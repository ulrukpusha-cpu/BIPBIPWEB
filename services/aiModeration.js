/**
 * Modération IA des annonces et liens sociaux
 * 1. Filtre local (mots interdits) — instantané, gratuit
 * 2. Classification IA — deux chemins possibles :
 *    a) modèle de classification via /chat/completions (Groq
 *       openai/gpt-oss-safeguard-20b par défaut) si AI_MODERATION_MODEL est défini ;
 *    b) sinon l'endpoint natif /moderations d'OpenAI, si le fournisseur est OpenAI.
 *    Sans clé, seul le filtre local s'applique.
 * Retourne { ok: true } ou { ok: false, reason: '...' }
 *
 * En cas d'erreur ou de délai dépassé côté fournisseur, on LAISSE PASSER
 * (ai_error: true) : les annonces partent de toute façon en statut
 * « en_attente » et un admin valide avant diffusion. Bloquer sur une panne
 * réseau empêcherait toute publication légitime.
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

// Fournisseur partagé avec services/aiWriter.js : une seule config à tenir.
const AI_BASE_URL = () => (process.env.AI_WRITER_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_KEY = () => process.env.AI_WRITER_API_KEY || process.env.OPENAI_API_KEY || '';
// Défini => classification par modèle de chat. Vide => endpoint natif /moderations d'OpenAI.
const AI_MODERATION_MODEL = () => process.env.AI_MODERATION_MODEL || '';
const AI_TIMEOUT_MS = 12000;

const CONTEXTES = {
    annonce: "un message publicitaire court destiné au bandeau lumineux de l'application",
    lien: "un lien vers une chaîne YouTube, un compte X (Twitter) ou un canal Telegram, proposé pour une quête"
};

function policyPrompt(contexte) {
    return "Tu es un classificateur de modération pour Bipbip Recharge, une application de recharge " +
        "téléphonique et de petites annonces en Côte d'Ivoire.\n" +
        "Tu analyses " + (CONTEXTES[contexte] || CONTEXTES.annonce) + ", soumis par un utilisateur.\n\n" +
        "Signale le contenu qui relève de l'une de ces catégories :\n" +
        "- arnaque, promesse d'argent facile, multiplication d'argent, faux gains ;\n" +
        "- hameçonnage : demande de code PIN, de mot de passe, de code de retrait ou de données bancaires ;\n" +
        "- usurpation d'identité : se faire passer pour une banque, un opérateur, Bipbip ou une autorité ;\n" +
        "- contenu sexuel, nudité, prostitution ;\n" +
        "- haine, insulte, harcèlement, menace ;\n" +
        "- violence, armes ;\n" +
        "- drogue, produits illicites, contrefaçon ;\n" +
        "- toute autre activité illégale.\n\n" +
        "Ne signale PAS un commerce ordinaire, un service licite, une promotion honnête, " +
        "un prix, un lieu ou un numéro de téléphone : ce sont des annonces normales.\n\n" +
        "Réponds UNIQUEMENT par un objet JSON, sans texte autour :\n" +
        '{"flagged": true|false, "categories": ["..."], "reason": "une phrase courte en français"}';
}

/** Extrait le premier objet JSON d'une réponse, même entourée de texte. */
function parseVerdict(raw) {
    const s = String(raw || '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
}

/** Classification par modèle de chat (Groq gpt-oss-safeguard et compatibles). */
async function moderateWithChatModel(text, contexte) {
    const fetch = (await import('node-fetch')).default;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    try {
        const res = await fetch(AI_BASE_URL() + '/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + AI_KEY(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: AI_MODERATION_MODEL(),
                temperature: 0,
                // Marge large : ces modèles raisonnent avant de répondre et les
                // tokens de réflexion sont décomptés de max_tokens.
                max_tokens: 1200,
                reasoning_effort: 'low',
                messages: [
                    { role: 'system', content: policyPrompt(contexte) },
                    { role: 'user', content: String(text).slice(0, 2000) }
                ]
            }),
            signal: ctrl.signal
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error('[AI Moderation]', AI_BASE_URL(), res.status, body.slice(0, 200));
            return { ok: true, ai_error: true };
        }
        const data = await res.json();
        const choice = data && data.choices && data.choices[0];
        const verdict = parseVerdict(choice && choice.message && choice.message.content);
        if (!verdict || typeof verdict.flagged !== 'boolean') {
            console.error('[AI Moderation] verdict illisible:', JSON.stringify(choice && choice.message && choice.message.content).slice(0, 200));
            return { ok: true, ai_error: true };
        }
        if (verdict.flagged) {
            const cats = Array.isArray(verdict.categories) ? verdict.categories : [];
            return {
                ok: false,
                reason: verdict.reason
                    ? 'Contenu refusé par la modération IA : ' + String(verdict.reason).slice(0, 200)
                    : 'Contenu inapproprié détecté par IA (' + cats.join(', ') + ')',
                ai_categories: cats
            };
        }
        return { ok: true, ai_checked: true };
    } catch (err) {
        console.error('[AI Moderation] ' + (err.name === 'AbortError' ? 'délai dépassé' : 'erreur réseau') + ' :', err.message);
        return { ok: true, ai_error: true };
    } finally {
        clearTimeout(timer);
    }
}

/** Endpoint natif /moderations (OpenAI uniquement). */
async function moderateWithModerationsEndpoint(text) {
    try {
        const fetch = (await import('node-fetch')).default;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
        let res;
        try {
            res = await fetch(AI_BASE_URL() + '/moderations', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + AI_KEY(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: text }),
                signal: ctrl.signal
            });
        } finally { clearTimeout(timer); }

        if (!res.ok) {
            console.error('[AI Moderation] Erreur /moderations:', res.status, res.statusText);
            return { ok: true, ai_error: true };
        }
        const data = await res.json();
        const result = data.results && data.results[0];
        if (!result) return { ok: true, ai_error: true };
        if (result.flagged) {
            const categories = result.categories || {};
            const flagged = Object.entries(categories).filter(([, v]) => v === true).map(([k]) => k);
            return {
                ok: false,
                reason: 'Contenu inapproprié détecté par IA (' + flagged.join(', ') + ')',
                ai_categories: flagged
            };
        }
        return { ok: true, ai_checked: true };
    } catch (err) {
        console.error('[AI Moderation] Erreur réseau /moderations:', err.message);
        return { ok: true, ai_error: true };
    }
}

/**
 * Modération IA. `contexte` vaut 'annonce' (défaut) ou 'lien'.
 * Ne bloque jamais sur une panne du fournisseur (voir l'en-tête du fichier).
 */
async function moderateWithAI(text, contexte) {
    if (!AI_KEY()) {
        console.warn('[AI Moderation] aucune clé IA configurée, modération locale uniquement');
        return { ok: true, ai_skipped: true };
    }
    if (AI_MODERATION_MODEL()) return moderateWithChatModel(text, contexte);
    if (/api\.openai\.com/i.test(AI_BASE_URL())) return moderateWithModerationsEndpoint(text);
    // Fournisseur tiers sans modèle de modération déclaré : on ne devine pas.
    console.warn('[AI Moderation] AI_MODERATION_MODEL non défini pour ce fournisseur, modération locale uniquement');
    return { ok: true, ai_skipped: true };
}

// Ancien nom, conservé pour compatibilité avec d'éventuels appelants.
const moderateWithOpenAI = (text) => moderateWithAI(text, 'annonce');

/**
 * Modération complète d'une annonce (locale + OpenAI)
 */
async function moderateAnnonce(contenu) {
    // Étape 1 : modération locale (instantanée)
    const localResult = moderateLocal(contenu);
    if (!localResult.ok) return localResult;

    // Vérif longueur annonce spécifique
    if (contenu && contenu.trim().length > 200) return { ok: false, reason: 'Maximum 200 caractères pour une annonce' };

    // Étape 2 : classification IA (si un fournisseur est configuré)
    const aiResult = await moderateWithAI(contenu, 'annonce');
    if (!aiResult.ok) return aiResult;

    return { ok: true, ai_checked: !!aiResult.ai_checked, ai_error: !!aiResult.ai_error, ai_skipped: !!aiResult.ai_skipped };
}

/**
 * Modération complète d'un lien social (format + locale + OpenAI)
 */
async function moderateSocialLink(url) {
    // Étape 1 : vérifier format du lien
    const linkResult = moderateLink(url);
    if (!linkResult.ok) return linkResult;

    // Étape 2 : classification IA sur l'URL
    const aiResult = await moderateWithAI(url, 'lien');
    if (!aiResult.ok) return aiResult;

    return { ok: true, platform: linkResult.platform, ai_checked: !!aiResult.ai_checked };
}

module.exports = { moderateAnnonce, moderateLocal, moderateLink, moderateWithAI, moderateWithOpenAI, moderateSocialLink, MOTS_INTERDITS };
