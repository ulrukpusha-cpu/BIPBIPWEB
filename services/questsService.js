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

module.exports = {
    listActiveQuests,
    claimQuestByCode,
    getUserProgress,
    getOrCreateUserQuest,
    setProgress,
    completeQuest,
};
