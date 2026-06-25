#!/bin/bash
grep -nE "/api/quests|/api/admin/quests|admin.*quest|saveAdminQuest|addQuestFromAdmin" /root/var/www/BIPBIPWEB/server.js | head -10
echo "---app.js---"
grep -nE "addQuestFromAdmin|loadAdminQuests|saveQuest" /root/var/www/BIPBIPWEB/app.js | head -10
