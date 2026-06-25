#!/bin/bash
KEY="UQAuGWDe9CJqctQnKtNc5jd1MTYpIhas8qQLavQL33tU9wxRAsso"
echo "=== 1) readAppConfig contient-il maintenance ? ==="
grep -n "maintenance" /root/var/www/BIPBIPWEB/server.js | grep -i "raw.maintenance\|return.*maintenance"
echo ""
echo "=== 2) Etat actuel disque ==="
python3 -c "import json;d=json.load(open('/root/var/www/BIPBIPWEB/data/app-config.json'));print('disk maintenance =', d.get('maintenance'))"
echo ""
echo "=== 3) Active maintenance via API ==="
curl -s -X PUT https://bipbiprecharge.ci/api/admin/config -H "X-Admin-Key: $KEY" -H "Content-Type: application/json" -d '{"maintenance":{"enabled":true,"message":"DEEP TEST","image":"/uploads/test.png"}}' > /dev/null
sleep 1
echo "-- lecture API immediate --"
curl -s "https://bipbiprecharge.ci/api/config?_=a" | python3 -c "import sys,json;print('  api =', json.load(sys.stdin).get('maintenance'))"
echo "-- lecture disque --"
python3 -c "import json;d=json.load(open('/root/var/www/BIPBIPWEB/data/app-config.json'));print('  disk =', d.get('maintenance'))"
echo ""
echo "=== 4) Simule un redemarrage serveur (restart pm2) puis relit ==="
pm2 restart BIPBIPWEB --update-env > /dev/null
sleep 3
curl -s "https://bipbiprecharge.ci/api/config?_=b" | python3 -c "import sys,json;print('  api apres restart =', json.load(sys.stdin).get('maintenance'))"
