/**
 * Modération IA des annonces : spam, arnaque, mots interdits
 * Retourne { ok: true } ou { ok: false, reason: '...' }
 * Brancher une API (OpenAI, Moderation, etc.) plus tard via OPENAI_API_KEY
 */
const MOTS_INTERDITS = ['arnaque', 'gratuit', 'win', 'click here', 'urgent', 'viagra', 'casino', 'prêt sans frais'].map(w => w.toLowerCase());

function moderateAnnonce(contenu) {
    if (!contenu || typeof contenu !== 'string') return { ok: false, reason: 'Contenu vide' };
    const text = contenu.trim().toLowerCase();
    if (text.length > 200) return { ok: false, reason: 'Maximum 200 caractères' };
    for (const mot of MOTS_INTERDITS) {
        if (text.includes(mot)) return { ok: false, reason: 'Contenu non autorisé (mot interdit)' };
    }
    return { ok: true };
}

module.exports = { moderateAnnonce };
