/**
 * Actualités : liste approuvées, par slug, admin approve/reject
 */
const db = require('../database/supabase-client');
const { scoreActualite } = require('./scoring');


// ── Cache mémoire 5 min (protection contre les timeouts Supabase) ─────────────
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _cache = {};
function cacheGet(key) {
    const e = _cache[key];
    if (!e) return null;
    if (Date.now() - e.ts > CACHE_TTL_MS) { delete _cache[key]; return null; }
    return e.data;
}
function cacheSet(key, data) { _cache[key] = { data, ts: Date.now() }; }
// ─────────────────────────────────────────────────────────────────────────────

// ── Meta portée par `sources` (image cover + catégorie) sans colonne DB dédiée ──
// L'image de couverture et la catégorie sont stockées sur le 1er élément de
// `sources` ({ name, url, image, cat }). fillSources côté front ignore ces
// champs ; on les ré-expose ici en `image_url` / `category` au niveau article.
function embedMetaInSources(sources, image_url, category) {
    let arr;
    if (Array.isArray(sources)) arr = sources.slice();
    else if (typeof sources === 'string') { try { arr = JSON.parse(sources); } catch { arr = null; } if (!Array.isArray(arr)) arr = sources ? [{ name: 'Source', url: sources }] : []; }
    else if (sources && typeof sources === 'object') arr = [sources];
    else arr = [];
    if (!arr.length) arr = [{}];
    arr[0] = Object.assign({}, arr[0]);
    if (image_url && !arr[0].image) arr[0].image = image_url;
    if (category && !arr[0].cat) arr[0].cat = category;
    return arr;
}

function enrichFromSources(row) {
    if (!row || typeof row !== 'object') return row;
    let s = row.sources;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = null; } }
    if (Array.isArray(s)) {
        for (const el of s) {
            if (el && typeof el === 'object') {
                if (!row.image_url && el.image) row.image_url = el.image;
                if (!row.category && el.cat) row.category = el.cat;
            }
        }
    }
    return row;
}

const CATEGORY_KEYWORDS = {
    region: ['afrique', 'côte d\'ivoire', 'abidjan', 'cameroun', 'sénégal', 'mali', 'burkina', 'guinée', 'togo', 'bénin', 'niger', 'congo', 'gabon', 'tchad', 'maroc', 'algérie', 'tunisie', 'kenya', 'nigeria', 'soudan', 'uemoa', 'cedeao', 'gouvernement', 'président', 'politique', 'élection', 'ministre', 'diplomatie'],
    finance: ['crypto', 'bitcoin', 'ethereum', 'solana', 'blockchain', 'nft', 'token', 'bourse', 'trading', 'finance', 'banque', 'inflation', 'fmi', 'dette', 'fintech', 'minage', 'airdrop', 'staking', 'binance', 'wallet', 'investiss'],
    tech: ['technologie', 'innovation', 'intelligence artificielle', 'startup', 'smartphone', 'logiciel', 'robot', 'spacex', 'tesla', 'apple', 'google', 'microsoft', 'openai', 'chatgpt', 'satellite', 'cybersécurité', 'nvidia', 'samsung', 'processeur', 'android', 'iphone'],
    mode: ['artiste', 'mode', 'fashion', 'style', 'beauté', 'défilé', 'couture', 'tendance', 'célébrité', 'people', 'film', 'cinéma', 'série', 'football', 'champion', 'ballon d\'or', 'ligue des champions', 'acteur', 'actrice', 'sport', 'coupe'],
    science: ['science', 'découverte', 'recherche', 'espace', 'nasa', 'astronomie', 'physique', 'biologie', 'climat', 'énergie', 'quantique', 'planète', 'galaxie', 'télescope', 'fusée', 'santé', 'médecine', 'archéologie', 'dinosaure', 'univers'],
    music: ['musique', 'concert', 'festival', 'album', 'single', 'rap', 'afrobeat', 'afrobeats', 'coupé-décalé', 'rnb', 'pop', 'hip-hop', 'grammy', 'chanteur', 'chanteuse', 'rappeur', 'clip', 'tournée', 'spotify', 'streaming'],
};

function buildCategoryFilter(category) {
    const kw = CATEGORY_KEYWORDS[category];
    if (!kw) return null;
    return kw.map(k => `title.ilike.%${k}%`).join(',');
}

// Traduction : défaut = français. Si une trad FR est stockée dans sources[].fr
// (articles de sources anglaises traduits à l'ingestion), on l'applique. lang='en'
// renvoie la version d'origine (anglais pour ces sources).
function applyLang(row, lang) {
    if (!row || typeof row !== 'object') return row;
    if (lang === 'en') return row;
    let s = row.sources;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = null; } }
    if (Array.isArray(s)) {
        for (const el of s) {
            if (el && typeof el === 'object' && el.fr) {
                if (el.fr.title) row.title = el.fr.title;
                if (el.fr.summary_short) row.summary_short = el.fr.summary_short;
                if (el.fr.content != null) row.content = el.fr.content;
                break;
            }
        }
    }
    return row;
}

async function listApproved(limit = 20, offset = 0, sort = 'date', category = null, lang = 'fr') {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const L = row => applyLang(enrichFromSources(row), lang);
    const cacheKey = `list:${limit}:${offset}:${sort}:${category || 'all'}:${lang}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const cols = 'id, title, slug, summary_short, published_at, ai_score, sources';

    if (category && CATEGORY_KEYWORDS[category]) {
        let hasCol = true;
        try {
            const { error: testErr } = await supabase.from('actualites').select('category').limit(0);
            if (testErr) hasCol = false;
        } catch { hasCol = false; }

        if (hasCol) {
            const { data } = await supabase.from('actualites')
                .select(cols)
                .eq('status', 'approved')
                .eq('category', category)
                .order('published_at', { ascending: false })
                .range(offset, offset + limit - 1);
            if (data && data.length > 0) return data.map(L);
        }

        const filter = buildCategoryFilter(category);
        const { data } = await supabase.from('actualites')
            .select(cols)
            .eq('status', 'approved')
            .or(filter)
            .order('published_at', { ascending: false })
            .range(offset, offset + limit - 1);
        return (data || []).map(L);
    }

    let q = supabase.from('actualites').select(cols).eq('status', 'approved');
    if (sort === 'date') q = q.order('published_at', { ascending: false });
    else if (sort === 'popularite') q = q.order('ai_score', { ascending: false });
    const { data } = await q.range(offset, offset + limit - 1);
    const result = (data || []).map(L);
    if (result.length) cacheSet(cacheKey, result);
    return result;
}

async function getBySlug(slug, lang = 'fr') {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const { data } = await supabase.from('actualites').select('*').eq('slug', slug).eq('status', 'approved').single();
    return applyLang(enrichFromSources(data), lang);
}

async function listPending() {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.from('actualites').select('*').eq('status', 'pending').order('created_at', { ascending: false });
    return data || [];
}

async function createActualite(payload) {
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    const slug = (payload.slug || payload.title || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'article-' + Date.now();
    const ai_score = payload.ai_score != null ? payload.ai_score : scoreActualite(payload.title, payload.content, payload.sources);
    const status = ['draft', 'pending', 'approved', 'rejected'].includes(payload.status) ? payload.status : 'pending';
    let sourcesVal = payload.sources;
    if (payload.image_url || payload.category) {
        sourcesVal = embedMetaInSources(sourcesVal, payload.image_url, payload.category);
    }
    const sourcesStr = sourcesVal == null ? null : (typeof sourcesVal === 'string' ? sourcesVal : JSON.stringify(sourcesVal));
    const row = {
        title: payload.title,
        slug,
        content: payload.content || '',
        summary_short: payload.summary_short || null,
        sources: sourcesStr,
        ai_score,
        status,
        published_at: status === 'approved' ? new Date().toISOString() : null,
    };
    if (payload.category) row.category = payload.category;
    let { data, error } = await supabase.from('actualites').insert(row).select('id, slug, status').single();
    if (error && error.message && error.message.includes('category')) {
        delete row.category;
        ({ data, error } = await supabase.from('actualites').insert(row).select('id, slug, status').single());
    }
    if (error) return { error: error.message };
    return { actualite: data };
}

async function approveActualite(id) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const { data } = await supabase.from('actualites').update({
        status: 'approved',
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }).eq('id', id).select().single();
    return data;
}

async function rejectActualite(id) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    await supabase.from('actualites').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', id);
    return true;
}

module.exports = {
    listApproved,
    getBySlug,
    listPending,
    createActualite,
    approveActualite,
    rejectActualite,
};
