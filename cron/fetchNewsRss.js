/**
 * Récupère les actualités depuis un ou plusieurs flux RSS.
 * Par défaut les articles sont créés en "approved" pour affichage immédiat.
 * Mettre AUTO_APPROVE_RSS=false dans .env pour les mettre en attente de validation admin.
 *
 * .env :
 *   RSS_FEED_URL=https://example.com/feed.xml
 *   ou RSS_FEED_URLS=https://feed1.xml,https://feed2.xml
 *   AUTO_APPROVE_RSS=true  (défaut: true = affichage direct)
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

    const autoApprove = process.env.AUTO_APPROVE_RSS !== 'false';
    console.log('[fetchNewsRss] AUTO_APPROVE_RSS =', autoApprove, '→ articles visibles', autoApprove ? 'tout de suite' : 'après validation admin');

    for (const url of feedUrls) {
        try {
            const feed = await parser.parseURL(url);
            const feedTitle = feed.title || 'RSS';
            let count = 0;
            const items = (feed.items || []).slice(0, 10);
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const title = truncate(item.title || 'Sans titre', 255);
                const content = item.contentSnippet || item.content || item.link || '';
                const summary = truncate(content, 500);
                const link = item.link || item.guid || '';
                const sources = link ? [{ name: feedTitle, url: link }] : [{ name: feedTitle }];
                const slugSuffix = '-' + Date.now() + '-' + i;
                const result = await actualitesService.createActualite({
                    title,
                    slug: (title || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 200) + slugSuffix,
                    content: content.slice(0, 5000) || title,
                    summary_short: summary || title,
                    sources,
                    status: autoApprove ? 'approved' : 'pending',
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
