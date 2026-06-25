#!/usr/bin/env python3
"""Ajoute themeForce a la config serveur : persistance + GET /api/config + PUT admin."""
import sys
PATH = '/root/var/www/BIPBIPWEB/server.js'
with open(PATH, 'r', encoding='utf-8') as f:
    c = f.read()

if 'themeForce' in c:
    print('ALREADY_PATCHED'); sys.exit(0)

# 1) readAppConfig : ajoute themeForce au parse + return
OLD1 = """            const maintenance = (raw.maintenance && typeof raw.maintenance === 'object')
                ? raw.maintenance
                : { enabled: false };
            return { ledScrollSeconds: led, pubBanners, giftCards, maintenance };"""
NEW1 = """            const maintenance = (raw.maintenance && typeof raw.maintenance === 'object')
                ? raw.maintenance
                : { enabled: false };
            const themeForce = (typeof raw.themeForce === 'string') ? raw.themeForce : '';
            return { ledScrollSeconds: led, pubBanners, giftCards, maintenance, themeForce };"""
if OLD1 not in c:
    print('OLD1_NOT_FOUND'); sys.exit(1)
c = c.replace(OLD1, NEW1)

# 2) GET /api/config : expose themeForce
OLD2 = """        maintenance: appConfig.maintenance || { enabled: false },
        tonUsd: (_tonRateCache && _tonRateCache.usd) || null"""
NEW2 = """        maintenance: appConfig.maintenance || { enabled: false },
        themeForce: appConfig.themeForce || '',
        tonUsd: (_tonRateCache && _tonRateCache.usd) || null"""
if OLD2 not in c:
    print('OLD2_NOT_FOUND'); sys.exit(1)
c = c.replace(OLD2, NEW2)

# 3) PUT admin : accepte themeForce
OLD3 = """    if (!writeAppConfig(current)) return res.status(500).json({ error: 'Erreur écriture config' });
    res.json({
        success: true,
        config: {
            ledScrollSeconds: current.ledScrollSeconds,
            pubBanners: current.pubBanners,
            maintenance: current.maintenance || { enabled: false }
        }
    });
});"""
NEW3 = """    if (body.themeForce != null) {
        current.themeForce = String(body.themeForce || '').slice(0, 40);
        console.log('[THEME] PUT themeForce=' + (current.themeForce || '(auto)'));
    }
    if (!writeAppConfig(current)) return res.status(500).json({ error: 'Erreur écriture config' });
    res.json({
        success: true,
        config: {
            ledScrollSeconds: current.ledScrollSeconds,
            pubBanners: current.pubBanners,
            maintenance: current.maintenance || { enabled: false },
            themeForce: current.themeForce || ''
        }
    });
});"""
if OLD3 not in c:
    print('OLD3_NOT_FOUND'); sys.exit(1)
c = c.replace(OLD3, NEW3)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(c)
print('PATCHED_OK')
