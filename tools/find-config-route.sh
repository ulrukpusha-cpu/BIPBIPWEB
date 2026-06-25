#!/bin/bash
grep -nE "googleClientId|/api/config" /root/var/www/BIPBIPWEB/server.js | head -15
