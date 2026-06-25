#!/bin/bash
echo "--- routes annonces ---"
grep -nE "router\.(get|post|put)|res.json|res.status" /root/var/www/BIPBIPWEB/routes/annonces.js 2>/dev/null | head -40
