#!/bin/bash
echo "--- /api/momo routes ---"
grep -nE "/api/momo" /root/var/www/BIPBIPWEB/server.js | head -5
echo "--- routes/momo.js ---"
grep -nE "router\.(get|post)" /root/var/www/BIPBIPWEB/routes/momo.js 2>/dev/null | head -10
echo "--- /api/orders/:id/proof-base64 ---"
grep -n "proof-base64" /root/var/www/BIPBIPWEB/server.js | head -3
