/**
 * Annonces payantes : grille 50-500F, modération IA, LED, paiement MoMo
 */
const db = require('../database/supabase-client');
const { moderateAnnonce } = require('./aiModeration');
const momoRepo = require('../database/momo-repository');

const GRILLE = {
    50:  { nombre_diffusion: 5,  position_actualite: 'normal' },
    100: { nombre_diffusion: 10, position_actualite: 'remonte' },
    150: { nombre_diffusion: 15, position_actualite: 'prioritaire' },
    300: { nombre_diffusion: 30, position_actualite: 'haut' },
    500: { nombre_diffusion: 50, position_actualite: 'premium' },
};

function getGrille() {
    return GRILLE;
}

async function createAnnonce(userId, contenu, prix) {
    const mod = moderateAnnonce(contenu);
    if (!mod.ok) return { error: mod.reason };
    if (!GRILLE[prix]) return { error: 'Prix invalide (50, 100, 150, 300, 500)' };
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

async function validateAnnonce(id) {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const { data: ann } = await supabase.from('annonces').select('*').eq('id', id).single();
    if (!ann || ann.statut !== 'en_attente') return null;
    if (momoRepo.isAvailable()) {
        const paid = await momoRepo.getSuccessfulTransactionForAnnonce(id);
        if (!paid) return { error: 'Paiement MoMo requis avant validation' };
    }
    const { data: led } = await supabase.from('led_messages').insert({
        content: ann.contenu,
        priority: ann.prix,
        annonce_id: id,
    }).select('id').single();
    await supabase.from('annonces').update({
        statut: 'valide',
        date_validation: new Date().toISOString(),
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
