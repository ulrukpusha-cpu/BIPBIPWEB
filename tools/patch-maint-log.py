#!/usr/bin/env python3
"""Ajoute un log quand maintenance.enabled change (pour tracer qui desactive)."""
import sys
PATH = '/root/var/www/BIPBIPWEB/server.js'
OLD = """    if (body.maintenance != null) {
        current.maintenance = {
            enabled: !!body.maintenance.enabled,
            message: String(body.maintenance.message || '').slice(0, 300),
            image: String(body.maintenance.image || '').slice(0, 512),
            updatedAt: Date.now()
        };
    }"""
NEW = """    if (body.maintenance != null) {
        const wasEnabled = current.maintenance && current.maintenance.enabled;
        current.maintenance = {
            enabled: !!body.maintenance.enabled,
            message: String(body.maintenance.message || '').slice(0, 300),
            image: String(body.maintenance.image || '').slice(0, 512),
            updatedAt: Date.now()
        };
        console.log('[MAINT] PUT maintenance.enabled=' + current.maintenance.enabled +
            ' (was ' + wasEnabled + ') ua=' + (req.headers['user-agent'] || '?').slice(0,40) +
            ' xff=' + (req.headers['x-forwarded-for'] || req.ip || '?'));
    }"""
with open(PATH,'r',encoding='utf-8') as f: c=f.read()
if "[MAINT] PUT maintenance" in c:
    print('ALREADY_PATCHED'); sys.exit(0)
if OLD not in c:
    print('PATTERN_NOT_FOUND'); sys.exit(1)
c=c.replace(OLD,NEW)
with open(PATH,'w',encoding='utf-8') as f: f.write(c)
print('PATCHED_OK')
