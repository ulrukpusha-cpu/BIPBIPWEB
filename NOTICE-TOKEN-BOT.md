# Bouton « Valider » ne répond pas ?

Pour que le bouton **Valider** (et **Rejeter**) sous la preuve commande fonctionne sur Telegram, **la webapp et le bot Python doivent utiliser exactement le même token Telegram**.

## À faire sur le VPS

1. **Webapp** (`/root/var/www/BIPBIPWEB/.env`) :
   ```env
   TELEGRAM_BOT_TOKEN=le_même_token
   ADMIN_CHAT_ID=6735995998
   ```

2. **Bot** (`/root/bot/.env`) :
   ```env
   TELEGRAM_BOT_TOKEN=le_même_token
   ADMIN_CHAT_ID=6735995998
   WEBAPP_URL=http://127.0.0.1:3000
   ```

3. Redémarrer les deux :
   ```bash
   pm2 restart BIPBIPWEB
   pm2 restart bipbip-bot
   ```

Si les tokens sont différents, le message « Preuve commande » est envoyé par un bot (token A) et le clic sur Valider est envoyé à ce même bot. Seul le processus qui tourne avec **ce** token (A) reçoit le clic. Donc le bot Python doit tourner avec le **même** token que la webapp.
