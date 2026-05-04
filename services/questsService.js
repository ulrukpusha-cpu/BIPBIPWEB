/**
 * Quêtes : liste active, progression user, complétion
 */
const db = require('../database/supabase-client');

// --- Vérification Telegram (abonnement + boost) via Bot API ---
const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHANNEL = process.env.TELEGRAM_CHANNEL || '@bipbiprecharge';

async function tgApiCall(method, params) {
    if (!TG_BOT_TOKEN) return { ok: false, description: 'TELEGRAM_BOT_TOKEN manquant' };
    try {
        const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        return await r.json();
    } catch (e) {
        return { ok: false, description: e.message || 'network error' };
    }
}

async function verifyTelegramSubscribe(telegramUserId) {
    const r = await tgApiCall('getChatMember', { chat_id: TG_CHANNEL, user_id: Number(telegramUserId) });
    if (!r.ok) return { verified: false, error: r.description };
    const status = r.result && r.result.status;
    return { verified: ['creator', 'administrator', 'member', 'restricted'].includes(status), status };
}

async function verifyTelegramBoost(telegramUserId) {
    const r = await tgApiCall('getUserChatBoosts', { chat_id: TG_CHANNEL, user_id: Number(telegramUserId) });
    if (!r.ok) return { verified: false, error: r.description };
    const boosts = (r.result && r.result.boosts) || [];
    const now = Math.floor(Date.now() / 1000);
    const active = boosts.filter(b => !b.expiration_date || b.expiration_date > now);
    return { verified: active.length > 0, boosts: active.length };
}

async function listActiveQuests() {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.from('quests').select('*').eq('is_active', true).order('points_reward', { ascending: false });
    return data || [];
}

async function getUserProgress(userId) {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.from('user_quests').select('*, quests(*)').eq('user_id', String(userId));
    return data || [];
}

async function getOrCreateUserQuest(userId, questId) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    let { data } = await supabase.from('user_quests').select('*').eq('user_id', String(userId)).eq('quest_id', questId).single();
    if (!data) {
        const { data: inserted } = await supabase.from('user_quests').insert({
            user_id: String(userId),
            quest_id: questId,
            progress: 0,
            completed: false,
        }).select().single();
        data = inserted;
    }
    return data;
}

async function setProgress(userId, questId, progress, completed = false) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const payload = { progress };
    if (completed) {
        payload.completed = true;
        payload.completed_at = new Date().toISOString();
    }
    const { data } = await supabase.from('user_quests').update(payload).eq('user_id', String(userId)).eq('quest_id', questId).select().single();
    return data;
}

async function completeQuest(userId, questId) {
    return setProgress(userId, questId, 999, true);
}


/**
 * Reclamer la recompense d'une quete par code (idempotent).
 * Retourne { success, points_earned, total_points, already_claimed, error }
 */
async function claimQuestByCode(userId, code) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    const uid = String(userId);

    // 1) Trouver la quete
    const { data: quest, error: qErr } = await supabase
        .from('quests')
        .select('id, code, points_reward, is_active')
        .eq('code', code)
        .maybeSingle();
    if (qErr) return { error: qErr.message };
    if (!quest || !quest.is_active) return { error: 'Quete introuvable' };

    // 2) Verifier user_quests
    let { data: uq } = await supabase
        .from('user_quests')
        .select('*')
        .eq('user_id', uid)
        .eq('quest_id', quest.id)
        .maybeSingle();

    if (uq && uq.completed) {
        return { already_claimed: true };
    }

    // 2.5) Vérification stricte pour les quêtes Telegram (abonnement / boost)
    //      On NE marque PAS completed si la vérification échoue, pour permettre le retry.
    if (code === 'telegram_subscribe' || code === 'telegram_boost') {
        // Ces quêtes exigent un vrai compte Telegram (userId numérique)
        if (!/^-?\d+$/.test(uid)) {
            return { error: 'Connecte ton compte Telegram pour cette quête.', needs_telegram: true };
        }
        const verify = code === 'telegram_subscribe'
            ? await verifyTelegramSubscribe(uid)
            : await verifyTelegramBoost(uid);
        if (!verify.verified) {
            const msg = code === 'telegram_subscribe'
                ? 'Tu n\'es pas encore abonné au canal @bipbiprecharge. Abonne-toi puis réessaie.'
                : 'Aucun boost actif détecté sur @bipbiprecharge. Booste le canal puis réessaie.';
            return { error: msg, not_verified: true, tg_error: verify.error || null };
        }
    }

    // 3) Marquer completee
    if (!uq) {
        const ins = await supabase.from('user_quests').insert({
            user_id: uid, quest_id: quest.id, progress: 1,
            completed: true, completed_at: new Date().toISOString(),
        }).select().single();
        if (ins.error) return { error: ins.error.message };
    } else {
        const upd = await supabase.from('user_quests').update({
            progress: Math.max(uq.progress || 0, 1),
            completed: true,
            completed_at: new Date().toISOString(),
        }).eq('user_id', uid).eq('quest_id', quest.id);
        if (upd.error) return { error: upd.error.message };
    }

    // 4) Crediter les points (seulement pour users enregistres Telegram/Google: numerique)
    const telegramUsersService = require('./telegramUsersService');
    const isRegistered = /^-?\d+$/.test(uid);
    let total = null;
    if (isRegistered) {
        total = await telegramUsersService.addPoints(uid, quest.points_reward || 0, 'quest', 'Quete: ' + (quest.code || ''));
    }

    return {
        success: true,
        points_earned: isRegistered ? (quest.points_reward || 0) : 0,
        total_points: total,
        code: quest.code,
    };
}


/**
 * Incremente la progression d'une quete par code (idempotent par item_id si fourni).
 * Utilise pour les quetes "fais X N fois" comme "Lire 5 articles".
 *
 * @param {string} userId - id Telegram du user
 * @param {string} code - code de la quete (ex: "lire_5_articles")
 * @param {object} options - { increment: 1, item_id: 'slug-unique' }
 *   Si item_id fourni, on n'incremente qu'une fois par item (dedupe via metadata).
 * @returns { success, progress, target, completed, just_completed, already_claimed, points_earned }
 */
async function incrementProgressByCode(userId, code, options = {}) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    const uid = String(userId);
    const increment = Number(options.increment) || 1;
    const itemId = options.item_id ? String(options.item_id) : null;

    // 1) Trouver la quete
    const { data: quest, error: qErr } = await supabase
        .from('quests')
        .select('id, code, points_reward, target_value, is_active')
        .eq('code', code)
        .maybeSingle();
    if (qErr) return { error: qErr.message };
    if (!quest || !quest.is_active) return { error: 'Quete introuvable' };

    const target = Number(quest.target_value) || 1;

    // 2) Recuperer / creer user_quest
    let { data: uq } = await supabase
        .from('user_quests')
        .select('*')
        .eq('user_id', uid)
        .eq('quest_id', quest.id)
        .maybeSingle();

    if (uq && uq.completed) {
        return {
            already_claimed: true,
            progress: uq.progress || target,
            target,
            completed: true,
        };
    }

    // 3) Dedupe par item_id si fourni (via metadata.items[])
    let items = [];
    if (uq && uq.metadata && Array.isArray(uq.metadata.items)) {
        items = uq.metadata.items;
    }
    if (itemId) {
        if (items.indexOf(itemId) >= 0) {
            // Item deja compte — pas d'incrementation
            return {
                success: true,
                progress: uq ? (uq.progress || 0) : 0,
                target,
                completed: false,
                just_completed: false,
                duplicate: true,
            };
        }
        items.push(itemId);
    }

    const oldProgress = uq ? (uq.progress || 0) : 0;
    const newProgress = Math.min(oldProgress + increment, target);
    const justCompleted = newProgress >= target && !(uq && uq.completed);

    // 4) Upsert user_quest
    const payload = {
        user_id: uid,
        quest_id: quest.id,
        progress: newProgress,
        completed: justCompleted,
    };
    if (itemId) payload.metadata = { items };
    if (justCompleted) payload.completed_at = new Date().toISOString();

    if (!uq) {
        const ins = await supabase.from('user_quests').insert(payload).select().single();
        if (ins.error) return { error: ins.error.message };
    } else {
        // Conserver le metadata existant + items
        const upd = await supabase.from('user_quests').update(payload)
            .eq('user_id', uid).eq('quest_id', quest.id);
        if (upd.error) return { error: upd.error.message };
    }

    // 5) Si juste complete, crediter les points (users registres seulement)
    let pointsEarned = 0;
    let totalPoints = null;
    if (justCompleted) {
        const telegramUsersService = require('./telegramUsersService');
        const isRegistered = /^-?\d+$/.test(uid);
        if (isRegistered) {
            pointsEarned = quest.points_reward || 0;
            totalPoints = await telegramUsersService.addPoints(
                uid, pointsEarned, 'quest', 'Quete: ' + (quest.code || '')
            );
        }
    }

    return {
        success: true,
        progress: newProgress,
        target,
        completed: justCompleted,
        just_completed: justCompleted,
        points_earned: pointsEarned,
        total_points: totalPoints,
        code: quest.code,
    };
}

module.exports = {
    listActiveQuests,
    claimQuestByCode,
    incrementProgressByCode,
    getUserProgress,
    getOrCreateUserQuest,
    setProgress,
    completeQuest,
};
