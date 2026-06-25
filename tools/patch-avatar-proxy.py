#!/usr/bin/env python3
"""Ajoute un proxy d'avatar Google : /api/avatar?u=<lh3 url> (affichage fiable dans le WebView APK)."""
import sys
PATH = '/root/var/www/BIPBIPWEB/server.js'
ANCHOR = "app.get('/api/config', (req, res) => {"
PATCH = '''// Proxy d'avatar Google (lh3.googleusercontent.com) — necessaire car le WebView Android
// charge mal ces images cross-origin. On ne proxy QUE googleusercontent.com (anti-SSRF).
app.get('/api/avatar', async (req, res) => {
    try {
        const raw = String(req.query.u || '').trim();
        if (!raw) return res.status(400).end();
        let u;
        try { u = new URL(raw); } catch (e) { return res.status(400).end(); }
        if (u.protocol !== 'https:' || !/(^|\\.)googleusercontent\\.com$/i.test(u.hostname)) {
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

'''
with open(PATH, 'r', encoding='utf-8') as f:
    c = f.read()
if "app.get('/api/avatar'" in c:
    print('ALREADY'); sys.exit(0)
i = c.find(ANCHOR)
if i < 0:
    print('ANCHOR_NOT_FOUND'); sys.exit(1)
c = c[:i] + PATCH + c[i:]
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(c)
print('PATCHED_OK')
