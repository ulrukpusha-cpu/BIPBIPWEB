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
const annoncesRoutes = require('./routes/annonces');
const questsRoutes = require('./routes/quests');
const ledService = require('./services/ledService');

// ==================== CONFIG ====================
const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

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

// ==================== UPLOADS ====================
const UPLOADS_DIR = './uploads';
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

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
async function sendTelegramMessage(chatId, text, options = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log('[Telegram] Token non configuré, message ignoré:', text);
        return;
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
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

async function sendTelegramPhoto(chatId, photoUrl, caption, options = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log('[Telegram] Token non configuré, photo ignorée');
        return;
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
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

async function sendTelegramToAllAdmins(text, options = {}) {
    const ids = getAdminChatIds();
    for (const chatId of ids) {
        await sendTelegramMessage(chatId, text, options);
    }
}

async function sendTelegramPhotoToAllAdmins(photoUrl, caption, options = {}) {
    const ids = getAdminChatIds();
    for (const chatId of ids) {
        await sendTelegramPhoto(chatId, photoUrl, caption, options);
    }
}

// ==================== API ROUTES ====================

// Config publique (numéro MoMo marchand pour affichage)
app.get('/api/config', (req, res) => {
    const mtnMerchantPhone = (process.env.BIPBIP_MOMO_PHONE || '').trim();
    res.json({
        mtnMerchantPhone: mtnMerchantPhone || null,
        momoEnabled: !!process.env.MTN_SUBSCRIPTION_KEY && !!process.env.MTN_API_USER
    });
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
        
        // Envoyer la preuve à tous les admins (chacun peut valider/rejeter)
        await sendTelegramPhotoToAllAdmins(
            proofUrl,
            `📸 <b>Preuve commande #${orderId}</b>\n\n` +
            `📲 ${order.operator} - ${order.amountTotal} FCFA\n` +
            `📞 ${order.phone}`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Valider', callback_data: `validate_${orderId}` },
                        { text: '❌ Rejeter', callback_data: `reject_${orderId}` }
                    ]]
                }
            }
        );
        
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
        
        // Envoyer notification
        const proofUrl = `${req.protocol}://${req.get('host')}${proofPath}`;
        
        await sendTelegramPhotoToAllAdmins(
            proofUrl,
            `📸 <b>Preuve commande #${orderId}</b>\n\n` +
            `📲 ${order.operator} - ${order.amountTotal} FCFA\n` +
            `📞 ${order.phone}`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Valider', callback_data: `validate_${orderId}` },
                        { text: '❌ Rejeter', callback_data: `reject_${orderId}` }
                    ]]
                }
            }
        );
        
        res.json({ success: true, proof: proofPath });
        
    } catch (error) {
        console.error('Erreur upload preuve base64:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Valider une commande
app.post('/api/admin/orders/:id/validate', async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await orderStorage.setOrderValidated(orderId);
        
        if (!order) {
            return res.status(404).json({ error: 'Commande introuvable' });
        }
        
        // Notifier l'utilisateur si on a son ID Telegram
        if (order.userId) {
            await sendTelegramMessage(order.userId,
                `✅ <b>Recharge effectuée !</b>\n\n` +
                `📲 ${order.operator} - ${order.amount} FCFA\n` +
                `📞 ${order.phone}\n\n` +
                `Merci d'avoir utilisé Bipbip Recharge CI ! 🎉`
            );
        }
        
        res.json({ success: true, message: 'Commande validée' });
        
    } catch (error) {
        console.error('Erreur validation:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Rejeter une commande
app.post('/api/admin/orders/:id/reject', async (req, res) => {
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

// Admin: Liste des commandes
app.get('/api/admin/orders', async (req, res) => {
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

// Webhook Telegram (pour les callbacks)
app.post('/api/telegram/webhook', async (req, res) => {
    try {
        const { callback_query } = req.body;
        
        if (callback_query) {
            const data = callback_query.data;
            const chatId = callback_query.message.chat.id;
            
            if (data.startsWith('validate_')) {
                const orderId = data.replace('validate_', '');
                const order = await orderStorage.setOrderValidated(orderId);
                if (order) {
                    await sendTelegramMessage(chatId, `✅ Commande #${orderId} validée !`);
                    if (order.userId) {
                        await sendTelegramMessage(order.userId,
                            `✅ <b>Recharge effectuée !</b>\n\n` +
                            `📲 ${order.operator} - ${order.amount} FCFA\n` +
                            `📞 ${order.phone}`
                        );
                    }
                }
            } else if (data.startsWith('reject_')) {
                const orderId = data.replace('reject_', '');
                const order = await orderStorage.setOrderRejected(orderId);
                if (order) {
                    await sendTelegramMessage(chatId, `❌ Commande #${orderId} rejetée`);
                }
            }
        }
        
        res.json({ ok: true });
        
    } catch (error) {
        console.error('Webhook error:', error);
        res.json({ ok: true });
    }
});

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
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
});
