/**
 * Inbox support unifiée BIPBIP.
 *
 * Une seule source de vérité pour TOUTES les conversations client, quel que soit
 * le canal (widget web/APK, bot Telegram @Bipbipsuppbot). Avant ça, le bot Telegram
 * gardait tout en RAM : l'admin ne voyait rien et ne pouvait pas reprendre la main.
 *
 * Persistance fichier (même convention que deposits.json / market_quota.json).
 * Volume réel : quelques messages par minute au pire → écriture synchrone, pas de debounce
 * (un message perdu au restart serait bien plus grave que le coût du writeFileSync).
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'support_conversations.json');

const MAX_CONVERSATIONS = 300;   // au-delà, on purge les plus anciennes closes
const MAX_MESSAGES = 200;        // par conversation
const HANDOFF_MINUTES = Number(process.env.SUPPORT_HANDOFF_MIN || 30);

let db = { conversations: {} };

function load() {
    try {
        if (fs.existsSync(FILE)) {
            const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
            if (raw && typeof raw === 'object' && raw.conversations) db = raw;
        }
    } catch (e) {
        console.error('[support] lecture', FILE, 'KO:', e.message);
        db = { conversations: {} };
    }
}
load();

function save() {
    try {
        fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('[support] écriture KO:', e.message);
    }
}

function purge() {
    const ids = Object.keys(db.conversations);
    if (ids.length <= MAX_CONVERSATIONS) return;
    // On sacrifie d'abord les conversations closes les plus anciennes.
    const sorted = ids
        .map((id) => db.conversations[id])
        .sort((a, b) => {
            const ca = a.status === 'closed' ? 0 : 1;
            const cb = b.status === 'closed' ? 0 : 1;
            if (ca !== cb) return ca - cb;
            return (a.lastAt || 0) - (b.lastAt || 0);
        });
    const toDrop = sorted.slice(0, ids.length - MAX_CONVERSATIONS);
    for (const c of toDrop) delete db.conversations[c.id];
}

const now = () => Date.now();
const convId = (channel, peerId) => `${channel}:${peerId}`;
let msgSeq = 0;
const nextMsgId = () => `${now().toString(36)}${(msgSeq = (msgSeq + 1) % 1000).toString(36)}`;

/**
 * Récupère (ou crée) la conversation d'un client sur un canal donné.
 * meta = { name, username, phone, avatar }
 */
function getOrCreate(channel, peerId, meta = {}) {
    const id = convId(channel, String(peerId));
    let c = db.conversations[id];
    if (!c) {
        c = db.conversations[id] = {
            id,
            channel,
            peerId: String(peerId),
            name: meta.name || 'Client',
            username: meta.username || null,
            phone: meta.phone || null,
            status: 'bot',            // bot | waiting | human | closed
            createdAt: now(),
            lastAt: now(),
            lastClientAt: now(),
            adminUnread: 0,           // messages client non lus par l'admin
            clientUnread: 0,          // messages admin/bot non lus par le client (badge widget)
            handoffUntil: 0,          // tant que > now(), l'IA se tait
            messages: [],
        };
        purge();
    }
    // On rafraîchit l'identité si le canal nous en donne une meilleure.
    if (meta.name && meta.name !== 'Client') c.name = meta.name;
    if (meta.username) c.username = meta.username;
    if (meta.phone) c.phone = meta.phone;
    return c;
}

function get(id) {
    return db.conversations[id] || null;
}

/**
 * from : 'client' | 'bot' | 'admin'
 * opts : { author, deliver (bool: à livrer sur le canal), meta }
 */
function addMessage(id, from, text, opts = {}) {
    const c = db.conversations[id];
    if (!c) return null;
    const msg = {
        id: nextMsgId(),
        from,
        text: String(text || '').slice(0, 4000),
        at: now(),
        author: opts.author || null,
    };
    // Un message admin doit être poussé vers le canal du client (Telegram) → file d'attente.
    if (from === 'admin' && opts.deliver !== false) msg.pending = true;

    c.messages.push(msg);
    if (c.messages.length > MAX_MESSAGES) c.messages = c.messages.slice(-MAX_MESSAGES);
    c.lastAt = msg.at;

    if (from === 'client') {
        c.lastClientAt = msg.at;
        c.adminUnread = (c.adminUnread || 0) + 1;
        if (c.status === 'closed') c.status = 'bot';
    } else {
        c.clientUnread = (c.clientUnread || 0) + 1;
    }
    if (from === 'admin') {
        // L'admin a repris la main : l'IA se tait sur CETTE conversation uniquement.
        c.status = 'human';
        c.handoffUntil = now() + HANDOFF_MINUTES * 60000;
        c.adminUnread = 0;
    }
    save();
    return msg;
}

/** L'IA doit-elle répondre ? Non si un humain a la main. */
function isHumanActive(id) {
    const c = db.conversations[id];
    if (!c) return false;
    return c.status === 'human' && (c.handoffUntil || 0) > now();
}

/** Le client réclame explicitement un conseiller. */
function requestHuman(id) {
    const c = db.conversations[id];
    if (!c) return null;
    if (c.status !== 'human') c.status = 'waiting';
    c.escalatedAt = now();
    save();
    return c;
}

function setStatus(id, status) {
    const c = db.conversations[id];
    if (!c) return null;
    c.status = status;
    if (status === 'closed') { c.handoffUntil = 0; c.adminUnread = 0; }
    save();
    return c;
}

function markAdminRead(id) {
    const c = db.conversations[id];
    if (!c) return null;
    c.adminUnread = 0;
    save();
    return c;
}

function markClientRead(id) {
    const c = db.conversations[id];
    if (!c) return null;
    c.clientUnread = 0;
    save();
    return c;
}

/** Liste pour la console admin : résumé, plus récent d'abord. */
function list({ limit = 60, includeClosed = true } = {}) {
    return Object.values(db.conversations)
        .filter((c) => includeClosed || c.status !== 'closed')
        .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
        .slice(0, limit)
        .map((c) => {
            const last = c.messages[c.messages.length - 1];
            return {
                id: c.id,
                channel: c.channel,
                peerId: c.peerId,
                name: c.name,
                username: c.username,
                phone: c.phone,
                status: c.status,
                adminUnread: c.adminUnread || 0,
                lastAt: c.lastAt,
                humanActive: isHumanActive(c.id),
                preview: last ? `${last.from === 'client' ? '' : last.from === 'admin' ? '↩ ' : '🤖 '}${last.text.slice(0, 90)}` : '',
            };
        });
}

function totalAdminUnread() {
    return Object.values(db.conversations).reduce((n, c) => n + (c.adminUnread || 0), 0);
}

/** Conversations en attente d'un humain (pour le rappel admin). */
function waiting() {
    return Object.values(db.conversations).filter((c) => c.status === 'waiting');
}

/**
 * Messages admin pas encore livrés sur un canal donné.
 * Le bot Telegram vient les chercher ici : c'est ce polling qui remplace
 * le "fromMe" de WhatsApp Business (le bot ne peut pas voir ce que tu écris).
 */
function pendingOutbound(channel, limit = 20) {
    const out = [];
    for (const c of Object.values(db.conversations)) {
        if (c.channel !== channel) continue;
        for (const m of c.messages) {
            if (m.from === 'admin' && m.pending) {
                out.push({ convId: c.id, peerId: c.peerId, msgId: m.id, text: m.text, at: m.at });
                if (out.length >= limit) return out;
            }
        }
    }
    return out;
}

/**
 * Livraison definitivement impossible (client a bloque le bot, compte supprime).
 * On retire `pending` pour arreter les tentatives, et on garde la trace : sans
 * ca, le bot re-essayait toutes les 3 s indefiniment.
 */
function markFailed(id, msgIds, reason) {
    const c = db.conversations[id];
    if (!c) return false;
    const set = new Set(msgIds || []);
    let touched = false;
    for (const m of c.messages) {
        if (set.has(m.id) && m.pending) {
            delete m.pending;
            m.failed = String(reason || 'injoignable').slice(0, 120);
            touched = true;
        }
    }
    if (touched) save();
    return touched;
}

function markDelivered(id, msgIds) {
    const c = db.conversations[id];
    if (!c) return false;
    const set = new Set(msgIds || []);
    let touched = false;
    for (const m of c.messages) {
        if (set.has(m.id) && m.pending) { delete m.pending; touched = true; }
    }
    if (touched) save();
    return touched;
}

/** Messages destinés au client (widget) depuis un timestamp. */
function threadSince(id, since = 0) {
    const c = db.conversations[id];
    if (!c) return [];
    return c.messages
        .filter((m) => m.at > since)
        .map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, author: m.author }));
}

module.exports = {
    convId,
    getOrCreate,
    get,
    addMessage,
    isHumanActive,
    requestHuman,
    setStatus,
    markAdminRead,
    markClientRead,
    list,
    totalAdminUnread,
    waiting,
    pendingOutbound,
    markDelivered,
    markFailed,
    threadSince,
    HANDOFF_MINUTES,
    _file: FILE,
};
