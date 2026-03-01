/**
 * Bandeau LED : messages actifs pour affichage
 */
const db = require('../database/supabase-client');

async function getActiveMessages() {
    const supabase = db.getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.from('led_messages').select('id, content, priority').eq('is_active', true).order('priority', { ascending: false });
    return data || [];
}

/** Optionnel : décrémenter diffusions_restantes sur l'annonce liée (appelé par le cron LED) */
async function decrementAnnonceDiffusions(annonceId) {
    const supabase = db.getSupabase();
    if (!supabase) return;
    const { data: ann } = await supabase.from('annonces').select('diffusions_restantes').eq('id', annonceId).single();
    if (!ann || ann.diffusions_restantes <= 0) return;
    await supabase.from('annonces').update({ diffusions_restantes: ann.diffusions_restantes - 1 }).eq('id', annonceId);
}

module.exports = { getActiveMessages, decrementAnnonceDiffusions };
