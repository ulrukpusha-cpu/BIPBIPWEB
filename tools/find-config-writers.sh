#!/bin/bash
echo "=== Tous les appels writeAppConfig dans server.js ==="
grep -n "writeAppConfig" /root/var/www/BIPBIPWEB/server.js
echo ""
echo "=== Autres fichiers qui ecrivent app-config.json ==="
grep -rln "app-config.json\|writeAppConfig\|APP_CONFIG" /root/var/www/BIPBIPWEB --include=*.js 2>/dev/null | grep -v node_modules
echo ""
echo "=== Test persistance directe ==="
KEY="UQAuGWDe9CJqctQnKtNc5jd1MTYpIhas8qQLavQL33tU9wxRAsso"
echo "-- 1) Active maintenance --"
curl -s -X PUT https://bipbiprecharge.ci/api/admin/config -H "X-Admin-Key: $KEY" -H "Content-Type: application/json" -d '{"maintenance":{"enabled":true,"message":"test","image":"/uploads/x.png"}}' > /dev/null
echo "-- 2) Relecture immediate --"
curl -s "https://bipbiprecharge.ci/api/config?_=1" | python3 -c "import sys,json;print('enabled =', json.load(sys.stdin).get('maintenance',{}).get('enabled'))"
echo "-- 3) Sauve LED speed (autre action admin) --"
curl -s -X PUT https://bipbiprecharge.ci/api/admin/config -H "X-Admin-Key: $KEY" -H "Content-Type: application/json" -d '{"ledScrollSeconds":120}' > /dev/null
echo "-- 4) Relecture apres action LED --"
curl -s "https://bipbiprecharge.ci/api/config?_=2" | python3 -c "import sys,json;print('enabled =', json.load(sys.stdin).get('maintenance',{}).get('enabled'))"
