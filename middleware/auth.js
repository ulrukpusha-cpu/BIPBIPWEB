/**
 * Authentification Telegram (initData) - comme BipbipRecharge v2
 * Valide le header X-Telegram-Init-Data ou body.initData / query.initData
 */
const crypto = require('crypto');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function validateTelegramWebAppInitData(initData, botToken) {
    if (!initData || !botToken) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculated !== hash) return null;
    try {
        const user = JSON.parse(params.get('user') || '{}');
        return user;
    } catch {
        return null;
    }
}

function authTelegram(req, res, next) {
    const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData;
    const user = validateTelegramWebAppInitData(initData, TELEGRAM_BOT_TOKEN);
    if (user) {
        req.telegramUser = user;
        req.userId = String(user.id);
    } else {
        req.telegramUser = null;

        // Google session : header X-Google-Session + userId numérique (ID négatif)
        const googleSession = req.headers['x-google-session'] || '';
        const bodyUid = req.body?.userId || req.query?.userId || null;

        if (googleSession && typeof bodyUid === 'string' && /^-?\d+$/.test(bodyUid)) {
            req.userId = bodyUid;
            req.authType = 'google';
        } else {
            // Accepter le userId du body pour les utilisateurs navigateur (préfixé web_)
            req.userId = (typeof bodyUid === 'string' && bodyUid.startsWith('web_')) ? bodyUid : null;
        }
    }
    next();
}

function requireAuth(req, res, next) {
    if (!req.userId) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    next();
}

/**
 * Retourne true si la requête vient d'un utilisateur Telegram ou Google enregistré.
 * Rejette les utilisateurs anonymes (userId préfixé web_).
 */
function isRegisteredUser(req) {
    if (req.telegramUser && req.userId) return true;          // Telegram valide
    if (req.authType === 'google' && req.userId &&
        /^-?\d+$/.test(req.userId)) return true;             // Google valide
    return false;
}

module.exports = {
    authTelegram,
    requireAuth,
    validateTelegramWebAppInitData,
    isRegisteredUser,
};
