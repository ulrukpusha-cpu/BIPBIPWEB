/**
 * Récupère les actualités depuis un ou plusieurs flux RSS et les enregistre (statut pending).
 * À lancer en cron (ex. toutes les heures) ou à la main.
 *
 * .env :
 *   RSS_FEED_URL=https://example.com/feed.xml
 *   ou RSS_FEED_URLS=https://feed1.xml,https://feed2.xml
 *
 * Exemples de flux Côte d'Ivoire / Afrique :
 *   https://www.fratmat.info/feed/
 *   https://news.google.com/rss/search?q=Côte+d'Ivoire&hl=fr (nécessite User-Agent)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Parser = require('rss-parser');
const db = require('../database/supabase-client');
const actualitesService = require('../services/actualitesService');

const parser = new Parser({
    timeout: 10000,
    headers: { 'User-Agent': 'BipbipRecharge-Bot/1.0' },
});

function getFeedUrls() {
    const urls = process.env.RSS_FEED_URLS || process.env.RSS_FEED_URL || '';
    return urls.split(',').map((u) => u.trim()).filter(Boolean);
}

function truncate(str, max) {
    if (!str || typeof str !== 'string') return '';
    return str.length <= max ? str : str.slice(0, max - 3) + '...';
}

async function fetchAndIngest() {
    if (!db.isAvailable()) {
        console.log('[fetchNewsRss] Supabase non configuré, skip.');
        return;
    }
    const feedUrls = getFeedUrls();
    if (feedUrls.length === 0) {
        console.log('[fetchNewsRss] Aucun RSS_FEED_URL ou RSS_FEED_URLS dans .env.');
        return;
    }

    for (const url of feedUrls) {
        try {
            const feed = await parser.parseURL(url);
            const feedTitle = feed.title || 'RSS';
            let count = 0;
            const items = (feed.items || []).slice(0, 10);
            for (const item of items) {
                const title = truncate(item.title || 'Sans titre', 255);
                const content = item.contentSnippet || item.content || item.link || '';
                const summary = truncate(content, 500);
                const link = item.link || item.guid || '';
                const sources = link ? [{ name: feedTitle, url: link }] : [{ name: feedTitle }];
                const result = await actualitesService.createActualite({
                    title,
                    content: content.slice(0, 5000) || title,
                    summary_short: summary || title,
                    sources,
                    status: 'pending',
                });
                if (result.error) {
                    if (result.error.includes('duplicate') || result.error.includes('unique')) continue;
                    console.error('[fetchNewsRss]', result.error);
                } else {
                    count++;
                    console.log('[fetchNewsRss] Créé:', result.actualite?.slug);
                }
            }
            console.log('[fetchNewsRss]', feedTitle, ':', count, 'actualité(s) en attente.');
        } catch (err) {
            console.error('[fetchNewsRss] Erreur', url, err.message);
        }
    }
}

fetchAndIngest()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
