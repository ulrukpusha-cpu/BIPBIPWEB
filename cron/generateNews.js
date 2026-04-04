/**
 * Job cron : génération d'actualités IA (sources accrochées), statut pending.
 * À exécuter en hebdo (ex: chaque lundi) ou manuellement.
 * L'IA génère des résumés avec sources ; un admin valide avant publication.
 *
 * Usage: node cron/generateNews.js
 * Ou via agenda/node-cron depuis server.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../database/supabase-client');
const actualitesService = require('../services/actualitesService');
const { scoreActualite } = require('../services/scoring');

// Stub : génération factice. Remplacer par appel API OpenAI/autre avec prompt du type :
// "Résume les actualités de la semaine en Côte d'Ivoire (économie, tech, société), avec sources (liens ou noms)."
function generateWeeklyNewsStub() {
    const now = new Date();
    return [
        {
            title: 'Actualités de la semaine – ' + now.toLocaleDateString('fr-FR', { week: 'long', year: 'numeric' }),
            content: 'Résumé des faits marquants de la semaine (à remplacer par sortie IA réelle avec sources).',
            summary_short: 'Synthèse hebdo avec sources.',
            sources: JSON.stringify([{ name: 'Exemple', url: 'https://example.com' }]),
        },
    ];
}

async function run() {
    if (!db.isAvailable()) {
        console.log('[generateNews] Supabase non configuré, skip.');
        return;
    }
    const items = generateWeeklyNewsStub();
    for (const item of items) {
        const result = await actualitesService.createActualite({
            ...item,
            status: 'pending',
        });
        if (result.error) console.error('[generateNews]', result.error);
        else console.log('[generateNews] Créé:', result.actualite?.slug);
    }
}

run().catch(err => {
    console.error('[generateNews]', err);
    process.exit(1);
});
