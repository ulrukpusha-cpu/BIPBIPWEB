#!/bin/bash
echo "=== fichiers contenant setOrderValidated ou validate ==="
grep -rln "setOrderValidated\|validate-by-telegram\|valider_commande\|valid_order" /root/var/www/BIPBIPWEB --include=*.js 2>/dev/null | grep -v node_modules
echo ""
echo "=== bridge pm2 ==="
pm2 info bipbip-bridge 2>/dev/null | grep -E "script path|exec cwd"
echo ""
echo "=== callback handlers dans server.js (boutons inline admin) ==="
grep -n "callback_query\|validate-by-telegram\|order.*valid\|Valider" /root/var/www/BIPBIPWEB/server.js | head -15
