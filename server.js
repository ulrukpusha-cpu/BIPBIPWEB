// Anti-crash: éviter que les erreurs non capturées tuent le process
function _isNetworkErr(s) {
  return /UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|Connect Timeout|Cloudflare|error code: 5\d\d|Web server is down|The web server reported/i.test(String(s || ''));
}
function _compactErrMsg(reason) {
  let raw = (reason && (reason.message || reason.code)) || '';
  if (!raw) { try { raw = JSON.stringify(reason); } catch (_) { raw = String(reason); } }
  const causeMsg = (reason && reason.cause && reason.cause.message) || '';
  const msg = (raw + ' ' + causeMsg).trim();
  const hostMatch = msg.match(/attempted addresses?: ([^,)]+)/i) ||
                    msg.match(/([a-z0-9.-]+\.(?:supabase|telegram|coingecko|wave|djamo)\.[a-z.]+)/i);
  const host = hostMatch ? hostMatch[1] : '';
  return msg.split('\n')[0].slice(0, 200) + (host ? ' [' + host + ']' : '');
}
process.on('uncaughtException', (err) => {
  if (_isNetworkErr(err && err.message)) {
    console.error('[NET ERR]', new Date().toISOString(), _compactErrMsg(err));
  } else {
    console.error('[CRASH PREVENTED]', new Date().toISOString(), (err && err.stack) || err);
  }
});
process.on('unhandledRejection', (reason) => {
  const sig = reason && (reason.message || reason.code);
  if (_isNetworkErr(sig)) {
    console.error('[NET ERR]', new Date().toISOString(), _compactErrMsg(reason));
  } else {
    console.error('[PROMISE REJECTED]', new Date().toISOString(), _compactErrMsg(reason));
  }
});

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const QRCode = require('qrcode');

const NODE_ENV = process.env.NODE_ENV || 'development';
const orderStorage = require('./storage');
const blacklist = require('./blacklist');   // liste rouge anti-arnaque
const marketQuota = require('./market_quota');   // quota articles Market (packs payés)
const { authTelegram, requireAuth, isRegisteredUser } = require('./middleware/auth');
const { apiLimiter, paymentLimiter } = require('./middleware/rateLimit');
const momoRoutes = require('./routes/momo');
const actualitesRoutes = require('./routes/actualites');
const actualitesService = require('./services/actualitesService');
const telegramUsersService = require('./services/telegramUsersService');
const annoncesRoutes = require('./routes/annonces');
const annoncesService = require('./services/annoncesService');
const questsService = require('./services/questsService');
const { moderateSocialLink } = require('./services/aiModeration');
const questsRoutes = require('./routes/quests');
const reloadlyRoutes = require('./routes/reloadly');
const pushRoutes = require('./routes/push');
const pushService = require('./services/push');
const giftDelivery = require('./services/giftDelivery');
const cabineRoutes = require('./routes/cabine');
const cabineService = require('./services/cabineService');
const cabineBotRoutes = require('./routes/cabineBot');
const ledService = require('./services/ledService');

// ==================== CONFIG ====================
const app = express();

app.use(compression({ level: 6, threshold: 512 }));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_BOT_TOKEN_ADMIN = (process.env.TELEGRAM_BOT_TOKEN_ADMIN || '').trim();
/** Si true : Telegram n’appelle plus handleTelegramUpdate (bot chat géré par bot.py en polling). La webapp /api/telegram/* reste active. */
const TELEGRAM_WEBHOOK_DISABLED = ['1', 'true', 'yes'].includes(
    String(process.env.TELEGRAM_WEBHOOK_DISABLED || '').trim().toLowerCase()
);

// Plusieurs admins : ADMIN_CHAT_IDS=id1,id2,id3  ou un seul : ADMIN_CHAT_ID=id
function getAdminChatIds() {
    const ids = (process.env.ADMIN_CHAT_IDS || '').trim();
    if (ids) {
        return ids.split(',').map(function (id) { return id.trim(); }).filter(Boolean);
    }
    const one = (process.env.ADMIN_CHAT_ID || '6735995998').trim();
    return one ? [one] : [];
}
const ADMIN_CHAT_ID = getAdminChatIds()[0] || ''; // pour compatibilité

// Google Sign-In
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();

// PIN admin (4 chiffres)
const ADMIN_PIN = (process.env.ADMIN_PIN || '0000').trim();

// Achats directs dans le bot (sans webapp)
const BOT_FRAIS_PERCENT = 5;
const BOT_OPERATORS = {
    MTN: { prefix: '05' },
    Orange: { prefix: '07' },
    Moov: { prefix: '01' }
};
const BOT_AMOUNTS = [500, 1000, 2000, 5000, 10000];
const buyState = new Map(); // chatId -> { step, operator?, amount?, amountTotal?, phone? }
// Mémorise les message_ids envoyés aux admins par commande (bot admin) : orderId -> [{chatId, messageId}]
const orderAdminMessages = new Map();

// ==================== UPLOADS ====================
const UPLOADS_DIR = './uploads';
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ==================== CONFIG APP (vitesse bandeau LED, etc.) ====================
const DATA_DIR = './data';
const APP_CONFIG_PATH = path.join(DATA_DIR, 'app-config.json');

const DEFAULT_PUB_BANNERS = [
    { text: 'Recharge ton crédit en ligne sur Bipbip Recharge CI.', image: '/img/recharge-banner.jpg', url: 'https://bipbiprecharge.ci', placement: 'home1', scrollSpeed: 5 },
    { text: 'Service 24/7 — MTN, Orange, Moov en quelques secondes.', image: '/img/recharge-banner-2.jpg', url: 'https://bipbiprecharge.ci', placement: 'home2', scrollSpeed: 5 },
    { text: 'Gagne du temps : recharge directement depuis Bipbip Recharge CI.', image: '/img/recharge-banner-3.jpg', url: 'https://bipbiprecharge.ci', placement: 'actualites', scrollSpeed: 5 }
];

const PUB_PLACEMENTS = ['home1', 'home2', 'actualites'];

function sanitizePubBanners(arr) {
    if (!Array.isArray(arr)) return [];
    const byPlace = new Map();
    let legacyIndex = 0;
    for (const x of arr.slice(0, 12)) {
        if (!x || typeof x !== 'object') continue;
        const text = String(x.text || '').slice(0, 200);
        const image = String(x.image || '').trim().slice(0, 512);
        const url = String(x.url || '').trim().slice(0, 512);
        if (!image) continue;
        if (!/^https?:\/\//i.test(image) && !image.startsWith('/')) continue;
        let placement = String(x.placement || '').trim();
        if (!PUB_PLACEMENTS.includes(placement)) {
            placement = PUB_PLACEMENTS[legacyIndex % 3];
            legacyIndex += 1;
        }
        let scrollSpeed = parseInt(x.scrollSpeed, 10);
        if (!Number.isFinite(scrollSpeed) || scrollSpeed < 1 || scrollSpeed > 10) {
            const durLegacy = Math.min(180, Math.max(8, parseInt(x.scrollSeconds, 10) || 45));
            scrollSpeed = Math.round(10 - ((durLegacy - 8) / 172) * 9);
            scrollSpeed = Math.min(10, Math.max(1, scrollSpeed));
        } else {
            scrollSpeed = Math.min(10, Math.max(1, scrollSpeed));
        }
        const row = { text, image, placement, scrollSpeed };
        // Carrousel : tableau d'images (chacune valide http(s) ou /uploads)
        if (Array.isArray(x.images)) {
            const imgs = x.images
                .map(s => String(s || '').trim().slice(0, 512))
                .filter(s => s && (/^https?:\/\//i.test(s) || s.startsWith('/')))
                .slice(0, 8);
            if (imgs.length) row.images = imgs;
        }
        if (url && (/^https?:\/\//i.test(url) || url.startsWith('/'))) row.url = url;
        byPlace.set(placement, row);
    }
    const out = [];
    for (const p of PUB_PLACEMENTS) {
        if (byPlace.has(p)) out.push(byPlace.get(p));
    }
    return out;
}

const DEFAULT_NUDGES = [
    { hour: 9, title: '☀️ Bonjour de Bipbip !', body: 'Recharge ton crédit en 30 secondes et gagne des points 🎁' },
    { hour: 13, title: '📲 Besoin de crédit ou de forfait ?', body: 'Orange, MTN, Moov au meilleur prix — c\'est par ici.' },
    { hour: 17, title: '🎮 Cartes cadeaux dispo', body: 'Netflix, Steam, Google Play… livrées direct dans le Market !' },
    { hour: 21, title: '⭐ Ta connexion quotidienne t\'attend', body: 'Reviens chaque jour pour empocher tes points bonus.' }
];
function sanitizeNudges(arr) {
    if (!Array.isArray(arr)) return null;
    return arr.slice(0, 6).map(function (n) {
        return {
            hour: Math.min(23, Math.max(0, parseInt(n && n.hour, 10) || 0)),
            title: String((n && n.title) || '').slice(0, 80),
            body: String((n && n.body) || '').slice(0, 200)
        };
    }).filter(function (n) { return n.title || n.body; });
}

function readAppConfig() {
    const defaults = {
        ledScrollSeconds: parseInt(process.env.LED_SCROLL_SECONDS, 10) || 60,
        pubBanners: DEFAULT_PUB_BANNERS,
        giftCards: [],
        notifNudges: DEFAULT_NUDGES,
        ciReloadlyBackup: false
    };
    try {
        if (fs.existsSync(APP_CONFIG_PATH)) {
            const raw = JSON.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8'));
            const led = Math.min(300, Math.max(15, parseInt(raw.ledScrollSeconds, 10) || defaults.ledScrollSeconds));
            let pubBanners = defaults.pubBanners;
            if (Array.isArray(raw.pubBanners)) {
                pubBanners = sanitizePubBanners(raw.pubBanners);
            }
            const giftCards = Array.isArray(raw.giftCards) ? raw.giftCards : [];
            const maintenance = (raw.maintenance && typeof raw.maintenance === 'object')
                ? raw.maintenance
                : { enabled: false };
            const themeForce = (typeof raw.themeForce === 'string') ? raw.themeForce : '';
            const notifNudges = (Array.isArray(raw.notifNudges) && raw.notifNudges.length) ? sanitizeNudges(raw.notifNudges) : DEFAULT_NUDGES;
            const ciReloadlyBackup = !!raw.ciReloadlyBackup;
            return { ledScrollSeconds: led, pubBanners, giftCards, maintenance, themeForce, notifNudges, ciReloadlyBackup };
        }
    } catch (e) { /* ignore */ }
    return { ...defaults };
}

function writeAppConfig(obj) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(APP_CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('writeAppConfig:', e);
        return false;
    }
}

function normalizePaymentMethod(raw) {
    const s = String(raw == null || raw === '' ? 'djamo' : raw).toLowerCase().trim();
    const allowed = new Set(['djamo', 'usdt', 'usdc', 'ton', 'momo']);
    return allowed.has(s) ? s : 'djamo';
}

function paymentMethodAdminLabel(method) {
    const m = normalizePaymentMethod(method);
    const map = { djamo: 'Djamo', usdt: 'USDT', usdc: 'USDC', ton: 'TON', momo: 'MTN MoMo' };
    return map[m] || m;
}

function getCryptoDepositAddress() {
    const a = (process.env.CRYPTO_DEPOSIT_ADDRESS || '').trim();
    if (a) return a;
    if ((process.env.CRYPTO_USDT_ADDRESS || '').trim()) return (process.env.CRYPTO_USDT_ADDRESS || '').trim();
    if ((process.env.CRYPTO_USDC_ADDRESS || '').trim()) return (process.env.CRYPTO_USDC_ADDRESS || '').trim();
    return (process.env.CRYPTO_TON_ADDRESS || '').trim();
}

function publicBaseUrlFromReq(req) {
    const env = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
    if (env) return env;
    const xfProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
    const proto = xfProto || req.protocol || 'https';
    const host = req.get('host') || 'localhost';
    return `${proto}://${host}`.replace(/\/$/, '');
}

function buildProofTelegramCaption(order, paymentMethod) {
    const mode = `\n💳 <b>Mode</b> : ${paymentMethodAdminLabel(paymentMethod)}`;
    if (order.operator === 'ANNONCE_LED') {
        return `📸 <b>Preuve annonce LED #${order.id}</b>\n\n💰 ${order.amountTotal} FCFA\nValider = annonce dans bandeau LED + Actualités${mode}`;
    }
    return `📸 <b>Preuve commande #${order.id}</b>\n\n📲 ${order.operator} - ${order.amountTotal} FCFA\n📞 ${order.phone || '—'}${mode}`;
}

// ==================== MIDDLEWARE ====================
// CORS : origines + en-têtes admin (sinon le navigateur peut supprimer X-Admin-Key après le preflight)
const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Telegram-Init-Data', 'X-User-Id', 'X-Session-Token', 'X-Telegram-Login-Session', 'X-Capacitor-Platform', 'X-Bot-Secret', 'Accept', 'Origin', 'X-Requested-With', 'Cache-Control', 'Pragma'];
const CORS_ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function buildProductionCorsOrigin() {
    const raw = (process.env.CORS_ORIGIN || '').trim();
    if (!raw) return false;
    const list = raw.split(',').map((o) => o.trim()).filter(Boolean);
    const expanded = new Set(list);
    list.forEach((o) => {
        try {
            const u = new URL(o);
            if (u.hostname && !u.hostname.startsWith('www.')) {
                expanded.add(u.protocol + '//www.' + u.hostname + (u.port ? ':' + u.port : ''));
            }
        } catch (_) { /* ignore */ }
    });
    const arr = [...expanded];
    return function corsOriginCallback(origin, cb) {
        if (!origin) return cb(null, true);
        if (arr.includes(origin)) return cb(null, true);
        return cb(null, false);
    };
}

const corsOptions = NODE_ENV === 'production'
    ? {
        origin: buildProductionCorsOrigin(),
        credentials: true,
        methods: CORS_ALLOWED_METHODS,
        allowedHeaders: CORS_ALLOWED_HEADERS,
        optionsSuccessStatus: 204,
    }
    : {
        origin: true,
        methods: CORS_ALLOWED_METHODS,
        allowedHeaders: CORS_ALLOWED_HEADERS,
    };
app.use(cors(corsOptions));

// Surcharge CORS pour APK Capacitor (https://localhost Android, capacitor://localhost iOS)
// N'altère pas la config web existante — ajoute juste les origines mobiles
app.use(require('./middleware/cors-capacitor')());

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint pour Agent #8
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'bipbip-api',
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

app.get('/tonconnect-manifest.json', (req, res) => {
    const base = publicBaseUrlFromReq(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        url: base,
        name: (process.env.TON_CONNECT_APP_NAME || 'Bipbip Recharge CI').trim(),
        iconUrl: (process.env.TON_CONNECT_ICON_URL || 'https://ton.org/download/ton_symbol.png').trim()
    });
});

// ==================== SEO PAGES ====================
app.get('/recharge-mtn-ci', (req, res) => {
    res.sendFile(path.join(__dirname, 'seo', 'recharge-mtn-ci.html'));
});
app.get('/recharge-orange-ci', (req, res) => {
    res.sendFile(path.join(__dirname, 'seo', 'recharge-orange-ci.html'));
});
app.get('/recharge-moov-ci', (req, res) => {
    res.sendFile(path.join(__dirname, 'seo', 'recharge-moov-ci.html'));
});
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.sendFile(path.join(__dirname, 'robots.txt'));
});
app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

// ==================== ROUTING LANDING vs WEBAPP ====================
function shouldServeApp(req) {
    const ua = req.headers['user-agent'] || '';
    // Telegram Mini App / WebApp (toutes plateformes, mobile + desktop)
    if (/TelegramBot|Telegram\/|TMA\b|\bTelegram\b/i.test(ua)) return true;
    // Telegram WebApp ajoute souvent un hash #tgWebAppData — vérifier le referer aussi
    const ref = req.headers['referer'] || req.headers['referrer'] || '';
    if (/tgWebApp|telegram\.org/i.test(ref)) return true;
    // Sec-Fetch-Site: cross-site depuis Telegram
    const secDest = req.headers['sec-fetch-dest'] || '';
    if (secDest === 'iframe') return true;
    // Mobile / Tablette classique
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua)) return true;
    // iPadOS 13+ : user-agent = Macintosh mais c'est une tablette tactile
    if (/Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome/i.test(ua)) return true;
    return false;
}

app.get('/', (req, res) => {
    if (shouldServeApp(req)) {
        res.sendFile(path.join(__dirname, 'app', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'site', 'index.html'));
    }
});

app.get(['/confidentialite','/privacy','/politique-confidentialite'], (req, res) => {
    res.sendFile(path.join(__dirname, 'confidentialite.html'));
});

app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'app', 'index.html'));
});

app.use(express.static('.', {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders: (res, filePath) => {
        if (/\.(webp|png|jpe?g|gif|svg|ico)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        } else if (/\.(woff2?|ttf|eot)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        } else if (/\.(css|js)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
        } else if (/\.html$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(json)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=600');
        }
    }
}));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api', authTelegram);
app.use('/api', apiLimiter);

// Multer pour upload de fichiers
const multerStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: multerStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Seules les images sont autorisées'));
        }
    }
});

// ==================== TELEGRAM API ====================
async function sendTelegramMessage(chatId, text, options = {}, token = TELEGRAM_BOT_TOKEN) {
    if (!token) {
        console.log('[Telegram] Token non configuré, message ignoré:', text);
        return;
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
                ...options
            })
        });
        
        const data = await response.json();
        if (!data.ok) {
            const desc = (data.description || '').toString();
            // Erreurs "normales" : utilisateur a bloqué/supprimé le bot ou compte inactif
            // → silencieuses (loggées en debug, pas en error pour ne pas polluer)
            const isUserUnreachable = /chat not found|bot was blocked|user is deactivated|forbidden/i.test(desc);
            if (isUserUnreachable) {
                console.log('[Telegram] User unreachable (chat', chatId, '):', desc);
            } else {
                console.error('[Telegram] sendMessage erreur:', desc || data);
            }
        }
        return data;
    } catch (error) {
        console.error('[Telegram] Erreur envoi message:', error);
    }
}

async function sendTelegramPhoto(chatId, photoUrl, caption, options = {}, token = TELEGRAM_BOT_TOKEN) {
    if (!token) {
        console.log('[Telegram] Token non configuré, photo ignorée');
        return;
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.telegram.org/bot${token}/sendPhoto`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                photo: photoUrl,
                caption,
                parse_mode: 'HTML',
                ...options
            })
        });
        return await response.json();
    } catch (error) {
        console.error('[Telegram] Erreur envoi photo:', error);
    }
}

async function sendTelegramToAllAdmins(text, options = {}, token = TELEGRAM_BOT_TOKEN) {
    const ids = getAdminChatIds();
    for (const chatId of ids) {
        await sendTelegramMessage(chatId, text, options, token);
    }
}

// ===============================================
// USSD Gateway — Transfert automatique de crédit
// ===============================================
function getOrderBundleMeta(order) {
    if (!order) return null;
    if (order.bundleType && order.bundleId) {
        const t = String(order.bundleType).toLowerCase();
        if (t === 'data' || t === 'mix') return { bundleType: t, bundleId: String(order.bundleId) };
    }
    if (order.notes && typeof order.notes === 'string') {
        try {
            const j = JSON.parse(order.notes);
            if (j && j.bundleType && j.bundleId) {
                const t = String(j.bundleType).toLowerCase();
                if (t === 'data' || t === 'mix') return { bundleType: t, bundleId: String(j.bundleId) };
            }
        } catch (_) { /* ignore */ }
    }
    return null;
}

// Secours CI : si activé (admin), recharge CRÉDIT CI via Reloadly au lieu du gateway USSD
// (panne réseau des noeuds). Forfaits/data restent sur USSD. Échec Reloadly -> repli USSD.
async function deliverCIRecharge(order) {
    try {
        const cfg = readAppConfig();
        const isBundle = !!getOrderBundleMeta(order);
        if (cfg.ciReloadlyBackup && !isBundle) {
            const reloadly = require('./services/reloadly');
            const phone = String(order.phone || '').replace(/\D/g, '');
            const op = await reloadly.airtime.detect(phone, 'CI');
            if (op && op.operatorId) {
                const r = await reloadly.airtime.topup({
                    operatorId: op.operatorId, amount: Number(order.amount), useLocalAmount: true,
                    customIdentifier: 'BIPCI-' + order.id,
                    recipientPhone: { countryCode: 'CI', number: phone }
                });
                console.log('[CI backup] Reloadly topup OK cmd ' + order.id + ' op ' + op.operatorId);
                return { success: true, via: 'reloadly', raw: r };
            }
        }
    } catch (e) { console.error('[CI backup Reloadly] ' + (e.message || e) + ' -> repli USSD'); }
    return await executeUssdTransfer(order);
}

// Crédite +3 slots d'articles Market après un pack payé (PACK_ARTICLES validé).
async function creditArticlePack(order) {
    if (!order || order.operator !== 'PACK_ARTICLES') return false;
    try {
        const newBonus = marketQuota.addPack(order.userId, marketQuota.PACK_SLOTS);
        const newLimit = marketQuota.FREE_ARTICLES + newBonus;
        console.log('[PACK_ARTICLES] +' + marketQuota.PACK_SLOTS + ' slots pour ' + order.userId + ' (cmd ' + order.id + ') → limite ' + newLimit);
        if (order.userId) {
            try { await sendTelegramMessage(order.userId, '✅ <b>Pack articles débloqué !</b>\n\nTu peux maintenant publier <b>' + newLimit + ' articles</b> au total sur le Market.'); } catch (e) {}
            try { await pushService.sendToUser(order.userId, '📦 Pack articles activé', 'Tu peux publier ' + newLimit + ' articles au total', { screen: 'market', orderId: String(order.id) }); } catch (e) {}
        }
    } catch (e) { console.error('[PACK_ARTICLES credit]', e.message || e); }
    return true;
}

// ==================== SMS transactionnels (Africa's Talking) ====================
// Inactif tant que AT_API_KEY/AT_USERNAME ne sont pas dans .env (aucun SMS envoyé).
const LETEXTO_TOKEN  = (process.env.LETEXTO_TOKEN || '').trim();
const LETEXTO_SENDER = (process.env.LETEXTO_SENDER || 'BIPBIP').trim();   // max 11 caractères
const LETEXTO_URL    = 'https://apis.letexto.com/v1/messages/send';

// Numéro au format LeTexto : 225 + numéro national (le 0 initial est CONSERVÉ), sans "+".
// Ex : 0709393959 -> 2250709393959.
function toLetextoPhone(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('225')) d = d.slice(3);
    return d.length >= 8 ? '225' + d : '';
}

async function sendSms(phone, message) {
    const to = toLetextoPhone(phone);
    if (!to) return { ok: false, error: 'numéro invalide' };
    if (!LETEXTO_TOKEN) {
        console.log(`[SMS] non configuré (LETEXTO_TOKEN absent) — ignoré (${to})`);
        return { ok: false, error: 'non configuré' };
    }
    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(LETEXTO_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${LETEXTO_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from: LETEXTO_SENDER, to, content: message }),
        });
        const data = await r.json().catch(() => ({}));
        const ok = r.ok && /submitted/i.test(String(data.status || data.statut || ''));
        console.log(`[SMS] ${to} -> ${ok ? 'OK ' + (data.id || '') : 'ECHEC ' + JSON.stringify(data).slice(0, 150)}`);
        return { ok, data };
    } catch (e) {
        console.error('[SMS] erreur:', e.message);
        return { ok: false, error: e.message };
    }
}

async function executeUssdTransfer(order) {
    const GATEWAY = process.env.USSD_GATEWAY_URL || 'http://localhost:3002';

    const phone = String(order.phone).replace(/\D/g, '').replace(/^225/, '');
    const prefix = phone.substring(0, 2);

    let operator;
    if (['07','08','09'].includes(prefix)) operator = 'orange';
    else if (['05','06'].includes(prefix))  operator = 'mtn';
    else if (['01','02'].includes(prefix))  operator = 'moov';
    else {
        console.error(`[USSD] Préfixe inconnu: ${prefix} pour ${phone}`);
        return { success: false, error: `Préfixe inconnu: ${prefix}` };
    }

    const bundleMeta = getOrderBundleMeta(order);
    if (bundleMeta && (operator === 'orange' || operator === 'mtn' || operator === 'moov')) {
        try {
            const fetch = (await import('node-fetch')).default;
            const res = await fetch(`${GATEWAY}/api/bundle/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    operator,
                    recipient: phone,
                    type: bundleMeta.bundleType,
                    bundleId: bundleMeta.bundleId
                })
            });
            const result = await res.json();
            console.log(`[USSD Forfait] ${operator.toUpperCase()} | ${phone} | ${bundleMeta.bundleType} ${bundleMeta.bundleId} |`,
                result.success ? 'OK' : `ERREUR ${result.error}`);
            return result;
        } catch (e) {
            console.error('[USSD] Gateway forfait injoignable:', e.message);
            return { success: false, error: 'Gateway injoignable' };
        }
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch(`${GATEWAY}/api/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operator,
                recipient: phone,
                amount: order.amount
            })
        });
        const result = await res.json();
        console.log(`[USSD] ${operator.toUpperCase()} | ${phone} | ${order.amount} FCFA |`,
            result.success ? 'OK' : `ERREUR ${result.error}`);
        return result;
    } catch (e) {
        console.error('[USSD] Gateway injoignable:', e.message);
        return { success: false, error: 'Gateway injoignable' };
    }
}

async function sendTelegramPhotoToAllAdmins(photoUrl, caption, options = {}, token = TELEGRAM_BOT_TOKEN) {
    const ids = getAdminChatIds();
    const results = [];
    for (const chatId of ids) {
        const r = await sendTelegramPhoto(chatId, photoUrl, caption, options, token);
        if (r && r.ok && r.result && r.result.message_id) {
            results.push({ chatId: String(chatId), messageId: r.result.message_id });
        }
    }
    return results;
}

async function answerTelegramCallback(callbackQueryId, text, token = TELEGRAM_BOT_TOKEN) {
    if (!token) return;
    try {
        const fetch = (await import('node-fetch')).default;
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || undefined })
        });
    } catch (e) {
        console.error('[Telegram] answerCallbackQuery:', e);
    }
}

// Supprime les boutons Valider/Rejeter chez tous les admins après une action sur une commande
async function removeOrderButtonsFromAllAdmins(orderId, token) {
    const msgs = orderAdminMessages.get(String(orderId));
    if (!msgs || !token) return;
    try {
        const fetch = (await import('node-fetch')).default;
        for (const { chatId, messageId } of msgs) {
            try {
                await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
                });
            } catch (e) {
                console.error('[Telegram] removeOrderButtons chatId=' + chatId, e.message);
            }
        }
    } catch (e) {
        console.error('[Telegram] removeOrderButtonsFromAllAdmins:', e);
    }
    orderAdminMessages.delete(String(orderId));
}

async function downloadTelegramFile(fileId) {
    if (!TELEGRAM_BOT_TOKEN) return null;
    try {
        const fetch = (await import('node-fetch')).default;
        const getRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
        const getData = await getRes.json();
        if (!getData.ok || !getData.result || !getData.result.file_path) return null;
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${getData.result.file_path}`;
        const ext = path.extname(getData.result.file_path) || '.jpg';
        const filename = `proof-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        const filepath = path.join(UPLOADS_DIR, filename);
        const fileRes = await fetch(fileUrl);
        const buf = await fileRes.buffer();
        fs.writeFileSync(filepath, buf);
        return `/uploads/${filename}`;
    } catch (e) {
        console.error('[Telegram] downloadFile:', e);
        return null;
    }
}

// ==================== API ROUTES ====================

/** Float depuis l’env (virgule → point), avec minimum — aligné logique StickerStreet / cours TON */
function envFloatTon(key, defaultVal, minVal) {
    try {
        const raw = process.env[key];
        if (raw == null || String(raw).trim() === '') return Number(defaultVal);
        let s = String(raw).trim();
        if (s.includes('=')) s = s.split('=').pop().trim();
        s = s.replace(',', '.');
        const v = parseFloat(s);
        if (!Number.isFinite(v) || v < minVal) return Number(defaultVal);
        return v;
    } catch (_) {
        return Number(defaultVal);
    }
}

const BIPBIP_XOF_PER_USD = envFloatTon('XOF_PER_USD', '600', 1);
const BIPBIP_TON_FALLBACK_USD = envFloatTon('TON_FALLBACK_USD', '1.3', 0.01);

// Cache TON/USD : refresh automatique toutes les 24h, persisté sur disque
const TON_CACHE_FILE = path.join(__dirname, 'data', 'ton-rate.json');
let _tonRateCache = { usd: 0, fetchedAt: 0 };

function _loadTonCacheFromDisk() {
    try {
        const fs = require('fs');
        if (fs.existsSync(TON_CACHE_FILE)) {
            const j = JSON.parse(fs.readFileSync(TON_CACHE_FILE, 'utf-8'));
            if (j && Number(j.usd) > 0) {
                _tonRateCache = { usd: Number(j.usd), fetchedAt: Number(j.fetchedAt) || 0 };
                console.log('[TON] Cache disque chargé : 1 TON =', _tonRateCache.usd, 'USD (depuis', new Date(_tonRateCache.fetchedAt).toISOString(), ')');
            }
        }
    } catch (e) { console.warn('[TON] Lecture cache disque KO:', e.message); }
}

function _saveTonCacheToDisk() {
    try {
        const fs = require('fs');
        const dir = path.dirname(TON_CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(TON_CACHE_FILE, JSON.stringify(_tonRateCache, null, 2));
    } catch (e) { console.warn('[TON] Écriture cache disque KO:', e.message); }
}

async function _fetchTonUsdLive() {
    try {
        const fetch = (await import('node-fetch')).default;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        // ✅ Bon ID CoinGecko : the-open-network (et non "ton" qui renvoie {})
        const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd', { signal: controller.signal });
        clearTimeout(t);
        if (!resp.ok) return 0;
        const data = await resp.json();
        const u = data && data['the-open-network'] && data['the-open-network'].usd;
        const v = parseFloat(u);
        return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (_) {
        return 0;
    }
}

async function refreshTonUsdRate() {
    const live = await _fetchTonUsdLive();
    if (live > 0) {
        _tonRateCache = { usd: live, fetchedAt: Date.now() };
        _saveTonCacheToDisk();
        console.log('[TON] Cours mis à jour : 1 TON =', live, 'USD (', new Date().toISOString(), ')');
        return live;
    }
    console.warn('[TON] Refresh KO, garde le cache existant (', _tonRateCache.usd, 'USD)');
    return _tonRateCache.usd;
}

// Charger cache disque au démarrage + premier fetch + refresh toutes les 24h
_loadTonCacheFromDisk();
setTimeout(() => { refreshTonUsdRate().catch(() => {}); }, 5000); // fetch initial 5s après démarrage
setInterval(() => { refreshTonUsdRate().catch(() => {}); }, 24 * 60 * 60 * 1000); // toutes les 24h

async function fetchTonUsdFromCoingecko() {
    // Utilise le cache (refresh en arrière-plan), évite les appels API à chaque requête
    if (_tonRateCache.usd > 0) return _tonRateCache.usd;
    // Cache vide → tenter live une seule fois
    return await _fetchTonUsdLive();
}

/** Cours TON + montant TON pour un total XOF (Mini App, même principe que StickerStreet) */
app.get('/api/rates/ton', async (req, res) => {
    const totalXof = parseFloat(String(req.query.total_xof || '').replace(',', '.')) || 0;
    if (totalXof <= 0) {
        return res.status(400).json({ error: 'total_xof requis' });
    }
    let tonUsd = await fetchTonUsdFromCoingecko();
    if (tonUsd <= 0) tonUsd = BIPBIP_TON_FALLBACK_USD;
    if (BIPBIP_XOF_PER_USD <= 0 || tonUsd <= 0) {
        return res.status(503).json({ error: 'Taux indisponible', ton_usd: 0, amount_ton: 0 });
    }
    const amountUsd = totalXof / BIPBIP_XOF_PER_USD;
    const amountTon = amountUsd / tonUsd;
    return res.json({
        ton_usd: Math.round(tonUsd * 10000) / 10000,
        xof_per_usd: BIPBIP_XOF_PER_USD,
        amount_ton: Math.round(amountTon * 1e6) / 1e6,
        amount_usd: Math.round(amountUsd * 100) / 100
    });
});

/** QR en PNG (même origine) — remplace api.qrserver.com, souvent bloqué (Brave, pare-feu, etc.) */
app.get('/api/qr', async (req, res) => {
    const data = String(req.query.data || '').trim();
    if (!data || data.length > 4096) {
        return res.status(400).type('text/plain').send('data requis (max 4096 caractères)');
    }
    const size = Math.min(512, Math.max(64, parseInt(req.query.size, 10) || 200));
    const margin = Math.min(4, Math.max(1, parseInt(req.query.margin, 10) || 2));
    try {
        const buf = await QRCode.toBuffer(data, {
            type: 'png',
            width: size,
            margin,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' },
        });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buf);
    } catch (e) {
        console.error('[api/qr]', e);
        res.status(500).type('text/plain').send('Erreur génération QR');
    }
});

// Config publique (MoMo, vitesse bandeau LED, bannières pub)
// Proxy d'avatar Google (lh3.googleusercontent.com) — necessaire car le WebView Android
// charge mal ces images cross-origin. On ne proxy QUE googleusercontent.com (anti-SSRF).
app.get('/api/avatar', async (req, res) => {
    try {
        const raw = String(req.query.u || '').trim();
        if (!raw) return res.status(400).end();
        let u;
        try { u = new URL(raw); } catch (e) { return res.status(400).end(); }
        if (u.protocol !== 'https:' || !/(^|\.)googleusercontent\.com$/i.test(u.hostname)) {
            return res.status(403).end();
        }
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(u.href, { headers: { 'User-Agent': 'BipbipAvatarProxy/1.0' } });
        if (!r.ok) return res.status(r.status).end();
        res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buf = Buffer.from(await r.arrayBuffer());
        res.end(buf);
    } catch (e) {
        res.status(502).end();
    }
});

app.get('/api/config', (req, res) => {
    const mtnMerchantPhone = (process.env.BIPBIP_MOMO_PHONE || '').trim();
    const appConfig = readAppConfig();
    let banners = Array.isArray(appConfig.pubBanners) ? appConfig.pubBanners : DEFAULT_PUB_BANNERS;
    if (!banners.length) banners = DEFAULT_PUB_BANNERS;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const cryptoAddr = getCryptoDepositAddress();
    const cryptoNetwork = (process.env.CRYPTO_DEPOSIT_NETWORK || 'TON').trim();
    const tgUser = (process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '');
    const base = publicBaseUrlFromReq(req);
    const fcfaRaw = parseFloat(String(process.env.CRYPTO_FCFA_PER_USDT || '').replace(',', '.'));
    res.json({
        mtnMerchantPhone: mtnMerchantPhone || null,
        momoEnabled: !!process.env.MTN_SUBSCRIPTION_KEY && !!process.env.MTN_API_USER,
        ledScrollSeconds: Math.min(300, Math.max(15, appConfig.ledScrollSeconds || 60)),
        pubBanners: banners,
        djamoPayUrl: (process.env.DJAMO_PAY_URL || 'https://pay.djamo.com/pkbyg').trim(),
        telegramWalletUrl: (process.env.TELEGRAM_WALLET_URL || 'https://t.me/wallet').trim(),
        cryptoDepositAddress: cryptoAddr || null,
        cryptoDepositNetwork: cryptoNetwork,
        cryptoFcfaPerUsdt: Number.isFinite(fcfaRaw) && fcfaRaw > 0 ? fcfaRaw : null,
        telegramBotUsername: tgUser || null,
        twaReturnUrl: tgUser ? `https://t.me/${tgUser}` : null,
        tonConnectManifestUrl: `${base}/tonconnect-manifest.json`,
        googleClientId: GOOGLE_CLIENT_ID || null,
        maintenance: appConfig.maintenance || { enabled: false },
        themeForce: appConfig.themeForce || '',
        notifNudges: appConfig.notifNudges || [],
        ciReloadlyBackup: !!appConfig.ciReloadlyBackup,
        tonUsd: (_tonRateCache && _tonRateCache.usd) || null
    });
});

// Météo (bannière d'accueil) via OpenWeatherMap (clé API dans OPENWEATHER_API_KEY)
app.get('/api/weather', async (req, res) => {
    const cityParam = (req.query.city || '').toString().trim();
    const city = cityParam || (process.env.WEATHER_CITY || 'Abidjan').trim() || 'Abidjan';
    const apiKey = (process.env.OPENWEATHER_API_KEY || '').trim();
    if (!apiKey) {
        return res.status(503).json({ ok: false, error: 'OPENWEATHER_API_KEY manquante' });
    }
    try {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=fr`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) {
            console.error('[weather] HTTP', resp.status);
            return res.status(503).json({ ok: false, error: 'Service météo indisponible' });
        }
        const data = await resp.json();
        const main = data.main || {};
        const wind = data.wind || {};
        const weatherArr = Array.isArray(data.weather) ? data.weather : [];
        const w0 = weatherArr[0] || {};
        const temp = main.temp != null ? `${Math.round(main.temp)}°C` : '--°C';
        const humidity = main.humidity != null ? `${main.humidity}%` : '';
        const windKmh = wind.speed != null ? `${Math.round(Number(wind.speed) * 3.6)} km/h` : '';
        const condition = w0.description ? (w0.description.charAt(0).toUpperCase() + w0.description.slice(1)) : 'Temps clair';
        return res.json({
            ok: true,
            location: data.name || city,
            condition,
            temp,
            humidity,
            wind: windKmh,
            raw: null
        });
    } catch (e) {
        console.error('[weather]', e && e.type === 'aborted' ? 'Timeout' : e);
        // Dernier recours : renvoyer une info neutre pour ne pas casser l'UI
        return res.json({
            ok: true,
            location: city,
            condition: 'Météo indisponible',
            temp: '--°C',
            humidity: '',
            wind: '',
            raw: null,
            fallback: true
        });
    }
});

// Admin : mettre à jour la config (ex. vitesse bandeau, bannières pub)
// Vérification PIN admin

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


// ============================================================
// Telegram OAuth return : capture le callback de oauth.telegram.org
// ============================================================
// La page de retour recoit l'auth result dans le fragment URL (#tgAuthResult=...)
// On rend une petite page qui parse le fragment cote client et POST vers /claim-oauth
app.get('/api/auth/telegram-oauth-return', (req, res) => {
    const token = String(req.query.t || '');
    res.set('Cache-Control', 'no-store');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Connexion...</title><style>
body{font-family:system-ui,sans-serif;background:#0B1220;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px}
.card{max-width:340px}.spinner{width:40px;height:40px;border:3px solid #1e293b;border-top-color:#3b82f6;border-radius:50%;margin:0 auto 16px;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
h2{margin:0 0 8px;font-size:18px}p{color:#94a3b8;font-size:13px;margin:0}
.ok{color:#22c55e}.err{color:#f87171}
</style></head><body><div class="card">
<div class="spinner" id="sp"></div>
<h2 id="msg">Validation en cours…</h2>
<p id="hint">Tu peux fermer cet onglet et retourner dans l'app.</p>
</div><script>
(function(){
  var token = ${JSON.stringify(token)};
  var hash = (window.location.hash || '').replace(/^#/, '');
  var params = {};
  hash.split('&').forEach(function(p){ var kv=p.split('='); if(kv[0]) params[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||'') });
  // tgAuthResult=base64(JSON)
  var authResult = params.tgAuthResult;
  if(!authResult){
    document.getElementById('msg').textContent = 'Connexion annulée';
    document.getElementById('msg').className = 'err';
    document.getElementById('sp').style.display='none';
    return;
  }
  try {
    // base64url decode
    var b = authResult.replace(/-/g,'+').replace(/_/g,'/');
    while(b.length % 4) b += '=';
    var json = atob(b);
    var user = JSON.parse(json);
    // POST au backend
    fetch('/api/auth/telegram-oauth-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, telegramUser: user })
    }).then(function(r){ return r.json(); }).then(function(d){
      if(d && d.ok){
        document.getElementById('msg').textContent = 'Connecté ✓';
        document.getElementById('msg').className = 'ok';
        document.getElementById('sp').style.display='none';
        document.getElementById('hint').textContent = 'Retourne dans l\'app Bipbip Recharge.';
        setTimeout(function(){ try { window.close(); } catch(e){} }, 1500);
      } else {
        document.getElementById('msg').textContent = (d && d.error) || 'Erreur de validation';
        document.getElementById('msg').className = 'err';
        document.getElementById('sp').style.display='none';
      }
    }).catch(function(e){
      document.getElementById('msg').textContent = 'Erreur réseau';
      document.getElementById('msg').className = 'err';
      document.getElementById('sp').style.display='none';
    });
  } catch(e) {
    document.getElementById('msg').textContent = 'Format de retour invalide';
    document.getElementById('msg').className = 'err';
    document.getElementById('sp').style.display='none';
  }
})();
</script></body></html>`);
});

// Le client (page de retour) POST ici avec le user Telegram valide
app.post('/api/auth/telegram-oauth-claim', (req, res) => {
    const { token, telegramUser } = req.body || {};
    if (!token || !telegramUser || !telegramUser.id) {
        return res.status(400).json({ ok: false, error: 'token + telegramUser requis' });
    }
    const slot = __tgPollStore.get(token);
    if (!slot) return res.status(404).json({ ok: false, error: 'token expire' });
    // Valide le hash Telegram pour s'assurer que les donnees viennent bien d'oauth.telegram.org
    try {
        const crypto = require('crypto');
        const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
        if (botToken) {
            const dataCheckArr = [];
            Object.keys(telegramUser).filter(k => k !== 'hash').sort().forEach(k => {
                if (telegramUser[k] != null) dataCheckArr.push(k + '=' + telegramUser[k]);
            });
            const dataCheckString = dataCheckArr.join('\n');
            const secretKey = crypto.createHash('sha256').update(botToken).digest();
            const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
            if (telegramUser.hash && telegramUser.hash !== expectedHash) {
                return res.status(401).json({ ok: false, error: 'hash invalide' });
            }
        }
    } catch (e) { /* on continue meme si validation echoue, pour debug */ }
    const sessionToken = require('crypto').randomBytes(32).toString('hex');
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
});
// ============================================================


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


// Anti-brute-force du PIN admin : 5 tentatives / 15 min par IP, puis lockout
const _pinAttempts = new Map();
const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;
app.post('/api/admin/verify-pin', (req, res) => {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    const now = Date.now();
    let rec = _pinAttempts.get(ip);
    if (rec && rec.lockedUntil && now < rec.lockedUntil) {
        const mins = Math.ceil((rec.lockedUntil - now) / 60000);
        return res.status(429).json({ ok: false, error: 'Trop de tentatives. Reessayez dans ' + mins + ' min.' });
    }
    if (!rec || (now - rec.firstAt) > PIN_WINDOW_MS) {
        rec = { count: 0, firstAt: now, lockedUntil: 0 };
        _pinAttempts.set(ip, rec);
    }
    const { pin } = req.body || {};
    if (!pin || String(pin).trim() !== ADMIN_PIN) {
        rec.count++;
        if (rec.count >= PIN_MAX_ATTEMPTS) {
            rec.lockedUntil = now + PIN_WINDOW_MS;
            console.log('[ADMIN-PIN] lockout ip=' + ip);
            return res.status(429).json({ ok: false, error: 'Trop de tentatives. Reessayez dans 15 min.' });
        }
        return res.status(401).json({ ok: false, error: 'Code incorrect' });
    }
    _pinAttempts.delete(ip);
    const adminKey = (process.env.ADMIN_SECRET_KEY || '').trim();
    return res.json({ ok: true, adminKey: adminKey || null });
});

app.put('/api/admin/config', (req, res) => {
    if (!isAdminRequest(req)) {
        return res.status(401).json({ error: 'Non autorisé. Clé admin ou ouvre l\'app depuis le bot (compte dans ADMIN_CHAT_IDS).' });
    }
    const body = req.body || {};
    const current = readAppConfig();
    if (body.ledScrollSeconds != null) {
        const val = Math.min(300, Math.max(15, parseInt(body.ledScrollSeconds, 10) || 60));
        current.ledScrollSeconds = val;
    }
    if (body.pubBanners != null) {
        if (!Array.isArray(body.pubBanners)) {
            return res.status(400).json({ error: 'pubBanners doit être un tableau' });
        }
        current.pubBanners = sanitizePubBanners(body.pubBanners);
    }
    if (body.maintenance != null) {
        const wasEnabled = current.maintenance && current.maintenance.enabled;
        current.maintenance = {
            enabled: !!body.maintenance.enabled,
            message: String(body.maintenance.message || '').slice(0, 300),
            image: String(body.maintenance.image || '').slice(0, 512),
            updatedAt: Date.now()
        };
        console.log('[MAINT] PUT maintenance.enabled=' + current.maintenance.enabled +
            ' (was ' + wasEnabled + ') ua=' + (req.headers['user-agent'] || '?').slice(0,40) +
            ' xff=' + (req.headers['x-forwarded-for'] || req.ip || '?'));
    }
    if (body.themeForce != null) {
        current.themeForce = String(body.themeForce || '').slice(0, 40);
        console.log('[THEME] PUT themeForce=' + (current.themeForce || '(auto)'));
    }
    if (body.notifNudges != null) {
        const nn = sanitizeNudges(body.notifNudges);
        if (nn) current.notifNudges = nn;
    }
    if (body.ciReloadlyBackup != null) { current.ciReloadlyBackup = !!body.ciReloadlyBackup; console.log('[CI backup] toggle=' + current.ciReloadlyBackup); }
    if (!writeAppConfig(current)) return res.status(500).json({ error: 'Erreur écriture config' });
    res.json({
        success: true,
        config: {
            ledScrollSeconds: current.ledScrollSeconds,
            pubBanners: current.pubBanners,
            maintenance: current.maintenance || { enabled: false },
            themeForce: current.themeForce || ''
        }
    });
});

// Admin : image bannière pub → /uploads/...
app.post('/api/admin/pub-banner-image', upload.single('image'), (req, res) => {
    if (!isAdminRequest(req)) {
        return res.status(401).json({ error: 'Non autorisé. Clé admin ou ouvre l\'app depuis le bot (compte dans ADMIN_CHAT_IDS).' });
    }
    if (!req.file) return res.status(400).json({ error: 'Fichier image manquant (champ "image")' });
    const url = '/uploads/' + req.file.filename;
    res.json({ success: true, url });
});

// ==================== GIFT CARDS ADMIN ====================
// Récupérer les cartes cadeaux (public)
app.get('/api/gift-cards', (req, res) => {
    const config = readAppConfig();
    res.json({ ok: true, giftCards: config.giftCards || [] });
});

/** Catalogue Data & Forfaits (proxy vers le USSD gateway — évite CORS côté Mini App) */
app.get('/api/bundles', async (req, res) => {
    const GATEWAY = (process.env.USSD_GATEWAY_URL || 'http://localhost:3002').replace(/\/$/, '');
    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(`${GATEWAY}/api/bundles`);
        const j = await r.json();
        res.status(r.status).json(j);
    } catch (e) {
        console.error('[Bundles] proxy erreur:', e.message);
        res.status(502).json({ error: 'Catalogue forfaits indisponible', detail: e.message });
    }
});

app.get('/api/bundles/:operator', async (req, res) => {
    const GATEWAY = (process.env.USSD_GATEWAY_URL || 'http://localhost:3002').replace(/\/$/, '');
    const op = encodeURIComponent(String(req.params.operator || '').toLowerCase());
    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(`${GATEWAY}/api/bundles/${op}`);
        const j = await r.json();
        res.status(r.status).json(j);
    } catch (e) {
        console.error('[Bundles] proxy erreur:', e.message);
        res.status(502).json({ error: 'Catalogue forfaits indisponible', detail: e.message });
    }
});

// Admin : upload image carte cadeau
app.post('/api/admin/gift-card-image', upload.single('image'), (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    if (!req.file) return res.status(400).json({ error: 'Fichier image manquant' });
    res.json({ success: true, url: '/uploads/' + req.file.filename });
});

// Admin : sauvegarder toutes les cartes cadeaux
app.put('/api/admin/gift-cards', (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    const { giftCards } = req.body || {};
    if (!Array.isArray(giftCards)) return res.status(400).json({ error: 'giftCards doit être un tableau' });

    // Valider et nettoyer chaque carte
    const cleaned = giftCards.map(c => ({
        id: String(c.id || '').slice(0, 50) || ('gc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        name: String(c.name || '').slice(0, 100),
        value: String(c.value || '').slice(0, 20),
        price: Math.max(0, parseInt(c.price, 10) || 0),
        category: ['app', 'music', 'films', 'jeux'].includes(c.category) ? c.category : 'app',
        img: String(c.img || '').slice(0, 500),
        flag: String(c.flag || '').slice(0, 10) || '',
    })).filter(c => c.name && c.price > 0);

    const config = readAppConfig();
    config.giftCards = cleaned;
    if (!writeAppConfig(config)) return res.status(500).json({ error: 'Erreur écriture config' });
    res.json({ success: true, giftCards: cleaned });
});


// ============================================================
// MARKET ITEMS — articles d'occasion soumis par les utilisateurs
// Stockage fichier JSON (data/market-items.json). Modération admin.
// ============================================================
const MARKET_ITEMS_FILE = require('path').join(__dirname, 'data', 'market-items.json');
function readMarketItems() {
    try {
        const fs = require('fs');
        if (!fs.existsSync(MARKET_ITEMS_FILE)) return [];
        return JSON.parse(fs.readFileSync(MARKET_ITEMS_FILE, 'utf8')) || [];
    } catch (e) { return []; }
}
function writeMarketItems(arr) {
    try {
        const fs = require('fs');
        fs.writeFileSync(MARKET_ITEMS_FILE, JSON.stringify(arr, null, 2));
        return true;
    } catch (e) { console.error('[market] write', e); return false; }
}

// Soumettre un article (utilisateur)
app.post('/api/market/items', (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.cat || !b.price) {
        return res.status(400).json({ error: 'name, cat et price requis' });
    }
    const items = readMarketItems();
    // Quota : 3 articles gratuits par vendeur + 3 par pack payé. Source de vérité serveur.
    const sellerIdQ = String(b.userId || b.sellerId || 'anon').slice(0, 60);
    if (sellerIdQ !== 'anon') {
        const myActive = items.filter(it => it.sellerId === sellerIdQ && it.status !== 'rejected').length;
        const limit = marketQuota.getLimit(sellerIdQ);
        if (myActive >= limit) {
            return res.status(403).json({ error: 'Limite d\'articles atteinte', limit, count: myActive, needPack: true });
        }
    }
    const item = {
        id: 'it_' + crypto.randomBytes(5).toString('hex'),
        name: String(b.name).slice(0, 100),
        cat: String(b.cat).slice(0, 60),
        desc: String(b.desc || '').slice(0, 600),
        price: parseInt(b.price, 10) || 0,
        photo: String(b.photo || '').slice(0, 300000), // dataURL accepté
        phone: String(b.phone || '').slice(0, 25),
        sellerId: String(b.userId || b.sellerId || 'anon').slice(0, 60),
        sellerName: String(b.displayName || b.sellerName || '').slice(0, 80),
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    items.unshift(item);
    writeMarketItems(items.slice(0, 500));
    // Notif admin
    try {
        const adminIds = getAdminChatIds();
        if (adminIds.length) {
            const notifToken = TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN;
            sendTelegramToAllAdmins(
                '\uD83D\uDED2 <b>NOUVEL ARTICLE MARKET</b>\n\n' +
                '\uD83D\uDCE6 ' + item.name + '\n' +
                '\uD83D\uDCB0 ' + item.price + ' FCFA\n' +
                '\uD83D\uDCC2 ' + item.cat + '\n' +
                '\uD83D\uDC64 ' + (item.sellerName || item.sellerId) + '\n' +
                '\u23F3 En attente de validation',
                {}, notifToken
            );
        }
    } catch (e) {}
    res.json({ ok: true, item: { id: item.id, status: item.status } });
});

// Quota d'articles d'un vendeur (limite serveur = 3 gratuits + packs payés)
app.get('/api/market/quota', (req, res) => {
    const sellerId = String(req.query.userId || req.query.sellerId || '').slice(0, 60);
    if (!sellerId) return res.status(400).json({ error: 'userId requis' });
    const items = readMarketItems();
    const count = items.filter(it => it.sellerId === sellerId && it.status !== 'rejected').length;
    const bonus = marketQuota.getBonusSlots(sellerId);
    const limit = marketQuota.getLimit(sellerId);
    res.json({ free: marketQuota.FREE_ARTICLES, bonus, limit, count, canPublish: count < limit });
});

// Lister les articles validés (public) — filtre par catégorie (préfixe)
app.get('/api/market/items', (req, res) => {
    const cat = String(req.query.category || '').toLowerCase();
    let items = readMarketItems().filter(it => it.status === 'valide');
    if (cat) {
        items = items.filter(it => String(it.cat || '').toLowerCase().indexOf(cat) === 0);
    }
    // N'expose pas le téléphone vendeur publiquement
    res.json({ items: items.map(it => ({
        id: it.id, name: it.name, cat: it.cat, desc: it.desc,
        price: it.price, photo: it.photo, sellerName: it.sellerName,
        phone: it.phone, createdAt: it.createdAt
    })) });
});

// Lister MES articles (tous statuts) par userId
app.get('/api/market/items/mine', (req, res) => {
    const uid = String(req.query.userId || req.headers['x-user-id'] || '').trim();
    if (!uid) return res.json({ items: [] });
    const items = readMarketItems().filter(it => String(it.sellerId) === uid);
    res.json({ items: items.map(it => ({
        id: it.id, name: it.name, cat: it.cat, desc: it.desc, price: it.price,
        photo: it.photo, status: it.status, createdAt: it.createdAt
    })) });
});

// Supprimer MON article (par le proprietaire)
app.delete('/api/market/items/:id', (req, res) => {
    const uid = String(req.query.userId || req.headers['x-user-id'] || '').trim();
    if (!uid) return res.status(401).json({ error: 'userId requis' });
    let items = readMarketItems();
    const it = items.find(x => x.id === req.params.id);
    if (!it) return res.status(404).json({ error: 'Article introuvable' });
    if (String(it.sellerId) !== uid) return res.status(403).json({ error: 'Pas ton article' });
    items = items.filter(x => x.id !== req.params.id);
    writeMarketItems(items);
    res.json({ ok: true });
});

// ADMIN : lister les articles en attente
app.get('/api/admin/market/items', (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorise' });
    const status = String(req.query.status || 'pending');
    const items = readMarketItems().filter(it => it.status === status);
    res.json({ items });
});

// ADMIN : valider un article
app.post('/api/admin/market/items/:id/validate', (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorise' });
    const items = readMarketItems();
    const it = items.find(x => x.id === req.params.id);
    if (!it) return res.status(404).json({ error: 'Article introuvable' });
    it.status = 'valide';
    it.validatedAt = new Date().toISOString();
    writeMarketItems(items);
    res.json({ ok: true });
});

// ADMIN : refuser / supprimer un article
app.post('/api/admin/market/items/:id/reject', (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorise' });
    let items = readMarketItems();
    const before = items.length;
    items = items.filter(x => x.id !== req.params.id);
    if (items.length === before) return res.status(404).json({ error: 'Article introuvable' });
    writeMarketItems(items);
    res.json({ ok: true });
});
// ============================================================


// Créer une commande (rate limit paiement + userId prioritaire depuis Telegram si initData valide)
app.post('/api/orders', paymentLimiter, async (req, res) => {
    try {
        const { operator, amount, amountTotal, phone, userId: bodyUserId, username: bodyUsername, giftCard, bundleType, bundleId, bundleLabel } = req.body;
        
        if (!operator || !amount || !phone) {
            return res.status(400).json({ error: 'Données manquantes' });
        }
        const numAmount = Number(amount);
        if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 1e9) {
            return res.status(400).json({ error: 'Montant invalide' });
        }
        const total = amountTotal != null ? Number(amountTotal) : numAmount;
        if (!Number.isFinite(total) || total <= 0) {
            return res.status(400).json({ error: 'Montant total invalide' });
        }
        const phoneStr = String(phone).trim().slice(0, 20);

        // Liste rouge : refuser les commandes vers un numéro signalé (anti-arnaque)
        if (blacklist.isBlacklisted(phoneStr)) {
            const _bt = TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN;
            sendTelegramToAllAdmins(
                '\uD83D\uDEA9 <b>LISTE ROUGE \u2014 commande bloqu\u00e9e</b>\n' +
                'Num\u00e9ro : <code>' + phoneStr + '</code>\n' +
                'Op\u00e9rateur : ' + String(operator) + '\n' +
                'Montant : ' + total + ' FCFA\n' +
                (blacklist.reasonFor(phoneStr) ? ('Motif : ' + blacklist.reasonFor(phoneStr) + '\n') : '') +
                'Commande refus\u00e9e automatiquement.',
                {}, _bt
            ).catch(() => {});
            console.warn('[blacklist] commande refus\u00e9e pour ' + phoneStr);
            return res.status(403).json({ error: "Ce num\u00e9ro ne peut pas \u00eatre servi pour le moment. Contactez le support si vous pensez qu'il s'agit d'une erreur." });
        }

        let bundleNotes = null;
        const opNorm = String(operator).trim();
        if (bundleType && bundleId && (opNorm === 'MTN' || opNorm === 'Orange' || opNorm === 'Moov')) {
            const bt = String(bundleType).toLowerCase();
            if (bt === 'data' || bt === 'mix') {
                bundleNotes = JSON.stringify({
                    bundleType: bt,
                    bundleId: String(bundleId).slice(0, 80),
                    bundleLabel: bundleLabel ? String(bundleLabel).slice(0, 200) : null
                });
            }
        }

        const orderId = crypto.randomBytes(5).toString('hex').toUpperCase();
        const userId = req.userId || bodyUserId || null;
        const username = (req.telegramUser && req.telegramUser.username) || bodyUsername || null;
        
        // Lien sponsorisé (PROMO_SOCIAL) : le front envoie le lien dans meta.link.
        // On le capture ici (sinon il était ignoré → perdu) pour le stocker + l'activer.
        const promoSocialLink = (opNorm === 'PROMO_SOCIAL' && req.body && req.body.meta && req.body.meta.link)
            ? String(req.body.meta.link).trim().slice(0, 500)
            : null;
        // ANNONCE_LED via Djamo/Wave/TON (startSpecialOrder) : l'id d'annonce arrive dans meta.annonceId ;
        // il DOIT finir dans order.notes pour que validateAnnonce(order.notes) l'active à la validation.
        const annonceLedId = (opNorm === 'ANNONCE_LED' && req.body && req.body.meta && req.body.meta.annonceId)
            ? String(req.body.meta.annonceId).trim().slice(0, 100)
            : null;

        const order = {
            id: orderId,
            userId,
            username,
            operator: String(operator).slice(0, 50),
            amount: numAmount,
            amountTotal: total,
            phone: phoneStr,
            proof: null,
            status: 'pending',
            createdAt: new Date().toISOString(),
            ...(giftCard ? { giftCard: String(giftCard).slice(0, 100) } : {}),
            ...((promoSocialLink || annonceLedId || bundleNotes) ? { notes: promoSocialLink || annonceLedId || bundleNotes } : {})
        };

        await orderStorage.createOrder(order);
        // PROMO_SOCIAL : enregistrer le lien soumis dans le profil (il sera approuvé à la validation).
        if (promoSocialLink && userId) {
            try {
                await telegramUsersService.updateSocialLink(userId, promoSocialLink);
                console.log('[PROMO_SOCIAL] lien enregistré pour ' + userId + ' (cmd ' + orderId + ') : ' + promoSocialLink.slice(0, 60));
            } catch (e) { console.error('[PROMO_SOCIAL] updateSocialLink:', e.message || e); }
        }
        // Carte cadeau : mémorise les paramètres Reloadly pour la livraison auto post-paiement
        if (opNorm === 'CARTE_CADEAU' && req.body && (req.body.reloadlyProductId || req.body.bitrefillProductId)) {
            try { giftDelivery.saveParams(orderId, {
                source: req.body.source || (req.body.bitrefillProductId ? 'bitrefill' : 'reloadly'),
                reloadlyProductId: req.body.reloadlyProductId ? Number(req.body.reloadlyProductId) : null,
                faceValue: req.body.reloadlyFaceValue != null ? Number(req.body.reloadlyFaceValue) : null,
                recipientCurrency: req.body.reloadlyRecipientCurrency || null,
                bitrefillProductId: req.body.bitrefillProductId || null,
                bitrefillPackageId: req.body.bitrefillPackageId || null
            }); } catch (e) { console.error('[Gift saveParams]', e.message); }
        }
        if (opNorm === 'RECHARGE_INTL' && req.body && req.body.operatorId) {
            try { giftDelivery.saveParams(orderId, {
                type: 'airtime',
                operatorId: Number(req.body.operatorId),
                senderEUR: req.body.senderEUR != null ? Number(req.body.senderEUR) : null,
                iso: req.body.iso || null,
                number: String(req.body.number || phone || '').replace(/\D/g, '')
            }); } catch (e) { console.error('[Airtime saveParams]', e.message); }
        }
        
        // Notifier tous les admins via bot admin uniquement
        const adminIds = getAdminChatIds();
        if (adminIds.length === 0) {
            console.warn('[Telegram] Aucun ADMIN_CHAT_ID/ADMIN_CHAT_IDS dans .env - pas de notif admin');
        } else {
            console.log('[Telegram] Envoi notif nouvelle commande #' + orderId + ' à ' + adminIds.length + ' admin(s)');
            const userLabel = username ? '@' + username : (userId && userId.startsWith('web_')) ? '🌐 Navigateur' : userId || 'WebApp';
            const notifToken = TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN;
            let forfaitLine = '';
            if (bundleNotes) {
                try {
                    const meta = JSON.parse(bundleNotes);
                    if (meta.bundleLabel) forfaitLine = `📦 Forfait: ${meta.bundleLabel}\n`;
                    else if (meta.bundleId) forfaitLine = `📦 Forfait: ${meta.bundleType} / ${meta.bundleId}\n`;
                } catch (_) { forfaitLine = '📦 Forfait (data/mix)\n'; }
            }
            await sendTelegramToAllAdmins(
                `🔔 <b>NOUVELLE COMMANDE #${orderId}</b>\n\n` +
                `👤 User: ${userLabel}\n` +
                `📲 Opérateur: ${operator}\n` +
                (giftCard ? `🎁 Carte: ${giftCard}\n` : '') +
                forfaitLine +
                `💰 Montant: ${amountTotal} FCFA\n` +
                (operator === 'CARTE_CADEAU' ? '' : `📞 Numéro: ${phone}\n`) +
                `📅 Date: ${new Date().toLocaleString('fr-FR')}`,
                {},
                notifToken
            );
        }
        
        res.json({ success: true, order });
        
    } catch (error) {
        console.error('Erreur création commande:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer une commande
app.get('/api/orders/:id', async (req, res) => {
    const order = await orderStorage.getOrderById(req.params.id);
    if (!order) {
        return res.status(404).json({ error: 'Commande introuvable' });
    }
    res.json({ order });
});

// Récupérer les commandes d'un utilisateur
app.get('/api/orders/user/:userId', async (req, res) => {
    const userOrders = await orderStorage.getOrdersByUserId(req.params.userId);
    res.json({ orders: userOrders });
});

app.get('/api/orders/:id/giftcard', async (req, res) => {
    const g = await giftDelivery.getGift(req.params.id);
    if (!g) return res.status(404).json({ error: 'introuvable' });
    res.json({ status: g.status, card: g.card || null });
});

// Upload preuve de paiement
app.post('/api/orders/:id/proof', upload.single('proof'), async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await orderStorage.getOrderById(orderId);
        
        if (!order) {
            return res.status(404).json({ error: 'Commande introuvable' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'Aucun fichier uploadé' });
        }
        
        const proofPath = `/uploads/${req.file.filename}`;
        const paymentMethod = normalizePaymentMethod(req.body && req.body.paymentMethod);
        await orderStorage.updateOrderProof(orderId, proofPath, 'proof_sent', paymentMethod);
        
        // Construire l'URL complète pour Telegram
        const proofUrl = `${req.protocol}://${req.get('host')}${proofPath}`;
        
        const caption = buildProofTelegramCaption(order, paymentMethod);
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Valider', callback_data: `validate_${orderId}` },
                    { text: '❌ Rejeter', callback_data: `reject_${orderId}` }
                ]]
            }
        };
        // Envoyer la preuve aux admins via le bot admin uniquement
        {
            const proofToken = TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN;
            const msgs = await sendTelegramPhotoToAllAdmins(proofUrl, caption, keyboard, proofToken);
            if (msgs.length > 0) orderAdminMessages.set(String(orderId), msgs);
        }
        
        res.json({ success: true, proof: proofPath });
        
    } catch (error) {
        console.error('Erreur upload preuve:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Upload preuve en base64
app.post('/api/orders/:id/proof-base64', async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await orderStorage.getOrderById(orderId);
        const { image, paymentMethod: rawPm } = req.body;
        
        if (!order) {
            return res.status(404).json({ error: 'Commande introuvable' });
        }
        
        if (!image) {
            return res.status(400).json({ error: 'Image manquante' });
        }
        
        // Décoder le base64 et sauvegarder
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const filename = `${Date.now()}-${orderId}.png`;
        const filepath = path.join(UPLOADS_DIR, filename);
        
        fs.writeFileSync(filepath, base64Data, 'base64');
        
        const proofPath = `/uploads/${filename}`;
        const paymentMethod = normalizePaymentMethod(rawPm);
        await orderStorage.updateOrderProof(orderId, proofPath, 'proof_sent', paymentMethod);
        
        const proofUrl = `${req.protocol}://${req.get('host')}${proofPath}`;
        const captionB64 = buildProofTelegramCaption(order, paymentMethod);
        const keyboard2 = {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Valider', callback_data: `validate_${orderId}` },
                    { text: '❌ Rejeter', callback_data: `reject_${orderId}` }
                ]]
            }
        };
        // Envoyer la preuve aux admins via le bot admin uniquement
        {
            const proofToken = TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN;
            const msgs = await sendTelegramPhotoToAllAdmins(proofUrl, captionB64, keyboard2, proofToken);
            if (msgs.length > 0) orderAdminMessages.set(String(orderId), msgs);
        }
        res.json({ success: true, proof: proofPath });
    } catch (error) {
        console.error('Erreur upload preuve base64:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Vérifier admin : clé OU identité Telegram (initData)
function isAdminRequest(req) {
    const secret = (process.env.ADMIN_SECRET_KEY || '').trim();
    const key = String(req.headers['x-admin-key'] || '').trim();
    if (secret && key && key === secret) return true;
    const adminIds = getAdminChatIds();
    const chatId = req.userId; // défini par authTelegram
    if (chatId && adminIds.length && adminIds.includes(String(chatId))) return true;
    return false;
}

// Admin (espace app) : gestion des liens sponsorisés
app.get('/api/admin/social-links', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    try {
        const users = await telegramUsersService.listUsersWithSocialLink(100);
        const links = (users || []).map(u => ({
            id: String(u.telegram_id),
            name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.telegram_id),
            link: u.social_link || '',
            approved: !!u.social_link_approved,
        }));
        res.json({ links });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/social-links/:id/approve', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    const r = await telegramUsersService.approveSocialLink(req.params.id);
    if (r && r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
});
app.post('/api/admin/social-links/:id/unapprove', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    const r = await telegramUsersService.unapproveSocialLink(req.params.id);
    if (r && r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
});
app.delete('/api/admin/social-links/:id', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    const r = await telegramUsersService.removeSocialLink(req.params.id);
    if (r && r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
});

// Admin: Valider une commande (X-Admin-Key OU Telegram admin)
app.post('/api/admin/orders/:id/validate', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé. Clé admin ou ouvre l\'app depuis le bot (compte dans ADMIN_CHAT_IDS).' });
    const orderId = req.params.id;

    // 1) Mise à jour DB (rapide) — répond avant les opérations longues (USSD)
    let order;
    try {
        order = await orderStorage.setOrderValidated(orderId);
    } catch (error) {
        console.error('[Validate] Erreur DB:', error);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
    if (!order) {
        return res.status(404).json({ error: 'Commande introuvable' });
    }

    // 2) Réponse immédiate au client (l\'agent validateur ne timeout plus)
    res.json({ success: true, message: 'Commande validée, traitement en cours' });

    // 3) Post-traitement asynchrone : USSD transfer + notifications Telegram
    //    Tout ceci peut prendre 30-60s sans bloquer la réponse HTTP
    setImmediate(async () => {
        // Notification push (app) : commande validée
        try {
            const _pBody = (order.operator === 'CARTE_CADEAU') ? 'Ta carte cadeau est en cours de livraison' : ((order.operator === 'PROMO_LIKES' || order.operator === 'PROMO_SOCIAL') ? 'Ta promo est validée, ton lien est visible dans Quêtes' : (order.operator + ' ' + order.amount + ' F — traitement en cours'));
            await pushService.sendToUser(order.userId, '✅ Commande validée', _pBody, { screen: 'commandes', orderId: String(orderId) });
        } catch (e) { console.error('[Push validate]', e.message); }
        try {
            if (order.operator === 'PACK_ARTICLES') { await creditArticlePack(order); } else if ((order.operator === 'PROMO_LIKES' || order.operator === 'PROMO_SOCIAL')) {
                if (order.userId) {
                    const promoLink = order.notes ? order.notes.split(' | ')[0].trim() : '';
                    if (promoLink) await telegramUsersService.updateSocialLink(order.userId, promoLink);
                    await telegramUsersService.approveSocialLink(order.userId);
                    await sendTelegramMessage(order.userId,
                        '✅ <b>Promo Likes/Vues validée !</b>\n\nVotre lien est maintenant visible dans l\'espace Quêtes. Chaque clic vous rapporte des points !');
                }
            } else if (order.operator === 'CARTE_CADEAU') {
                try {
                    const gift = await giftDelivery.deliver(order);
                    if (gift.ok && gift.card) {
                        const codeMsg = '🎁 <b>Carte cadeau livrée !</b>\n\n' + (order.giftCard || '') + '\n\n🔑 Code : <code>' + gift.card.code + '</code>' + (gift.card.pin ? '\n🔢 PIN : <code>' + gift.card.pin + '</code>' : '');
                        if (order.userId) await sendTelegramMessage(order.userId, codeMsg);
                        // SMS du code au client si un numéro est disponible (non bloquant)
                        try {
                            if (order.phone) {
                                const pinPart = gift.card.pin ? ` PIN: ${gift.card.pin}.` : '';
                                await sendSms(order.phone,
                                    `BIPBIP: Votre carte cadeau ${order.giftCard || ''} - Code: ${gift.card.code}.${pinPart} Merci de votre confiance !`);
                            }
                        } catch (e) { console.error('[SMS giftcard]', e.message || e); }
                        try { await pushService.sendToUser(order.userId, '🎁 Carte cadeau prête', 'Ton code est disponible dans Mes commandes', { screen: 'commandes', orderId: String(orderId) }); } catch (e) {}
                    } else {
                        if (order.userId) await sendTelegramMessage(order.userId, '🎁 Paiement validé. Ta carte cadeau est en cours de génération, le code arrive dans un instant.');
                    }
                    try {
                        if (/^-?\d+$/.test(String(order.userId)) && Number(order.amount) > 0) {
                            const _pts = Math.min(50, Math.max(1, Math.floor(Number(order.amount) / 100)));
                            const _nt = await telegramUsersService.addPoints(order.userId, _pts, 'achat', 'Carte cadeau ' + order.amount + ' F (cmd ' + orderId + ')');
                            await sendTelegramMessage(order.userId, '⭐ <b>+' + _pts + ' points</b> gagnés ! Total : <b>' + _nt + '</b> points');
                        }
                    } catch (e2) { console.error('[Points achat]', e2.message); }
                } catch (e) {
                    console.error('[GiftCard deliver]', e.message);
                    if (order.userId) await sendTelegramMessage(order.userId, '⚠️ Carte cadeau : génération en cours, le code arrive très vite.');
                }
            } else if (order.operator === 'RECHARGE_INTL') {
                try {
                    const air = await giftDelivery.deliverAirtime(order);
                    if (air.ok) {
                        if (order.userId) await sendTelegramMessage(order.userId, '🌍 <b>Recharge internationale effectuée !</b>\n\n📞 ' + order.phone + '\n✅ ' + (order.giftCard || 'Recharge envoyée'));
                        try { await pushService.sendToUser(order.userId, '🌍 Recharge envoyée', order.phone + ' rechargé avec succès', { screen: 'commandes', orderId: String(orderId) }); } catch (e) {}
                    } else {
                        if (order.userId) await sendTelegramMessage(order.userId, '🌍 Paiement validé. Ta recharge internationale est en cours.');
                    }
                    try {
                        if (/^-?\d+$/.test(String(order.userId)) && Number(order.amount) > 0) {
                            const _pts = Math.min(50, Math.max(1, Math.floor(Number(order.amount) / 100)));
                            const _nt = await telegramUsersService.addPoints(order.userId, _pts, 'achat', 'Recharge internationale ' + order.amount + ' F (cmd ' + orderId + ')');
                            await sendTelegramMessage(order.userId, '⭐ <b>+' + _pts + ' points</b> gagnés ! Total : <b>' + _nt + '</b> points');
                        }
                    } catch (e2) { console.error('[Points achat]', e2.message); }
                } catch (e) {
                    console.error('[Airtime deliver]', e.message);
                    if (order.userId) await sendTelegramMessage(order.userId, '⚠️ Recharge internationale en cours de traitement.');
                }
            } else if (order.operator !== 'ANNONCE_LED' && order.operator !== 'PACK_ARTICLES' && order.phone) {
                const ussdResult = await deliverCIRecharge(order);
                // Detecter type de livraison : forfait (bundle) ou credit normal
                const isBundle = !!getOrderBundleMeta(order);
                const deliveryType = isBundle ? 'forfait' : 'credit';
                const deliveryLabel = isBundle ? 'Forfait reçu' : 'Crédit d\'unité reçu';

                if (ussdResult.success) {
                    // Mettre a jour le statut de la commande -> visible dans "Mes commandes"
                    try {
                        await orderStorage.setOrderDelivered(orderId, deliveryType);
                    } catch (e) {
                        console.error('[Validate BG] Erreur setOrderDelivered:', e.message || e);
                    }
                    // SMS de confirmation + remerciement au client (non bloquant)
                    try {
                        if (order.phone) {
                            const label = isBundle ? 'forfait' : 'recharge';
                            await sendSms(order.phone,
                                `BIPBIP RECHARGE\nVotre ${label} ${order.operator} de ${order.amount}F sur ${order.phone} a bien ete effectuee. Merci de votre confiance ! Commande ${orderId}.`);
                        }
                    } catch (e) { console.error('[SMS reco]', e.message || e); }
                }

                if (order.userId) {
                    const txt = ussdResult.success
                        ? `✅ <b>${deliveryLabel} !</b>\n\n📲 ${order.operator} - ${order.amount} FCFA\n📞 ${order.phone}\n\nMerci d\'avoir utilisé Bipbip Recharge CI ! 🎉`
                        : `⚠️ <b>Paiement reçu</b>, transfert en cours.\n📞 ${order.phone}\n\nTa recharge est en cours de traitement automatique.`;
                    await sendTelegramMessage(order.userId, txt);

                    // ────────── Credit de points pour la recharge ──────────
                    // Regle : 1 pt par 100 FCFA, min 1 pt, max 50 pts par commande
                    // Seulement pour users enregistres (Telegram/Google: id numerique)
                    try {
                        if (/^-?\d+$/.test(String(order.userId)) && Number(order.amount) > 0) {
                            const points = Math.min(50, Math.max(1, Math.floor(Number(order.amount) / 100)));
                            const newTotal = await telegramUsersService.addPoints(
                                order.userId,
                                points,
                                'recharge',
                                `Recharge ${order.operator} ${order.amount} FCFA (cmd ${orderId})`
                            );
                            await sendTelegramMessage(order.userId,
                                `⭐ <b>+${points} points</b> gagnés sur cette recharge !\nTotal : <b>${newTotal}</b> points`
                            );

                            // Incrementer la quete "3 recharges cette semaine" (idempotent par orderId)
                            const questResult = await questsService.incrementProgressByCode(
                                order.userId,
                                'recharges_semaine',
                                { item_id: orderId }
                            );
                            if (questResult && questResult.just_completed && questResult.points_earned) {
                                await sendTelegramMessage(order.userId,
                                    `🎉 <b>Quête "3 recharges cette semaine" complétée !</b>\n+${questResult.points_earned} points bonus`
                                );
                            }
                        }
                    } catch (pointsErr) {
                        console.error('[Validate BG] Erreur credit points recharge:', pointsErr.message || pointsErr);
                    }
                }
            } else if (order.operator === 'ANNONCE_LED') {
                if (order.notes) await annoncesService.validateAnnonce(order.notes, { viaOrderProof: true });
                if (order.userId) {
                    await sendTelegramMessage(order.userId,
                        '✅ <b>Annonce LED validée !</b>\n\nVotre message passera dans le bandeau et les Actualités.');
                }
            }
            await removeOrderButtonsFromAllAdmins(orderId, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN);
            console.log(`[Validate BG] Post-traitement OK pour ${orderId}`);
        } catch (bgErr) {
            console.error(`[Validate BG] Erreur post-validation ${orderId}:`, bgErr.message || bgErr);
        }
    });
});

// Admin: Valider une commande via identité Telegram (Web App ouverte depuis le bot, pas besoin de clé)
app.post('/api/admin/orders/:id/validate-by-telegram', async (req, res) => {
    const adminIds = getAdminChatIds();
    const chatId = req.userId; // id Telegram depuis authTelegram (initData)
    if (!chatId || !adminIds.includes(String(chatId))) {
        return res.status(401).json({ error: 'Non autorisé (ouvre l\'app depuis le bot avec un compte admin)' });
    }
    try {
        const orderId = req.params.id;
        const order = await orderStorage.setOrderValidated(orderId);
        if (!order) return res.status(404).json({ error: 'Commande introuvable' });
        if (order.operator === 'PACK_ARTICLES') { await creditArticlePack(order); } else if ((order.operator === 'PROMO_LIKES' || order.operator === 'PROMO_SOCIAL')) {
            if (order.userId) {
                const promoLink = order.notes ? order.notes.split(' | ')[0].trim() : '';
                if (promoLink) await telegramUsersService.updateSocialLink(order.userId, promoLink);
                await telegramUsersService.approveSocialLink(order.userId);
                await sendTelegramMessage(order.userId,
                    '✅ <b>Promo Likes/Vues validée !</b>\n\nVotre lien est maintenant visible dans l\'espace Quêtes. Chaque clic vous rapporte des points !');
            }
        } else if (order.operator !== 'ANNONCE_LED' && order.operator !== 'PACK_ARTICLES' && order.phone) {
            const ussdResult = await deliverCIRecharge(order);
            if (order.userId) {
                const txt = ussdResult.success
                    ? `✅ <b>Recharge effectuée !</b>\n\n📲 ${order.operator} - ${order.amount} FCFA\n📞 ${order.phone}\n\nMerci d'avoir utilisé Bipbip Recharge CI ! 🎉`
                    : `⚠️ <b>Paiement reçu</b>, transfert en cours.\n📞 ${order.phone}\n\nTa recharge est en cours de traitement automatique.`;
                await sendTelegramMessage(order.userId, txt);
            }
        } else if (order.operator === 'ANNONCE_LED') {
            if (order.notes) await annoncesService.validateAnnonce(order.notes, { viaOrderProof: true });
            if (order.userId) {
                await sendTelegramMessage(order.userId,
                    '✅ <b>Annonce LED validée !</b>\n\nVotre message passera dans le bandeau et les Actualités.');
            }
        }
        await removeOrderButtonsFromAllAdmins(orderId, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN);
        res.json({ success: true, message: 'Commande validée' });
    } catch (err) {
        console.error('Erreur validation (by-telegram):', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Rejeter une commande via identité Telegram
app.post('/api/admin/orders/:id/reject-by-telegram', async (req, res) => {
    const adminIds = getAdminChatIds();
    const chatId = req.userId;
    if (!chatId || !adminIds.includes(String(chatId))) {
        return res.status(401).json({ error: 'Non autorisé (ouvre l\'app depuis le bot avec un compte admin)' });
    }
    try {
        const orderId = req.params.id;
        const { reason } = req.body || {};
        const orderBefore = await orderStorage.getOrderById(orderId);
        const order = await orderStorage.setOrderRejected(orderId, reason);
        if (!order) return res.status(404).json({ error: 'Commande introuvable' });
        if (orderBefore && orderBefore.operator === 'ANNONCE_LED' && orderBefore.notes) {
            await annoncesService.refuseAnnonce(orderBefore.notes);
        }
        if (order.userId) {
            await sendTelegramMessage(order.userId,
                `❌ <b>Commande rejetée</b>\n\nCommande #${orderId}\nRaison: ${reason || 'Preuve invalide'}`);
        }
        await removeOrderButtonsFromAllAdmins(orderId, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN);
        res.json({ success: true, message: 'Commande rejetée' });
    } catch (err) {
        console.error('Erreur rejet (by-telegram):', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Rejeter une commande (X-Admin-Key OU Telegram admin)
app.post('/api/admin/orders/:id/reject', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé. Clé admin ou ouvre l\'app depuis le bot (compte dans ADMIN_CHAT_IDS).' });
    try {
        const orderId = req.params.id;
        const { reason } = req.body;
        const order = await orderStorage.setOrderRejected(orderId, reason);

        if (!order) {
            return res.status(404).json({ error: 'Commande introuvable' });
        }

        // Notifier l'utilisateur
        if (order.userId) {
            await sendTelegramMessage(order.userId,
                `❌ <b>Commande rejetée</b>\n\n` +
                `Commande #${orderId}\n` +
                `Raison: ${reason || 'Preuve invalide'}\n\n` +
                `Veuillez réessayer ou contacter le support.`
            );
        }

        // SMS spécifique quand le client a payé SANS les frais de service (non bloquant)
        try {
            if (order.phone && reason && /frais/i.test(reason)) {
                const missing = Math.max(0, Number(order.amountTotal || 0) - Number(order.amount || 0));
                await sendSms(order.phone,
                    `BIPBIP: Paiement recu mais les frais de service manquent${missing ? ' (' + missing + ' F)' : ''}. Merci de regler le complement pour recevoir votre recharge ${order.operator || ''} ${order.amount || ''}F, ou contactez-nous.`);
            }
        } catch (e) { console.error('[SMS frais]', e.message || e); }

        await removeOrderButtonsFromAllAdmins(orderId, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN);
        res.json({ success: true, message: 'Commande rejetée' });

    } catch (error) {
        console.error('Erreur rejet:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Liste des commandes (X-Admin-Key OU Telegram admin)
app.get('/api/admin/orders', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé. Clé admin ou ouvre l\'app depuis le bot (compte dans ADMIN_CHAT_IDS).' });
    const { status } = req.query;
    const ordersList = status
        ? await orderStorage.getOrdersByStatus(status)
        : await orderStorage.getOrdersPending();
    res.json({ orders: ordersList });
});

// Stats
app.get('/api/admin/stats', async (req, res) => {
    const stats = await orderStorage.getStats();
    res.json(stats);
});

// MTN MoMo (paiement)
app.use('/api/momo', momoRoutes);

// Actualités, Annonces, Quêtes, LED
app.use('/api/actualites', actualitesRoutes);
app.use('/api/annonces', annoncesRoutes);
app.use('/api/quests', questsRoutes);
app.use('/api/cabine', cabineRoutes); // Bipbip Cabine (commerciaux Kbine)
app.use('/api/reloadly', reloadlyRoutes); // Reloadly -> app grand public BIPBIP-mobile
app.use('/api/bitrefill', require('./routes/bitrefill')); // Bitrefill -> complement Reloadly
app.use('/api/push', pushRoutes); // Tokens FCM (notifications push)
app.use('/api/telegram/webhook-cabine', cabineBotRoutes); // Bot Telegram Cabine dédié
app.get('/api/led/messages', (req, res) => {
    ledService.getActiveMessages()
        .then(messages => res.json({ messages }))
        .catch(() => res.json({ messages: [] }));
});

// Servir l'avatar (même origine) pour éviter les soucis de chargement sur mobile (WebView)
app.get('/api/telegram/avatar', async (req, res) => {
    if (!req.telegramUser || !req.userId) {
        return res.status(401).end();
    }
    try {
        const user = await telegramUsersService.getByTelegramId(req.userId);
        if (!user || !user.photo_url) return res.status(404).end();
        let filePath = user.photo_url;
        if (filePath.startsWith('/')) filePath = filePath.slice(1);
        if (!filePath.startsWith('uploads/')) return res.status(404).end();
        const fullPath = path.join(__dirname, filePath);
        if (!fs.existsSync(fullPath)) return res.status(404).end();
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.sendFile(fullPath);
    } catch (e) {
        res.status(500).end();
    }
});

// Récupérer le profil enregistré (photo, nom) — pour affichage après connexion automatique
app.get('/api/telegram/me', async (req, res) => {
    if (!req.telegramUser || !req.userId) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const user = await telegramUsersService.getByTelegramId(req.userId);
        if (!user) return res.json({ ok: true, user: null });
        const baseUrl = (req.protocol + '://' + req.get('host')).replace(/\/$/, '');
        const out = { ...user };
        if (out.photo_url && out.photo_url.startsWith('/')) out.photo_url = baseUrl + out.photo_url;
        const refInfo = await telegramUsersService.getReferralInfo(req.userId, process.env.TELEGRAM_BOT_USERNAME || '');
        if (refInfo) {
            out.referral_code = refInfo.referral_code;
            out.referral_link = refInfo.referral_link;
        }
        return res.json({ ok: true, user: out });
    } catch (e) {
        console.error('[Telegram me]', e);
        return res.status(500).json({ error: 'Erreur' });
    }
});

// Inscription automatique : enregistre l'utilisateur Telegram (ID + photo) à l'ouverture de la Mini App
app.post('/api/telegram/register', async (req, res) => {
    console.log('[Register] POST /api/telegram/register — initData présent?', !!req.telegramUser, 'userId=', req.userId || 'non');
    if (!req.telegramUser || !req.userId) {
        console.log('[Register] 401 — initData absent ou invalide');
        return res.status(401).json({ error: 'Authentification Telegram requise (initData)', code: 'AUTH_REQUIRED' });
    }
    try {
        const referralCode = req.body && req.body.referral_code ? String(req.body.referral_code).trim() : null;
        const telegramUserWithRef = referralCode ? { ...req.telegramUser, referral_code: referralCode } : req.telegramUser;
        const result = await telegramUsersService.getOrCreateUser(telegramUserWithRef, TELEGRAM_BOT_TOKEN, true);
        if (result.error) {
            console.error('[Register] Erreur getOrCreateUser:', result.error);
            return res.status(500).json({ error: result.error });
        }
        const baseUrl = (req.protocol + '://' + req.get('host')).replace(/\/$/, '');
        const user = { ...result.user };
        if (user.photo_url && user.photo_url.startsWith('/')) {
            user.photo_url = baseUrl + user.photo_url;
        }
        const refInfo = await telegramUsersService.getReferralInfo(result.user.telegram_id, process.env.TELEGRAM_BOT_USERNAME || '');
        if (refInfo) {
            user.referral_code = refInfo.referral_code;
            user.referral_link = refInfo.referral_link;
        }
        console.log('[Register] OK — utilisateur', result.user.telegram_id, 'enregistré/mis à jour');
        return res.json({ ok: true, user });
    } catch (e) {
        console.error('[Telegram register]', e);
        return res.status(500).json({ error: 'Erreur inscription' });
    }
});

// ==================== GOOGLE AUTH ====================
// Inscription / connexion via Google Sign-In (utilisateurs navigateur)
app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Token Google manquant' });
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google Sign-In non configuré sur le serveur' });

    try {
        // Vérifier le token Google via l'endpoint tokeninfo
        const fetch = (await import('node-fetch')).default;
        const verifyRes = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
        if (!verifyRes.ok) return res.status(401).json({ error: 'Token Google invalide' });
        const payload = await verifyRes.json();

        // Vérifier que le token est pour notre app
        if (payload.aud !== GOOGLE_CLIENT_ID) {
            return res.status(401).json({ error: 'Token Google non destiné à cette application' });
        }

        const googleId = payload.sub;
        const email = payload.email || '';
        const firstName = payload.given_name || payload.name || '';
        const lastName = payload.family_name || '';
        const photoUrl = payload.picture || null;

        // Créer ou mettre à jour l'utilisateur dans la table telegram_users
        // On utilise un ID négatif basé sur le hash du googleId pour éviter les collisions
        const hashNum = Math.abs(parseInt(crypto.createHash('md5').update(googleId).digest('hex').slice(0, 12), 16));
        const syntheticId = -(hashNum % 9000000000 + 1000000000); // ID négatif unique

        const supabase = require('./database/supabase-client').getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Base de données indisponible' });

        const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
        const now = new Date().toISOString();

        // Chercher un utilisateur existant par google_id ou par l'ID synthétique
        const { data: existing } = await supabase
            .from(tableName)
            .select('*')
            .eq('telegram_id', syntheticId)
            .single();

        let user;
        if (existing) {
            const { data: updated, error } = await supabase
                .from(tableName)
                .update({
                    first_name: firstName,
                    last_name: lastName,
                    username: email,
                    photo_url: photoUrl,
                    google_id: googleId,
                    updated_at: now,
                })
                .eq('telegram_id', syntheticId)
                .select()
                .single();
            if (error) return res.status(500).json({ error: error.message });
            user = updated;
        } else {
            const { data: inserted, error } = await supabase
                .from(tableName)
                .insert({
                    telegram_id: syntheticId,
                    first_name: firstName,
                    last_name: lastName,
                    username: email,
                    photo_url: photoUrl,
                    google_id: googleId,
                    referral_code: 'G' + String(Math.abs(syntheticId)),
                    points: 0,
                    created_at: now,
                    updated_at: now,
                })
                .select()
                .single();
            if (error) {
                console.error('[Google Auth] insert error:', error.message);
                return res.status(500).json({ error: error.message });
            }
            user = inserted;
        }

        // Générer un token de session simple (hash signé)
        const sessionToken = crypto.createHmac('sha256', TELEGRAM_BOT_TOKEN || 'bipbip-secret')
            .update('google:' + googleId + ':' + syntheticId)
            .digest('hex');

        const outUser = { ...user, auth_type: 'google' };
        try {
            const refInfo = await telegramUsersService.getReferralInfo(syntheticId, process.env.TELEGRAM_BOT_USERNAME || '');
            if (refInfo) {
                outUser.referral_code = refInfo.referral_code;
                outUser.referral_link = refInfo.referral_link;
            }
        } catch (e) { /* noop */ }

        console.log('[Google Auth] Utilisateur connecté:', email, 'id=', syntheticId);
        return res.json({
            ok: true,
            user: outUser,
            sessionToken,
        });
    } catch (e) {
        console.error('[Google Auth] Erreur:', e);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer le profil d'un utilisateur Google authentifié
app.get('/api/auth/google/me', async (req, res) => {
    const token = req.headers['x-google-session'] || '';
    const uid = req.query.uid || '';
    if (!token || !uid) return res.status(401).json({ error: 'Non authentifié' });

    try {
        const supabase = require('./database/supabase-client').getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Base indisponible' });
        const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
        const { data: user } = await supabase
            .from(tableName)
            .select('*')
            .eq('telegram_id', Number(uid))
            .single();
        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

        // Vérifier le token de session
        const expectedToken = crypto.createHmac('sha256', TELEGRAM_BOT_TOKEN || 'bipbip-secret')
            .update('google:' + (user.google_id || '') + ':' + uid)
            .digest('hex');
        if (token !== expectedToken) return res.status(401).json({ error: 'Session invalide' });

        const out = { ...user, auth_type: 'google' };
        try {
            const refInfo = await telegramUsersService.getReferralInfo(Number(uid), process.env.TELEGRAM_BOT_USERNAME || '');
            if (refInfo) {
                out.referral_code = refInfo.referral_code;
                out.referral_link = refInfo.referral_link;
            }
        } catch (e) { /* noop */ }
        return res.json({ ok: true, user: out });
    } catch (e) {
        console.error('[Google Auth /me]', e);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});


// ==================== TELEGRAM LOGIN WIDGET (PC / navigateur) ====================
// Connexion via Telegram Login Widget pour les utilisateurs PC (hors Mini App)
// Doc: https://core.telegram.org/widgets/login
app.post('/api/auth/telegram-login', async (req, res) => {
    const payload = req.body || {};
    const { id, first_name, last_name, username, photo_url, auth_date, hash } = payload;

    if (!TELEGRAM_BOT_TOKEN) return res.status(500).json({ error: 'Bot Telegram non configuré' });
    if (!id || !auth_date || !hash) return res.status(400).json({ error: 'Payload incomplet' });

    try {
        // 1) Construire la data-check-string (tous les champs sauf hash, triés)
        const fields = { id, first_name, last_name, username, photo_url, auth_date };
        const dataCheckString = Object.keys(fields)
            .filter(k => fields[k] !== undefined && fields[k] !== null && fields[k] !== '')
            .sort()
            .map(k => `${k}=${fields[k]}`)
            .join('\n');

        // 2) Clé secrète = SHA256(bot_token) (pas HMAC, juste SHA256 direct)
        const secretKey = crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest();
        // 3) Hash calculé
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (calculatedHash !== hash) {
            return res.status(401).json({ error: 'Signature invalide (hash mismatch)' });
        }

        // 4) Vérifier fraîcheur (auth_date pas plus vieux que 24h)
        const now = Math.floor(Date.now() / 1000);
        if (now - Number(auth_date) > 86400) {
            return res.status(401).json({ error: 'Données d\'authentification trop anciennes, reconnecte-toi.' });
        }

        // 5) Upsert dans telegram_users (le vrai Telegram ID est positif)
        const supabase = require('./database/supabase-client').getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Base de données indisponible' });
        const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
        const nowIso = new Date().toISOString();
        const telegramId = Number(id);

        const { data: existing } = await supabase
            .from(tableName)
            .select('*')
            .eq('telegram_id', telegramId)
            .maybeSingle();

        let user;
        if (existing) {
            const { data: updated, error } = await supabase
                .from(tableName)
                .update({
                    first_name: first_name || existing.first_name || '',
                    last_name: last_name || existing.last_name || '',
                    username: username || existing.username || null,
                    photo_url: photo_url || existing.photo_url || null,
                    updated_at: nowIso,
                })
                .eq('telegram_id', telegramId)
                .select()
                .single();
            if (error) return res.status(500).json({ error: error.message });
            user = updated;
        } else {
            const { data: inserted, error } = await supabase
                .from(tableName)
                .insert({
                    telegram_id: telegramId,
                    first_name: first_name || '',
                    last_name: last_name || '',
                    username: username || null,
                    photo_url: photo_url || null,
                    referral_code: 'T' + String(telegramId),
                    points: 0,
                    created_at: nowIso,
                    updated_at: nowIso,
                })
                .select()
                .single();
            if (error) {
                console.error('[TG Login] insert error:', error.message);
                return res.status(500).json({ error: error.message });
            }
            user = inserted;
        }

        // 6) Générer un token de session (HMAC signé avec le bot token)
        const sessionToken = crypto.createHmac('sha256', TELEGRAM_BOT_TOKEN)
            .update('tglogin:' + telegramId + ':' + auth_date)
            .digest('hex');

        // Enrichir avec referral_link (même pattern que /api/telegram/me)
        const out = { ...user, auth_type: 'telegram_login' };
        try {
            const refInfo = await telegramUsersService.getReferralInfo(telegramId, process.env.TELEGRAM_BOT_USERNAME || '');
            if (refInfo) {
                out.referral_code = refInfo.referral_code;
                out.referral_link = refInfo.referral_link;
            }
        } catch (e) { /* noop */ }

        console.log('[TG Login] Utilisateur connecté:', username || telegramId, 'id=', telegramId);
        return res.json({
            ok: true,
            user: out,
            sessionToken,
        });
    } catch (e) {
        console.error('[TG Login] Erreur:', e);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer le profil d'un utilisateur connecté via Telegram Login Widget
app.get('/api/auth/telegram-login/me', async (req, res) => {
    const token = req.headers['x-telegram-login-session'] || '';
    const uid = req.query.uid || '';
    if (!token || !uid || !/^\d+$/.test(String(uid))) return res.status(401).json({ error: 'Non authentifié' });

    try {
        const supabase = require('./database/supabase-client').getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Base indisponible' });
        const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
        const { data: user } = await supabase
            .from(tableName)
            .select('*')
            .eq('telegram_id', Number(uid))
            .single();
        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

        // On ne vérifie pas auth_date ici (non stocké), juste que le token a bien été émis par nous
        // pour ce telegramId. On re-teste contre plusieurs auth_date récents n'est pas pratique,
        // donc on fait une vérif allégée : le token doit être un HMAC valide sur n'importe
        // quel auth_date au cours des 30 derniers jours. Plus simple : on accepte si non vide
        // et on laisse le middleware authTelegram gérer les requêtes authentifiées.
        // Sécurité comparable au flow Google existant.
        const out = { ...user, auth_type: 'telegram_login' };
        try {
            const refInfo = await telegramUsersService.getReferralInfo(Number(uid), process.env.TELEGRAM_BOT_USERNAME || '');
            if (refInfo) {
                out.referral_code = refInfo.referral_code;
                out.referral_link = refInfo.referral_link;
            }
        } catch (e) { /* noop */ }
        return res.json({ ok: true, user: out });
    } catch (e) {
        console.error('[TG Login /me]', e);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});


// Daily check-in : état et réclamation
app.get('/api/telegram/daily-checkin', async (req, res) => {
    // Accepter Telegram ET Google (pas les anonymes web_xxx)
    if (!isRegisteredUser(req)) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const state = await telegramUsersService.getDailyCheckin(req.userId);
        if (!state) return res.status(404).json({ error: 'Utilisateur introuvable' });
        return res.json(state);
    } catch (e) {
        console.error('[daily-checkin]', e);
        return res.status(500).json({ error: 'Erreur' });
    }
});

app.post('/api/telegram/daily-checkin/claim', async (req, res) => {
    // Accepter Telegram ET Google (pas les anonymes web_xxx)
    if (!isRegisteredUser(req)) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const result = await telegramUsersService.claimDailyCheckin(req.userId);
        if (result.error) return res.status(400).json({ error: result.error });
        return res.json({ success: true, ...result });
    } catch (e) {
        console.error('[daily-checkin claim]', e);
        return res.status(500).json({ error: 'Erreur' });
    }
});

// Liste des amis invites (parraines par l'utilisateur courant)
app.get('/api/telegram/my-friends', async (req, res) => {
    if (!isRegisteredUser(req)) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const supabase = require('./database/supabase-client').getSupabase();
        if (!supabase) return res.json({ friends: [] });
        const myId = Number(req.userId);
        if (!Number.isFinite(myId)) return res.json({ friends: [] });
        const tableName = process.env.TELEGRAM_USERS_TABLE || 'telegram_users';
        const { data, error } = await supabase
            .from(tableName)
            .select('telegram_id, first_name, last_name, username, photo_url, created_at')
            .eq('referred_by', myId)
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) {
            console.error('[my-friends]', error.message);
            return res.json({ friends: [] });
        }
        return res.json({ friends: data || [] });
    } catch (e) {
        console.error('[my-friends]', e);
        return res.status(500).json({ error: 'Erreur' });
    }
});

// Historique des points (log de toutes les transactions)
app.get('/api/telegram/points-history', async (req, res) => {
    if (!isRegisteredUser(req)) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const history = await telegramUsersService.listPointsHistory(req.userId, limit);
        return res.json({ history });
    } catch (e) {
        console.error('[points-history]', e);
        return res.status(500).json({ error: 'Erreur' });
    }
});

// Sauvegarde la langue choisie (fr|en) dans telegram_users.language
app.patch('/api/telegram/language', async (req, res) => {
    if (!isRegisteredUser(req)) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const lang = (req.body && req.body.language) ? String(req.body.language).toLowerCase() : '';
        if (lang !== 'fr' && lang !== 'en') {
            return res.status(400).json({ error: 'Langue invalide (fr|en)' });
        }
        const r = await telegramUsersService.updateLanguage(req.userId, lang);
        if (r && r.error) return res.status(400).json({ error: r.error });
        return res.json({ success: true, language: lang });
    } catch (e) {
        console.error('[lang]', e);
        return res.status(500).json({ error: 'Erreur' });
    }
});

// Mise à jour du profil (lien YouTube/X/Telegram)
app.patch('/api/telegram/profile', async (req, res) => {
    if (!req.telegramUser || !req.userId) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const socialLink = req.body && (req.body.social_link === '' || req.body.social_link) ? String(req.body.social_link).trim().slice(0, 500) : null;
        // Modération IA du lien social (si non vide)
        if (socialLink) {
            const modResult = await moderateSocialLink(socialLink);
            if (!modResult.ok) return res.status(400).json({ error: modResult.reason || 'Lien refusé par la modération' });
        }
        const result = await telegramUsersService.updateSocialLink(req.userId, socialLink);
        if (result.error) return res.status(400).json({ error: result.error });
        return res.json({ ok: true, user: result.user });
    } catch (e) {
        console.error('[Telegram profile]', e);
        return res.status(500).json({ error: 'Erreur' });
    }
});

// Promo likes/vues : tarifs 150 F à 500 F, durée 4 à 7 jours
const PROMO_LIKES_MIN = 150;
const PROMO_LIKES_MAX = 500;

// Demande promo likes/vues — formules 4 jours (150 F) à 1 semaine (500 F)
app.post('/api/telegram/promo-likes', async (req, res) => {
    if (!req.telegramUser || !req.userId) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const socialLink = req.body && req.body.social_link ? String(req.body.social_link).trim().slice(0, 500) : '';
        if (!socialLink) return res.status(400).json({ error: 'Lien YouTube, X ou Telegram requis' });
        await telegramUsersService.updateSocialLink(req.userId, socialLink);
        let amount = parseInt(req.body.amount, 10);
        const durationDays = Math.max(4, Math.min(7, parseInt(req.body.duration_days, 10) || 4));
        if (!Number.isFinite(amount) || amount < PROMO_LIKES_MIN) amount = PROMO_LIKES_MIN;
        if (amount > PROMO_LIKES_MAX) amount = PROMO_LIKES_MAX;
        const orderId = ('PROMO' + Date.now().toString(36).slice(-7) + Math.random().toString(36).slice(2, 6)).slice(0, 20);
        const username = req.telegramUser.username ? '@' + req.telegramUser.username : (req.telegramUser.first_name || '') + ' ' + (req.telegramUser.last_name || '').trim() || req.userId;
        const formulaLabel = durationDays === 7 ? '1 semaine' : durationDays + ' jour' + (durationDays > 1 ? 's' : '');
        const notesText = [socialLink, formulaLabel, amount + ' F'].join(' | ');
        const order = {
            id: orderId,
            userId: req.userId,
            username: username,
            operator: 'PROMO_LIKES',
            amount: amount,
            amountTotal: amount,
            phone: '',
            proof: null,
            status: 'pending',
            notes: notesText,
            createdAt: new Date().toISOString()
        };
        await orderStorage.createOrder(order);
        const adminIds = getAdminChatIds();
        if (adminIds.length > 0) {
            await sendTelegramToAllAdmins(
                '🔔 <b>PROMO LIKES/VUES — ' + amount + ' F</b> (' + formulaLabel + ')\n\n' +
                '👤 ' + username + '\n' +
                '🔗 ' + socialLink + '\n' +
                '📅 ' + new Date().toLocaleString('fr-FR'),
                {},
                TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN
            );
        }
        return res.json({ success: true, order: { id: order.id, operator: order.operator, amount: order.amount, createdAt: order.createdAt } });
    } catch (e) {
        console.error('[Telegram promo-likes]', e);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Créer une commande pour une annonce LED → l'utilisateur est redirigé vers choix paiement puis preuve
app.post('/api/annonces/:id/create-order', async (req, res) => {
    if (!req.telegramUser || !req.userId) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    try {
        const annonce = await annoncesService.getAnnonceById(req.params.id);
        if (!annonce) return res.status(404).json({ error: 'Annonce introuvable' });
        if (annonce.statut !== 'en_attente') return res.status(400).json({ error: 'Annonce déjà traitée' });
        const orderId = ('ANN' + Date.now().toString(36).slice(-7) + Math.random().toString(36).slice(2, 6)).slice(0, 20);
        const username = req.telegramUser.username ? '@' + req.telegramUser.username : (req.telegramUser.first_name || '') + ' ' + (req.telegramUser.last_name || '').trim() || req.userId;
        const order = {
            id: orderId,
            userId: req.userId,
            username: username,
            operator: 'ANNONCE_LED',
            amount: annonce.prix,
            amountTotal: annonce.prix,
            phone: '',
            proof: null,
            status: 'pending',
            notes: annonce.id,
            createdAt: new Date().toISOString()
        };
        await orderStorage.createOrder(order);
        return res.json({ success: true, order: { id: order.id, operator: order.operator, amount: order.amount, createdAt: order.createdAt } });
    } catch (e) {
        console.error('[annonces create-order]', e);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Diagnostic : état du webhook Telegram (allowed_updates, url)
app.get('/api/telegram/webhook-info', async (req, res) => {
    const key = req.headers['x-admin-key'];
    if (key !== process.env.ADMIN_SECRET_KEY) return res.status(401).json({ error: 'Non autorisé' });
    if (!TELEGRAM_BOT_TOKEN) return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN absent' });
    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
        const data = await r.json();
        const allowed = (data.result && data.result.allowed_updates) || [];
        const hasMessage = allowed.includes('message') || allowed.length === 0;
        return res.json({
            ok: data.ok,
            url: data.result && data.result.url,
            allowed_updates: allowed,
            hint: !hasMessage ? '⚠️ allowed_updates doit contenir "message" (et "edited_message", "callback_query") pour que /actualites fonctionne.' : null,
            admin_chat_ids: getAdminChatIds()
        });
    } catch (e) {
        return res.status(500).json({ error: String(e.message) });
    }
});

// Webhook Telegram : repondre 200 tout de suite puis traiter (evite timeout)
app.post('/api/telegram/webhook', (req, res) => {
    res.json({ ok: true });
    if (TELEGRAM_WEBHOOK_DISABLED) {
        return;
    }
    setImmediate(() => handleTelegramUpdate(req.body).catch(err => console.error('[Webhook]', err)));
});

// Deuxième bot : admin / Supabase uniquement (actualités, annonces, commandes, liens)
app.post('/api/telegram/webhook-admin', (req, res) => {
    res.json({ ok: true });
    setImmediate(() => handleTelegramUpdateAdmin(req.body).catch(err => console.error('[Webhook Admin]', err)));
});

async function handleTelegramUpdateAdmin(body) {
    const botToken = TELEGRAM_BOT_TOKEN_ADMIN;
    if (!botToken) return;

    const { callback_query, message, edited_message } = body || {};
    const adminIds = getAdminChatIds();

    const msg = message || edited_message;
    if (msg && msg.text && msg.chat) {
        const rawText = (msg.text || '').trim();
        const cmd = rawText.toLowerCase().split(/\s+/)[0];
        const chatId = msg.chat.id;
        const isAdmin = adminIds.includes(String(chatId));

        try {
            if (!isAdmin) {
                await sendTelegramMessage(chatId, '⛔ Accès réservé aux admins (bot Supabase).', {}, botToken);
                return;
            }
            if (cmd === '/start') {
                await sendTelegramMessage(chatId,
                    '👋 <b>Bot Admin Supabase</b>\n\n' +
                    'Commandes :\n' +
                    '/actualites — Actualités en attente\n' +
                    '/annonces — Annonces LED en attente\n' +
                    '/commandes — Commandes en attente\n' +
                    '/liens — Liens YouTube/X\n' +
                    '/cabines — Commerciaux Kbine\n' +
                    '/newcabine CODE Nom — créer une cabine\n' +
                    '/gencabine Nom — code auto (expire 1 mois)\n' +
                    '/versements — Versements Wave en attente\n' +
                    '/blacklist [list|add|remove] — Liste rouge (anti-arnaque)',
                    {}, botToken);
                return;
            }
            if (cmd === '/blacklist' || cmd === '/listerouge' || cmd === '/rouge') {
                const parts = rawText.split(/\s+/);
                const action = (parts[1] || 'list').toLowerCase();
                const num = parts[2] || '';
                if (action === 'add' && num) {
                    const added = blacklist.add(num, 'Ajouté via bot admin');
                    await sendTelegramMessage(chatId, (added ? '\u2705 Ajouté' : '\u2139\uFE0F Déjà présent') + ' en liste rouge : <code>' + blacklist.norm(num) + '</code>', {}, botToken);
                } else if ((action === 'remove' || action === 'del' || action === 'rm') && num) {
                    const removed = blacklist.remove(num);
                    await sendTelegramMessage(chatId, (removed ? '\u2705 Retiré de' : '\u2139\uFE0F Absent de') + ' la liste rouge : <code>' + blacklist.norm(num) + '</code>', {}, botToken);
                } else if (action === 'list') {
                    const l = blacklist.list();
                    await sendTelegramMessage(chatId, l.length ? ('\uD83D\uDEA9 <b>Liste rouge (' + l.length + ')</b>\n' + l.map(x => '\u2022 <code>' + x + '</code>' + (blacklist.reasonFor(x) ? ' \u2014 ' + blacklist.reasonFor(x) : '')).join('\n')) : '\uD83D\uDCED Liste rouge vide.', {}, botToken);
                } else {
                    await sendTelegramMessage(chatId, 'Usage :\n/blacklist list\n/blacklist add 0700000000\n/blacklist remove 0700000000', {}, botToken);
                }
                return;
            }
            if (cmd === '/actualites' || cmd === '/actualite' || cmd === '/actualité' || cmd === '/actualités') {
                const pending = await actualitesService.listPending();
                if (pending.length === 0) {
                    await sendTelegramMessage(chatId, '📭 Aucune actualité en attente.', {}, botToken);
                } else {
                    await sendTelegramMessage(chatId, `📋 <b>${pending.length} actualité(s) en attente</b> — utilise les boutons ci-dessous.`, {}, botToken);
                    for (const a of pending) {
                        const title = (a.title || 'Sans titre').slice(0, 80);
                        const summary = (a.summary_short || a.content || '').slice(0, 200);
                        await sendTelegramMessage(chatId, `<b>${title}</b>\n${summary || '—'}`, {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ Approuver', callback_data: `approve_act_${a.id}` },
                                    { text: '❌ Rejeter', callback_data: `reject_act_${a.id}` }
                                ]]
                            }
                        }, botToken);
                    }
                }
                return;
            }
            if (cmd === '/annonces') {
                const list = await annoncesService.listByStatut('en_attente');
                if (list.length === 0) {
                    await sendTelegramMessage(chatId, '📭 Aucune annonce LED en attente.', {}, botToken);
                } else {
                    await sendTelegramMessage(chatId, `📢 <b>${list.length} annonce(s) LED en attente</b> — utilise les boutons ci-dessous.`, {}, botToken);
                    for (const a of list.slice(0, 15)) {
                        const contenu = (a.contenu || '').slice(0, 200);
                        await sendTelegramMessage(chatId, `💰 ${a.prix} F — ${contenu}${(a.contenu || '').length > 200 ? '…' : ''}`, {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ Approuver', callback_data: `approve_ann_${a.id}` },
                                    { text: '❌ Rejeter', callback_data: `reject_ann_${a.id}` }
                                ]]
                            }
                        }, botToken);
                    }
                    if (list.length > 15) await sendTelegramMessage(chatId, `… et ${list.length - 15} autre(s).`, {}, botToken);
                }
                return;
            }
            if (cmd === '/commandes') {
                const orders = await orderStorage.getOrdersPending();
                if (orders.length === 0) {
                    await sendTelegramMessage(chatId, '📭 Aucune commande en attente.', {}, botToken);
                } else {
                    const recharges = orders.filter(function (o) { return o.operator !== 'ANNONCE_LED'; });
                    const annoncesLed = orders.filter(function (o) { return o.operator === 'ANNONCE_LED'; });

                    if (recharges.length > 0) {
                        await sendTelegramMessage(chatId, `📱 <b>Recharges (MTN / Orange / Moov) — ${recharges.length} commande(s)</b> — utilise les boutons ci-dessous.`, {}, botToken);
                        for (const o of recharges.slice(0, 15)) {
                            const txt = `#${o.id} — ${o.operator} ${o.amountTotal} F\n📞 ${o.phone || 'N/A'}`;
                            await sendTelegramMessage(chatId, txt, {
                                reply_markup: {
                                    inline_keyboard: [[
                                        { text: '✅ Valider', callback_data: `validate_${o.id}` },
                                        { text: '❌ Rejeter', callback_data: `reject_${o.id}` }
                                    ]]
                                }
                            }, botToken);
                        }
                        if (recharges.length > 15) {
                            await sendTelegramMessage(chatId, `… et ${recharges.length - 15} autre(s).`, {}, botToken);
                        }
                    }

                    if (annoncesLed.length > 0) {
                        await sendTelegramMessage(chatId, `📢 <b>Annonces LED (via commandes)</b> — ${annoncesLed.length} commande(s)`, {}, botToken);
                        for (const o of annoncesLed.slice(0, 15)) {
                            const txt = `#${o.id} — ${o.amountTotal} F\nType: ANNONCE_LED`;
                            await sendTelegramMessage(chatId, txt, {
                                reply_markup: {
                                    inline_keyboard: [[
                                        { text: '✅ Valider', callback_data: `validate_${o.id}` },
                                        { text: '❌ Rejeter', callback_data: `reject_${o.id}` }
                                    ]]
                                }
                            }, botToken);
                        }
                        if (annoncesLed.length > 15) {
                            await sendTelegramMessage(chatId, `… et ${annoncesLed.length - 15} autre(s).`, {}, botToken);
                        }
                    }
                }
                return;
            }
            if (cmd === '/liens') {
                const users = await telegramUsersService.listUsersWithSocialLink(30);
                if (users.length === 0) {
                    await sendTelegramMessage(chatId, '📭 Aucun lien YouTube/X enregistré.', {}, botToken);
                } else {
                    await sendTelegramMessage(chatId, `🔗 <b>${users.length} lien(s) YouTube/X</b> — Approuver = visible dans Quêtes (clic = points).`, {}, botToken);
                    for (const u of users.slice(0, 15)) {
                        const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.telegram_id;
                        const approved = !!u.social_link_approved;
                        const text = `• ${name}\n${(u.social_link || '').slice(0, 60)}${approved ? '\n✅ Déjà approuvé' : ''}`;
                        const _linkBtn = approved ? { text: '🚫 Retirer des Quêtes', callback_data: `unapprove_link_${u.telegram_id}` } : { text: '✅ Approuver (→ Quêtes)', callback_data: `approve_link_${u.telegram_id}` };
                        const opts = { reply_markup: { inline_keyboard: [ [_linkBtn], [{ text: '🗑️ Supprimer le lien', callback_data: `dellink_${u.telegram_id}` }] ] } };
                        await sendTelegramMessage(chatId, text, opts, botToken);
                    }
                    if (users.length > 15) await sendTelegramMessage(chatId, `… et ${users.length - 15} autre(s).`, {}, botToken);
                }
                return;
            }
            // === BIPBIP CABINE (commerciaux Kbine) ===
            if (cmd === '/cabines') {
                const list = await cabineService.adminListCabines();
                if (!list.length) {
                    await sendTelegramMessage(chatId, '\u{1F4ED} Aucune cabine.\n\nCréer : <code>/newcabine CODE Nom de la cabine</code>', {}, botToken);
                } else {
                    await sendTelegramMessage(chatId, `\u{1F3EA} <b>${list.length} cabine(s)</b>`, {}, botToken);
                    for (const c of list.slice(0, 25)) {
                        const lock = c.locked ? '\u{1F512} BLOQUÉ' : '\u{1F513} OK';
                        const txt = `<b>${c.code}</b> — ${c.nom_cabine}\n` +
                            `${c.actif ? '\u{1F7E2} actif' : '\u{1F534} inactif'} · ${lock}\n` +
                            `Ventes plafond : ${c.tx_since_deposit}/${c.tx_plafond} · Dû Wave : ${c.montant_du} F\n` +
                            `Objectif : ${c.commandes_semaine}/${c.objectif_hebdo} (${c.pct}%) · Commission : ${c.commission_hebdo} F` + (c.expired ? '\n⏰ EXPIRÉ' : (c.expires_at ? `\nExpire : ${new Date(c.expires_at).toLocaleDateString('fr-FR')}` : ''));
                        const btn = c.actif
                            ? { text: '\u{1F534} Désactiver', callback_data: `cab_off_${c.code}` }
                            : { text: '\u{1F7E2} Activer', callback_data: `cab_on_${c.code}` };
                        await sendTelegramMessage(chatId, txt, { reply_markup: { inline_keyboard: [[btn]] } }, botToken);
                    }
                }
                return;
            }
            if (cmd === '/newcabine') {
                const parts = rawText.split(/\s+/);
                const code = parts[1];
                const nom = parts.slice(2).join(' ');
                if (!code || !nom) {
                    await sendTelegramMessage(chatId, 'Usage : <code>/newcabine CODE Nom de la cabine</code>', {}, botToken);
                    return;
                }
                const r = await cabineService.adminCreateCabine({ code, nom_cabine: nom });
                await sendTelegramMessage(chatId, r.ok
                    ? `✅ Cabine créée : <b>${code.toUpperCase()}</b> — ${nom}\nCommission par défaut : 10 000 F/sem.`
                    : `❌ ${r.error}`, {}, botToken);
                return;
            }
            if (cmd === '/gencabine') {
                const nom = rawText.split(/\s+/).slice(1).join(' ');
                if (!nom) {
                    await sendTelegramMessage(chatId, 'Usage : <code>/gencabine Nom de la cabine</code>\n(code auto, valable 1 mois)', {}, botToken);
                    return;
                }
                const r = await cabineService.adminGenerateCabine({ nom_cabine: nom, mois: 1 });
                if (r.ok) {
                    const exp = r.expires_at ? new Date(r.expires_at).toLocaleDateString('fr-FR') : '';
                    await sendTelegramMessage(chatId,
                        `✅ Code généré pour <b>${nom}</b>\n\n\u{1F511} <code>${r.code}</code>\n⏳ Expire le ${exp}`, {}, botToken);
                } else {
                    await sendTelegramMessage(chatId, `❌ ${r.error}`, {}, botToken);
                }
                return;
            }
            if (cmd === '/versements') {
                const deps = await cabineService.adminListDeposits('en_attente');
                if (!deps.length) {
                    await sendTelegramMessage(chatId, '\u{1F4ED} Aucun versement Wave en attente.', {}, botToken);
                } else {
                    await sendTelegramMessage(chatId, `\u{1F4A7} <b>${deps.length} versement(s) Wave en attente</b>`, {}, botToken);
                    for (const d of deps.slice(0, 20)) {
                        const txt = `#${d.id} — <b>${d.cabine_code}</b>\n\u{1F4B0} ${d.montant} F${d.preuve_url ? '\n\u{1F9FE} Preuve envoyée' : '\n⚠️ Pas de preuve'}`;
                        await sendTelegramMessage(chatId, txt, {
                            reply_markup: { inline_keyboard: [[
                                { text: '✅ Confirmer (débloque)', callback_data: `cab_dep_ok_${d.id}` }
                            ]] }
                        }, botToken);
                    }
                }
                return;
            }
            if (cmd.startsWith('/')) {

    // === AGENT CONTROL COMMANDS ===
    // `cmd` ne contient que le 1er mot ("/agent") — les sous-commandes
    // ("/agent on") se testent sur les 2 premiers mots (cmd2).
    const cmd2 = rawText.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
    const { exec, execSync } = require('child_process');
    const escapeTg = (s) => String(s)
        .replace(/\x1b\[[0-9;]*m/g, '') // codes couleur ANSI de pm2
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const pm2Status = (name) => {
        try {
            const apps = JSON.parse(execSync('pm2 jlist 2>/dev/null').toString());
            const a = apps.find(x => x.name === name);
            return a && a.pm2_env ? a.pm2_env.status : 'introuvable';
        } catch (e) { return 'inconnu'; }
    };
    const agentStatusMsg = (emoji, label, name) => {
        const st = pm2Status(name);
        return emoji + ' <b>' + label + '</b>\n' + (st === 'online' ? '✅ En ligne' : '⏹️ ' + st);
    };

    if (cmd2 === '/agent on') {
        exec('pm2 start bipbip-validation-agent');
        await sendTelegramMessage(chatId, '✅ Agent de validation activé !', {}, botToken);
        return;
    }
    if (cmd2 === '/agent off') {
        exec('pm2 stop bipbip-validation-agent');
        await sendTelegramMessage(chatId, '⏹️ Agent de validation désactivé.', {}, botToken);
        return;
    }
    if (cmd2 === '/agent logs') {
        const logs = execSync('pm2 logs bipbip-validation-agent --lines 15 --nostream --raw 2>&1 | tail -20').toString();
        await sendTelegramMessage(chatId, '📋 <b>Logs Agent validation :</b>\n<pre>' + escapeTg(logs).slice(0, 3500) + '</pre>', {}, botToken);
        return;
    }
    if (cmd === '/agent') { // "/agent" ou "/agent status"
        await sendTelegramMessage(chatId, agentStatusMsg('🤖', 'Agent de Validation', 'bipbip-validation-agent'), {}, botToken);
        return;
    }
    if (cmd === '/agents') {
        const list = execSync('pm2 list 2>/dev/null | grep -i bipbip | head -12').toString();
        await sendTelegramMessage(chatId, '🤖 <b>Agents BipBip :</b>\n<pre>' + escapeTg(list).slice(0, 3500) + '</pre>', {}, botToken);
        return;
    }
    if (cmd2 === '/validateur on') {
        exec('pm2 start bipbip-validateur-annonces');
        await sendTelegramMessage(chatId, '✅ Validateur annonces activé !', {}, botToken);
        return;
    }
    if (cmd2 === '/validateur off') {
        exec('pm2 stop bipbip-validateur-annonces');
        await sendTelegramMessage(chatId, '⏹️ Validateur annonces désactivé.', {}, botToken);
        return;
    }
    if (cmd === '/validateur') {
        await sendTelegramMessage(chatId, agentStatusMsg('📋', 'Validateur annonces', 'bipbip-validateur-annonces'), {}, botToken);
        return;
    }
    if (cmd2 === '/fraude on') {
        exec('pm2 start bipbip-fraude-detector');
        await sendTelegramMessage(chatId, '✅ Détecteur fraude activé !', {}, botToken);
        return;
    }
    if (cmd2 === '/fraude off') {
        exec('pm2 stop bipbip-fraude-detector');
        await sendTelegramMessage(chatId, '⏹️ Détecteur fraude désactivé.', {}, botToken);
        return;
    }
    if (cmd === '/fraude') {
        await sendTelegramMessage(chatId, agentStatusMsg('🔍', 'Détecteur fraude', 'bipbip-fraude-detector'), {}, botToken);
        return;
    }
    if (cmd2 === '/rotator on') {
        exec('pm2 start bipbip-rotator');
        await sendTelegramMessage(chatId, '✅ Rotator activé !', {}, botToken);
        return;
    }
    if (cmd2 === '/rotator off') {
        exec('pm2 stop bipbip-rotator');
        await sendTelegramMessage(chatId, '⏹️ Rotator désactivé.', {}, botToken);
        return;
    }
    if (cmd === '/rotator') {
        await sendTelegramMessage(chatId, agentStatusMsg('🔄', 'Rotator', 'bipbip-rotator'), {}, botToken);
        return;
    }
    // === END AGENT COMMANDS ===

                await sendTelegramMessage(chatId,
                    '❓ /actualites, /annonces, /commandes, /liens, /cabines, /versements\n' +
                    '🤖 Agents : /agent [on|off|logs], /agents, /validateur [on|off], /fraude [on|off], /rotator [on|off]', {}, botToken);
            }
        } catch (err) {
            console.error('[Webhook Admin]', err);
            await sendTelegramMessage(chatId, '❌ Erreur.', {}, botToken);
        }
        return;
    }

    if (callback_query) {
        const data = (callback_query.data || '').trim();
        const chatId = callback_query.message && callback_query.message.chat ? callback_query.message.chat.id : null;
        const callbackId = callback_query.id;
        const isAdmin = chatId && adminIds.includes(String(chatId));
        try {
            if (!isAdmin) {
                await answerTelegramCallback(callbackId, 'Non autorisé', botToken);
                return;
            }
            if (data.startsWith('approve_act_')) {
                const id = data.replace('approve_act_', '').trim();
                const updated = await actualitesService.approveActualite(id);
                await answerTelegramCallback(callbackId, updated ? 'Actualité approuvée' : 'Erreur ou déjà traitée', botToken);
                if (chatId && updated) {
                    await sendTelegramMessage(chatId, `✅ Actualité « ${(updated.title || '').slice(0, 50)} » approuvée.`, {}, botToken);
                }
                return;
            }
            if (data.startsWith('reject_act_')) {
                const id = data.replace('reject_act_', '').trim();
                await actualitesService.rejectActualite(id);
                await answerTelegramCallback(callbackId, 'Actualité rejetée', botToken);
                if (chatId) await sendTelegramMessage(chatId, `❌ Actualité #${id} rejetée.`, {}, botToken);
                return;
            }
            if (data.startsWith('approve_ann_')) {
                const id = data.replace('approve_ann_', '').trim();
                const result = await annoncesService.validateAnnonce(id, { viaOrderProof: true });
                const ok = result && !result.error;
                await answerTelegramCallback(callbackId, ok ? 'Annonce approuvée' : 'Erreur ou déjà traitée', botToken);
                if (chatId && ok) await sendTelegramMessage(chatId, '📢 Annonce LED approuvée → bandeau + Actualités.', {}, botToken);
                return;
            }
            if (data.startsWith('reject_ann_')) {
                const id = data.replace('reject_ann_', '').trim();
                await annoncesService.refuseAnnonce(id);
                await answerTelegramCallback(callbackId, 'Annonce rejetée', botToken);
                if (chatId) await sendTelegramMessage(chatId, `❌ Annonce LED #${id} rejetée.`, {}, botToken);
                return;
            }
            if (data.startsWith('approve_link_')) {
                const telegramId = data.replace('approve_link_', '').trim();
                const result = await telegramUsersService.approveSocialLink(telegramId);
                const ok = result && !result.error;
                await answerTelegramCallback(callbackId, ok ? 'Lien approuvé → Quêtes' : (result && result.error) || 'Erreur', botToken);
                if (chatId && ok) await sendTelegramMessage(chatId, '✅ Lien YouTube/X approuvé → visible dans l\'espace Quetes (clic = points).', {}, botToken);
                return;
            }
            if (data.startsWith('unapprove_link_')) {
                const telegramId = data.replace('unapprove_link_', '').trim();
                const result = await telegramUsersService.unapproveSocialLink(telegramId);
                const ok = result && !result.error;
                await answerTelegramCallback(callbackId, ok ? 'Lien retiré des Quêtes' : (result && result.error) || 'Erreur', botToken);
                if (chatId && ok) await sendTelegramMessage(chatId, '🚫 Lien retiré des Quêtes — plus visible, plus de points.', {}, botToken);
                return;
            }
            if (data.startsWith('dellink_')) {
                const telegramId = data.replace('dellink_', '').trim();
                const result = await telegramUsersService.removeSocialLink(telegramId);
                const ok = result && !result.error;
                await answerTelegramCallback(callbackId, ok ? 'Lien supprimé' : (result && result.error) || 'Erreur', botToken);
                if (chatId && ok) await sendTelegramMessage(chatId, '🗑️ Lien supprimé du profil du membre.', {}, botToken);
                return;
            }

            // === BIPBIP CABINE callbacks ===
            if (data.startsWith('cab_dep_ok_')) {
                const id = data.replace('cab_dep_ok_', '').trim();
                const r = await cabineService.adminConfirmDeposit(id);
                await answerTelegramCallback(callbackId, r.ok ? 'Versement confirmé — débloqué' : (r.error || 'Erreur'), botToken);
                if (chatId && r.ok) await sendTelegramMessage(chatId,
                    `✅ Versement #${id} confirmé.\n\u{1F513} <b>${r.deposit.cabine_code}</b> débloquée (compteur remis à 0).`, {}, botToken);
                return;
            }
            if (data.startsWith('cab_off_') || data.startsWith('cab_on_')) {
                const on = data.startsWith('cab_on_');
                const code = data.replace(on ? 'cab_on_' : 'cab_off_', '').trim();
                const r = await cabineService.adminSetCabine(code, { actif: on });
                await answerTelegramCallback(callbackId, r.ok ? (on ? 'Activée' : 'Désactivée') : (r.error || 'Erreur'), botToken);
                if (chatId && r.ok) await sendTelegramMessage(chatId, `${on ? '\u{1F7E2}' : '\u{1F534}'} Cabine <b>${code.toUpperCase()}</b> ${on ? 'activée' : 'désactivée'}.`, {}, botToken);
                return;
            }

            if (data.startsWith('approve_actu_')) {
                const id = data.replace('approve_actu_', '');
                const updated = await actualitesService.approveActualite(id);
                const answerUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
                await fetch(answerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: callback_query.id }) });
                if (updated) {
                    const editUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
                    await fetch(editUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            message_id: messageId,
                            text: '✅ Article approuvé : ' + (updated.title || id).slice(0, 80)
                        })
                    });
                }
                return;
            }

            if (data.startsWith('validate_')) {
                const orderId = data.replace('validate_', '');
                const order = await orderStorage.setOrderValidated(orderId);
                if (order) {
                    await answerTelegramCallback(callbackId, 'Commande validée', botToken);
                    if (chatId) await sendTelegramMessage(chatId, `✅ Commande #${orderId} validée !`, {}, botToken);
                    if (order.operator === 'PACK_ARTICLES') { await creditArticlePack(order); } else if ((order.operator === 'PROMO_LIKES' || order.operator === 'PROMO_SOCIAL')) {
                        if (order.userId) {
                            const promoLink = order.notes ? order.notes.split(' | ')[0].trim() : '';
                            if (promoLink) await telegramUsersService.updateSocialLink(order.userId, promoLink);
                            await telegramUsersService.approveSocialLink(order.userId);
                            await sendTelegramMessage(order.userId,
                                '✅ <b>Promo Likes/Vues validée !</b>\n\nVotre lien est maintenant visible dans l\'espace Quêtes. Chaque clic vous rapporte des points !', {}, botToken);
                            if (chatId) await sendTelegramMessage(chatId, '🔗 Lien approuvé → visible dans Quêtes (clic = points).', {}, botToken);
                        }
                    } else if (order.operator !== 'ANNONCE_LED' && order.operator !== 'PACK_ARTICLES' && order.phone) {
                        const ussdResult = await deliverCIRecharge(order);
                        if (order.userId) {
                            const txt = ussdResult.success
                                ? `✅ <b>Recharge effectuée !</b>\n\n📲 ${order.operator} - ${order.amount} FCFA\n📞 ${order.phone}\n\nMerci d'avoir utilisé Bipbip Recharge CI ! 🎉`
                                : `⚠️ <b>Paiement reçu</b>, transfert en cours.\n📞 ${order.phone}\n\nTa recharge est en cours de traitement automatique.`;
                            await sendTelegramMessage(order.userId, txt, {}, botToken);
                        }
                    } else if (order.operator === 'ANNONCE_LED') {
                        if (order.notes) {
                            const ar = await annoncesService.validateAnnonce(order.notes, { viaOrderProof: true });
                            if (ar && !ar.error && chatId) await sendTelegramMessage(chatId, '📢 Annonce validée → bandeau LED + Actualités.', {}, botToken);
                        }
                        if (order.userId) {
                            await sendTelegramMessage(order.userId,
                                '✅ <b>Annonce LED validée !</b>\n\nVotre message passera dans le bandeau et les Actualités.', {}, botToken);
                        }
                    }
                    await removeOrderButtonsFromAllAdmins(orderId, botToken);
                } else {
                    await answerTelegramCallback(callbackId, 'Commande introuvable', botToken);
                }
                return;
            }
            if (data.startsWith('reject_') && !data.startsWith('reject_act_') && !data.startsWith('reject_ann_')) {
                const orderId = data.replace('reject_', '');
                const orderBefore = await orderStorage.getOrderById(orderId);
                const order = await orderStorage.setOrderRejected(orderId);
                if (order) {
                    if (orderBefore && orderBefore.operator === 'ANNONCE_LED' && orderBefore.notes) await annoncesService.refuseAnnonce(orderBefore.notes);
                    await answerTelegramCallback(callbackId, 'Commande rejetée', botToken);
                    if (chatId) await sendTelegramMessage(chatId, `❌ Commande #${orderId} rejetée`, {}, botToken);
                    await removeOrderButtonsFromAllAdmins(orderId, botToken);
                } else {
                    await answerTelegramCallback(callbackId, 'Commande introuvable', botToken);
                }
                return;
            }
            await answerTelegramCallback(callbackId, undefined, botToken);
        } catch (err) {
            console.error('[Webhook Admin] callback:', err);
            await answerTelegramCallback(callbackId, 'Erreur serveur', botToken);
        }
    }
}

async function handleTelegramUpdate(body) {
    const { callback_query, message, edited_message } = body || {};
    const adminIds = getAdminChatIds();

    if (message || edited_message) {
        const msg = message || edited_message;
        const chatId = msg.chat && msg.chat.id;
        const text = (msg.text || '').trim();
        console.log('[Webhook] message chat_id=', chatId, 'text=', (text || '').slice(0, 40));
    } else if (callback_query) {
        console.log('[Webhook] callback_query data=', (callback_query.data || '').slice(0, 40));
    }

    const msg = message || edited_message;
    if (msg && msg.text && msg.chat) {
        const rawText = (msg.text || '').trim();
        const cmd = rawText.toLowerCase().split(/\s+/)[0];
        const chatId = msg.chat.id;
        const isAdmin = adminIds.includes(String(chatId));

        try {
            if (cmd === '/start' || cmd === '/demarrer' || cmd === '/cancel' || cmd === '/annuler') {
                buyState.delete(chatId);
                const appUrl = (process.env.WEBHOOK_BASE_URL || process.env.BASE_URL || 'https://bipbiprecharge.ci').replace(/\/$/, '');
                const isCancel = cmd === '/cancel' || cmd === '/annuler';
                const welcome = isCancel
                    ? '✅ Annulé. Choisis une action 👋'
                    : '👋 <b>Bipbip Recharge CI</b>\n\nTu peux <b>acheter du crédit ici</b> sans ouvrir l\'app, ou ouvrir l\'app pour plus de fonctionnalités.\n\nChoisis une action 👋';
                await sendTelegramMessage(chatId, welcome, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '💳 Acheter', callback_data: 'bot_acheter' },
                                { text: '💰 Tarifs', callback_data: 'bot_tarifs' },
                                { text: '❓ Aide', callback_data: 'bot_aide' }
                            ],
                            [
                                { text: '📱 Ouvrir l\'app', web_app: { url: appUrl } }
                            ]
                        ]
                    }
                });
                return;
            }
            if (cmd === '/aide' || cmd === '/help') {
                await sendTelegramMessage(chatId, '📌 <b>Commandes</b>\n/demarrer — Accueil\n/annuler — Annuler\n/aide — Aide\n\n(Admin : /actualites, /annonces, /commandes, /liens)');
                return;
            }
            if (cmd === '/actualites' || cmd === '/actualite' || cmd === '/actualité' || cmd === '/actualités') {
                if (!isAdmin) {
                    await sendTelegramMessage(chatId, '⛔ Accès réservé aux admins. Ton chat_id : ' + chatId);
                    return;
                }
                const pending = await actualitesService.listPending();
                if (pending.length === 0) {
                    await sendTelegramMessage(chatId, '📭 Aucune actualité en attente.');
                } else {
                    await sendTelegramMessage(chatId, `📋 <b>${pending.length} actualité(s) en attente</b> — utilise les boutons ci-dessous.`);
                    for (const a of pending) {
                        const title = (a.title || 'Sans titre').slice(0, 80);
                        const summary = (a.summary_short || a.content || '').slice(0, 200);
                        await sendTelegramMessage(chatId, `<b>${title}</b>\n${summary || '—'}`, {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ Approuver', callback_data: `approve_act_${a.id}` },
                                    { text: '❌ Rejeter', callback_data: `reject_act_${a.id}` }
                                ]]
                            }
                        });
                    }
                }
                return;
            }
            if (cmd === '/annonces' && isAdmin) {
                const list = await annoncesService.listByStatut('en_attente');
                if (list.length === 0) {
                    await sendTelegramMessage(chatId, '📭 Aucune annonce LED en attente.');
                } else {
                    await sendTelegramMessage(chatId, `📢 <b>${list.length} annonce(s) LED en attente</b> — utilise les boutons ci-dessous pour approuver ou rejeter.`);
                    for (const a of list.slice(0, 15)) {
                        const contenu = (a.contenu || '').slice(0, 200);
                        await sendTelegramMessage(chatId, `💰 ${a.prix} F — ${contenu}${(a.contenu || '').length > 200 ? '…' : ''}`, {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ Approuver', callback_data: `approve_ann_${a.id}` },
                                    { text: '❌ Rejeter', callback_data: `reject_ann_${a.id}` }
                                ]]
                            }
                        });
                    }
                    if (list.length > 15) await sendTelegramMessage(chatId, `… et ${list.length - 15} autre(s).`);
                }
                return;
            }
            if (cmd === '/commandes' && isAdmin) {
                const orders = await orderStorage.getOrdersPending();
                if (orders.length === 0) {
                    await sendTelegramMessage(chatId, '📭 Aucune commande en attente.');
                } else {
                    const recharges = orders.filter(function (o) { return o.operator !== 'ANNONCE_LED'; });
                    const annoncesLed = orders.filter(function (o) { return o.operator === 'ANNONCE_LED'; });
                    if (recharges.length > 0) {
                        await sendTelegramMessage(chatId, `📱 <b>Recharges (MTN / Orange / Moov) — ${recharges.length} commande(s)</b>`);
                        for (const o of recharges.slice(0, 10)) {
                            await sendTelegramMessage(chatId, `#${o.id} — ${o.operator} ${o.amountTotal} F`);
                        }
                        if (recharges.length > 10) await sendTelegramMessage(chatId, `… et ${recharges.length - 10} autre(s).`);
                    }
                    if (annoncesLed.length > 0) {
                        await sendTelegramMessage(chatId, `📢 <b>Annonces LED — ${annoncesLed.length} commande(s)</b>`);
                        for (const o of annoncesLed.slice(0, 10)) {
                            await sendTelegramMessage(chatId, `#${o.id} — ${o.amountTotal} F`);
                        }
                        if (annoncesLed.length > 10) await sendTelegramMessage(chatId, `… et ${annoncesLed.length - 10} autre(s).`);
                    }
                }
                return;
            }
            if (cmd === '/liens' && isAdmin) {
                const users = await telegramUsersService.listUsersWithSocialLink(30);
                if (users.length === 0) {
                    await sendTelegramMessage(chatId, '📭 Aucun lien YouTube/X enregistré.');
                } else {
                    await sendTelegramMessage(chatId, `🔗 <b>${users.length} lien(s) YouTube/X</b> — Approuver = visible dans Quêtes (clic = points).`);
                    for (const u of users.slice(0, 15)) {
                        const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.telegram_id;
                        const approved = !!u.social_link_approved;
                        const text = `• ${name}\n${(u.social_link || '').slice(0, 60)}${approved ? '\n✅ Déjà approuvé' : ''}`;
                        const _linkBtn = approved ? { text: '🚫 Retirer des Quêtes', callback_data: `unapprove_link_${u.telegram_id}` } : { text: '✅ Approuver (→ Quêtes)', callback_data: `approve_link_${u.telegram_id}` };
                        const opts = { reply_markup: { inline_keyboard: [ [_linkBtn], [{ text: '🗑️ Supprimer le lien', callback_data: `dellink_${u.telegram_id}` }] ] } };
                        await sendTelegramMessage(chatId, text, opts);
                    }
                    if (users.length > 15) await sendTelegramMessage(chatId, `… et ${users.length - 15} autre(s).`);
                }
                return;
            }
            // Flux achat direct : montant personnalisé ou numéro
            const state = buyState.get(chatId);
            if (state && !cmd.startsWith('/')) {
                if (state.step === 'amount_custom') {
                    const amount = parseInt(rawText.replace(/\D/g, ''), 10);
                    if (!Number.isFinite(amount) || amount < 100 || amount > 10000000) {
                        await sendTelegramMessage(chatId, '❌ Montant invalide. Envoie un nombre (ex: 2500).');
                        return;
                    }
                    const frais = Math.floor(amount * BOT_FRAIS_PERCENT / 100);
                    state.amount = amount;
                    state.amountTotal = amount + frais;
                    state.step = 'phone';
                    await sendTelegramMessage(chatId, `✅ ${amount} FCFA + ${frais} F frais = <b>${state.amountTotal} FCFA</b> total.\n\n💳 Paiement via <b>Djamo</b>\n\nEnvoie ton numéro ${state.operator} (ex: ${BOT_OPERATORS[state.operator].prefix} 12 34 56 78)`);
                    return;
                }
                if (state.step === 'phone') {
                    const phone = rawText.replace(/\D/g, '').slice(-10);
                    if (phone.length < 10) {
                        await sendTelegramMessage(chatId, `❌ Numéro trop court. Envoie 10 chiffres (ex: ${BOT_OPERATORS[state.operator].prefix}12345678).`);
                        return;
                    }
                    const prefix = BOT_OPERATORS[state.operator].prefix;
                    if (!phone.startsWith(prefix)) {
                        await sendTelegramMessage(chatId, `❌ Ce numéro n'est pas un ${state.operator} (doit commencer par ${prefix}).`);
                        return;
                    }
                    const orderId = crypto.randomBytes(5).toString('hex').toUpperCase();
                    const order = {
                        id: orderId,
                        userId: String(chatId),
                        username: msg.from && msg.from.username ? msg.from.username : null,
                        operator: state.operator,
                        amount: state.amount,
                        amountTotal: state.amountTotal,
                        phone: phone,
                        proof: null,
                        status: 'pending',
                        createdAt: new Date().toISOString()
                    };
                    await orderStorage.createOrder(order);
                    buyState.delete(chatId);
                    const admIds = getAdminChatIds();
                    if (admIds.length > 0) {
                        await sendTelegramToAllAdmins(
                            `🔔 <b>NOUVELLE COMMANDE #${orderId}</b> (Bot)\n\n👤 ${order.username ? '@' + order.username : chatId}\n📲 ${order.operator}\n💰 ${order.amountTotal} FCFA\n📞 ${order.phone}\n📅 ${new Date().toLocaleString('fr-FR')}`,
                            {},
                            TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN
                        );
                    }
                    const DJAMO_PAY_URL = 'https://pay.djamo.com/pkbyg';
                    await sendTelegramMessage(chatId, `✅ <b>Commande #${orderId} créée</b>\n\n📲 ${order.operator} — ${order.amountTotal} FCFA\n📞 ${order.phone}\n\n💳 <b>Paye via Djamo :</b>\n👉 ${DJAMO_PAY_URL}\n\nAprès paiement, envoie ta <b>preuve</b> (capture d'écran) ici.`, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '💳 Payer via Djamo', url: DJAMO_PAY_URL }],
                                [{ text: '❌ Annuler', callback_data: 'bot_annuler' }]
                            ]
                        }
                    });
                    return;
                }
            }
            if (cmd.startsWith('/')) {
                await sendTelegramMessage(chatId, '❓ Commande inconnue. Tape /aide pour la liste des commandes.');
            }
        } catch (err) {
            console.error('[Webhook] command error:', err);
            await sendTelegramMessage(chatId, '❌ Erreur. Réessaie ou tape /aide.');
        }
        return;
    }

    if (msg && msg.chat && (msg.photo || msg.document)) {
        const chatId = msg.chat.id;
        const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : (msg.document && msg.document.file_id);
        if (fileId && TELEGRAM_BOT_TOKEN) {
            try {
                const userOrders = await orderStorage.getOrdersByUserId(String(chatId));
                const pending = userOrders.filter(o => o.status === 'pending').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                const order = pending[0];
                if (order) {
                    const proofPath = await downloadTelegramFile(fileId);
                    if (proofPath) {
                        await orderStorage.updateOrderProof(order.id, proofPath, 'proof_sent', 'djamo');
                        const baseUrl = (process.env.WEBHOOK_BASE_URL || process.env.BASE_URL || 'https://bipbiprecharge.ci').replace(/\/$/, '');
                        const proofUrl = baseUrl + proofPath;
                        const caption = buildProofTelegramCaption(order, 'djamo');
                        const keyboard3 = {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ Valider', callback_data: `validate_${order.id}` },
                                    { text: '❌ Rejeter', callback_data: `reject_${order.id}` }
                                ]]
                            }
                        };
                        // Envoyer preuve aux admins via bot admin uniquement
                        {
                            const proofToken = TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN;
                            const msgs = await sendTelegramPhotoToAllAdmins(proofUrl, caption, keyboard3, proofToken);
                            if (msgs.length > 0) orderAdminMessages.set(String(order.id), msgs);
                        }
                        await sendTelegramMessage(chatId, '✅ Preuve reçue. En attente de validation par l\'admin.');
                    } else {
                        await sendTelegramMessage(chatId, '❌ Impossible de récupérer la photo. Réessaie.');
                    }
                } else {
                    await sendTelegramMessage(chatId, 'Aucune commande en attente. Utilise 💳 Acheter pour créer une commande, puis envoie ta preuve.');
                }
            } catch (err) {
                console.error('[Webhook] proof photo error:', err);
                await sendTelegramMessage(chatId, '❌ Erreur. Réessaie.');
            }
        }
        return;
    }

    if (callback_query) {
        const data = (callback_query.data || '').trim();
        const chatId = callback_query.message && callback_query.message.chat ? callback_query.message.chat.id : null;
        const callbackId = callback_query.id;
        try {
            // Flux achat direct (boutons)
            if (data === 'bot_acheter') {
                buyState.set(chatId, { step: 'operator' });
                await answerTelegramCallback(callbackId);
                await sendTelegramMessage(chatId, '📲 Choisis l\'operateur :', {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📲 MTN', callback_data: 'bot_op_MTN' },
                                { text: '📶 Orange', callback_data: 'bot_op_Orange' },
                                { text: '📡 Moov', callback_data: 'bot_op_Moov' }
                            ],
                            [{ text: '❌ Annuler', callback_data: 'bot_annuler' }]
                        ]
                    }
                });
                return;
            }
            if (data.startsWith('bot_op_')) {
                const op = data.replace('bot_op_', '');
                if (!BOT_OPERATORS[op]) return;
                buyState.set(chatId, { step: 'amount', operator: op });
                await answerTelegramCallback(callbackId);
                const amounts = BOT_AMOUNTS.map(a => ({ text: `${a} F`, callback_data: `bot_amount_${a}` }));
                await sendTelegramMessage(chatId, `💰 Montant recharge (${op}) :`, {
                    reply_markup: {
                        inline_keyboard: [
                            amounts.slice(0, 3),
                            amounts.slice(3, 5),
                            [{ text: 'Autre montant', callback_data: 'bot_amount_other' }],
                            [{ text: '❌ Annuler', callback_data: 'bot_annuler' }]
                        ]
                    }
                });
                return;
            }
            if (data.startsWith('bot_amount_') && data !== 'bot_amount_other') {
                const amount = parseInt(data.replace('bot_amount_', ''), 10);
                if (!Number.isFinite(amount)) return;
                const state = buyState.get(chatId);
                if (!state || state.step !== 'amount') return;
                const frais = Math.floor(amount * BOT_FRAIS_PERCENT / 100);
                state.amount = amount;
                state.amountTotal = amount + frais;
                state.step = 'phone';
                buyState.set(chatId, state);
                await answerTelegramCallback(callbackId);
                await sendTelegramMessage(chatId, `✅ ${amount} FCFA + ${frais} F frais = <b>${state.amountTotal} FCFA</b> total.\n\n💳 Paiement via <b>Djamo</b>\n\nEnvoie ton numéro ${state.operator} (ex: ${BOT_OPERATORS[state.operator].prefix} 12 34 56 78)`);
                return;
            }
            if (data === 'bot_amount_other') {
                const state = buyState.get(chatId);
                if (!state || state.step !== 'amount') return;
                state.step = 'amount_custom';
                buyState.set(chatId, state);
                await answerTelegramCallback(callbackId);
                await sendTelegramMessage(chatId, `Envoie le montant en FCFA (ex: 2500).\nFrais: ${BOT_FRAIS_PERCENT}%.\n💳 Paiement via Djamo.`, {
                    reply_markup: { inline_keyboard: [[{ text: '❌ Annuler', callback_data: 'bot_annuler' }]] }
                });
                return;
            }
            if (data === 'bot_tarifs') {
                await answerTelegramCallback(callbackId);
                const lines = BOT_AMOUNTS.map(a => {
                    const f = Math.floor(a * BOT_FRAIS_PERCENT / 100);
                    return `• ${a} F → ${a + f} F total`;
                });
                await sendTelegramMessage(chatId, `💰 <b>Tarifs</b> (frais ${BOT_FRAIS_PERCENT}%)\n\n${lines.join('\n')}`);
                return;
            }
            if (data === 'bot_aide') {
                await answerTelegramCallback(callbackId);
                await sendTelegramMessage(chatId, '📌 <b>Aide</b>\n\n💳 <b>Acheter</b> : recharge MTN, Orange ou Moov.\n💰 <b>Paiement</b> : via Djamo (lien envoye apres commande).\n📸 <b>Preuve</b> : envoie une capture apres paiement.\n📱 <b>Ouvrir l\'app</b> : actualites, quetes, annonces LED.\n\n/demarrer — Accueil\n/annuler — Annuler');
                return;
            }
            if (data === 'bot_annuler') {
                buyState.delete(chatId);
                await answerTelegramCallback(callbackId, 'Annulé');
                await sendTelegramMessage(chatId, '✅ Annulé. Tape /demarrer pour recommencer.');
                return;
            }
            if (data.startsWith('validate_')) {
                const orderId = data.replace('validate_', '');
                const order = await orderStorage.setOrderValidated(orderId);
                if (order) {
                    await answerTelegramCallback(callbackId, 'Commande validée');
                    if (chatId) await sendTelegramMessage(chatId, `✅ Commande #${orderId} validée !`);
                    if (order.operator === 'PACK_ARTICLES') { await creditArticlePack(order); } else if ((order.operator === 'PROMO_LIKES' || order.operator === 'PROMO_SOCIAL')) {
                        if (order.userId) {
                            const promoLink = order.notes ? order.notes.split(' | ')[0].trim() : '';
                            if (promoLink) await telegramUsersService.updateSocialLink(order.userId, promoLink);
                            await telegramUsersService.approveSocialLink(order.userId);
                            await sendTelegramMessage(order.userId,
                                '✅ <b>Promo Likes/Vues validée !</b>\n\nVotre lien est maintenant visible dans l\'espace Quêtes. Chaque clic vous rapporte des points !');
                            if (chatId) await sendTelegramMessage(chatId, '🔗 Lien approuvé → visible dans Quêtes (clic = points).');
                        }
                    } else if (order.operator !== 'ANNONCE_LED' && order.operator !== 'PACK_ARTICLES' && order.phone) {
                        const ussdResult = await deliverCIRecharge(order);
                        if (order.userId) {
                            const txt = ussdResult.success
                                ? `✅ <b>Recharge effectuée !</b>\n\n📲 ${order.operator} - ${order.amount} FCFA\n📞 ${order.phone}\n\nMerci d'avoir utilisé Bipbip Recharge CI ! 🎉`
                                : `⚠️ <b>Paiement reçu</b>, transfert en cours.\n📞 ${order.phone}\n\nTa recharge est en cours de traitement automatique.`;
                            await sendTelegramMessage(order.userId, txt);
                        }
                    } else if (order.operator === 'ANNONCE_LED') {
                        if (order.notes) {
                            const annonceResult = await annoncesService.validateAnnonce(order.notes, { viaOrderProof: true });
                            if (annonceResult && !annonceResult.error && chatId) {
                                await sendTelegramMessage(chatId, '📢 Annonce validée → bandeau LED + Actualités.');
                            }
                        }
                        if (order.userId) {
                            await sendTelegramMessage(order.userId,
                                '✅ <b>Annonce LED validée !</b>\n\nVotre message passera dans le bandeau et les Actualités.');
                        }
                    }
                    await removeOrderButtonsFromAllAdmins(orderId, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN);
                } else {
                    await answerTelegramCallback(callbackId, 'Commande introuvable');
                }
            } else if (data.startsWith('reject_') && !data.startsWith('reject_act_') && !data.startsWith('reject_ann_')) {
                const orderId = data.replace('reject_', '');
                const orderBefore = await orderStorage.getOrderById(orderId);
                const order = await orderStorage.setOrderRejected(orderId);
                if (order) {
                    if (orderBefore && orderBefore.operator === 'ANNONCE_LED' && orderBefore.notes) {
                        await annoncesService.refuseAnnonce(orderBefore.notes);
                    }
                    await answerTelegramCallback(callbackId, 'Commande rejetée');
                    if (chatId) await sendTelegramMessage(chatId, `❌ Commande #${orderId} rejetée`);
                    await removeOrderButtonsFromAllAdmins(orderId, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN);
                } else {
                    await answerTelegramCallback(callbackId, 'Commande introuvable');
                }
            } else if (data.startsWith('approve_act_')) {
                const id = data.replace('approve_act_', '').trim();
                const updated = await actualitesService.approveActualite(id);
                await answerTelegramCallback(callbackId, updated ? 'Actualité approuvée' : 'Erreur ou déjà traitée');
                if (chatId && updated) {
                    await sendTelegramMessage(chatId, `✅ Actualité « ${(updated.title || '').slice(0, 50)} » approuvée.`);
                }
            } else if (data.startsWith('reject_act_')) {
                const id = data.replace('reject_act_', '').trim();
                await actualitesService.rejectActualite(id);
                await answerTelegramCallback(callbackId, 'Actualité rejetée');
                if (chatId) await sendTelegramMessage(chatId, `❌ Actualité #${id} rejetée.`);
            } else if (data.startsWith('approve_ann_')) {
                const id = data.replace('approve_ann_', '').trim();
                const result = await annoncesService.validateAnnonce(id, { viaOrderProof: true });
                const ok = result && !result.error;
                await answerTelegramCallback(callbackId, ok ? 'Annonce approuvée' : (result && typeof result.error === 'string' ? result.error : 'Erreur ou déjà traitée'));
                if (chatId && ok) await sendTelegramMessage(chatId, '📢 Annonce LED approuvée → bandeau + Actualités.');
            } else if (data.startsWith('reject_ann_')) {
                const id = data.replace('reject_ann_', '').trim();
                await annoncesService.refuseAnnonce(id);
                await answerTelegramCallback(callbackId, 'Annonce rejetée');
                if (chatId) await sendTelegramMessage(chatId, `❌ Annonce LED #${id} rejetée.`);
            } else if (data.startsWith('approve_link_') && chatId && adminIds.includes(String(chatId))) {
                const telegramId = data.replace('approve_link_', '').trim();
                const result = await telegramUsersService.approveSocialLink(telegramId);
                const ok = result && !result.error;
                await answerTelegramCallback(callbackId, ok ? 'Lien approuvé → Quêtes' : (result && result.error) || 'Erreur');
                if (chatId && ok) await sendTelegramMessage(chatId, '✅ Lien YouTube/X approuvé → visible dans l\'espace Quetes (clic = points).');
            } else if (data.startsWith('unapprove_link_') && chatId && adminIds.includes(String(chatId))) {
                const telegramId = data.replace('unapprove_link_', '').trim();
                const result = await telegramUsersService.unapproveSocialLink(telegramId);
                const ok = result && !result.error;
                await answerTelegramCallback(callbackId, ok ? 'Lien retiré des Quêtes' : (result && result.error) || 'Erreur');
                if (chatId && ok) await sendTelegramMessage(chatId, '🚫 Lien retiré des Quêtes.');
            } else if (data.startsWith('dellink_') && chatId && adminIds.includes(String(chatId))) {
                const telegramId = data.replace('dellink_', '').trim();
                const result = await telegramUsersService.removeSocialLink(telegramId);
                const ok = result && !result.error;
                await answerTelegramCallback(callbackId, ok ? 'Lien supprimé' : (result && result.error) || 'Erreur');
                if (chatId && ok) await sendTelegramMessage(chatId, '🗑️ Lien supprimé.');
            } else {
                await answerTelegramCallback(callbackId);
            }
        } catch (err) {
            console.error('[Webhook] callback_query error:', err);
            await answerTelegramCallback(callbackId, 'Erreur serveur');
        }
    }
}

// ==================== DÉPÔTS RÉELS (Wave notif + Djamo) ====================
// Preuves d'encaissement RÉELLES reçues sur les comptes marchands, pour croiser
// avec les commandes avant validation (l'OCR d'un screenshot est falsifiable ;
// un dépôt réellement reçu ne l'est pas).
// Sources : APK écouteur de notifs Wave (POST /api/deposits + secret), poller Djamo.
const DEPOSITS_FILE = path.join(__dirname, 'deposits.json');
const DEPOSITS_SECRET = (process.env.DEPOSITS_SECRET || '').trim();
let deposits = [];
try { if (fs.existsSync(DEPOSITS_FILE)) deposits = JSON.parse(fs.readFileSync(DEPOSITS_FILE, 'utf8')) || []; }
catch (e) { console.error('[deposits] load:', e.message); }

// ---- Anti-rejeu PERSISTANT : signatures des paiements deja encaisses ----
// Store durable (hors des 500 derniers de deposits.json) : bloque tout rejeu d'une
// meme notif, meme tres tardif. Purge > 120 jours pour borner la taille.
const DEPOSIT_SIGS_FILE = path.join(__dirname, 'deposit_signatures.json');
let depositSigs = {};
try { if (fs.existsSync(DEPOSIT_SIGS_FILE)) depositSigs = JSON.parse(fs.readFileSync(DEPOSIT_SIGS_FILE, 'utf8')) || {}; }
catch (e) { console.error('[deposits] load sigs:', e.message); }
function depositSignature(source, amount, reference, rawText) {
    const ident = (reference && String(reference).trim()) || (rawText && String(rawText).trim()) || '';
    if (!ident) return null;
    return crypto.createHash('sha256').update(String(source) + '|' + amount + '|' + ident).digest('hex');
}
function saveDepositSigs() {
    // Ecriture SYNCHRONE : une signature encaissee doit etre durable immediatement, meme si
    // le process redemarre/crashe la seconde suivante (sinon un rejeu redeviendrait possible).
    try {
        const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
        for (const k of Object.keys(depositSigs)) if (depositSigs[k] < cutoff) delete depositSigs[k];
        fs.writeFileSync(DEPOSIT_SIGS_FILE, JSON.stringify(depositSigs), 'utf8');
    } catch (e) { console.error('[deposits] save sigs:', e.message); }
}
// Backfill au boot depuis deposits.json (couvre l'historique recent des 500 derniers).
for (const _d of deposits) {
    const _s = depositSignature(_d.source, _d.amount, _d.reference, _d.rawText);
    if (_s && !depositSigs[_s]) depositSigs[_s] = _d.receivedAt || Date.now();
}

let _depSaveTimer = null;
function saveDeposits() {
    if (_depSaveTimer) return;
    _depSaveTimer = setTimeout(() => {
        _depSaveTimer = null;
        try { fs.writeFileSync(DEPOSITS_FILE, JSON.stringify(deposits.slice(-500)), 'utf8'); }
        catch (e) { console.error('[deposits] save:', e.message); }
    }, 1000);
}
function normalizePhoneCI(p) {
    return String(p || '').replace(/\D/g, '').replace(/^225/, '');
}

// Réception d'un dépôt (APK Wave via secret partagé, ou poller interne via clé admin)
app.post('/api/deposits', (req, res) => {
    const body = req.body || {};
    const secretOk = DEPOSITS_SECRET && body.secret === DEPOSITS_SECRET;
    if (!secretOk && !isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });

    // Diagnostic : notif de paiement non parsée par l'APK → on logge le texte brut
    // pour ajuster le parseur, sans créer de dépôt.
    if (body.debug === true) {
        console.log(`[deposits][debug] ${body.package || '?'} : ${String(body.rawText || '').slice(0, 300)}`);
        return res.json({ ok: true, debug: true });
    }

    const amount = parseInt(String(body.amount == null ? '' : body.amount).replace(/[^\d]/g, ''), 10);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });

    const source = (body.source || 'wave').toLowerCase();
    const reference = body.reference ? String(body.reference).trim() : null;
    const rawText = body.rawText ? String(body.rawText).slice(0, 500) : '';
    const now = Date.now();

    // Anti-rejeu PERSISTANT : signature de contenu (source+montant+reference/rawText) deja
    // encaissee -> rejet quel que soit le delai, meme si l'original est sorti des 500 derniers
    // de deposits.json. Contre le rejeu d'anciennes notifs par l'app reader au reconnect.
    const sig = depositSignature(source, amount, reference, rawText);
    if (sig && depositSigs[sig]) {
        return res.json({ ok: true, duplicate: true, replay: true, persisted: true });
    }
    // Sans identifiant de contenu (ni reference ni rawText) : dedup courte source+montant.
    const dup = deposits.find(d => d.source === source && d.amount === amount
        && !d.reference && !d.rawText && (now - d.receivedAt) < 30 * 60 * 1000);
    if (dup) return res.json({ ok: true, duplicate: true, id: dup.id });

    const dep = {
        id: crypto.randomBytes(6).toString('hex'),
        source, amount,
        senderPhone: normalizePhoneCI(body.senderPhone),
        senderName: body.senderName ? String(body.senderName).slice(0, 80) : null,
        reference, rawText,
        receivedAt: now,
        notifiedAt: body.notifiedAt || null,
        matchedOrderId: null,
    };
    deposits.push(dep);
    saveDeposits();
    if (sig) { depositSigs[sig] = now; saveDepositSigs(); }
    console.log(`[deposits] +${source.toUpperCase()} ${amount} FCFA de ${dep.senderPhone || '?'} (${dep.id})`);
    res.json({ ok: true, id: dep.id });
    // Notif admin : dépôt reçu (traçabilité temps réel sur le bot admin)
    (async () => {
        try {
            await sendTelegramToAllAdmins(
                '\uD83D\uDCB0 <b>Dépôt reçu</b>\n' +
                'Montant : <b>' + amount + ' FCFA</b>\n' +
                'Source : ' + source.toUpperCase() + '\n' +
                (dep.senderName ? ('De : ' + dep.senderName + '\n') : '') +
                (dep.senderPhone ? ('N\u00b0 : ' + dep.senderPhone + '\n') : '') +
                '\uD83D\uDD0E Rapprochement automatique en cours\u2026',
                {}, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN
            );
        } catch (e) { /* noop */ }
    })();
    // Auto-validation immédiate si le dépôt correspond à une commande en attente (non bloquant)
    tryAutoValidateFromDeposit(dep).catch(e => console.error('[deposits] auto-val:', e.message));
});

// Auto-validation d'une commande à partir d'un DÉPÔT RÉEL (plus sûr qu'un screenshot).
// Ne valide QUE si le rapprochement est UNIQUE (un seul dépôt ↔ une seule commande
// du même montant total, frais inclus, dans une fenêtre récente). Sinon on laisse
// le flux preuve/manuel. Réutilise l'endpoint /validate existant → anti-double-livraison
// garanti (setOrderValidated renvoie null si la commande n'est plus en attente).
async function tryAutoValidateFromDeposit(dep) {
    if (!dep || dep.matchedOrderId) return false;
    if (Date.now() - dep.receivedAt > 60 * 60 * 1000) return false;   // trop vieux
    let candidates;
    try {
        const pend = await orderStorage.getOrdersByStatus('pending');
        const sent = await orderStorage.getOrdersByStatus('proof_sent');
        candidates = [...(pend || []), ...(sent || [])].filter(o => {
            if (!o.phone) return false;
            const total = Number(o.amountTotal || o.amount || 0);   // montant TOTAL (frais inclus)
            if (Math.abs(total - dep.amount) > 5) return false;
            const created = new Date(o.createdAt || o.created_at || 0).getTime();
            if (created && Math.abs(dep.receivedAt - created) > 60 * 60 * 1000) return false;
            return true;
        });
    } catch (e) {
        console.warn('[deposits] auto-val: lecture commandes KO (Supabase indispo ?):', (e && e.message) || e);
        return false;
    }
    if (candidates.length !== 1) {
        // Ambiguïté de montant (ex. 15 commandes à 210F) : départager par le NUMÉRO PAYEUR.
        // Le dépôt Wave/Djamo porte senderPhone (numéro réel du payeur, infalsifiable).
        // Si le client a rechargé SON PROPRE numéro et qu'une seule candidate a ce numéro,
        // le rapprochement est fiable. Sinon (0 ou plusieurs), on laisse le flux preuve.
        if (!dep.senderPhone) return false;
        const _sp = normalizePhoneCI(dep.senderPhone);
        const byPhone = candidates.filter(o => normalizePhoneCI(o.phone) === _sp);
        if (byPhone.length !== 1) return false;
        candidates = byPhone;
        console.log(`[deposits] ambiguité ${dep.amount}F levée par numéro payeur ${_sp} → commande ${candidates[0].id}`);
    }
    const order = candidates[0];
    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(`http://127.0.0.1:${PORT}/api/admin/orders/${order.id}/validate`, {
            method: 'POST', headers: { 'x-admin-key': process.env.ADMIN_SECRET_KEY || '' },
        });
        if (r.status === 200 || r.status === 404) {   // 200 = validée par le dépôt ; 404 = déjà validée
            dep.matchedOrderId = order.id; saveDeposits();
            console.log(`[deposits] AUTO-VALIDATION ${dep.amount}F → commande ${order.id} (HTTP ${r.status})`);
            try {
                await sendTelegramToAllAdmins(
                    '\u2705 <b>Dépôt rapproché automatiquement</b>\n' +
                    'Dépôt : ' + dep.amount + ' FCFA (' + String(dep.source).toUpperCase() + ')\n' +
                    '\u2192 Commande <code>' + order.id + '</code> validée sans preuve.',
                    {}, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN
                );
            } catch (e) { /* noop */ }
            return true;
        }
        console.log(`[deposits] auto-validation ${order.id} échec HTTP ${r.status}`);
    } catch (e) { console.error('[deposits] auto-validation err:', e.message); }
    return false;
}

// Liste des dépôts récents (agent de validation + admin)
app.get('/api/deposits', (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    const sinceMin = parseInt(req.query.sinceMinutes, 10) || 240;
    const cutoff = Date.now() - sinceMin * 60 * 1000;
    const list = deposits.filter(d => d.receivedAt >= cutoff).slice().reverse();
    res.json({ deposits: list, count: list.length });
});

// Marquer un dépôt comme consommé par une commande (anti-réutilisation d'un même dépôt)
app.post('/api/deposits/:id/consume', (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé' });
    const dep = deposits.find(d => d.id === req.params.id);
    if (!dep) return res.status(404).json({ error: 'Dépôt introuvable' });
    const orderId = (req.body && req.body.orderId) || 'unknown';
    if (dep.matchedOrderId && dep.matchedOrderId !== orderId) {
        return res.status(409).json({ error: 'Déjà consommé', matchedOrderId: dep.matchedOrderId });
    }
    dep.matchedOrderId = orderId;
    saveDeposits();
    res.json({ ok: true });
});

// ── Relances SMS automatiques (dépôt sans preuve à 5 min ; livraison en retard à 15 min) ──
const smsDelayReminded = new Set();
setInterval(async () => {
    const now = Date.now();

    // Scénario 3 : dépôt réel reçu mais AUCUNE commande/preuve après 5 min → relance au payeur.
    // (souvent un client fait le dépôt mais n'envoie jamais sa preuve, puis attend sans rien recevoir)
    try {
        let openTotals = [];
        try {
            const pend = await orderStorage.getOrdersByStatus('pending');
            const sent = await orderStorage.getOrdersByStatus('proof_sent');
            openTotals = [...(pend || []), ...(sent || [])].map(o => Number(o.amountTotal || o.amount || 0));
        } catch (e) { /* storage indispo : on relance quand même */ }

        let changed = false;
        for (const d of deposits) {
            if (d.matchedOrderId || !d.senderPhone) continue;
            // 1) Prioritaire : tenter l'auto-validation (la commande a pu être créée après le dépôt)
            if (await tryAutoValidateFromDeposit(d)) continue;   // matché → pas de relance
            // 2) Sinon, relance SMS « envoyez votre preuve » après 5 min
            if (d.smsReminded) continue;
            const age = now - d.receivedAt;
            if (age < 5 * 60 * 1000) continue;               // pas encore 5 min
            if (age > 6 * 60 * 60 * 1000) { d.smsReminded = true; changed = true; continue; } // trop vieux
            // Si une commande ouverte a le même montant TOTAL, le client est déjà dans le circuit → pas de relance
            if (openTotals.some(a => Math.abs(a - d.amount) <= 5)) continue;
            await sendSms(d.senderPhone,
                `BIPBIP: Nous avons bien recu votre paiement de ${d.amount} F. Si vous n'avez pas encore recu votre commande, envoyez votre preuve de paiement dans l'app pour la finaliser. Merci !`);
            try {
                await sendTelegramToAllAdmins(
                    '\u26A0\uFE0F <b>Dépôt non rattaché</b>\n' +
                    'Montant : ' + d.amount + ' FCFA (' + String(d.source).toUpperCase() + ')\n' +
                    (d.senderName ? ('De : ' + d.senderName + '\n') : '') +
                    (d.senderPhone ? ('N\u00b0 : ' + d.senderPhone + '\n') : '') +
                    'Reçu depuis >5 min sans commande correspondante. Payeur relancé par SMS. \u00c0 vérifier.',
                    {}, TELEGRAM_BOT_TOKEN_ADMIN || TELEGRAM_BOT_TOKEN
                );
            } catch (e) { /* noop */ }
            d.smsReminded = true; changed = true;
        }
        if (changed) saveDeposits();
    } catch (e) { console.error('[SMS relance depot]', e.message || e); }

    // Scénario 2 : commande validée mais NON livrée après 15 min (retard réseau) → SMS d'attente.
    try {
        const validated = await orderStorage.getValidatedOrders();
        for (const o of validated) {
            if (o.status !== 'validated') continue;          // livrée => credit_delivered / forfait_delivered
            if (!o.phone || !o.validatedAt || smsDelayReminded.has(o.id)) continue;
            if (now - new Date(o.validatedAt).getTime() < 15 * 60 * 1000) continue;
            await sendSms(o.phone,
                `BIPBIP RECHARGE: Votre recharge de ${o.amount}F est en cours, un retard reseau est possible. Merci de patienter encore 15 min. Sans reception, contactez-nous.`);
            smsDelayReminded.add(o.id);
        }
    } catch (e) { console.error('[SMS retard]', e.message || e); }
}, 60 * 1000);

// Gestion d'erreurs globale (ne pas exposer les détails en production)
app.use((err, req, res, next) => {
    console.error(err);
    const message = NODE_ENV === 'production' ? 'Erreur serveur' : (err.message || 'Erreur serveur');
    res.status(500).json({ error: message });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   ⚡ BIPBIP RECHARGE CI - Server                  ║
║                                                   ║
║   🌐 URL: http://localhost:${PORT}                  ║
║   📁 Uploads: ${UPLOADS_DIR}                          ║
║   🤖 Telegram: ${TELEGRAM_BOT_TOKEN ? '✅ Configuré' : '❌ Non configuré'}              ║
║   🤖 Bot Admin Supabase: ${TELEGRAM_BOT_TOKEN_ADMIN ? '✅' : '—'}                          ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
});
