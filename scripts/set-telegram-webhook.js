#!/usr/bin/env node
/**
 * Enregistre les webhooks Telegram (bot principal + bot admin Supabase).
 * Usage: node scripts/set-telegram-webhook.js
 * .env: TELEGRAM_BOT_TOKEN (obligatoire), TELEGRAM_BOT_TOKEN_ADMIN (optionnel)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const token = process.env.TELEGRAM_BOT_TOKEN;
const tokenAdmin = (process.env.TELEGRAM_BOT_TOKEN_ADMIN || '').trim();
const baseUrl = process.env.WEBHOOK_BASE_URL || 'https://bipbiprecharge.ci';
const base = baseUrl.replace(/\/$/, '');
const webhookUrl = `${base}/api/telegram/webhook`;
const webhookAdminUrl = `${base}/api/telegram/webhook-admin`;

if (!token) {
    console.error('ERREUR: TELEGRAM_BOT_TOKEN absent dans le .env');
    process.exit(1);
}

async function setWebhook(botToken, url, label) {
    console.log(`\n[${label}] Token (début):`, botToken.slice(0, 10) + '...');
    console.log(`[${label}] URL:`, url);
    const body = {
        url,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
    };
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log('Réponse:', JSON.stringify(data, null, 2));
    if (!data.ok) {
        console.error('Échec:', data.description || data);
        return false;
    }
    console.log(`OK — ${label} enregistré.`);
    return true;
}

async function setCommands(botToken, commands, label) {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands }),
    });
    const data = await res.json();
    if (data.ok) {
        console.log(`[${label}] Menu des commandes (français) : OK`);
    } else {
        console.warn(`[${label}] setMyCommands:`, data.description || data);
    }
}

async function main() {
    const ok1 = await setWebhook(token, webhookUrl, 'Bot principal (recharge)');
    if (!ok1) process.exit(1);

    // Menu des commandes en français (bot principal)
    await setCommands(token, [
        { command: 'demarrer', description: 'Accueil' },
        { command: 'annuler', description: 'Annuler' },
        { command: 'aide', description: 'Aide' },
    ], 'Bot principal');

    if (tokenAdmin) {
        const ok2 = await setWebhook(tokenAdmin, webhookAdminUrl, 'Bot admin Supabase');
        if (!ok2) process.exit(1);
        // Menu des commandes en français (bot admin)
        await setCommands(tokenAdmin, [
            { command: 'start', description: 'Accueil' },
            { command: 'actualites', description: 'Actualités en attente' },
            { command: 'annonces', description: 'Annonces LED en attente' },
            { command: 'commandes', description: 'Commandes en attente' },
            { command: 'liens', description: 'Liens YouTube / X' },
        ], 'Bot admin');
    } else {
        console.log('\n(Bot admin: TELEGRAM_BOT_TOKEN_ADMIN non défini — une seule webhook enregistrée)');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
