#!/usr/bin/env python3
"""readAppConfig() doit preserver le champ maintenance (sinon perdu a chaque lecture/PUT)."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

OLD = """            const giftCards = Array.isArray(raw.giftCards) ? raw.giftCards : [];
            return { ledScrollSeconds: led, pubBanners, giftCards };"""

NEW = """            const giftCards = Array.isArray(raw.giftCards) ? raw.giftCards : [];
            const maintenance = (raw.maintenance && typeof raw.maintenance === 'object')
                ? raw.maintenance
                : { enabled: false };
            return { ledScrollSeconds: led, pubBanners, giftCards, maintenance };"""

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if "const maintenance = (raw.maintenance" in content:
    print('ALREADY_PATCHED')
    sys.exit(0)
if OLD not in content:
    print('PATTERN_NOT_FOUND')
    sys.exit(1)
content = content.replace(OLD, NEW)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
