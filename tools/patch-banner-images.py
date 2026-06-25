#!/usr/bin/env python3
"""Permet aux bannières pub de stocker un tableau 'images' (carrousel stick 6s)."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

OLD = """        const row = { text, image, placement, scrollSpeed };
        if (url && (/^https?:\\/\\//i.test(url) || url.startsWith('/'))) row.url = url;
        byPlace.set(placement, row);"""

NEW = """        const row = { text, image, placement, scrollSpeed };
        // Carrousel : tableau d'images (chacune valide http(s) ou /uploads)
        if (Array.isArray(x.images)) {
            const imgs = x.images
                .map(s => String(s || '').trim().slice(0, 512))
                .filter(s => s && (/^https?:\\/\\//i.test(s) || s.startsWith('/')))
                .slice(0, 8);
            if (imgs.length) row.images = imgs;
        }
        if (url && (/^https?:\\/\\//i.test(url) || url.startsWith('/'))) row.url = url;
        byPlace.set(placement, row);"""

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if "row.images = imgs" in content:
    print('ALREADY_PATCHED')
    sys.exit(0)
if OLD not in content:
    print('PATTERN_NOT_FOUND')
    sys.exit(1)
content = content.replace(OLD, NEW)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
