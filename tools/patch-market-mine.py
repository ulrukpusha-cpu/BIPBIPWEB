#!/usr/bin/env python3
"""Ajoute GET /api/market/items/mine (articles d'un utilisateur, tous statuts)."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

ANCHOR = "// ADMIN : lister les articles en attente"

PATCH = '''// Lister MES articles (tous statuts) par userId
app.get('/api/market/items/mine', (req, res) => {
    const uid = String(req.query.userId || req.headers['x-user-id'] || '').trim();
    if (!uid) return res.json({ items: [] });
    const items = readMarketItems().filter(it => String(it.sellerId) === uid);
    res.json({ items: items.map(it => ({
        id: it.id, name: it.name, cat: it.cat, desc: it.desc, price: it.price,
        photo: it.photo, status: it.status, createdAt: it.createdAt
    })) });
});

'''

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if "/api/market/items/mine" in content:
    print('ALREADY_PATCHED')
    sys.exit(0)
idx = content.find(ANCHOR)
if idx < 0:
    print('ANCHOR_NOT_FOUND')
    sys.exit(1)
content = content[:idx] + PATCH + content[idx:]
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
