#!/bin/bash
echo "--- routes TON dans server.js ---"
grep -nE "app\.(get|post)\('/api/(ton|crypto)" /root/var/www/BIPBIPWEB/server.js | head -10
echo "--- usdPerTon / fcfaPerUsdt dans config ---"
grep -nE "usdPerTon|fcfaPerUsdt|tonRate|TON.*Cache" /root/var/www/BIPBIPWEB/server.js | head -15
echo "--- contenu ton-rate.json ---"
cat /root/var/www/BIPBIPWEB/data/ton-rate.json 2>/dev/null
