#!/usr/bin/env python3
"""Expose tonUsd (depuis _tonRateCache) dans GET /api/config."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

OLD = '''        googleClientId: GOOGLE_CLIENT_ID || null,
        maintenance: appConfig.maintenance || { enabled: false }
    });
});'''

NEW = '''        googleClientId: GOOGLE_CLIENT_ID || null,
        maintenance: appConfig.maintenance || { enabled: false },
        tonUsd: (_tonRateCache && _tonRateCache.usd) || null
    });
});'''

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if "tonUsd: (_tonRateCache" in content:
    print('ALREADY_PATCHED')
    sys.exit(0)
if OLD not in content:
    print('PATTERN_NOT_FOUND')
    sys.exit(1)

content = content.replace(OLD, NEW)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
