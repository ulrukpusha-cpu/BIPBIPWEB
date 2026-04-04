#!/usr/bin/env node
/**
 * Supprime le webhook du bot principal (TELEGRAM_BOT_TOKEN) pour passer en polling (ex. bot.py).
 * Usage : node scripts/telegram-delete-webhook.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!token) {
    console.error('ERREUR: TELEGRAM_BOT_TOKEN absent dans .env');
    process.exit(1);
}

async function main() {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_pending_updates: true }),
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    process.exit(data.ok ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
