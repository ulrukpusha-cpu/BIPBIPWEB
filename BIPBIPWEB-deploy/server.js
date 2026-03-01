const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ==================== CONFIG ====================
const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '6735995998';

// ==================== STORAGE ====================
const ORDERS_FILE = './data/orders.json';
const UPLOADS_DIR = './uploads';

// Créer les dossiers si nécessaire
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Charger les commandes
let orders = {};
let validatedOrders = [];

if (fs.existsSync(ORDERS_FILE)) {
    const data = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    orders = data.orders || {};
    validatedOrders = data.validatedOrders || [];
}

function saveOrders() {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify({ orders, validatedOrders }, null, 2));
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer pour upload de fichiers
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
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
        
        return await response.json();
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

// ==================== API ROUTES ====================

// Créer une commande
app.post('/api/orders', async (req, res) => {
    try {
        const { operator, amount, amountTotal, phone, userId, username } = req.body;
        
        // Validation
        if (!operator || !amount || !phone) {
            return res.status(400).json({ error: 'Données manquantes' });
        }
        
        // Générer ID
        const orderId = Math.random().toString(36).substring(2, 10).toUpperCase();
        
        const order = {
            id: orderId,
            userId: userId || null,
            username: username || null,
            operator,
            amount,
            amountTotal: amountTotal || amount,
            phone,
            proof: null,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        
        orders[orderId] = order;
        saveOrders();
        
        // Notifier l'admin
        await sendTelegramMessage(ADMIN_CHAT_ID, 
            `🔔 <b>NOUVELLE COMMANDE #${orderId}</b>\n\n` +
            `👤 User: ${username ? '@' + username : userId || 'WebApp'}\n` +
            `📲 Opérateur: ${operator}\n` +
            `💰 Montant: ${amountTotal} FCFA\n` +
            `📞 Numéro: ${phone}\n` +
            `📅 Date: ${new Date().toLocaleString('fr-FR')}`
        );
        
        res.json({ success: true, order });
        
    } catch (error) {
        console.error('Erreur création commande:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer une commande
app.get('/api/orders/:id', (req, res) => {
    const order = orders[req.params.id];
    if (!order) {
        return res.status(404).json({ error: 'Commande introuvable' });
    }
    res.json({ order });
});

// Récupérer les commandes d'un utilisateur
app.get('/api/orders/user/:userId', (req, res) => {
    const userOrders = Object.values(orders).filter(o => o.userId === req.params.userId);
    res.json({ orders: userOrders });
});

// Upload preuve de paiement
app.post('/api/orders/:id/proof', upload.single('proof'), async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = orders[orderId];
        
        if (!order) {
            return res.status(404).json({ error: 'Commande introuvable' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'Aucun fichier uploadé' });
        }
        
        // Mettre à jour la commande
        order.proof = `/uploads/${req.file.filename}`;
        order.status = 'proof_sent';
        saveOrders();
        
        // Construire l'URL complète pour Telegram
        const proofUrl = `${req.protocol}://${req.get('host')}${order.proof}`;
        
        // Envoyer la preuve à l'admin
        await sendTelegramPhoto(
            ADMIN_CHAT_ID,
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
        
        res.json({ success: true, proof: order.proof });
        
    } catch (error) {
        console.error('Erreur upload preuve:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Upload preuve en base64
app.post('/api/orders/:id/proof-base64', async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = orders[orderId];
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
        
        // Mettre à jour la commande
        order.proof = `/uploads/${filename}`;
        order.status = 'proof_sent';
        saveOrders();
        
        // Envoyer notification
        const proofUrl = `${req.protocol}://${req.get('host')}${order.proof}`;
        
        await sendTelegramPhoto(
            ADMIN_CHAT_ID,
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
        
        res.json({ success: true, proof: order.proof });
        
    } catch (error) {
        console.error('Erreur upload preuve base64:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Admin: Valider une commande
app.post('/api/admin/orders/:id/validate', async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = orders[orderId];
        
        if (!order) {
            return res.status(404).json({ error: 'Commande introuvable' });
        }
        
        // Mettre à jour le statut
        order.status = 'validated';
        order.validatedAt = new Date().toISOString();
        
        // Déplacer vers les commandes validées
        validatedOrders.push({...order});
        delete orders[orderId];
        saveOrders();
        
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
        const order = orders[orderId];
        const { reason } = req.body;
        
        if (!order) {
            return res.status(404).json({ error: 'Commande introuvable' });
        }
        
        order.status = 'rejected';
        order.rejectedAt = new Date().toISOString();
        order.rejectReason = reason || 'Non spécifié';
        saveOrders();
        
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
app.get('/api/admin/orders', (req, res) => {
    const { status } = req.query;
    
    let result = Object.values(orders);
    
    if (status === 'validated') {
        result = validatedOrders;
    } else if (status) {
        result = result.filter(o => o.status === status);
    }
    
    res.json({ orders: result });
});

// Stats
app.get('/api/admin/stats', (req, res) => {
    const pending = Object.values(orders).filter(o => o.status === 'pending' || o.status === 'proof_sent').length;
    const validated = validatedOrders.length;
    const totalAmount = validatedOrders.reduce((sum, o) => sum + (o.amountTotal || 0), 0);
    
    res.json({
        pending,
        validated,
        totalAmount,
        totalOrders: pending + validated
    });
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
                // Simuler la validation
                const order = orders[orderId];
                if (order) {
                    order.status = 'validated';
                    validatedOrders.push({...order});
                    delete orders[orderId];
                    saveOrders();
                    
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
                const order = orders[orderId];
                if (order) {
                    order.status = 'rejected';
                    saveOrders();
                    
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
