#!/bin/bash
grep -nE "router\.(get|post|put)" /root/var/www/BIPBIPWEB/routes/actualites.js | head -20
echo "--- champs select (contenu/source) ---"
grep -nE "select|content|source|article|summary_long|body" /root/var/www/BIPBIPWEB/routes/actualites.js | head -20
