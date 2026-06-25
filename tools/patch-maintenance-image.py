#!/usr/bin/env python3
"""Ajoute le champ 'image' au mode maintenance (config)."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

OLD = """    if (body.maintenance != null) {
        current.maintenance = {
            enabled: !!body.maintenance.enabled,
            message: String(body.maintenance.message || '').slice(0, 300),
            updatedAt: Date.now()
        };
    }"""

NEW = """    if (body.maintenance != null) {
        current.maintenance = {
            enabled: !!body.maintenance.enabled,
            message: String(body.maintenance.message || '').slice(0, 300),
            image: String(body.maintenance.image || '').slice(0, 512),
            updatedAt: Date.now()
        };
    }"""

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if "image: String(body.maintenance.image" in content:
    print('ALREADY_PATCHED')
    sys.exit(0)
if OLD not in content:
    print('PATTERN_NOT_FOUND')
    sys.exit(1)
content = content.replace(OLD, NEW)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
