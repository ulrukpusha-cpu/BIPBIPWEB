/* =========================================================
   Bipbip Cabine — nettoyage hebdomadaire des preuves Wave.
   Chaque LUNDI 07:00 (Afrique/Abidjan = UTC) :
     1) envoie toutes les preuves (images datées) aux admins via le bot Cabine,
     2) supprime les fichiers du serveur + la référence en base (espace nettoyé).
   Planificateur in-process (pas de node-cron) : vérifie l'heure toutes les 10 min,
   idempotent via une clé de semaine en mémoire.
   ========================================================= */
const cabineBot = require('../routes/cabineBot');

let lastRunWeek = null;

function weekKey(d) {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

async function tick() {
    const now = new Date(); // UTC = Abidjan
    if (now.getUTCDay() !== 1 || now.getUTCHours() !== 7) return; // lundi 07h
    const wk = weekKey(now);
    if (lastRunWeek === wk) return; // déjà fait cette semaine
    lastRunWeek = wk;
    try {
        console.log('[cabineProofCleanup] Lancement archivage hebdo des preuves Wave (' + wk + ')');
        const r = await cabineBot.archiveAndCleanProofs();
        console.log('[cabineProofCleanup] Terminé :', JSON.stringify(r));
    } catch (e) {
        console.error('[cabineProofCleanup]', e.message);
    }
}

function start() {
    setInterval(() => { tick().catch(() => {}); }, 10 * 60 * 1000); // toutes les 10 min
    tick().catch(() => {}); // 1er check au démarrage
    console.log('[cabineProofCleanup] Planificateur actif (lundi 07:00 Abidjan).');
}

module.exports = { start, tick, archive: () => cabineBot.archiveAndCleanProofs() };
