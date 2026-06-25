#!/bin/bash
grep -nE "sanitizePubBanners|PUB_PLACEMENTS|placement.*home" /root/var/www/BIPBIPWEB/server.js | head -10
