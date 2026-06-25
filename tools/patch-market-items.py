#!/usr/bin/env python3
"""Ajoute les endpoints Market items (user-generated, modération admin)."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

# Bloc de routes inséré avant la création de commande
PATCH = '''
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
                '\\uD83D\\uDED2 <b>NOUVEL ARTICLE MARKET</b>\\n\\n' +
                '\\uD83D\\uDCE6 ' + item.name + '\\n' +
                '\\uD83D\\uDCB0 ' + item.price + ' FCFA\\n' +
                '\\uD83D\\uDCC2 ' + item.cat + '\\n' +
                '\\uD83D\\uDC64 ' + (item.sellerName || item.sellerId) + '\\n' +
                '\\u23F3 En attente de validation',
                {}, notifToken
            );
        }
    } catch (e) {}
    res.json({ ok: true, item: { id: item.id, status: item.status } });
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
        price: it.price, photo: it.photo, sellerName: it.sellerName, createdAt: it.createdAt
    })) });
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

'''

ANCHOR = "// Créer une commande (rate limit paiement"

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if "/api/admin/market/items" in content:
    print('ALREADY_PATCHED')
    sys.exit(0)

idx = content.find(ANCHOR)
if idx < 0:
    print('ANCHOR_NOT_FOUND')
    sys.exit(1)

content = content[:idx] + PATCH + '\n' + content[idx:]
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
