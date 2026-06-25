#!/usr/bin/env python3
"""
Ajoute les endpoints /api/auth/telegram-poll/* pour le flow APK natif :
  - POST /create  -> token UUID
  - POST /claim   -> appele par le bot avec X-Bot-Secret + user
  - GET  /check   -> APK polle pour recuperer la session
"""
import re
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

PATCH = '''
// ============================================================
// Telegram-poll : flow auth APK natif via deep link bot
// ============================================================
// Stockage en memoire (5 min TTL). Pour multi-instance, remplacer par Redis.
const __tgPollStore = new Map();
const __TG_POLL_TTL_MS = 5 * 60 * 1000;
function __tgPollCleanup() {
    const now = Date.now();
    for (const [k, v] of __tgPollStore.entries()) {
        if (now - v.createdAt > __TG_POLL_TTL_MS) __tgPollStore.delete(k);
    }
}
setInterval(__tgPollCleanup, 60 * 1000);

// 1) APK demande un token unique
app.post('/api/auth/telegram-poll/create', (req, res) => {
    const token = 'tgp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    __tgPollStore.set(token, { createdAt: Date.now(), status: 'pending', user: null, sessionToken: null });
    res.json({ ok: true, token, botUsername: process.env.TELEGRAM_BOT_USERNAME || 'BIPBIPRechargeProCi_bot' });
});

// 2) Le bot reclame le token avec les infos user Telegram
app.post('/api/auth/telegram-poll/claim', async (req, res) => {
    const secret = req.headers['x-bot-secret'] || '';
    if (!process.env.BOT_INTERNAL_SECRET || secret !== process.env.BOT_INTERNAL_SECRET) {
        return res.status(401).json({ ok: false, error: 'invalid bot secret' });
    }
    const { token, telegramUser } = req.body || {};
    if (!token || !telegramUser || !telegramUser.id) {
        return res.status(400).json({ ok: false, error: 'token + telegramUser.id requis' });
    }
    const slot = __tgPollStore.get(token);
    if (!slot) return res.status(404).json({ ok: false, error: 'token introuvable ou expire' });

    // Cree une session pour cet utilisateur (reutilise la logique existante)
    try {
        const sessionToken = require('crypto').randomBytes(32).toString('hex');
        // Stocke dans Supabase/DB si dispo, sinon en memoire
        if (typeof supabase !== 'undefined' && supabase) {
            await supabase.from('telegram_login_sessions').upsert({
                session_token: sessionToken,
                user_id: String(telegramUser.id),
                created_at: new Date().toISOString()
            }, { onConflict: 'session_token' });
        }
        const user = {
            telegram_id: telegramUser.id,
            first_name: telegramUser.first_name || '',
            last_name: telegramUser.last_name || '',
            username: telegramUser.username || '',
            photo_url: telegramUser.photo_url || ''
        };
        slot.status = 'claimed';
        slot.user = user;
        slot.sessionToken = sessionToken;
        slot.claimedAt = Date.now();
        res.json({ ok: true });
    } catch (e) {
        console.error('[tg-poll/claim]', e);
        res.status(500).json({ ok: false, error: 'erreur serveur' });
    }
});

// 3) APK polle pour savoir si le token est reclame
app.get('/api/auth/telegram-poll/check', (req, res) => {
    const token = String(req.query.token || '');
    if (!token) return res.status(400).json({ ok: false, error: 'token requis' });
    const slot = __tgPollStore.get(token);
    if (!slot) return res.status(404).json({ ok: false, error: 'token expire' });
    if (slot.status === 'claimed') {
        // One-shot : on supprime apres lecture
        __tgPollStore.delete(token);
        return res.json({ ok: true, status: 'claimed', user: slot.user, sessionToken: slot.sessionToken });
    }
    res.json({ ok: true, status: 'pending' });
});
// ============================================================
// /Telegram-poll
// ============================================================

'''

ANCHOR = "app.post('/api/admin/verify-pin'"

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if '__tgPollStore' in content:
    print('ALREADY_PATCHED')
    sys.exit(0)

idx = content.find(ANCHOR)
if idx < 0:
    print('ANCHOR_NOT_FOUND')
    sys.exit(1)

# Insere PATCH juste avant l'ancre
content = content[:idx] + PATCH + '\n' + content[idx:]

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
