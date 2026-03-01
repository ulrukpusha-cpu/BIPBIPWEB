#!/bin/bash
# ============================================================
# Script à lancer UNE FOIS sur le VPS (dans le dossier BIPBIPWEB)
# Usage: cd /root/var/www/BIPBIPWEB && bash scripts/vps-setup-actualites.sh
# ============================================================

set -e
cd "$(dirname "$0")/.."
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
    echo ">>> Fichier .env absent. Crée-le d'abord avec tes clés (SUPABASE, etc.), puis relance ce script."
    exit 1
fi

echo ">>> Backup .env..."
cp -a "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true

echo ">>> Ajout des variables actualités dans .env (si absentes)..."

if ! grep -q "^RSS_FEED_URLS=" "$ENV_FILE" 2>/dev/null; then
    echo "" >> "$ENV_FILE"
    echo "# Flux RSS actualités (max 6) - lu par cron/fetchNewsRss.js" >> "$ENV_FILE"
    echo "RSS_FEED_URLS=https://www.rfi.fr/fr/rss,https://www.rfi.fr/fr/afrique/rss,https://www.fratmat.info/feed/,https://feeds.bbci.co.uk/french/rss.xml,https://www.lemonde.fr/afrique/rss_full.xml,https://www.jeuneafrique.com/feed/" >> "$ENV_FILE"
    echo "    RSS_FEED_URLS ajouté."
else
    echo "    RSS_FEED_URLS déjà présent."
fi

if ! grep -q "^INGEST_SECRET_KEY=" "$ENV_FILE" 2>/dev/null; then
    if grep -q "^ADMIN_SECRET_KEY=" "$ENV_FILE" 2>/dev/null; then
        echo "    INGEST_SECRET_KEY non défini : la route /api/actualites/ingest utilisera ADMIN_SECRET_KEY (OK)."
    else
        echo "" >> "$ENV_FILE"
        echo "# Clé pour envoyer des actualités (OpenClaw, API) - header X-Ingest-Key" >> "$ENV_FILE"
        echo "INGEST_SECRET_KEY=$(openssl rand -hex 24)" >> "$ENV_FILE"
        echo "    INGEST_SECRET_KEY généré et ajouté."
    fi
else
    echo "    INGEST_SECRET_KEY déjà présent."
fi

echo ">>> Vérification des dépendances..."
npm install --production 2>/dev/null || npm install 2>/dev/null || true

echo ">>> Test du script RSS (1 run)..."
node cron/fetchNewsRss.js 2>/dev/null && echo "    OK." || echo "    (Erreur possible si Supabase en pause ou pas de flux - à vérifier plus tard.)"

echo ""
echo "=============================================="
echo "  CONFIG ACTUALITÉS TERMINÉE."
echo "=============================================="
echo ""
echo "Pour lancer le RSS automatiquement toutes les heures, exécute:"
echo "  crontab -e"
echo "Puis ajoute cette ligne (sauvegarde: Esc puis :wq):"
echo "  0 * * * * cd /root/var/www/BIPBIPWEB && node cron/fetchNewsRss.js >> /var/log/bipbip-rss.log 2>&1"
echo ""
echo "Redémarre l'app si elle tourne: pm2 restart BIPBIPWEB  (ou le nom de ton process)"
echo ""
