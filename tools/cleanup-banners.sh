#!/bin/bash
KEY="UQAuGWDe9CJqctQnKtNc5jd1MTYpIhas8qQLavQL33tU9wxRAsso"
# Recupere la config actuelle pour reutiliser les images
CFG=$(curl -s https://bipbiprecharge.ci/api/config)
H1_IMG=$(echo "$CFG" | python3 -c "import sys,json;d=json.load(sys.stdin);b=[x for x in d['pubBanners'] if x['placement']=='home1'];print(b[0]['image'] if b else '')")
ACTU_IMG=$(echo "$CFG" | python3 -c "import sys,json;d=json.load(sys.stdin);b=[x for x in d['pubBanners'] if x['placement']=='actualites'];print(b[0]['image'] if b else '')")
ACTU_TXT=$(echo "$CFG" | python3 -c "import sys,json;d=json.load(sys.stdin);b=[x for x in d['pubBanners'] if x['placement']=='actualites'];print(b[0].get('text','') if b else '')")
ACTU_URL=$(echo "$CFG" | python3 -c "import sys,json;d=json.load(sys.stdin);b=[x for x in d['pubBanners'] if x['placement']=='actualites'];print(b[0].get('url','') if b else '')")

# Nouveau set : market (depuis home1) + actualites
BODY=$(python3 <<EOF
import json
banners = [
    {"placement": "market", "image": "$H1_IMG", "text": "", "scrollSpeed": 5, "url": ""},
    {"placement": "actualites", "image": "$ACTU_IMG", "text": "$ACTU_TXT", "scrollSpeed": 5, "url": "$ACTU_URL"}
]
print(json.dumps({"pubBanners": banners}))
EOF
)
echo "Body: $BODY"
curl -s -X PUT https://bipbiprecharge.ci/api/admin/config \
  -H "X-Admin-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY" | head -200
