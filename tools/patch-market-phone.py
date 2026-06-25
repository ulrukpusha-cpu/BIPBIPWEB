#!/usr/bin/env python3
"""Expose le telephone vendeur dans la liste publique market (contact acheteur->vendeur)."""
import sys

PATH = '/root/var/www/BIPBIPWEB/server.js'

OLD = """    res.json({ items: items.map(it => ({
        id: it.id, name: it.name, cat: it.cat, desc: it.desc,
        price: it.price, photo: it.photo, sellerName: it.sellerName, createdAt: it.createdAt
    })) });"""

NEW = """    res.json({ items: items.map(it => ({
        id: it.id, name: it.name, cat: it.cat, desc: it.desc,
        price: it.price, photo: it.photo, sellerName: it.sellerName,
        phone: it.phone, createdAt: it.createdAt
    })) });"""

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if "phone: it.phone, createdAt: it.createdAt" in content:
    print('ALREADY_PATCHED')
    sys.exit(0)
if OLD not in content:
    print('PATTERN_NOT_FOUND')
    sys.exit(1)
content = content.replace(OLD, NEW)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
