#!/bin/bash
python3 /tmp/patch-ton-rate-config.py
pm2 restart BIPBIPWEB --update-env > /dev/null
sleep 2
echo "--- /api/config tonUsd ---"
curl -s https://bipbiprecharge.ci/api/config | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('tonUsd:', d.get('tonUsd'))
print('cryptoFcfaPerUsdt:', d.get('cryptoFcfaPerUsdt'))
"
