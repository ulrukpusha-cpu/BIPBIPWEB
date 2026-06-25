#!/usr/bin/env python3
"""Permet a un utilisateur de supprimer SON propre article market."""
import sys
PATH = '/root/var/www/BIPBIPWEB/server.js'
ANCHOR = "// ADMIN : lister les articles en attente"
PATCH = '''// Supprimer MON article (par le proprietaire)
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

'''
with open(PATH,'r',encoding='utf-8') as f: c=f.read()
if "Supprimer MON article" in c:
    print('ALREADY_PATCHED'); sys.exit(0)
i=c.find(ANCHOR)
if i<0: print('ANCHOR_NOT_FOUND'); sys.exit(1)
c=c[:i]+PATCH+c[i:]
with open(PATH,'w',encoding='utf-8') as f: f.write(c)
print('PATCHED_OK')
