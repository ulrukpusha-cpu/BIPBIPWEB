/**
 * Actualités : liste approuvées, par slug, admin approve/reject
 */
const db = require('../database/supabase-client');
const { scoreActualite } = require('./scoring');

async function listApproved(limit = 20, offset = 0, sort = 'date') {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    let q = supabase.from('actualites').select('id, title, slug, summary_short, published_at, ai_score').eq('status', 'approved');
    if (sort === 'date') q = q.order('published_at', { ascending: false });
    else if (sort === 'popularite') q = q.order('ai_score', { ascending: false });
    const { data } = await q.range(offset, offset + limit - 1);
    return data || [];
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
    const ai_score = scoreActualite(payload.title, payload.content, payload.sources);
    const { data, error } = await supabase.from('actualites').insert({
        title: payload.title,
        slug,
        content: payload.content || '',
        summary_short: payload.summary_short || null,
        sources: payload.sources || null,
        ai_score,
        status: payload.status || 'pending',
    }).select('id, slug, status').single();
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
