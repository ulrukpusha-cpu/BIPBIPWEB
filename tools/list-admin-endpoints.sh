#!/bin/bash
grep -nE "app\.(get|post|put|delete)\('/api/admin" /root/var/www/BIPBIPWEB/server.js
echo "---"
grep -nE "app\.(get|post|put|delete)\('/api/(gift-cards|quests|orders|annonces|led)" /root/var/www/BIPBIPWEB/server.js | head -30
