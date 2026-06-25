#!/usr/bin/env python3
"""Ajoute X-User-Id et X-Session-Token à la whitelist CORS Capacitor."""
import sys

PATH = '/root/var/www/BIPBIPWEB/middleware/cors-capacitor.js'

OLD = """    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Telegram-Init-Data',
      'X-Capacitor-Platform',
      'X-Admin-Key',
      'Accept',
      'Origin'
    ],"""

NEW = """    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Telegram-Init-Data',
      'X-Capacitor-Platform',
      'X-Admin-Key',
      'X-User-Id',
      'X-Session-Token',
      'X-Telegram-Login-Session',
      'X-Bot-Secret',
      'Accept',
      'Origin'
    ],"""

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if "'X-User-Id'" in content and "'X-Session-Token'" in content:
    print('ALREADY_PATCHED')
    sys.exit(0)
if OLD not in content:
    print('PATTERN_NOT_FOUND')
    sys.exit(1)
content = content.replace(OLD, NEW)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
