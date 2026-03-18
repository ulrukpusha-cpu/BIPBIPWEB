const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');

const NODE_ENV = process.env.NODE_ENV || 'development';
const orderStorage = require('./storage');
const { authTelegram, requireAuth } = require('./middleware/auth');
const { apiLimiter, paymentLimiter } = require('./middleware/rateLimit');
const momoRoutes = require('./routes/momo');
const actualitesRoutes = require('./routes/actualites');
const actualitesService = require('./services/actualitesService');
const telegramUsersService = require('./services/telegramUsersService');
const annoncesRoutes = require('./routes/annonces');
const annoncesService = require('./services/annoncesService');
const { moderateSocialLink } = require('./services/aiModeration');
const questsRoutes = require('./routes/quests');
const ledService = require('./services/ledService');

// ==================== CONFIG ====================
const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_BOT_TOKEN_ADMIN = (process.env.TELEGRAM_BOT_TOKEN_ADMIN || '').trim();

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

// Achats directs dans le bot (sans webapp)
const BOT_FRAIS_PERCENT = 5;
const BOT_OPERATORS = {
    MTN: { prefix: '05' },
    Orange: { prefix: '07' },
    Moov: { prefix: '01' }
};
const BOT_AMOUNTS = [500, 1000, 2000, 5000, 10000];
const buyState = new Map(); // chatId -> { step, operator?, amount?, amountTotal?, phone? }

// ==================== UPLOADS ====================
const UPLOADS_DIR = './uploads';
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ==================== CONFIG APP (vitesse bandeau LED, etc.) ====================
const DATA_DIR = './data';
const APP_CONFIG_PATH = path.join(DATA_DIR, 'app-config.json');

function readAppConfig() {
    try {
        if (fs.existsSync(APP_CONFIG_PATH)) {
            const raw = fs.readFileSync(APP_CONFIG_PATH, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) { /* ignore */ }
    return { ledScrollSeconds: parseInt(process.env.LED_SCROLL_SECONDS, 10) || 60 };
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

// ==================== MIDDLEWARE ====================
// CORS : comme v2 - en production, restreindre aux origines (CORS_ORIGIN) ou désactiver si non défini
const corsOptions = NODE_ENV === 'production'
  ? {
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
        : false,
      credentials: true,
    }
  : {};
app.use(cors(corsOptions));

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));
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
            console.error('[Telegram] sendMessage erreur:', data.description || data);
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
    for (const chatId of ids) {
        await sendTelegramPhoto(chatId, photoUrl, caption, options, token);
    }
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

// Config publique (MoMo, vitesse bandeau LED)
app.get('/api/config', (req, res) => {
    const mtnMerchantPhone = (process.env.BIPBIP_MOMO_PHONE || '').trim();
    const appConfig = readAppConfig();
    res.json({
        mtnMerchantPhone: mtnMerchantPhone || null,
        momoEnabled: !!process.env.MTN_SUBSCRIPTION_KEY && !!process.env.MTN_API_USER,
        ledScrollSeconds: Math.min(300, Math.max(15, appConfig.ledScrollSeconds || 60))
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

// Admin : mettre à jour la config (ex. vitesse bandeau)
app.put('/api/admin/config', (req, res) => {
    const secret = process.env.ADMIN_SECRET_KEY;
    if (!secret) return res.status(503).json({ error: 'ADMIN_SECRET_KEY non configuré' });
    const key = req.headers['x-admin-key'];
    if (key !== secret) return res.status(401).json({ error: 'Non autorisé' });
    const body = req.body || {};
    const current = readAppConfig();
    if (body.ledScrollSeconds != null) {
        const val = Math.min(300, Math.max(15, parseInt(body.ledScrollSeconds, 10) || 60));
        current.ledScrollSeconds = val;
    }
    if (!writeAppConfig(current)) return res.status(500).json({ error: 'Erreur écriture config' });
    res.json({ success: true, config: { ledScrollSeconds: current.ledScrollSeconds } });
});

// Créer une commande (rate limit paiement + userId prioritaire depuis Telegram si initData valide)
app.post('/api/orders', paymentLimiter, async (req, res) => {
    try {
        const { operator, amount, amountTotal, phone, userId: bodyUserId, username: bodyUsername } = req.body;
        
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
        
        const orderId = crypto.randomBytes(5).toString('hex').toUpperCase();
        const userId = req.userId || bodyUserId || null;
        const username = (req.telegramUser && req.telegramUser.username) || bodyUsername || null;
        
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
            createdAt: new Date().toISOString()
        };
        
        await orderStorage.createOrder(order);
        
        // Notifier tous les admins
        const adminIds = getAdminChatIds();
        if (adminIds.length === 0) {
            console.warn('[Telegram] Aucun ADMIN_CHAT_ID/ADMIN_CHAT_IDS dans .env - pas de notif admin');
        } else {
            console.log('[Telegram] Envoi notif nouvelle commande #' + orderId + ' à ' + adminIds.length + ' admin(s)');
            await sendTelegramToAllAdmins(
                `🔔 <b>NOUVELLE COMMANDE #${orderId}</b>\n\n` +
                `👤 User: ${username ? '@' + username : userId || 'WebApp'}\n` +
                `📲 Opérateur: ${operator}\n` +
                `💰 Montant: ${amountTotal} FCFA\n` +
                `📞 Numéro: ${phone}\n` +
                `📅 Date: ${new Date().toLocaleString('fr-FR')}`
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
        await orderStorage.updateOrderProof(orderId, proofPath, 'proof_sent');
        
        // Construire l'URL complète pour Telegram
        const proofUrl = `${req.protocol}://${req.get('host')}${proofPath}`;
        
        const caption = order.operator === 'ANNONCE_LED'
            ? `📸 <b>Preuve annonce LED #${orderId}</b>\n\n💰 ${order.amountTotal} FCFA\nValider = annonce dans bandeau LED + Actualités`
            : `📸 <b>Preuve commande #${orderId}</b>\n\n📲 ${order.operator} - ${order.amountTotal} FCFA\n📞 ${order.phone}`;
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Valider', callback_data: `validate_${orderId}` },
                    { text: '❌ Rejeter', callback_data: `reject_${orderId}` }
                ]]
            }
        };
        // Envoyer la preuve aux admins via le bot principal
        await sendTelegramPhotoToAllAdmins(proofUrl, caption, keyboard);
        // Et aussi via le bot Admin Supabase (si configuré)
        if (TELEGRAM_BOT_TOKEN_ADMIN) {
            await sendTelegramPhotoToAllAdmins(proofUrl, caption, keyboard, TELEGRAM_BOT_TOKEN_ADMIN);
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
        const { image } = req.body;
        
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
        await orderStorage.updateOrderProof(orderId, proofPath, 'proof_sent');
        
        const proofUrl = `${req.protocol}://${req.get('host')}${proofPath}`;
        const captionB64 = order.operator === 'ANNONCE_LED'
            ? `📸 <b>Preuve annonce LED #${orderId}</b>\n\n💰 ${order.amountTotal} FCFA\nValider = bandeau LED + Actualités`
            : `📸 <b>Preuve commande #${orderId}</b>\n\n📲 ${order.operator} - ${order.amountTotal} FCFA\n📞 ${order.phone}`;
        const keyboard2 = {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Valider', callback_data: `validate_${orderId}` },
                    { text: '❌ Rejeter', callback_data: `reject_${orderId}` }
                ]]
            }
        };
        await sendTelegramPhotoToAllAdmins(proofUrl, captionB64, keyboard2);
        if (TELEGRAM_BOT_TOKEN_ADMIN) {
            await sendTelegramPhotoToAllAdmins(proofUrl, captionB64, keyboard2, TELEGRAM_BOT_TOKEN_ADMIN);
        }
        res.json({ success: true, proof: proofPath });
    } catch (error) {
        console.error('Erreur upload preuve base64:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Vérifier admin : clé OU identité Telegram (initData)
function isAdminRequest(req) {
    const secret = process.env.ADMIN_SECRET_KEY;
    if (secret && req.headers['x-admin-key'] === secret) return true;
    const adminIds = getAdminChatIds();
    const chatId = req.userId; // défini par authTelegram
    if (chatId && adminIds.length && adminIds.includes(String(chatId))) return true;
    return false;
}

// Admin: Valider une commande (X-Admin-Key OU Telegram admin)
app.post('/api/admin/orders/:id/validate', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé. Clé admin ou ouvre l’app depuis le bot (compte dans ADMIN_CHAT_IDS).' });
    try {
        const orderId = req.params.id;
        const order = await orderStorage.setOrderValidated(orderId);
        
        if (!order) {
            return res.status(404).json({ error: 'Commande introuvable' });
        }
        if (order.operator !== 'ANNONCE_LED' && order.phone) {
            const ussdResult = await executeUssdTransfer(order);
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
        res.json({ success: true, message: 'Commande validée' });
    } catch (error) {
        console.error('Erreur validation:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Valider une commande via identité Telegram (Web App ouverte depuis le bot, pas besoin de clé)
app.post('/api/admin/orders/:id/validate-by-telegram', async (req, res) => {
    const adminIds = getAdminChatIds();
    const chatId = req.userId; // id Telegram depuis authTelegram (initData)
    if (!chatId || !adminIds.includes(String(chatId))) {
        return res.status(401).json({ error: 'Non autorisé (ouvre l’app depuis le bot avec un compte admin)' });
    }
    try {
        const orderId = req.params.id;
        const order = await orderStorage.setOrderValidated(orderId);
        if (!order) return res.status(404).json({ error: 'Commande introuvable' });
        if (order.operator !== 'ANNONCE_LED' && order.phone) {
            const ussdResult = await executeUssdTransfer(order);
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
        return res.status(401).json({ error: 'Non autorisé (ouvre l’app depuis le bot avec un compte admin)' });
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
        res.json({ success: true, message: 'Commande rejetée' });
    } catch (err) {
        console.error('Erreur rejet (by-telegram):', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Rejeter une commande (X-Admin-Key OU Telegram admin)
app.post('/api/admin/orders/:id/reject', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé. Clé admin ou ouvre l’app depuis le bot (compte dans ADMIN_CHAT_IDS).' });
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
        
        res.json({ success: true, message: 'Commande rejetée' });
        
    } catch (error) {
        console.error('Erreur rejet:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Liste des commandes (X-Admin-Key OU Telegram admin)
app.get('/api/admin/orders', async (req, res) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Non autorisé. Clé admin ou ouvre l’app depuis le bot (compte dans ADMIN_CHAT_IDS).' });
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

// Daily check-in : état et réclamation
app.get('/api/telegram/daily-checkin', async (req, res) => {
    if (!req.telegramUser || !req.userId) {
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
    if (!req.telegramUser || !req.userId) {
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
                '📅 ' + new Date().toLocaleString('fr-FR')
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
                    '/liens — Liens YouTube/X',
                    {}, botToken);
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
                        const opts = !approved ? { reply_markup: { inline_keyboard: [[{ text: '✅ Approuver (→ Quêtes)', callback_data: `approve_link_${u.telegram_id}` }]] } } : {};
                        await sendTelegramMessage(chatId, text, opts, botToken);
                    }
                    if (users.length > 15) await sendTelegramMessage(chatId, `… et ${users.length - 15} autre(s).`, {}, botToken);
                }
                return;
            }
            if (cmd.startsWith('/')) {
                await sendTelegramMessage(chatId, '❓ /actualites, /annonces, /commandes, /liens', {}, botToken);
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
                if (chatId && ok) await sendTelegramMessage(chatId, '✅ Lien YouTube/X approuvé → visible dans l’espace Quêtes (clic = points).', {}, botToken);
                return;
            }
            if (data.startsWith('validate_')) {
                const orderId = data.replace('validate_', '');
                const order = await orderStorage.setOrderValidated(orderId);
                if (order) {
                    await answerTelegramCallback(callbackId, 'Commande validée', botToken);
                    if (chatId) await sendTelegramMessage(chatId, `✅ Commande #${orderId} validée !`, {}, botToken);
                    if (order.operator !== 'ANNONCE_LED' && order.phone) {
                        const ussdResult = await executeUssdTransfer(order);
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
                    : '👋 <b>Bipbip Recharge CI</b>\n\nTu peux <b>acheter du crédit ici</b> sans ouvrir l’app, ou ouvrir l’app pour plus de fonctionnalités.\n\nChoisis une action 👋';
                await sendTelegramMessage(chatId, welcome, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '💳 Acheter', callback_data: 'bot_acheter' },
                                { text: '💰 Tarifs', callback_data: 'bot_tarifs' },
                                { text: '❓ Aide', callback_data: 'bot_aide' }
                            ],
                            [
                                { text: '📱 Ouvrir l’app', web_app: { url: appUrl } }
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
                        const opts = !approved ? { reply_markup: { inline_keyboard: [[{ text: '✅ Approuver (→ Quêtes)', callback_data: `approve_link_${u.telegram_id}` }]] } } : {};
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
                            `🔔 <b>NOUVELLE COMMANDE #${orderId}</b> (Bot)\n\n👤 ${order.username ? '@' + order.username : chatId}\n📲 ${order.operator}\n💰 ${order.amountTotal} FCFA\n📞 ${order.phone}\n📅 ${new Date().toLocaleString('fr-FR')}`
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
                        await orderStorage.updateOrderProof(order.id, proofPath, 'proof_sent');
                        const baseUrl = (process.env.WEBHOOK_BASE_URL || process.env.BASE_URL || 'https://bipbiprecharge.ci').replace(/\/$/, '');
                        const proofUrl = baseUrl + proofPath;
                        const caption = `📸 <b>Preuve commande #${order.id}</b>\n\n📲 ${order.operator} - ${order.amountTotal} FCFA\n📞 ${order.phone}`;
                        const keyboard3 = {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ Valider', callback_data: `validate_${order.id}` },
                                    { text: '❌ Rejeter', callback_data: `reject_${order.id}` }
                                ]]
                            }
                        };
                        await sendTelegramPhotoToAllAdmins(proofUrl, caption, keyboard3);
                        if (TELEGRAM_BOT_TOKEN_ADMIN) {
                            await sendTelegramPhotoToAllAdmins(proofUrl, caption, keyboard3, TELEGRAM_BOT_TOKEN_ADMIN);
                        }
                        await sendTelegramMessage(chatId, '✅ Preuve reçue. En attente de validation par l’admin.');
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
                await sendTelegramMessage(chatId, '📲 Choisis l’opérateur :', {
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
                await sendTelegramMessage(chatId, ‘📌 <b>Aide</b>\n\n💳 <b>Acheter</b> : recharge MTN, Orange ou Moov.\n💰 <b>Paiement</b> : via Djamo (lien envoyé après commande).\n📸 <b>Preuve</b> : envoie une capture après paiement.\n📱 <b>Ouvrir l\’app</b> : actualités, quêtes, annonces LED.\n\n/demarrer — Accueil\n/annuler — Annuler’);
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
                    if (order.operator !== 'ANNONCE_LED' && order.phone) {
                        const ussdResult = await executeUssdTransfer(order);
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
                if (chatId && ok) await sendTelegramMessage(chatId, '✅ Lien YouTube/X approuvé → visible dans l’espace Quêtes (clic = points).');
            } else {
                await answerTelegramCallback(callbackId);
            }
        } catch (err) {
            console.error('[Webhook] callback_query error:', err);
            await answerTelegramCallback(callbackId, 'Erreur serveur');
        }
    }
}

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
