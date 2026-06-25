#!/bin/bash
F=$(grep -rl "createAnnonce" /root/var/www/BIPBIPWEB/services/ 2>/dev/null | head -1)
echo "File: $F"
echo "---"
grep -n "createAnnonce" "$F"
echo "--- body of createAnnonce (40 lines after) ---"
awk '/createAnnonce/{f=1} f{print; n++} n>40{exit}' "$F"
