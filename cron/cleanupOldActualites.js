/**
 * Supprime les actualités créées il y a plus de 24h.
 * Lancé via cron (toutes les 6h) pour garder la section Actualités fraîche.
 *
 * .env :
 *   ACTUALITES_TTL_HOURS=24  (defaut)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../database/supabase-client');

async function cleanupOld() {
    if (!db.isAvailable()) {
        console.log('[cleanupOldActualites] Supabase non configuré, skip.');
        return;
    }
    const supabase = db.getSupabase();
    const ttlHours = Number(process.env.ACTUALITES_TTL_HOURS) || 24;
    const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000).toISOString();
    console.log('[cleanupOldActualites] suppression des actualites creees avant', cutoff);

    // Compter avant
    const { count: before } = await supabase
        .from('actualites')
        .select('id', { count: 'exact', head: true })
        .lt('created_at', cutoff);

    if (!before) {
        console.log('[cleanupOldActualites] aucune actualite a supprimer');
        return;
    }

    // Supprimer toutes celles plus anciennes que le cutoff
    const { error } = await supabase
        .from('actualites')
        .delete()
        .lt('created_at', cutoff);

    if (error) {
        console.error('[cleanupOldActualites] erreur:', error.message);
        process.exit(1);
    }

    console.log(`[cleanupOldActualites] ${before} actualite(s) supprimee(s) (TTL: ${ttlHours}h)`);
}

cleanupOld()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
