/**
 * Annonces payantes : grille 50-500F, modération IA, LED, paiement MoMo
 */
const db = require('../database/supabase-client');
const { moderateAnnonce } = require('./aiModeration');
const momoRepo = require('../database/momo-repository');

const GRILLE = {
    150: { nombre_diffusion: 15, position_actualite: 'prioritaire' },
    300: { nombre_diffusion: 30, position_actualite: 'haut' },
    500: { nombre_diffusion: 50, position_actualite: 'premium' },
};

function getGrille() {
    return GRILLE;
}

async function createAnnonce(userId, contenu, prix) {
    const mod = await moderateAnnonce(contenu);
    if (!mod.ok) return { error: mod.reason };
    if (!GRILLE[prix]) return { error: 'Prix invalide (150, 300 ou 500)' };
    const supabase = db.getSupabase();
    if (!supabase) return { error: 'Base indisponible' };
    const { nombre_diffusion, position_actualite } = GRILLE[prix];
    const { data, error } = await supabase.from('annonces').insert({
        user_id: String(userId),
        contenu: contenu.slice(0, 255),
        prix,
        nombre_diffusion,
        diffusions_restantes: nombre_diffusion,
        statut: 'en_attente',
        ai_moderation_result: 'ok',
        position_actualite,
    }).select('id, statut, date_creation').single();
    if (error) return { error: error.message };
    return { annonce: data };
}

async function listByStatut(statut) {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.from('annonces').select('*').eq('statut', statut).order('date_creation', { ascending: false });
    return data || [];
}

async function listValidesForActualites(sort = 'date') {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    let q = supabase.from('annonces').select('*').eq('statut', 'valide');
    if (sort === 'premium') q = q.order('prix', { ascending: false });
    else if (sort === 'date') q = q.order('date_validation', { ascending: false });
    const { data } = await q;
    return data || [];
}

async function getAnnonceById(id) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const { data } = await supabase.from('annonces').select('*').eq('id', id).single();
    return data;
}

async function validateAnnonce(id, options = {}) {
    const { viaOrderProof } = options;
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const { data: ann } = await supabase.from('annonces').select('*').eq('id', id).single();
    if (!ann || ann.statut !== 'en_attente') return null;
    if (!viaOrderProof && momoRepo.isAvailable()) {
        const paid = await momoRepo.getSuccessfulTransactionForAnnonce(id);
        if (!paid) return { error: 'Paiement MoMo requis avant validation' };
    }
    const now = new Date().toISOString();
    await supabase.from('led_messages').insert({
        content: ann.contenu,
        priority: ann.prix,
        annonce_id: id,
    });
    const slugBase = (ann.contenu || '').slice(0, 50).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'annonce';
    const slug = slugBase + '-' + id.slice(0, 8);
    await supabase.from('actualites').insert({
        title: (ann.contenu || '').slice(0, 255),
        slug,
        content: ann.contenu || '',
        summary_short: (ann.contenu || '').slice(0, 500),
        status: 'approved',
        published_at: now,
        updated_at: now,
    });
    await supabase.from('annonces').update({
        statut: 'valide',
        date_validation: now,
    }).eq('id', id);
    return { ...ann, statut: 'valide' };
}

async function refuseAnnonce(id) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    await supabase.from('annonces').update({ statut: 'refuse' }).eq('id', id);
    return true;
}

module.exports = {
    getGrille,
    createAnnonce,
    getAnnonceById,
    listByStatut,
    listValidesForActualites,
    validateAnnonce,
    refuseAnnonce,
};
