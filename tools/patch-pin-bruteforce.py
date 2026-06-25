#!/usr/bin/env python3
"""Protege /api/admin/verify-pin contre le brute-force (5 essais / 15 min par IP puis lockout)."""
import sys
PATH = '/root/var/www/BIPBIPWEB/server.js'
OLD = """app.post('/api/admin/verify-pin', (req, res) => {
    const { pin } = req.body || {};
    if (!pin || String(pin).trim() !== ADMIN_PIN) {
        return res.status(401).json({ ok: false, error: 'Code incorrect' });
    }
    // PIN OK : retourne aussi la cle admin pour les requetes suivantes
    const adminKey = (process.env.ADMIN_SECRET_KEY || '').trim();
    return res.json({ ok: true, adminKey: adminKey || null });
});"""

NEW = """// Anti-brute-force du PIN admin : 5 tentatives / 15 min par IP, puis lockout
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
});"""

with open(PATH, 'r', encoding='utf-8') as f:
    c = f.read()
if '_pinAttempts' in c:
    print('ALREADY'); sys.exit(0)
if OLD not in c:
    print('OLD_NOT_FOUND'); sys.exit(1)
c = c.replace(OLD, NEW)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(c)
print('PATCHED_OK')
