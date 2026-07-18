/* =========================================================
   Bipbip Cabine — routes API des commerciaux (Kbine)
   Montées sous /api/cabine  (voir server.js : app.use('/api/cabine', cabineRoutes))
   Public  : login, recharge, history, bundles, wave-proof
   Admin   : protégé par X-Admin-Key (middleware adminAuth)
   ========================================================= */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const cabine = require('../services/cabineService');
const { adminAuth } = require('../middleware/adminAuth');

const UPLOADS_DIR = path.resolve('./uploads');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}

function fail(res, code, msg) { return res.status(code).json({ ok: false, error: msg }); }

// Sauve une image base64 (data URL) sous /uploads, renvoie le chemin public ou null
function saveBase64Image(dataUrl, prefix) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    if (m) {
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const fname = `${prefix || 'cabine'}-${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(m[2], 'base64'));
        return '/uploads/' + fname;
    }
    if (/^https?:\/\//i.test(dataUrl) || dataUrl.startsWith('/')) return dataUrl;
    return null;
}

// ---- POST /api/cabine/login  { code } ------------------------------------
router.post('/login', async (req, res) => {
    try {
        const code = (req.body && req.body.code) || '';
        if (!code) return fail(res, 400, 'Code requis');
        const r = await cabine.login(code);
        if (!r.ok) return res.status(401).json(r);
        res.json(r);
    } catch (e) {
        console.error('[cabine/login]', e.message);
        fail(res, 500, 'Erreur serveur');
    }
});

// ---- POST /api/cabine/recharge -------------------------------------------
// { code, operator, recipient, amount, type:'credit'|'bundle', bundleId?, bundleType? }
router.post('/recharge', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.code) return fail(res, 400, 'Code requis');
        if (!b.recipient) return fail(res, 400, 'Numéro requis');
        const r = await cabine.recharge(b);
        if (!r.ok && r.error === 'Code invalide') return res.status(401).json(r);
        // notifie le bot admin cabine (alerte Valider/Rejeter) — best-effort
        if (r.ok && r.order) {
            try { require('./cabineBot').notifyNewOrder(r.order, r.cabine); } catch (e) { console.error('[cabine notify]', e.message); }
        }
        res.json(r);
    } catch (e) {
        console.error('[cabine/recharge]', e.message);
        fail(res, 500, 'Erreur serveur');
    }
});

// ---- GET /api/cabine/order/:id?code=  (polling du statut par l'app) -------
router.get('/order/:id', async (req, res) => {
    try {
        const code = req.query.code || '';
        if (!code) return fail(res, 400, 'Code requis');
        const o = await cabine.getOrder(code, req.params.id);
        if (!o) return fail(res, 404, 'Commande introuvable');
        res.json({ ok: true, order: o });
    } catch (e) { fail(res, 500, 'Erreur serveur'); }
});

// ---- GET /api/cabine/message  (bandeau LED actif pour l'app) --------------
router.get('/message', async (req, res) => {
    try {
        const m = await cabine.getActiveMessage();
        res.json({ ok: true, message: m ? m.message : null });
    } catch (e) { res.json({ ok: true, message: null }); }
});

// ---- GET /api/cabine/history?code= ---------------------------------------
router.get('/history', async (req, res) => {
    try {
        const code = req.query.code || '';
        if (!code) return fail(res, 400, 'Code requis');
        const list = await cabine.history(code);
        res.json({ ok: true, orders: list });
    } catch (e) {
        console.error('[cabine/history]', e.message);
        fail(res, 500, 'Erreur serveur');
    }
});

// ---- GET /api/cabine/bundles?operator= -----------------------------------
router.get('/bundles', async (req, res) => {
    try {
        const data = await cabine.bundles(req.query.operator);
        res.json(data);
    } catch (e) {
        console.error('[cabine/bundles]', e.message);
        fail(res, 502, 'Gateway injoignable');
    }
});

// ---- POST /api/cabine/wave-proof  { code, preuve(base64?), montant? } -----
router.post('/wave-proof', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.code) return fail(res, 400, 'Code requis');
        const preuveUrl = saveBase64Image(b.preuve, 'cabine-wave');
        const r = await cabine.waveProof({ code: b.code, preuve_url: preuveUrl, montant: b.montant });
        if (!r.ok) return fail(res, 400, r.error);
        // Alerte au bot Cabine : preuve reçue → image + bouton Confirmer/débloquer
        try {
            const cab = await cabine.getCabineByCode(b.code);
            require('./cabineBot').notifyNewDeposit(r.deposit, cab);
        } catch (e) { console.error('[cabine notify deposit]', e.message); }
        res.json(r);
    } catch (e) {
        console.error('[cabine/wave-proof]', e.message);
        fail(res, 500, 'Erreur serveur');
    }
});

// ---- POST /api/cabine/postuler — candidature KYC (bouton "Postuler") ------
// { nom, telephone, date_naissance?, commune?, piece_type?, piece_numero?, piece(base64)?, selfie(base64)? }
router.post('/postuler', async (req, res) => {
    try {
        const b = req.body || {};
        const piece_url = saveBase64Image(b.piece, 'cabine-kyc-piece');
        const selfie_url = saveBase64Image(b.selfie, 'cabine-kyc-selfie');
        const r = await cabine.createCandidature({
            nom: b.nom, telephone: b.telephone, date_naissance: b.date_naissance,
            commune: b.commune, piece_type: b.piece_type, piece_numero: b.piece_numero,
            piece_url, selfie_url,
        });
        if (!r.ok) return fail(res, 400, r.error);
        // Alerte au bot Cabine : nouvelle candidature (photos + boutons Approuver/Rejeter)
        try { require('./cabineBot').notifyNewCandidature(r.candidature); }
        catch (e) { console.error('[cabine notify candidature]', e.message); }
        res.json({ ok: true, id: r.candidature.id });
    } catch (e) {
        console.error('[cabine/postuler]', e.message);
        fail(res, 500, 'Erreur serveur');
    }
});

// ======================= ADMIN (X-Admin-Key) =============================
router.get('/admin/cabines', adminAuth, async (req, res) => {
    try { res.json({ ok: true, cabines: await cabine.adminListCabines() }); }
    catch (e) { fail(res, 500, e.message); }
});

router.post('/admin/cabines', adminAuth, async (req, res) => {
    try {
        const b = req.body || {};
        const photo_url = saveBase64Image(b.photo, 'cabine-photo');
        const r = await cabine.adminCreateCabine({ ...b, photo_url });
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});

// Générateur : crée une cabine avec un code auto-généré qui expire (défaut 1 mois)
// Accepte une photo (base64) qui s'affichera dans le profil du commercial.
router.post('/admin/generate', adminAuth, async (req, res) => {
    try {
        const b = req.body || {};
        const photo_url = saveBase64Image(b.photo, 'cabine-photo');
        const r = await cabine.adminGenerateCabine({ ...b, photo_url });
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});

// Définir / changer la photo d'un commercial
router.post('/admin/cabines/:code/photo', adminAuth, async (req, res) => {
    try {
        const photo_url = saveBase64Image((req.body || {}).photo, 'cabine-photo');
        if (!photo_url) return fail(res, 400, 'Photo invalide');
        const r = await cabine.adminSetPhoto(req.params.code, photo_url);
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});

// ---- Candidatures KYC : lister / approuver / rejeter ---------------------
router.get('/admin/candidatures', adminAuth, async (req, res) => {
    try {
        const status = req.query.status === undefined ? 'en_attente' : req.query.status;
        res.json({ ok: true, candidatures: await cabine.adminListCandidatures(status) });
    } catch (e) { fail(res, 500, e.message); }
});
router.post('/admin/candidatures/:id/approve', adminAuth, async (req, res) => {
    try {
        const r = await cabine.adminApproveCandidature(req.params.id);
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});
router.post('/admin/candidatures/:id/reject', adminAuth, async (req, res) => {
    try {
        const r = await cabine.adminRejectCandidature(req.params.id);
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});

// ---- Commandes en attente : lister / valider / rejeter -------------------
router.get('/admin/orders', adminAuth, async (req, res) => {
    try { res.json({ ok: true, orders: await cabine.adminListPendingOrders() }); }
    catch (e) { fail(res, 500, e.message); }
});
router.post('/admin/orders/:id/validate', adminAuth, async (req, res) => {
    try {
        const r = await cabine.adminValidateOrder(req.params.id);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});
router.post('/admin/orders/:id/reject', adminAuth, async (req, res) => {
    try {
        const r = await cabine.adminRejectOrder(req.params.id, (req.body || {}).reason);
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});
// Annuler une commande validée (échec USSD réel) → réajuste les compteurs
router.post('/admin/orders/:id/cancel', adminAuth, async (req, res) => {
    try {
        const r = await cabine.adminCancelOrder(req.params.id);
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});

// ---- Message LED diffusé aux cabines -------------------------------------
router.post('/admin/message', adminAuth, async (req, res) => {
    try {
        const r = await cabine.adminSetMessage((req.body || {}).message);
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});
router.delete('/admin/message', adminAuth, async (req, res) => {
    try { res.json(await cabine.adminClearMessage()); }
    catch (e) { fail(res, 500, e.message); }
});

router.put('/admin/cabines/:code', adminAuth, async (req, res) => {
    try {
        const r = await cabine.adminSetCabine(req.params.code, req.body || {});
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});

router.get('/admin/deposits', adminAuth, async (req, res) => {
    try {
        const status = req.query.status === undefined ? 'en_attente' : req.query.status;
        res.json({ ok: true, deposits: await cabine.adminListDeposits(status) });
    } catch (e) { fail(res, 500, e.message); }
});

router.post('/admin/deposits/:id/confirm', adminAuth, async (req, res) => {
    try {
        const r = await cabine.adminConfirmDeposit(req.params.id);
        if (!r.ok) return fail(res, 400, r.error);
        res.json(r);
    } catch (e) { fail(res, 500, e.message); }
});

// Démarre le nettoyage hebdo des preuves Wave (lundi 07h Abidjan) — au chargement
try { require('../cron/cabineProofCleanup').start(); } catch (e) { console.error('[cabine cron]', e.message); }

module.exports = router;
