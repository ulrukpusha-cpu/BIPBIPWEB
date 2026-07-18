#!/bin/bash
# =========================================================
# Patch server.js pour ajouter le middleware CORS Capacitor.
# Insère 4 lignes APRÈS la ligne `app.use(cors(corsOptions));`
# Idempotent : ne fait rien si déjà appliqué.
# =========================================================
set -e

FILE="server.js"
ANCHOR="app.use(cors(corsOptions));"

cd "$(dirname "$0")/.."  # remonte à /root/var/www/BIPBIPWEB depuis middleware/

if [ ! -f "$FILE" ]; then
  echo "ERR: $FILE introuvable dans $(pwd)"
  exit 1
fi

# Idempotence
if grep -q "cors-capacitor" "$FILE"; then
  echo "OK déjà patché — rien à faire"
  exit 0
fi

# Backup horodaté
BAK="$FILE.bak.$(date +%Y%m%d_%H%M%S)"
cp "$FILE" "$BAK"
echo "Backup: $BAK"

# Vérifier l'anchor
if ! grep -qxF "$ANCHOR" "$FILE"; then
  echo "ERR: anchor '$ANCHOR' introuvable dans $FILE"
  exit 1
fi

# Insertion via awk (gère parfaitement les retours à la ligne)
TMP=$(mktemp)
awk -v anchor="$ANCHOR" '
{
  print
  if ($0 == anchor) {
    print ""
    print "// Surcharge CORS pour APK Capacitor (https://localhost Android, capacitor://localhost iOS)"
    print "// N'\''altère pas la config web existante — ajoute juste les origines mobiles"
    print "app.use(require('\''./middleware/cors-capacitor'\'')());"
  }
}
' "$FILE" > "$TMP"

mv "$TMP" "$FILE"

# Vérification
if ! grep -q "cors-capacitor" "$FILE"; then
  echo "ERR: insertion a échoué, restoration depuis $BAK"
  cp "$BAK" "$FILE"
  exit 1
fi

echo "--- Lignes autour du patch ---"
grep -n -B0 -A4 "$ANCHOR" "$FILE" | head -8

# Test syntaxe Node
echo "--- Syntax check ---"
if node -c "$FILE"; then
  echo "SYNTAX OK"
else
  echo "SYNTAX FAILED - restoration"
  cp "$BAK" "$FILE"
  exit 1
fi

echo ""
echo "Patch applique. Prochaine etape: pm2 restart BIPBIPWEB"
