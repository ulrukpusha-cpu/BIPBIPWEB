#!/usr/bin/env python3
"""Ajoute le support 'maintenance' dans PUT /api/admin/config + /api/config."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

OLD = '''    if (body.pubBanners != null) {
        if (!Array.isArray(body.pubBanners)) {
            return res.status(400).json({ error: 'pubBanners doit être un tableau' });
        }
        current.pubBanners = sanitizePubBanners(body.pubBanners);
    }
    if (!writeAppConfig(current)) return res.status(500).json({ error: 'Erreur écriture config' });
    res.json({
        success: true,
        config: {
            ledScrollSeconds: current.ledScrollSeconds,
            pubBanners: current.pubBanners
        }
    });
});'''

NEW = '''    if (body.pubBanners != null) {
        if (!Array.isArray(body.pubBanners)) {
            return res.status(400).json({ error: 'pubBanners doit être un tableau' });
        }
        current.pubBanners = sanitizePubBanners(body.pubBanners);
    }
    if (body.maintenance != null) {
        current.maintenance = {
            enabled: !!body.maintenance.enabled,
            message: String(body.maintenance.message || '').slice(0, 300),
            updatedAt: Date.now()
        };
    }
    if (!writeAppConfig(current)) return res.status(500).json({ error: 'Erreur écriture config' });
    res.json({
        success: true,
        config: {
            ledScrollSeconds: current.ledScrollSeconds,
            pubBanners: current.pubBanners,
            maintenance: current.maintenance || { enabled: false }
        }
    });
});'''

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

CONFIG_OLD = '''        googleClientId: GOOGLE_CLIENT_ID || null
    });
});'''
CONFIG_NEW = '''        googleClientId: GOOGLE_CLIENT_ID || null,
        maintenance: appConfig.maintenance || { enabled: false }
    });
});'''

if 'maintenance: appConfig.maintenance' in content:
    print('ALREADY_PATCHED')
    sys.exit(0)

ok = True
if OLD in content:
    content = content.replace(OLD, NEW)
else:
    print('PUT_PATTERN_NOT_FOUND', file=sys.stderr)
    ok = False

if CONFIG_OLD in content:
    content = content.replace(CONFIG_OLD, CONFIG_NEW)
else:
    print('CONFIG_PATTERN_NOT_FOUND', file=sys.stderr)
    ok = False

if not ok:
    sys.exit(1)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
