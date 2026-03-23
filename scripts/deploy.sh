#!/bin/bash
# Deploiement BIPBIPWEB - a executer sur le VPS
# Usage: bash scripts/deploy.sh

set -e
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
echo "Dossier projet: $PROJECT_DIR"

if [ -d ".git" ]; then
    echo "Mise a jour depuis Git..."
    git pull --rebase 2>/dev/null || true
else
    echo "Pas de depot Git - fichiers deja a jour."
fi

echo "Installation des dependances..."
npm install --production 2>/dev/null || npm install 2>/dev/null || true

echo "Redemarrage PM2..."
if pm2 describe BIPBIPWEB &>/dev/null; then
    pm2 restart BIPBIPWEB
    echo "BIPBIPWEB redemarre."
elif pm2 describe bipbip &>/dev/null; then
    pm2 restart bipbip
    echo "bipbip redemarre."
else
    pm2 restart all
    echo "Tous les processus PM2 redemarres."
fi

echo "Deploiement termine. Logs: pm2 logs BIPBIPWEB"
