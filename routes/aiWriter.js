/**
 * API Aide IA à la rédaction : description d'article Market et annonce LED.
 * Réservée aux utilisateurs connectés (l'appel est facturé côté OpenAI) et
 * limitée à 6 demandes par minute et par utilisateur.
 */
const express = require('express');
const router = express.Router();
const { authTelegram } = require('../middleware/auth');
const { createLimiter } = require('../middleware/rateLimit');
const aiWriter = require('../services/aiWriter');

const aiLimiter = createLimiter(60 * 1000, 6, "Trop de demandes à l'IA. Patiente une minute.");

function requireUser(req, res, next) {
    if (!req.userId) {
        return res.status(401).json({ error: "Connecte-toi pour utiliser l'aide IA." });
    }
    next();
}

function handleError(res, err) {
    const known = ['NO_KEY', 'NEED_NAME', 'NEED_TEXT', 'MODERATED', 'TIMEOUT', 'UPSTREAM', 'EMPTY', 'QUOTA'];
    if (err && known.includes(err.code)) {
        const status = (err.code === 'NEED_NAME' || err.code === 'NEED_TEXT') ? 400
            : (err.code === 'NO_KEY' || err.code === 'QUOTA') ? 503 : 502;
        return res.status(status).json({ error: err.message, code: err.code });
    }
    console.error('[aiWriter] ', err);
    res.status(500).json({ error: "L'aide IA est momentanément indisponible." });
}

// Description d'un article Market
router.post('/item-description', authTelegram, requireUser, aiLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const out = await aiWriter.writeItemDescription({
            name: b.name, cat: b.cat, price: b.price,
            current: b.current, mode: b.mode === 'improve' ? 'improve' : 'generate'
        });
        res.json({ ok: true, ...out });
    } catch (err) { handleError(res, err); }
});

// Annonce LED (200 caractères)
router.post('/annonce', authTelegram, requireUser, aiLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const out = await aiWriter.writeAnnonce({
            current: b.current, mode: b.mode === 'improve' ? 'improve' : 'generate'
        });
        res.json({ ok: true, ...out });
    } catch (err) { handleError(res, err); }
});

// Dispo de la fonctionnalité (permet au client de masquer le bouton si non configuré)
router.get('/health', (req, res) => {
    res.json({ ok: true, enabled: !!process.env.OPENAI_API_KEY });
});

module.exports = router;
