#!/bin/bash
echo "=== Logs PUT /api/admin/config recents (avec corps si loggé) ==="
pm2 logs BIPBIPWEB --lines 200 --nostream 2>/dev/null | grep -iE "admin/config|maintenance|PUT" | tail -30
echo ""
echo "=== Le endpoint PUT /api/admin/config logge-t-il quelque chose ? ==="
sed -n '1037,1078p' /root/var/www/BIPBIPWEB/server.js | grep -n "maintenance\|console\|body"
