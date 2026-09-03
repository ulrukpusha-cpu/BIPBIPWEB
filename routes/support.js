/**
 * API Support BIPBIP — widget chat (web/APK) + pont avec le bot Telegram support.
 *
 * Trois familles d'endpoints :
 *   /api/support/*            → le client (widget dans l'espace Aide)
 *   /api/support/admin/*      → la console admin (isAdminRequest)
 *   /api/support/bridge/*     → le bot Telegram (secret partagé)
 *
 * L'IA réutilise le cerveau du bot WhatsApp/Telegram (brain.mjs) par import dynamique
 * ESM : un SEUL prompt système BIPBIP pour les trois canaux, pas une 3e copie à maintenir.
 */
const express = require('express');
const router = express.Router();
const support = require('../services/supportChat');

const BRAIN_PATH = process.env.SUPPORT_BRAIN_PATH || '/root/var/www/bipbip-whatsapp-bot/brain.mjs';
const BRIDGE_SECRET = (process.env.SUPPORT_BRIDGE_SECRET || process.env.BOT_INTERNAL_SECRET || '').trim();
const ADMIN_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_ADMIN || process.env.TELEGRAM_BOT_TOKEN || '';

// Budget IA par conversation. Le rate-limit global (100 req/min/IP) protège le serveur,
// PAS la facture Groq : un seul client bavard = autant d'appels au 70b. Même bridage
// que le bot WhatsApp (cf. MAX_PER_HOUR côté responder.mjs).
const AI_MAX_PER_HOUR = Number(process.env.SUPPORT_AI_MAX_PER_HOUR || 12);
const AI_MIN_GAP_MS = Number(process.env.SUPPORT_AI_MIN_GAP_MS || 1500);
const aiBucket = new Map();

function aiBudgetOk(convId) {
    const now = Date.now();
    let b = aiBucket.get(convId);
    if (!b || now > b.resetAt) { b = { count: 0, resetAt: now + 3600e3, last: 0 }; aiBucket.set(convId, b); }
    if (now - b.last < AI_MIN_GAP_MS) return false;
    return b.count < AI_MAX_PER_HOUR;
}
function aiBudgetSpend(convId) {
    const b = aiBucket.get(convId);
    if (b) { b.count++; b.last = Date.now(); }
}

// ─────────────────────────── Cerveau IA (import paresseux) ───────────────────────────
let brainPromise = null;
function brain() {
    if (!brainPromise) {
        brainPromise = import(BRAIN_PATH).catch((e) => {
            console.error('[support] brain.mjs indisponible:', e.message);
            return null;
        });
    }
    return brainPromise;
}

// ─────────────────────────── Auth ───────────────────────────
// Même logique que isAdminRequest() de server.js (clé admin OU compte Telegram admin).
function isAdmin(req) {
    const secret = (process.env.ADMIN_SECRET_KEY || '').trim();
    const key = String(req.headers['x-admin-key'] || '').trim();
    if (secret && key && key === secret) return true;
    const ids = (process.env.ADMIN_CHAT_IDS || process.env.ADMIN_CHAT_ID || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
    const chatId = req.userId; // posé par le middleware authTelegram
    return !!(chatId && ids.includes(String(chatId)));
}

function isBridge(req) {
    if (!BRIDGE_SECRET) return false;
    const k = String(req.headers['x-bridge-secret'] || req.body?.secret || req.query?.secret || '').trim();
    return k === BRIDGE_SECRET;
}

// ─────────────────────────── Notification admin Telegram ───────────────────────────
function adminChatIds() {
    return (process.env.ADMIN_CHAT_IDS || process.env.ADMIN_CHAT_ID || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Ping les admins sur Telegram. Le marqueur #SUP:<convId> en fin de message est
 * la clé du dispositif : quand l'admin fait "répondre" à ce message dans Telegram,
 * server.js relit le marqueur et route sa réponse vers le bon client.
 */
async function notifyAdmins(conv, text, { force = false, throttleMs = 10 * 60000 } = {}) {
    const ids = adminChatIds();
    if (!ADMIN_BOT_TOKEN || !ids.length) return;
    // Anti-spam : un seul ping par conversation toutes les 10 min, sauf escalade explicite.
    const last = notifyAdmins._last || (notifyAdmins._last = new Map());
    if (!force && throttleMs > 0 && Date.now() - (last.get(conv.id) || 0) < throttleMs) return;
    last.set(conv.id, Date.now());

    // Le pseudo va dans <code> : une mention @xxx cliquable ouvrirait une
    // conversation depuis le profil PERSONNEL de l'admin (le client verrait son
    // vrai compte). Ici c'est du texte inerte, copiable mais pas cliquable.
    const who = escapeHtml(conv.name || 'Client')
        + (conv.username ? ` <code>${escapeHtml(String(conv.username).replace(/^@/, '@'))}</code>` : '');
    const canal = conv.channel === 'telegram' ? 'Telegram' : 'Appli/Web';
    const body = `${force ? '🙋 <b>Un client demande un conseiller</b>' : '💬 <b>Nouveau message support</b>'}\n`
        + `👤 ${who} · ${canal}\n\n`
        + `<i>${escapeHtml(String(text).slice(0, 500))}</i>\n\n`
        + `👇 Appuie sur <b>Répondre</b>, puis écris normalement.`;
    // Boutons : aucun "geste" Telegram requis (le reply long-press n'est pas
    // proposé partout, et un marqueur #SUP devenait un hashtag cliquable).
    const markup = {
        inline_keyboard: [[
            { text: '💬 Répondre', callback_data: `sup_rep_${conv.id}` },
            { text: '✅ Clore', callback_data: `sup_cls_${conv.id}` },
        ]],
    };
    for (const chatId of ids) {
        try {
            await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId, text: body, parse_mode: 'HTML',
                    disable_web_page_preview: true, reply_markup: markup,
                }),
            });
        } catch (e) { console.error('[support] notif admin KO:', e.message); }
    }
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────── Contexte commandes ───────────────────────────
async function ordersFor(userId, text) {
    const B = await brain();
    if (!B) return { orders: [], phonesKnown: false };
    const orders = [];
    let phonesKnown = false;

    // 1) Par le numéro cité dans le message (le client recharge souvent un AUTRE numéro).
    try {
        const phones = B.extractPhones(text || '');
        if (phones.length) {
            phonesKnown = true;
            const found = await B.lookupOrdersByPhones(phones);
            orders.push(...(found || []));
        }
    } catch (e) { /* lookup best-effort */ }

    // 2) Par l'identité du compte : sur le widget on SAIT qui parle (avantage sur WhatsApp).
    if (userId && !String(userId).startsWith('br_')) {
        try {
            const db = require('../database/db-supabase');
            const mine = await db.getOrdersByUserId(String(userId));
            for (const o of (mine || []).slice(0, 5)) {
                if (orders.some((x) => x.id === o.id)) continue;
                orders.push({
                    id: o.id, operator: o.operator, amount: o.amount,
                    amount_total: o.amountTotal, phone: o.phone,
                    status: o.status, proof: o.proof, created_at: o.createdAt,
                });
            }
        } catch (e) { /* Supabase indispo : on répond sans contexte commande */ }
    }
    return { orders: orders.slice(0, 5), phonesKnown: phonesKnown || orders.length > 0 };
}

// ═══════════════════════════ CLIENT (widget) ═══════════════════════════

/** Ouvre / récupère la conversation du client. */
router.post('/hello', async (req, res) => {
    const { userId, name, username } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const c = support.getOrCreate('web', userId, { name, username });
    support.markClientRead(c.id);
    res.json({
        conversationId: c.id,
        status: c.status,
        humanActive: support.isHumanActive(c.id),
        messages: support.threadSince(c.id, 0),
    });
});

/** Le client envoie un message → réponse IA (sauf si un humain a la main). */
router.post('/message', async (req, res) => {
    try {
        const { userId, name, username, text } = req.body || {};
        if (!userId || !String(text || '').trim()) {
            return res.status(400).json({ error: 'userId et text requis' });
        }
        const msg = String(text).trim().slice(0, 2000);
        const c = support.getOrCreate('web', userId, { name, username });
        support.addMessage(c.id, 'client', msg);

        const B = await brain();

        // Escalade explicite (litige, arnaque, "je veux un humain") → on passe la main.
        if (B && B.ESCALATE_RE.test(msg)) {
            support.requestHuman(c.id);
            const ack = 'Je transmets ta demande à un conseiller BIPBIP, il va te répondre ici même. Merci de patienter 🙏';
            support.addMessage(c.id, 'bot', ack);
            notifyAdmins(c, msg, { force: true }).catch(() => {});
            return res.json({ reply: ack, status: 'waiting', humanActive: false });
        }

        // Un humain a repris la main : l'IA se tait, l'admin est prévenu.
        if (support.isHumanActive(c.id) || c.status === 'waiting') {
            notifyAdmins(c, msg, { force: support.isHumanActive(c.id), throttleMs: 60000 }).catch(() => {});
            return res.json({ reply: null, status: c.status, humanActive: support.isHumanActive(c.id) });
        }

        if (!B) {
            const fb = "Le service d'assistance est momentanément indisponible. Écris-nous sur WhatsApp au +225 01 52 59 74 08 🙏";
            support.addMessage(c.id, 'bot', fb);
            return res.json({ reply: fb, status: c.status, humanActive: false });
        }

        // Budget IA épuisé : on bascule vers l'humain plutôt que de brûler des tokens.
        if (!aiBudgetOk(c.id)) {
            support.requestHuman(c.id);
            const ack = 'Je préfère te passer un conseiller BIPBIP pour bien traiter ta demande. Il te répond ici même 🙏';
            support.addMessage(c.id, 'bot', ack);
            notifyAdmins(c, msg, { force: true }).catch(() => {});
            return res.json({ reply: ack, status: 'waiting', humanActive: false });
        }
        aiBudgetSpend(c.id);

        const { orders, phonesKnown } = await ordersFor(userId, msg);
        const sys = B.systemPrompt(B.ordersContext(orders, phonesKnown), c.name || 'client', 'l\'application BIPBIP');
        const history = support.threadSince(c.id, 0).slice(-8)
            .map((m) => ({ role: m.from === 'client' ? 'user' : 'assistant', content: m.text }));

        let reply = '';
        try {
            reply = B.sanitizeReply(await B.askGroq([{ role: 'system', content: sys }, ...history]));
        } catch (e) {
            console.error('[support] Groq KO:', e.message);
        }
        if (!reply) {
            reply = "Désolé, peux-tu reformuler ? Je peux t'aider pour une recharge, un forfait, une carte cadeau ou le suivi d'une commande.";
        }
        support.addMessage(c.id, 'bot', reply);
        res.json({ reply, status: c.status, humanActive: false });
    } catch (e) {
        console.error('[support] /message', e.message);
        res.status(500).json({ error: 'erreur serveur' });
    }
});

/** Polling du widget : nouveaux messages depuis `since`. */
router.get('/thread', (req, res) => {
    const userId = String(req.query.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const id = support.convId('web', userId);
    const c = support.get(id);
    if (!c) return res.json({ messages: [], status: 'bot', humanActive: false });
    const since = Number(req.query.since || 0);
    res.json({
        messages: support.threadSince(id, since),
        status: c.status,
        humanActive: support.isHumanActive(id),
        unread: c.clientUnread || 0,
    });
});

/** Bouton « Parler à un conseiller ». */
router.post('/human', async (req, res) => {
    const { userId, name, username } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const c = support.getOrCreate('web', userId, { name, username });
    support.requestHuman(c.id);
    const ack = 'Un conseiller BIPBIP a été prévenu, il va te répondre ici même. Merci de patienter 🙏';
    support.addMessage(c.id, 'bot', ack);
    notifyAdmins(c, '(demande explicite de conseiller)', { force: true }).catch(() => {});
    res.json({ ok: true, reply: ack, status: 'waiting' });
});

router.post('/read', (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    support.markClientRead(support.convId('web', userId));
    res.json({ ok: true });
});

// ═══════════════════════════ ADMIN (console app) ═══════════════════════════

router.get('/admin/conversations', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
    res.json({
        conversations: support.list({ limit: Number(req.query.limit || 60) }),
        unread: support.totalAdminUnread(),
        waiting: support.waiting().length,
    });
});

router.get('/admin/conversations/:id', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
    const c = support.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Conversation introuvable' });
    support.markAdminRead(c.id);
    res.json({
        id: c.id, channel: c.channel, name: c.name, username: c.username,
        phone: c.phone, status: c.status, humanActive: support.isHumanActive(c.id),
        messages: support.threadSince(c.id, 0),
    });
});

/** L'admin répond → le message part vers le client (widget ou Telegram). */
router.post('/admin/conversations/:id/reply', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text requis' });
    const c = support.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Conversation introuvable' });
    const msg = support.addMessage(c.id, 'admin', text, { author: req.body?.author || 'Support BIPBIP' });
    // Canal web : le widget récupère au prochain polling → rien à pousser.
    // Canal telegram : le bot vient chercher via /bridge/outbound.
    res.json({ ok: true, message: msg, status: 'human' });
});

router.post('/admin/conversations/:id/close', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
    const c = support.setStatus(req.params.id, 'closed');
    if (!c) return res.status(404).json({ error: 'Conversation introuvable' });
    res.json({ ok: true });
});

/** Rend la main à l'IA sur cette conversation. */
router.post('/admin/conversations/:id/release', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
    const c = support.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Conversation introuvable' });
    c.handoffUntil = 0;
    support.setStatus(c.id, 'bot');
    res.json({ ok: true });
});

// ═══════════════════════════ BRIDGE (bot Telegram) ═══════════════════════════

/** Le bot pousse chaque message (client ou sa propre réponse) dans l'inbox. */
router.post('/bridge/ingest', async (req, res) => {
    if (!isBridge(req)) return res.status(401).json({ error: 'Non autorisé' });
    const { channel = 'telegram', peerId, name, username, from, text, escalate } = req.body || {};
    if (!peerId || !from || !text) return res.status(400).json({ error: 'peerId, from et text requis' });
    const c = support.getOrCreate(channel, peerId, { name, username });
    support.addMessage(c.id, from === 'client' ? 'client' : 'bot', text);
    if (escalate) {
        support.requestHuman(c.id);
        notifyAdmins(c, text, { force: true }).catch(() => {});
    } else if (from === 'client') {
        notifyAdmins(c, text, { force: support.isHumanActive(c.id), throttleMs: 60000 }).catch(() => {});
    }
    res.json({ ok: true, conversationId: c.id, humanActive: support.isHumanActive(c.id) });
});

/** Le bot vient chercher les réponses de l'admin à livrer au client. */
router.get('/bridge/outbound', (req, res) => {
    if (!isBridge(req)) return res.status(401).json({ error: 'Non autorisé' });
    const channel = String(req.query.channel || 'telegram');
    res.json({ messages: support.pendingOutbound(channel) });
});

/** Le bot confirme la livraison (sinon on re-tente au prochain tour). */
router.post('/bridge/delivered', (req, res) => {
    if (!isBridge(req)) return res.status(401).json({ error: 'Non autorisé' });
    const { convId, msgIds } = req.body || {};
    if (!convId) return res.status(400).json({ error: 'convId requis' });
    support.markDelivered(convId, msgIds || []);
    res.json({ ok: true });
});

/** Le bot signale un client definitivement injoignable (bloque / compte supprime). */
router.post('/bridge/failed', async (req, res) => {
    if (!isBridge(req)) return res.status(401).json({ error: 'Non autorise' });
    const { convId, msgIds, reason } = req.body || {};
    if (!convId) return res.status(400).json({ error: 'convId requis' });
    support.markFailed(convId, msgIds || [], reason);
    const c = support.get(convId);
    if (c) {
        // L'admin doit savoir que son message n'est PAS arrive.
        notifyAdmins(c, `\u26A0\uFE0F Ta reponse n'a PAS pu etre livree a ${c.name} : ${reason || 'client injoignable'}. `
            + `Il a probablement bloque le bot ou supprime son compte.`, { force: true }).catch(() => {});
    }
    res.json({ ok: true });
});

/** Le bot demande si un humain a la main (pour se taire). */
router.get('/bridge/state', (req, res) => {
    if (!isBridge(req)) return res.status(401).json({ error: 'Non autorisé' });
    const id = support.convId(String(req.query.channel || 'telegram'), String(req.query.peerId || ''));
    const c = support.get(id);
    res.json({ humanActive: c ? support.isHumanActive(id) : false, status: c ? c.status : 'bot' });
});

module.exports = router;
module.exports.notifyAdmins = notifyAdmins;
