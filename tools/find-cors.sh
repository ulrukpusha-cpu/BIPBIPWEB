#!/bin/bash
grep -nE "cors\(|allowedHeaders|Access-Control-Allow-Headers|setHeader.*Access-Control" /root/var/www/BIPBIPWEB/server.js | head -20
