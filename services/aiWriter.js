/**
 * Aide à la rédaction par IA (OpenAI) — descriptions d'articles Market et annonces LED.
 *
 * Deux modes : 'generate' (rédige à partir des infos de l'article) et 'improve'
 * (reformule un texte déjà saisi). Dans les deux cas le modèle a l'interdiction
 * d'inventer une caractéristique absente des infos fournies : une description
 * d'occasion qui invente une marque, un état ou une garantie tromperait l'acheteur.
 *
 * Le texte produit est aussi contraint d'éviter la liste de mots interdits de
 * services/aiModeration.js — sans ça l'IA peut générer un texte que l'endpoint
 * de publication refusera ensuite (« gratuit », « urgent »…).
 */

const { MOTS_INTERDITS, moderateLocal } = require('./aiModeration');

// Fournisseur interchangeable : toute API compatible OpenAI convient (Groq,
// OpenRouter, DeepSeek…). Par défaut OpenAI avec la clé déjà utilisée par
// services/aiModeration.js.
const BASE_URL = (process.env.AI_WRITER_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const API_KEY = () => process.env.AI_WRITER_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = process.env.AI_WRITER_MODEL || 'gpt-4o-mini';
const MAX_DESC = 2000;      // aligné sur maxlength du textarea et sur le slice serveur
const MAX_ANNONCE = 200;    // aligné sur moderateAnnonce()
const TIMEOUT_MS = 20000;

function motsInterditsLine() {
    return MOTS_INTERDITS.join(', ');
}

/** Coupe proprement à la limite, sur une fin de ligne ou de mot. */
function clamp(text, max) {
    const t = String(text || '').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const nl = cut.lastIndexOf('\n');
    if (nl > max * 0.6) return cut.slice(0, nl).trim();
    const sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

/** Le modèle glisse parfois du markdown malgré la consigne : on nettoie. */
function stripMarkdown(text) {
    return String(text || '')
        .replace(/^\s*```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, '$1$2')
        .replace(/^\s*[-*•]\s+/gm, '✅ ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function callOpenAI(system, user, maxTokens) {
    const apiKey = API_KEY();
    if (!apiKey) {
        const err = new Error("L'aide IA n'est pas configurée sur ce serveur.");
        err.code = 'NO_KEY';
        throw err;
    }
    const fetch = (await import('node-fetch')).default;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(BASE_URL + '/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                temperature: 0.7,
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user }
                ]
            }),
            signal: ctrl.signal
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error('[aiWriter]', BASE_URL, res.status, body.slice(0, 300));
            // 401/429 = compte sans crédit ou clé invalide : inutile de faire
            // patienter le vendeur, ça ne se réglera pas en réessayant.
            const quota = res.status === 429 || res.status === 401 || /insufficient_quota|no credits/i.test(body);
            const err = new Error(quota
                ? "L'aide IA est indisponible (quota du service épuisé). Préviens l'administrateur."
                : "L'IA n'a pas répondu. Réessaie dans un instant.");
            err.code = quota ? 'QUOTA' : 'UPSTREAM';
            throw err;
        }
        const data = await res.json();
        const text = data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content : '';
        if (!text || !text.trim()) {
            const err = new Error("L'IA n'a rien renvoyé. Réessaie.");
            err.code = 'EMPTY';
            throw err;
        }
        return stripMarkdown(text);
    } catch (e) {
        if (e.name === 'AbortError') {
            const err = new Error("L'IA met trop de temps à répondre. Réessaie.");
            err.code = 'TIMEOUT';
            throw err;
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

const RULES_COMMON =
    "Tu écris en français simple, pour des utilisateurs de Côte d'Ivoire.\n" +
    "INTERDIT ABSOLU : inventer une information qui ne t'a pas été donnée " +
    "(marque, modèle, état, âge, garantie, accessoires, dimensions, lieu, contact). " +
    "Si une info manque, reste général plutôt que de la deviner.\n" +
    "Pas de markdown : ni #, ni *, ni tirets de liste, ni blocs de code.\n" +
    "N'utilise à aucun prix ces mots, ils sont bloqués par le filtre anti-spam : " + motsInterditsLine() + ".\n" +
    "Réponds uniquement par le texte final, sans introduction ni commentaire.";

function itemSystemPrompt() {
    return "Tu rédiges des descriptions d'articles d'occasion pour le Market de Bipbip Recharge.\n" +
        RULES_COMMON + "\n" +
        "Structure attendue :\n" +
        "- 2 à 4 phrases de présentation ;\n" +
        "- une ligne vide ;\n" +
        "- 2 à 4 points forts, un par ligne, chaque ligne commençant par « ✅ ».\n" +
        "Les retours à la ligne sont réels et sont conservés à l'affichage.\n" +
        "Le prix est déjà affiché par l'application : ne le répète pas.\n" +
        "Ton commercial mais honnête, sans superlatif creux. " + MAX_DESC + " caractères maximum.";
}

function annonceSystemPrompt() {
    return "Tu rédiges des annonces très courtes pour le bandeau lumineux (LED) de l'application Bipbip Recharge.\n" +
        RULES_COMMON + "\n" +
        "Contraintes : " + MAX_ANNONCE + " caractères MAXIMUM, une seule phrase (deux très courtes au plus), " +
        "accrocheuse et immédiatement compréhensible en défilement. " +
        "Un emoji au maximum, en début de message. " +
        "N'invente ni prix, ni date, ni numéro, ni adresse.";
}

/**
 * Description d'un article Market.
 * @param {{name:string, cat:string, price:number, current:string, mode:'generate'|'improve'}} input
 */
async function writeItemDescription(input) {
    const name = String(input.name || '').trim().slice(0, 140);
    const cat = String(input.cat || '').trim().slice(0, 60);
    const price = parseInt(input.price, 10) || 0;
    const current = String(input.current || '').trim().slice(0, MAX_DESC);
    const improve = input.mode === 'improve' && current.length >= 15;

    if (!improve && !name) {
        const err = new Error("Renseigne au moins le nom de l'article pour que l'IA puisse t'aider.");
        err.code = 'NEED_NAME';
        throw err;
    }

    const facts = [
        name ? 'Nom de l\'article : ' + name : null,
        cat ? 'Catégorie : ' + cat.replace('/', ' > ') : null,
        price ? 'Prix : ' + price + ' FCFA' : null
    ].filter(Boolean).join('\n');

    const user = improve
        ? "Améliore la description ci-dessous : corrige l'orthographe, structure-la selon le format " +
          "demandé et rends-la plus vendeuse. Garde STRICTEMENT les mêmes informations, n'en ajoute aucune.\n\n" +
          (facts ? facts + '\n\n' : '') + 'Description actuelle :\n' + current
        : "Rédige la description de cet article d'occasion à partir des seules informations suivantes.\n\n" + facts;

    const text = clamp(await callOpenAI(itemSystemPrompt(), user, 700), MAX_DESC);
    return { text, mode: improve ? 'improve' : 'generate', model: MODEL };
}

/**
 * Annonce LED (200 caractères).
 * @param {{current:string, mode:'generate'|'improve'}} input
 */
async function writeAnnonce(input) {
    const current = String(input.current || '').trim().slice(0, 600);
    if (!current) {
        const err = new Error("Écris d'abord quelques mots sur ce que tu veux annoncer.");
        err.code = 'NEED_TEXT';
        throw err;
    }
    const improve = input.mode === 'improve';

    const user = improve
        ? "Reformule cette annonce pour le bandeau LED, sans ajouter d'information :\n\n" + current
        : "Transforme cette idée en annonce pour le bandeau LED :\n\n" + current;

    let text = clamp(await callOpenAI(annonceSystemPrompt(), user, 200), MAX_ANNONCE);

    // L'annonce passera par moderateAnnonce() à la publication : si le modèle a
    // quand même sorti un mot bloqué, autant le dire tout de suite.
    const check = moderateLocal(text);
    if (!check.ok) {
        const err = new Error("L'IA a produit un texte refusé par la modération. Réessaie.");
        err.code = 'MODERATED';
        throw err;
    }
    return { text, mode: improve ? 'improve' : 'generate', model: MODEL };
}

module.exports = { writeItemDescription, writeAnnonce, MAX_DESC, MAX_ANNONCE };
