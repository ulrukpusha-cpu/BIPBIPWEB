/**
 * Modération IA des annonces et liens sociaux
 * 1. Filtre local (mots interdits) — instantané, gratuit
 * 2. API OpenAI Moderation — IA avancée (nécessite OPENAI_API_KEY dans .env)
 * Retourne { ok: true } ou { ok: false, reason: '...' }
 */

const MOTS_INTERDITS = [
    'arnaque', 'gratuit', 'win', 'click here', 'urgent', 'viagra', 'casino',
    'prêt sans frais', 'loterie', 'escroquerie', 'hack', 'crack', 'porn',
    'sexe', 'nude', 'drogue', 'cocaïne', 'weed', 'bitcoin gratuit',
    'transfert western union', 'money doubling'
].map(w => w.toLowerCase());

// Patterns suspects pour les liens
const LINK_PATTERNS_BLOCKED = [
    /bit\.ly/i, /tinyurl/i, /adf\.ly/i,       // raccourcisseurs suspects
    /\.ru\//i, /\.cn\//i,                       // domaines à risque
    /phishing/i, /login.*fake/i,                // phishing
];

/**
 * Modération locale rapide (mots interdits)
 */
function moderateLocal(text) {
    if (!text || typeof text !== 'string') return { ok: false, reason: 'Contenu vide' };
    const lower = text.trim().toLowerCase();
    if (lower.length > 500) return { ok: false, reason: 'Contenu trop long' };
    for (const mot of MOTS_INTERDITS) {
        if (lower.includes(mot)) return { ok: false, reason: 'Contenu non autorisé (mot interdit : ' + mot + ')' };
    }
    return { ok: true };
}

/**
 * Modération des liens sociaux (YouTube, X, Telegram)
 */
function moderateLink(url) {
    if (!url || typeof url !== 'string') return { ok: false, reason: 'Lien vide' };
    const trimmed = url.trim();

    // Vérifier que c'est bien un lien YouTube, X ou Telegram
    const isYoutube = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(trimmed);
    const isX = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i.test(trimmed);
    const isTelegram = /^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i.test(trimmed);

    if (!isYoutube && !isX && !isTelegram) {
        return { ok: false, reason: 'Seuls les liens YouTube, X (Twitter) et Telegram sont acceptés' };
    }

    // Vérifier patterns suspects
    for (const pattern of LINK_PATTERNS_BLOCKED) {
        if (pattern.test(trimmed)) return { ok: false, reason: 'Lien suspect détecté' };
    }

    return { ok: true, platform: isYoutube ? 'youtube' : isX ? 'x' : 'telegram' };
}

/**
 * Modération IA via API OpenAI Moderation (gratuit avec clé API)
 * Détecte : hate, violence, self-harm, sexual, harassment, etc.
 */
async function moderateWithOpenAI(text) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        // Pas de clé → on ne bloque pas, modération locale uniquement
        console.warn('[AI Moderation] OPENAI_API_KEY non configurée, modération locale uniquement');
        return { ok: true, ai_skipped: true };
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch('https://api.openai.com/v1/moderations', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ input: text })
        });

        if (!res.ok) {
            console.error('[AI Moderation] Erreur API OpenAI:', res.status, res.statusText);
            return { ok: true, ai_error: true }; // En cas d'erreur API, on laisse passer (failover)
        }

        const data = await res.json();
        const result = data.results && data.results[0];

        if (!result) return { ok: true, ai_error: true };

        if (result.flagged) {
            // Trouver les catégories flaggées
            const categories = result.categories || {};
            const flagged = Object.entries(categories)
                .filter(([, val]) => val === true)
                .map(([key]) => key);
            return {
                ok: false,
                reason: 'Contenu inapproprié détecté par IA (' + flagged.join(', ') + ')',
                ai_categories: flagged
            };
        }

        return { ok: true, ai_checked: true };
    } catch (err) {
        console.error('[AI Moderation] Erreur réseau OpenAI:', err.message);
        return { ok: true, ai_error: true }; // Failover : on laisse passer
    }
}

/**
 * Modération complète d'une annonce (locale + OpenAI)
 */
async function moderateAnnonce(contenu) {
    // Étape 1 : modération locale (instantanée)
    const localResult = moderateLocal(contenu);
    if (!localResult.ok) return localResult;

    // Vérif longueur annonce spécifique
    if (contenu && contenu.trim().length > 200) return { ok: false, reason: 'Maximum 200 caractères pour une annonce' };

    // Étape 2 : modération OpenAI (si clé disponible)
    const aiResult = await moderateWithOpenAI(contenu);
    if (!aiResult.ok) return aiResult;

    return { ok: true, ai_checked: !!aiResult.ai_checked };
}

/**
 * Modération complète d'un lien social (format + locale + OpenAI)
 */
async function moderateSocialLink(url) {
    // Étape 1 : vérifier format du lien
    const linkResult = moderateLink(url);
    if (!linkResult.ok) return linkResult;

    // Étape 2 : modération OpenAI sur l'URL
    const aiResult = await moderateWithOpenAI(url);
    if (!aiResult.ok) return aiResult;

    return { ok: true, platform: linkResult.platform, ai_checked: !!aiResult.ai_checked };
}

module.exports = { moderateAnnonce, moderateLocal, moderateLink, moderateWithOpenAI, moderateSocialLink };
