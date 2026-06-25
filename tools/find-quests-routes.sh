#!/bin/bash
ls /root/var/www/BIPBIPWEB/routes/ 2>/dev/null
echo "---"
grep -nE "router\.(get|post|put|delete)" /root/var/www/BIPBIPWEB/routes/quests.js 2>/dev/null | head -30
