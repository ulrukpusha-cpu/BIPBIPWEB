#!/bin/bash
echo "=== readAppConfig / writeAppConfig ==="
grep -nE "function readAppConfig|function writeAppConfig|maintenance" /root/var/www/BIPBIPWEB/server.js | head -30
echo ""
echo "=== contenu disque data/app-config.json (champ maintenance) ==="
python3 -c "import json; d=json.load(open('/root/var/www/BIPBIPWEB/data/app-config.json')); print('maintenance =', d.get('maintenance'))"
