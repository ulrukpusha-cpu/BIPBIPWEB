/**
 * Job cron : rotation du bandeau LED, décrément des diffusions restantes des annonces.
 * À exécuter toutes les X minutes (ex: 5 min) pour "afficher" un message et décrémenter.
 *
 * Usage: node cron/ledScheduler.js
 * Ou via agenda/node-cron depuis server.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../database/supabase-client');
const ledService = require('../services/ledService');

async function getNextLedMessage() {
    const supabase = db.getSupabase();
    if (!supabase) return null;
    const { data } = await supabase.from('led_messages')
        .select('id, content, annonce_id')
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .limit(1)
        .single();
    return data;
}

async function deactivateWhenExhausted(annonceId) {
    const supabase = db.getSupabase();
    if (!supabase) return;
    const { data: ann } = await supabase.from('annonces').select('diffusions_restantes').eq('id', annonceId).single();
    if (ann && ann.diffusions_restantes <= 0) {
        await supabase.from('led_messages').update({ is_active: false }).eq('annonce_id', annonceId);
    }
}

async function run() {
    if (!db.isAvailable()) {
        console.log('[ledScheduler] Supabase non configuré, skip.');
        return;
    }
    const msg = await getNextLedMessage();
    if (!msg) return;
    // Décrémenter les diffusions restantes de l'annonce liée
    if (msg.annonce_id) {
        await ledService.decrementAnnonceDiffusions(msg.annonce_id);
        await deactivateWhenExhausted(msg.annonce_id);
    }
    console.log('[ledScheduler] Affiché:', msg.content?.slice(0, 40) + '…');
}

run().catch(err => {
    console.error('[ledScheduler]', err);
    process.exit(1);
});
