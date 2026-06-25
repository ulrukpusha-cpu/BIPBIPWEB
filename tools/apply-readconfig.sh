#!/bin/bash
python3 /tmp/patch-readconfig-maintenance.py
pm2 restart BIPBIPWEB --update-env > /dev/null
sleep 2
echo "--- relecture /api/config maintenance apres restart serveur ---"
curl -s https://bipbiprecharge.ci/api/config | python3 -c "import sys,json; print('maintenance =', json.load(sys.stdin).get('maintenance'))"
