/**
 * Récupère les actualités depuis des flux RSS organisés par catégorie.
 * Par défaut les articles sont créés en "approved" pour affichage immédiat.
 *
 * .env :
 *   RSS_FEEDS_REGION=https://feed1.xml,https://feed2.xml
 *   RSS_FEEDS_FINANCE=https://feed3.xml
 *   RSS_FEEDS_TECH=https://feed4.xml
 *   RSS_FEEDS_MODE=https://feed5.xml
 *   RSS_FEED_URLS=https://legacy.xml  (fallback, catégorisé "region")
 *   AUTO_APPROVE_RSS=true  (défaut: true = affichage direct)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Parser = require('rss-parser');
const db = require('../database/supabase-client');
const actualitesService = require('../services/actualitesService');

const parser = new Parser({
    timeout: 15000,
    headers: { 'User-Agent': 'BipbipRecharge-Bot/1.0' },
});

function splitUrls(str) {
    return (str || '').split(',').map(u => u.trim()).filter(Boolean);
}

function getCategorizedFeeds() {
    const feeds = [];
    const region = splitUrls(process.env.RSS_FEEDS_REGION);
    const finance = splitUrls(process.env.RSS_FEEDS_FINANCE);
    const tech = splitUrls(process.env.RSS_FEEDS_TECH);
    const mode = splitUrls(process.env.RSS_FEEDS_MODE);
    const legacy = splitUrls(process.env.RSS_FEED_URLS || process.env.RSS_FEED_URL);

    region.forEach(u => feeds.push({ url: u, category: 'region' }));
    finance.forEach(u => feeds.push({ url: u, category: 'finance' }));
    tech.forEach(u => feeds.push({ url: u, category: 'tech' }));
    mode.forEach(u => feeds.push({ url: u, category: 'mode' }));
    legacy.forEach(u => feeds.push({ url: u, category: 'region' }));

    return feeds;
}

function truncate(str, max) {
    if (!str || typeof str !== 'string') return '';
    const clean = str.replace(/<[^>]+>/g, '').trim();
    return clean.length <= max ? clean : clean.slice(0, max - 3) + '...';
}

async function fetchAndIngest() {
    if (!db.isAvailable()) {
        console.log('[fetchNewsRss] Supabase non configuré, skip.');
        return;
    }
    const feeds = getCategorizedFeeds();
    if (feeds.length === 0) {
        console.log('[fetchNewsRss] Aucun flux RSS configuré dans .env.');
        return;
    }

    const autoApprove = process.env.AUTO_APPROVE_RSS !== 'false';
    const categories = {};
    feeds.forEach(f => { categories[f.category] = (categories[f.category] || 0) + 1; });
    console.log('[fetchNewsRss]', feeds.length, 'flux →', Object.entries(categories).map(([k, v]) => k + ':' + v).join(', '),
        '| auto_approve:', autoApprove);

    let totalCreated = 0;
    for (const feed of feeds) {
        try {
            const parsed = await parser.parseURL(feed.url);
            const feedTitle = parsed.title || 'RSS';
            let count = 0;
            const items = (parsed.items || []).slice(0, 8);
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const title = truncate(item.title || 'Sans titre', 255);
                if (!title || title.length < 10) continue;
                const content = truncate(item.contentSnippet || item.content || item.link || '', 5000) || title;
                const summary = truncate(content, 500) || title;
                const link = item.link || item.guid || '';
                const sources = link ? [{ name: feedTitle, url: link }] : [{ name: feedTitle }];
                const slugSuffix = '-' + Date.now() + '-' + i;
                const result = await actualitesService.createActualite({
                    title,
                    slug: (title || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 200) + slugSuffix,
                    content,
                    summary_short: summary,
                    sources,
                    status: autoApprove ? 'approved' : 'pending',
                    category: feed.category,
                });
                if (result.error) {
                    if (result.error.includes('duplicate') || result.error.includes('unique')) continue;
                    console.error('[fetchNewsRss]', feed.category, result.error);
                } else {
                    count++;
                }
            }
            if (count > 0) console.log('[fetchNewsRss]', feed.category, '|', feedTitle, ':', count, 'article(s)');
            totalCreated += count;
        } catch (err) {
            console.error('[fetchNewsRss] Erreur', feed.category, feed.url.slice(0, 50), err.message);
        }
    }
    console.log('[fetchNewsRss] Total:', totalCreated, 'article(s) créé(s)');
}

fetchAndIngest()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
