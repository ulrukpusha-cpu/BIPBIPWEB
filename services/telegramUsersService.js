/**
 * Inscription automatique des utilisateurs Telegram (ID + photo de profil).
 * Appelé quand un client ouvre la Mini App avec initData valide.
 */
const path = require('path');
const fs = require('fs');
const db = require('../database/supabase-client');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'telegram-avatars');

function ensureAvatarsDir() {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

/**
 * Récupère l'URL de la photo de profil Telegram via l'API Bot, télécharge et sauvegarde en local.
 * Retourne le chemin public (ex: /uploads/telegram-avatars/123456.jpg) ou null.
 */
async function fetchAndSaveProfilePhoto(telegramId, botToken) {
    if (!botToken) return null;
    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: Number(telegramId), limit: 1 }),
        });
        const data = await res.json();
        if (!data.ok || !data.result?.photos?.length) return null;
        const photos = data.result.photos[0];
        const smallest = photos.length > 0 ? photos[0] : null;
        if (!smallest?.file_id) return null;

        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: smallest.file_id }),
        });
        const fileData = await fileRes.json();
        if (!fileData.ok || !fileData.result?.file_path) return null;

        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
        const ext = path.extname(fileData.result.file_path) || '.jpg';
        ensureAvatarsDir();
        const filename = `${telegramId}${ext}`;
        const destPath = path.join(AVATARS_DIR, filename);

        const imgRes = await fetch(fileUrl);
        if (!imgRes.ok) return null;
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(destPath, buffer);
        return `/uploads/telegram-avatars/${filename}`;
    } catch (e) {
        console.error('[telegramUsersService] fetchAndSaveProfilePhoto:', e.message);
        return null;
    }
}

/**
 * Crée ou met à jour un utilisateur Telegram. Récupère la photo si possible.
 * @param {object} telegramUser - Objet user de initData (id, first_name, last_name, username, language_code)
 * @param {string} botToken - TELEGRAM_BOT_TOKEN
 * @param {boolean} fetchPhoto - true pour tenter de récupérer la photo (défaut true)
 */
async function getOrCreateUser(telegramUser, botToken, fetchPhoto = true) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };

    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const telegramId = Number(telegramUser.id);
    if (!Number.isFinite(telegramId)) return { error: 'ID Telegram invalide' };

    const now = new Date().toISOString();
    let photoUrl = null;
    if (fetchPhoto && botToken) {
        photoUrl = await fetchAndSaveProfilePhoto(telegramId, botToken);
    }

    const referralCodeForNewUser = (typeof telegramUser.referral_code === 'string' && telegramUser.referral_code.trim()) ? telegramUser.referral_code.trim() : null;

    const row = {
        telegram_id: telegramId,
        username: telegramUser.username || null,
        first_name: telegramUser.first_name || null,
        last_name: telegramUser.last_name || null,
        language_code: telegramUser.language_code || null,
        photo_url: photoUrl,
        updated_at: now,
        referral_code: 'R' + String(telegramId),
    };
    const { data: existing } = await supabase
        .from(tableName)
        .select('telegram_id, photo_url, created_at')
        .eq('telegram_id', telegramId)
        .single();

    if (existing) {
        const update = {
            username: row.username,
            first_name: row.first_name,
            last_name: row.last_name,
            language_code: row.language_code,
            updated_at: now,
        };
        if (photoUrl) update.photo_url = photoUrl;
        const { data: updated, error } = await supabase
            .from(tableName)
            .update(update)
            .eq('telegram_id', telegramId)
            .select()
            .single();
        if (error) {
            console.error('[telegramUsersService] update error:', error.message, 'table=', tableName);
            return { error: error.message };
        }
        return { user: { ...updated, created_at: existing.created_at } };
    }

    let referredBy = null;
    if (referralCodeForNewUser && referralCodeForNewUser.startsWith('ref_')) {
        const code = referralCodeForNewUser.replace(/^ref_/, '').trim();
        const { data: referrer } = await supabase.from(tableName).select('telegram_id').eq('referral_code', code).neq('telegram_id', telegramId).maybeSingle();
        if (referrer) referredBy = referrer.telegram_id;
    }
    const insertRow = { ...row, created_at: now };
    if (referredBy) insertRow.referred_by = referredBy;

    const { data: inserted, error } = await supabase
        .from(tableName)
        .insert(insertRow)
        .select()
        .single();
    if (error) {
        console.error('[telegramUsersService] insert error:', error.message, 'table=', tableName);
        return { error: error.message };
    }
    const REFERRAL_BONUS = 20;
    if (referredBy) {
        await addPoints(referredBy, REFERRAL_BONUS, 'referral', 'Ami invite inscrit');
    }
    return { user: inserted };
}

/**
 * Récupère un utilisateur par son telegram_id.
 */
async function getByTelegramId(telegramId) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const { data } = await supabase
        .from(tableName)
        .select('*')
        .eq('telegram_id', Number(telegramId))
        .single();
    return data;
}


/**
 * Log une ligne dans points_history. Non-bloquant (try/catch silencieux).
 * Ne loggue PAS si action/description contient 'test' ou si telegramId est web_xxx.
 */
async function logPointsHistory(telegramId, amount, action, description) {
    try {
        const supabase = db.getSupabase();
        if (!supabase) return;
        const id = Number(telegramId);
        if (!Number.isFinite(id)) return; // web_xxx / google string → pas de log (ou a adapter)
        if (!Number.isFinite(amount) || amount === 0) return;
        await supabase.from('points_history').insert({
            telegram_id: id,
            amount: amount,
            action: String(action || 'unknown').slice(0, 50),
            description: description ? String(description).slice(0, 200) : null,
        });
    } catch (e) {
        // silencieux: un echec de log ne doit pas casser le credit de points
    }
}

/**
 * Recupere l'historique des points d'un utilisateur (les plus recents en premier).
 */
async function listPointsHistory(telegramId, limit = 50) {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const id = Number(telegramId);
    if (!Number.isFinite(id)) return [];
    const { data } = await supabase
        .from('points_history')
        .select('id, amount, action, description, created_at')
        .eq('telegram_id', id)
        .order('created_at', { ascending: false })
        .limit(Math.min(200, Math.max(1, limit)));
    return data || [];
}

/**
 * Ajoute des points à un utilisateur (quêtes, etc.). Retourne le nouveau total ou null.
 */
async function addPoints(telegramId, amount, action, description) {
    const supabase = db.getSupabase();
    if (!supabase || !Number.isFinite(amount) || amount < 0) return null;
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const { data: user } = await supabase.from(tableName).select('points').eq('telegram_id', Number(telegramId)).single();
    if (!user) return null;
    const newPoints = (user.points || 0) + amount;
    const { error } = await supabase.from(tableName).update({ points: newPoints, updated_at: new Date().toISOString() }).eq('telegram_id', Number(telegramId));
    if (error) return null;
    // Log historique (non-bloquant)
    logPointsHistory(telegramId, amount, action || 'bonus', description).catch(() => {});
    return newPoints;
}

/**
 * Liste les utilisateurs ayant un lien YouTube/X enregistré (pour admin bot /liens).
 */
async function listUsersWithSocialLink(limit = 50) {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const { data } = await supabase
        .from(tableName)
        .select('telegram_id, first_name, last_name, username, social_link, social_link_approved, updated_at')
        .not('social_link', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(limit);
    return data || [];
}

/**
 * Met à jour le lien social (YouTube / X) du profil.
 */
async function updateSocialLink(telegramId, socialLink) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const link = socialLink == null ? null : String(socialLink).trim().slice(0, 500) || null;
    const { data, error } = await supabase.from(tableName).update({ social_link: link, updated_at: new Date().toISOString() }).eq('telegram_id', Number(telegramId)).select().single();
    if (error) return { error: error.message };
    return { user: data };
}

/**
 * Approuve le lien YouTube/X d'un utilisateur (visible dans Quêtes, clic = points).
 */
async function approveSocialLink(telegramId) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const { data, error } = await supabase.from(tableName).update({ social_link_approved: true, updated_at: new Date().toISOString() }).eq('telegram_id', Number(telegramId)).not('social_link', 'is', null).select().single();
    if (error) return { error: error.message };
    return data ? { user: data } : { error: 'Utilisateur ou lien introuvable' };
}

/**
 * Génère un titre et une description attractifs selon le domaine/type du lien.
 */
function getLinkPromo(url) {
    const u = (url || '').toLowerCase();
    if (u.includes('immutable.com') || u.includes('immutablex')) {
        return { icon: '🎮', title: 'Crée ton Passport Immutable Play', desc: 'On vous offre une rotation de $5 000 de prix !' };
    }
    if (u.includes('youtube.com') || u.includes('youtu.be')) {
        return { icon: '▶️', title: 'Abonne-toi à cette chaîne YouTube', desc: 'Découvre du contenu exclusif' };
    }
    if (u.includes('twitter.com') || u.includes('x.com')) {
        return { icon: '𝕏', title: 'Suis ce compte sur X', desc: 'Reste connecté aux dernières actus' };
    }
    if (u.includes('t.me') || u.includes('telegram')) {
        return { icon: '✈️', title: 'Rejoins ce canal Telegram', desc: 'Accède à la communauté' };
    }
    if (u.includes('tiktok.com')) {
        return { icon: '🎵', title: 'Suis ce compte TikTok', desc: 'Vidéos courtes et fun' };
    }
    if (u.includes('instagram.com')) {
        return { icon: '📸', title: 'Suis ce compte Instagram', desc: 'Photos et stories exclusives' };
    }
    if (u.includes('facebook.com') || u.includes('fb.com')) {
        return { icon: '👥', title: 'Rejoins cette page Facebook', desc: 'Communauté et partages' };
    }
    if (u.includes('discord.gg') || u.includes('discord.com')) {
        return { icon: '💬', title: 'Rejoins ce serveur Discord', desc: 'Échange avec la communauté' };
    }
    if (u.includes('referral') || u.includes('invite') || u.includes('ref=') || u.includes('ref_')) {
        return { icon: '🎁', title: 'Profite de cette offre de parrainage', desc: 'Inscris-toi et gagne des récompenses' };
    }
    return { icon: '🔗', title: 'Découvre ce lien', desc: 'Clique et gagne des points' };
}

/**
 * Liste des liens YouTube/X approuvés (pour l'espace Quêtes).
 */
async function listApprovedLinks() {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const { data } = await supabase.from(tableName).select('telegram_id, first_name, last_name, username, social_link').eq('social_link_approved', true).not('social_link', 'is', null).order('updated_at', { ascending: false });
    return (data || []).map((u) => {
        const promo = getLinkPromo(u.social_link);
        return {
            id: String(u.telegram_id),
            link: u.social_link,
            icon: promo.icon,
            label: promo.title,
            desc: promo.desc,
            by: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '',
        };
    });
}

const POINTS_PER_LINK_CLICK = 5;

/**
 * Vérifie si l'utilisateur a déjà cliqué sur ce lien (éviter double points).
 */
async function hasUserClickedLink(userId, linkOwnerTelegramId) {
    const supabase = db.getSupabase();
    if (!supabase) return true;
    const { data } = await supabase.from('user_link_clicks').select('id').eq('user_id', String(userId)).eq('link_owner_telegram_id', Number(linkOwnerTelegramId)).limit(1).maybeSingle();
    return !!data;
}

/**
 * Enregistre un clic et crédite les points (une seule fois par user/lien).
 */
async function recordLinkClickAndAddPoints(userId, linkOwnerTelegramId) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    const already = await hasUserClickedLink(userId, linkOwnerTelegramId);
    if (already) return { alreadyClicked: true };
    const { error: insertErr } = await supabase.from('user_link_clicks').insert({
        user_id: String(userId),
        link_owner_telegram_id: Number(linkOwnerTelegramId),
    });
    if (insertErr) return { error: insertErr.message };
    const newTotal = await addPoints(userId, POINTS_PER_LINK_CLICK, 'link_click', 'Clic lien approuve');
    return { pointsAdded: POINTS_PER_LINK_CLICK, totalPoints: newTotal };
}

const DAILY_CHECKIN_REWARDS = [5, 10, 15, 20, 25, 30, 50];

function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * État du daily check-in (série 7 jours).
 * Après le 7e jour réclamé, le lendemain la grille repart à 0 (nouveau cycle) et next_streak = 1.
 */
async function getDailyCheckin(telegramId) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const { data } = await supabase.from(tableName).select('last_checkin_at, checkin_streak').eq('telegram_id', Number(telegramId)).single();
    if (!data) return null;
    const last = data.last_checkin_at ? (typeof data.last_checkin_at === 'string' ? data.last_checkin_at.slice(0, 10) : null) : null;
    const dbStreak = Math.min(7, Math.max(0, Number(data.checkin_streak) || 0));
    const today = todayStr();
    const yesterday = yesterdayStr();

    // Jours « remplis » sur la grille pour le cycle en cours (pas le brut DB si on attend le jour 1 d’un nouveau cycle)
    let displayStreak = 0;
    if (!last) {
        displayStreak = 0;
    } else if (last === today) {
        displayStreak = dbStreak;
    } else if (last === yesterday) {
        if (dbStreak >= 7) {
            displayStreak = 0;
        } else {
            displayStreak = dbStreak;
        }
    } else {
        displayStreak = 0;
    }

    let canClaim = false;
    let nextStreak = 1;
    if (last === today) {
        canClaim = false;
        nextStreak = dbStreak;
    } else if (!last || last === yesterday) {
        canClaim = true;
        if (!last) {
            nextStreak = 1;
        } else if (last === yesterday) {
            if (dbStreak >= 7) {
                nextStreak = 1;
            } else {
                nextStreak = Math.min(7, dbStreak + 1);
            }
        }
    } else {
        canClaim = true;
        nextStreak = 1;
    }

    return {
        streak: displayStreak,
        next_streak: nextStreak,
        last_checkin_at: last,
        can_claim: canClaim,
        rewards: DAILY_CHECKIN_REWARDS,
        reward_today: canClaim ? DAILY_CHECKIN_REWARDS[Math.min(nextStreak - 1, 6)] : 0,
    };
}

/**
 * Réclamer le bonus du jour (daily check-in).
 */
async function claimDailyCheckin(telegramId) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    const state = await getDailyCheckin(telegramId);
    if (!state || !state.can_claim) return { error: 'Déjà réclamé aujourd\'hui ou indisponible' };
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const newStreak = state.next_streak;
    const points = state.reward_today || DAILY_CHECKIN_REWARDS[0];
    const { error } = await supabase.from(tableName).update({
        last_checkin_at: todayStr(),
        checkin_streak: newStreak,
        updated_at: new Date().toISOString(),
    }).eq('telegram_id', Number(telegramId));
    if (error) return { error: error.message };
    const newTotal = await addPoints(telegramId, points, 'daily_checkin', 'Connexion quotidienne jour ' + newStreak);
    return { points_earned: points, streak: newStreak, total_points: newTotal };
}

/**
 * Récupère ou génère le code parrain et le lien d'invitation.
 */
async function getReferralInfo(telegramId, botUsername) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    let { data } = await supabase.from(tableName).select('referral_code').eq('telegram_id', Number(telegramId)).single();
    if (!data) return null;
    let code = data.referral_code;
    if (!code) {
        code = 'R' + String(telegramId);
        await supabase.from(tableName).update({ referral_code: code, updated_at: new Date().toISOString() }).eq('telegram_id', Number(telegramId));
    }
    const link = botUsername ? `https://t.me/${botUsername.replace('@', '')}?start=ref_${code}` : null;
    return { referral_code: code, referral_link: link };
}


/**
 * Met a jour la langue preferee de l'utilisateur (fr|en).
 */
async function updateLanguage(telegramId, lang) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    if (lang !== 'fr' && lang !== 'en') return { error: 'Langue invalide' };
    const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
    const id = Number(telegramId);
    if (!Number.isFinite(id)) return { error: 'User non supporte' };
    const { data, error } = await supabase.from(tableName)
        .update({ language: lang, updated_at: new Date().toISOString() })
        .eq('telegram_id', id).select().single();
    if (error) return { error: error.message };
    return { user: data };
}

module.exports = {
    getOrCreateUser,
    updateLanguage,
    listPointsHistory,
    getByTelegramId,
    addPoints,
    updateSocialLink,
    listUsersWithSocialLink,
    listApprovedLinks,
    approveSocialLink,
    hasUserClickedLink,
    recordLinkClickAndAddPoints,
    POINTS_PER_LINK_CLICK,
    getDailyCheckin,
    claimDailyCheckin,
    getReferralInfo,
    DAILY_CHECKIN_REWARDS,
    fetchAndSaveProfilePhoto,
};
