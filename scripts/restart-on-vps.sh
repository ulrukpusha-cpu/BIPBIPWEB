#!/bin/bash
# À lancer sur le VPS depuis le dossier du projet BIPBIPWEB
set -e
cd "$(dirname "$0")/.."
echo "Dossier: $(pwd)"
echo "Installation des dépendances (au cas où)..."
npm install --production 2>/dev/null || true
echo "Redémarrage de l'app..."
pm2 restart BIPBIPWEB 2>/dev/null || pm2 restart bipbip 2>/dev/null || pm2 restart all
echo "OK. Vérifier: pm2 logs BIPBIPWEB"
