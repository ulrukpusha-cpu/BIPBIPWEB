/**
 * Récupère les actualités depuis des flux RSS organisés par catégorie.
 * Chaque article est enrichi d'une image de couverture (cover) extraite du flux
 * (enclosure / media:content / media:thumbnail / itunes:image / <img> du contenu)
 * ou, en dernier recours, de la balise og:image de la page de l'article.
 * Par défaut les articles sont créés en "approved" pour affichage immédiat.
 *
 * Sources : liste curatée intégrée (DEFAULT_FEEDS) + surcharge/ajout via .env :
 *   RSS_FEEDS_REGION, RSS_FEEDS_FINANCE, RSS_FEEDS_TECH, RSS_FEEDS_MODE,
 *   RSS_FEEDS_SCIENCE, RSS_FEEDS_MUSIC   (URLs séparées par des virgules)
 *   RSS_FEED_URLS  (fallback, catégorisé "region")
 *   AUTO_APPROVE_RSS=true  (défaut: true = affichage direct)
 *   RSS_DISABLE_DEFAULTS=true  (n'utiliser que les flux du .env)
 *   RSS_MAX_PER_FEED=6
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const crypto = require('crypto');
const Parser = require('rss-parser');
const db = require('../database/supabase-client');
const actualitesService = require('../services/actualitesService');

const parser = new Parser({
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BipbipRecharge-Bot/1.0; +https://bipbiprecharge.ci)' },
    customFields: {
        item: [
            ['media:content', 'mediaContent', { keepArray: true }],
            ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
            ['media:group', 'mediaGroup'],
            ['content:encoded', 'contentEncoded'],
            ['itunes:image', 'itunesImage'],
        ],
    },
});

// ── Liste curatée de flux vérifiés (réponse OK + image) ──────────────────────
const DEFAULT_FEEDS = {
    region: [
        'https://www.rfi.fr/fr/afrique/rss',
        'https://www.france24.com/fr/afrique/rss',
        'https://www.bbc.com/afrique/index.xml',
        'https://www.jeuneafrique.com/feed/',
        // Côte d'Ivoire (best effort — ignorés si indisponibles)
        'https://www.7info.ci/feed/',
        'https://www.linfodrome.com/feed',
        'https://www.ivoirematin.com/rss/actualites.xml',
        'https://www.apanews.net/feed/',
    ],
    finance: [
        'https://www.coindesk.com/arc/outboundfeeds/rss/',
        'https://cointelegraph.com/rss',
        'https://www.sikafinance.com/rss',
    ],
    tech: [
        'https://www.numerama.com/feed/',
        'https://www.01net.com/feed/',
        'https://www.theverge.com/rss/index.xml',
        'http://feeds.arstechnica.com/arstechnica/index',
        'https://www.wired.com/feed/rss',
    ],
    science: [
        'https://www.futura-sciences.com/rss/actualites.xml',
        'https://www.sciencesetavenir.fr/rss.xml',
        'https://www.nasa.gov/rss/dyn/breaking_news.rss',
        'https://www.newscientist.com/feed/home/',
    ],
    music: [
        'https://pitchfork.com/rss/news/',
        'https://www.nme.com/news/music/feed',
        'https://www.billboard.com/feed/',
        'https://www.rollingstone.com/music/music-news/feed/',
    ],
    mode: [
        'https://www.vogue.fr/feed/rss',
        'https://www.gqmagazine.fr/feed/rss',
    ],
};

const CATEGORIES = ['region', 'finance', 'tech', 'mode', 'science', 'music'];

function splitUrls(str) {
    return (str || '').split(',').map(u => u.trim()).filter(Boolean);
}

function getCategorizedFeeds() {
    const seen = new Set();
    const feeds = [];
    const add = (url, category) => {
        if (!url) return;
        const key = category + '|' + url;
        if (seen.has(key)) return;
        seen.add(key);
        feeds.push({ url, category });
    };

    const useDefaults = process.env.RSS_DISABLE_DEFAULTS !== 'true';
    if (useDefaults) {
        for (const cat of CATEGORIES) (DEFAULT_FEEDS[cat] || []).forEach(u => add(u, cat));
    }
    // Surcharge / ajout via .env
    for (const cat of CATEGORIES) {
        splitUrls(process.env['RSS_FEEDS_' + cat.toUpperCase()]).forEach(u => add(u, cat));
    }
    splitUrls(process.env.RSS_FEED_URLS || process.env.RSS_FEED_URL).forEach(u => add(u, 'region'));
    return feeds;
}

function truncate(str, max) {
    if (!str || typeof str !== 'string') return '';
    const clean = str.replace(/<[^>]+>/g, '').trim();
    return clean.length <= max ? clean : clean.slice(0, max - 3) + '...';
}

function isImageUrl(u, hint) {
    if (!u) return false;
    return /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(u) || /image/i.test(hint || '') || /image/i.test(u);
}

// Extrait la meilleure image du flux RSS pour un item.
function extractImageFromItem(item) {
    // 1. enclosure
    if (item.enclosure && item.enclosure.url && isImageUrl(item.enclosure.url, item.enclosure.type)) {
        return item.enclosure.url;
    }
    // 2. media:content (éventuellement dans media:group)
    const collectMedia = (mc) => {
        if (!mc) return null;
        const arr = Array.isArray(mc) ? mc : [mc];
        for (const m of arr) {
            const u = m && m.$ && m.$.url;
            if (u && (m.$.medium === 'image' || isImageUrl(u, m.$.type))) return u;
        }
        // fallback : première url media quelconque
        for (const m of arr) { const u = m && m.$ && m.$.url; if (u) return u; }
        return null;
    };
    let img = collectMedia(item.mediaContent);
    if (img) return img;
    if (item.mediaGroup && item.mediaGroup['media:content']) {
        img = collectMedia(item.mediaGroup['media:content']);
        if (img) return img;
    }
    // 3. media:thumbnail
    if (item.mediaThumbnail) {
        const arr = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : [item.mediaThumbnail];
        for (const m of arr) { const u = m && m.$ && m.$.url; if (u) return u; }
    }
    // 4. itunes:image
    if (item.itunesImage && item.itunesImage.$ && item.itunesImage.$.href) return item.itunesImage.$.href;
    // 5. <img> dans le contenu HTML
    const html = item.contentEncoded || item['content:encoded'] || item.content || item.summary || '';
    const m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1]) return m[1];
    return null;
}

// Dernier recours : og:image / twitter:image depuis la page de l'article.
async function fetchOgImage(url) {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BipbipRecharge-Bot/1.0)' },
        });
        clearTimeout(to);
        if (!res.ok) return null;
        const html = (await res.text()).slice(0, 200000);
        const patterns = [
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        ];
        for (const p of patterns) { const m = html.match(p); if (m && m[1]) return m[1]; }
    } catch (_) { /* timeout / réseau : on ignore */ }
    return null;
}

function absolutize(imgUrl, pageUrl) {
    if (!imgUrl) return null;
    try {
        if (/^https?:\/\//i.test(imgUrl)) return imgUrl;
        if (imgUrl.startsWith('//')) return 'https:' + imgUrl;
        if (pageUrl) return new URL(imgUrl, pageUrl).href;
    } catch (_) {}
    return /^https?:\/\//i.test(imgUrl) ? imgUrl : null;
}

// ── Traduction EN→FR via Groq (clé GROQBIP dans /root/.env) ──────────────────
function getGroqKey() {
    try {
        const fs = require('fs');
        for (const p of ['/root/.env', require('path').join(__dirname, '..', '.env')]) {
            try {
                const m = fs.readFileSync(p, 'utf8').match(/^\s*(?:GROQBIP|GROQ_API_KEY)\s*=\s*(.+?)\s*$/m);
                if (m) return m[1].trim().replace(/^["']|["']$/g, '');
            } catch (_) {}
        }
    } catch (_) {}
    return process.env.GROQBIP || process.env.GROQ_API_KEY || null;
}
const GROQ_KEY = getGroqKey();
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const EN_FEED_HINTS = ['coindesk', 'cointelegraph', 'theverge', 'arstechnica', 'wired.com', 'nasa.gov', 'newscientist', 'pitchfork', 'nme.com', 'billboard', 'rollingstone'];
function isEnglishFeed(url) {
    const u = (url || '').toLowerCase();
    return EN_FEED_HINTS.some(h => u.includes(h));
}
async function translateToFrench(title, summary, content) {
    if (!GROQ_KEY) return null;
    const body = {
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 1600,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: 'Tu es un traducteur professionnel anglais→français pour une app d\'actualités. Traduis fidèlement en français naturel et journalistique. Ne traduis PAS les noms propres, marques, ni les noms de personnes. Réponds UNIQUEMENT en JSON strict: {"title":"...","summary_short":"...","content":"..."}.' },
            { role: 'user', content: JSON.stringify({ title: title || '', summary_short: summary || '', content: (content || '').slice(0, 1800) }) },
        ],
    };
    try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 25000);
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', signal: controller.signal,
            headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        clearTimeout(to);
        if (!r.ok) return null;
        const d = await r.json();
        const c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if (!c) return null;
        const j = JSON.parse(c);
        if (!j.title && !j.content) return null;
        return { title: j.title || title, summary_short: j.summary_short || summary, content: j.content || content };
    } catch (_) { return null; }
}

async function fetchAndIngest() {
    if (!db.isAvailable()) {
        console.log('[fetchNewsRss] Supabase non configuré, skip.');
        return;
    }
    const feeds = getCategorizedFeeds();
    if (feeds.length === 0) {
        console.log('[fetchNewsRss] Aucun flux RSS configuré.');
        return;
    }

    const autoApprove = process.env.AUTO_APPROVE_RSS !== 'false'; // défaut true
    const maxPerFeed = parseInt(process.env.RSS_MAX_PER_FEED, 10) || 6;
    const counts = {};
    feeds.forEach(f => { counts[f.category] = (counts[f.category] || 0) + 1; });
    console.log('[fetchNewsRss]', feeds.length, 'flux →',
        Object.entries(counts).map(([k, v]) => k + ':' + v).join(', '),
        '| auto_approve:', autoApprove, '| max/flux:', maxPerFeed);

    let totalCreated = 0, totalWithImg = 0, totalTranslated = 0, translationsUsed = 0;
    const MAX_TRANSLATIONS = parseInt(process.env.RSS_MAX_TRANSLATIONS, 10) || 80;
    for (const feed of feeds) {
        try {
            const parsed = await parser.parseURL(feed.url);
            const feedTitle = parsed.title || 'RSS';
            let count = 0;
            const items = (parsed.items || []).slice(0, maxPerFeed);
            for (const item of items) {
                const title = truncate(item.title || 'Sans titre', 255);
                if (!title || title.length < 10) continue;
                const content = truncate(item.contentEncoded || item.contentSnippet || item.content || item.link || '', 5000) || title;
                const summary = truncate(item.contentSnippet || item.content || content, 500) || title;
                const link = item.link || item.guid || '';

                // Image cover : flux d'abord, og:image en secours
                let image = extractImageFromItem(item);
                if (!image && link) image = await fetchOgImage(link);
                image = absolutize(image, link);
                if (image) totalWithImg++;

                const sources = link ? [{ name: feedTitle, url: link }] : [{ name: feedTitle }];
                const stableKey = link || title;
                const stableHash = crypto.createHash('md5').update(stableKey).digest('hex').slice(0, 8);
                const titleSlug = (title || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 180);

                const result = await actualitesService.createActualite({
                    title,
                    slug: titleSlug + '-' + stableHash,
                    content,
                    summary_short: summary,
                    sources,
                    image_url: image || null,
                    status: autoApprove ? 'approved' : 'pending',
                    category: feed.category,
                });
                if (result.error) {
                    if (result.error.includes('duplicate') || result.error.includes('unique')) continue;
                    console.error('[fetchNewsRss]', feed.category, result.error);
                } else {
                    count++;
                    // Traduction FR (uniquement pour un NOUVEL article de source anglaise)
                    if (isEnglishFeed(feed.url) && translationsUsed < MAX_TRANSLATIONS && result.actualite && result.actualite.id) {
                        translationsUsed++;
                        const tr = await translateToFrench(title, summary, content);
                        if (tr) {
                            try {
                                const supa = db.getSupabase();
                                const { data: cur } = await supa.from('actualites').select('sources').eq('id', result.actualite.id).single();
                                let arr; try { arr = JSON.parse(cur && cur.sources); } catch (e) { arr = null; }
                                if (!Array.isArray(arr) || !arr.length) arr = [{ name: feedTitle, url: link }];
                                arr[0] = Object.assign({}, arr[0], { fr: { title: tr.title, summary_short: tr.summary_short, content: tr.content } });
                                await supa.from('actualites').update({ sources: JSON.stringify(arr) }).eq('id', result.actualite.id);
                                totalTranslated++;
                            } catch (e) { /* garde l'anglais */ }
                        }
                    }
                }
            }
            if (count > 0) console.log('[fetchNewsRss]', feed.category, '|', feedTitle, ':', count, 'article(s)');
            totalCreated += count;
        } catch (err) {
            console.error('[fetchNewsRss] Erreur', feed.category, feed.url.slice(0, 55), '→', err.message.slice(0, 60));
        }
    }
    console.log('[fetchNewsRss] Total:', totalCreated, 'article(s) créé(s),', totalWithImg, 'avec image cover,', totalTranslated, 'traduit(s) FR.');
}

fetchAndIngest()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
