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

const CATEGORY_KEYWORDS = {
    region: ['afrique', 'côte d\'ivoire', 'abidjan', 'cameroun', 'sénégal', 'mali', 'burkina', 'guinée', 'togo', 'bénin', 'niger', 'congo', 'gabon', 'tchad', 'maroc', 'algérie', 'tunisie', 'kenya', 'nigeria', 'soudan', 'uemoa', 'cedeao', 'gouvernement', 'président', 'politique', 'élection', 'ministre', 'diplomatie'],
    finance: ['crypto', 'bitcoin', 'ethereum', 'solana', 'blockchain', 'nft', 'token', 'bourse', 'trading', 'finance', 'banque', 'inflation', 'fmi', 'dette', 'fintech', 'minage', 'airdrop', 'staking', 'binance', 'wallet', 'investiss'],
    tech: ['technologie', 'innovation', 'intelligence artificielle', 'startup', 'smartphone', 'logiciel', 'robot', 'spacex', 'tesla', 'apple', 'google', 'microsoft', 'openai', 'chatgpt', 'satellite', 'cybersécurité', 'nvidia', 'samsung', 'processeur', 'android', 'iphone'],
    mode: ['artiste', 'musique', 'concert', 'festival', 'célébrité', 'fashion', 'film', 'cinéma', 'série', 'album', 'rap', 'afrobeat', 'grammy', 'football', 'champion', 'ballon d\'or', 'ligue des champions', 'acteur', 'actrice', 'chanteur', 'sport', 'coupe'],
};

function buildCategoryFilter(category) {
    const kw = CATEGORY_KEYWORDS[category];
    if (!kw) return null;
    return kw.map(k => `title.ilike.%${k}%`).join(',');
}

async function listApproved(limit = 20, offset = 0, sort = 'date', category = null) {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const cacheKey = `list:${limit}:${offset}:${sort}:${category || 'all'}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const cols = 'id, title, slug, summary_short, published_at, ai_score';

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
            if (data && data.length > 0) return data;
        }

        const filter = buildCategoryFilter(category);
        const { data } = await supabase.from('actualites')
            .select(cols)
            .eq('status', 'approved')
            .or(filter)
            .order('published_at', { ascending: false })
            .range(offset, offset + limit - 1);
        return data || [];
    }

    let q = supabase.from('actualites').select(cols).eq('status', 'approved');
    if (sort === 'date') q = q.order('published_at', { ascending: false });
    else if (sort === 'popularite') q = q.order('ai_score', { ascending: false });
    const { data } = await q.range(offset, offset + limit - 1);
    const result = data || [];
    if (result.length) cacheSet(cacheKey, result);
    return result;
}

async function getBySlug(slug) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const { data } = await supabase.from('actualites').select('*').eq('slug', slug).eq('status', 'approved').single();
    return data;
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
    const sourcesStr = payload.sources == null ? null : (typeof payload.sources === 'string' ? payload.sources : JSON.stringify(payload.sources));
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
