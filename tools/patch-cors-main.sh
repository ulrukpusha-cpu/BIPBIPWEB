#!/bin/bash
OLD="const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Telegram-Init-Data'];"
NEW="const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Telegram-Init-Data', 'X-User-Id', 'X-Session-Token', 'X-Telegram-Login-Session', 'X-Capacitor-Platform', 'X-Bot-Secret', 'Accept', 'Origin', 'X-Requested-With'];"

if grep -q "X-User-Id" /root/var/www/BIPBIPWEB/server.js; then
  echo "ALREADY_PATCHED"
  exit 0
fi
python3 -c "
with open('/root/var/www/BIPBIPWEB/server.js', 'r', encoding='utf-8') as f: s = f.read()
old = \"$OLD\"
new = \"$NEW\"
if old in s:
    s = s.replace(old, new)
    with open('/root/var/www/BIPBIPWEB/server.js', 'w', encoding='utf-8') as f: f.write(s)
    print('PATCHED_OK')
else:
    print('PATTERN_NOT_FOUND')
"
pm2 restart BIPBIPWEB --update-env > /dev/null
sleep 2
echo "--- pre-flight test ---"
curl -s -I -X OPTIONS https://bipbiprecharge.ci/api/orders \
  -H "Origin: https://localhost" \
  -H "Access-Control-Request-Headers: x-user-id,x-session-token,content-type" \
  -H "Access-Control-Request-Method: POST" \
  | grep -i "access-control"
