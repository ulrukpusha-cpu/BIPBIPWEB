#!/usr/bin/env python3
"""Patche /api/admin/verify-pin pour retourner aussi la cle admin."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'
OLD = """app.post('/api/admin/verify-pin', (req, res) => {
    const { pin } = req.body || {};
    if (!pin || String(pin).trim() !== ADMIN_PIN) {
        return res.status(401).json({ ok: false, error: 'Code incorrect' });
    }
    return res.json({ ok: true });
});"""
NEW = """app.post('/api/admin/verify-pin', (req, res) => {
    const { pin } = req.body || {};
    if (!pin || String(pin).trim() !== ADMIN_PIN) {
        return res.status(401).json({ ok: false, error: 'Code incorrect' });
    }
    // PIN OK : retourne aussi la cle admin pour les requetes suivantes
    const adminKey = (process.env.ADMIN_SECRET_KEY || '').trim();
    return res.json({ ok: true, adminKey: adminKey || null });
});"""

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if NEW.split('PIN OK')[0].strip() in content and 'PIN OK : retourne aussi' in content:
    print('ALREADY_PATCHED')
    sys.exit(0)

if OLD not in content:
    print('PATTERN_NOT_FOUND')
    sys.exit(1)

content = content.replace(OLD, NEW)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
