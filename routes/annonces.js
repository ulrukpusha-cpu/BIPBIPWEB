/**
 * API Annonces payantes : grille, création (modération IA), liste par statut, admin valider/refuser
 */
const express = require('express');
const router = express.Router();
const annoncesService = require('../services/annoncesService');
const { adminAuth } = require('../middleware/adminAuth');
const { annonceLimiter } = require('../middleware/rateLimit');
const momoService = require('../services/mtn-momo');
const momoRepo = require('../database/momo-repository');

// Grille tarifaire (public)
router.get('/grille', (req, res) => {
    res.json({ grille: annoncesService.getGrille() });
});

// Créer une annonce (user) → modération IA, statut en_attente (rate limit comme v2)
router.post('/', annonceLimiter, (req, res) => {
    const { userId, contenu, prix } = req.body;
    if (!contenu || !prix) {
        return res.status(400).json({ error: 'contenu et prix requis' });
    }
    const prixNum = parseInt(prix, 10);
    if (Number.isNaN(prixNum)) {
        return res.status(400).json({ error: 'prix doit être un nombre' });
    }
    const uid = userId || req.body.telegram_user_id || 'web';
    annoncesService.createAnnonce(uid, String(contenu).trim(), prixNum)
        .then(result => {
            if (result.error) return res.status(400).json({ error: result.error });
            res.status(201).json(result);
        })
        .catch(err => {
            console.error('annonces create:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

// Paiement MoMo pour une annonce (après création, statut en_attente)
router.post('/:id/request-payment', async (req, res) => {
    try {
        const annonce = await annoncesService.getAnnonceById(req.params.id);
        if (!annonce) return res.status(404).json({ error: 'Annonce introuvable' });
        if (annonce.statut !== 'en_attente') return res.status(400).json({ error: 'Annonce déjà traitée' });
        if (!momoService.getConfig().isConfigured) return res.status(503).json({ error: 'MTN MoMo non configuré' });
        if (!momoRepo.isAvailable()) return res.status(503).json({ error: 'Base indisponible pour MoMo' });

        const phone = (req.body.phone || '').replace(/\D/g, '');
        if (phone.length < 10) return res.status(400).json({ error: 'Numéro de téléphone requis (10 chiffres)' });
        const payerPhone = phone.startsWith('225') ? phone : '225' + phone;

        const result = await momoService.requestToPay({
            amount: String(annonce.prix),
            currency: 'XOF',
            payerPhone,
            externalId: annonce.id,
            payeeNote: 'Annonce LED Bipbip'
        });

        await momoRepo.createTransaction({
            referenceId: result.referenceId,
            phoneNumber: payerPhone,
            amount: Number(annonce.prix),
            currency: 'XOF',
            status: 'PENDING',
            annonceId: annonce.id,
            telegramChatId: req.body.telegramChatId || null
        });

        res.status(201).json({ success: true, referenceId: result.referenceId, status: 'PENDING' });
    } catch (err) {
        console.error('annonces request-payment:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
});

// Liste des annonces validées pour la page Actualités (section Annonces sponsorisées)
router.get('/valides', (req, res) => {
    const sort = ['date', 'premium'].includes(req.query.sort) ? req.query.sort : 'date';
    annoncesService.listValidesForActualites(sort)
        .then(list => res.json({ annonces: list }))
        .catch(err => {
            console.error('annonces valides:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

// ——— Admin (X-Admin-Key requis) ———
router.get('/admin/en_attente', adminAuth, (req, res) => {
    annoncesService.listByStatut('en_attente')
        .then(list => res.json({ annonces: list }))
        .catch(err => {
            console.error('annonces en_attente:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

router.post('/admin/:id/valider', adminAuth, (req, res) => {
    annoncesService.validateAnnonce(req.params.id)
        .then(annonce => {
            if (annonce && annonce.error) return res.status(400).json({ error: annonce.error });
            if (!annonce) return res.status(404).json({ error: 'Annonce introuvable ou déjà traitée' });
            res.json({ success: true, annonce });
        })
        .catch(err => {
            console.error('annonces valider:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

router.post('/admin/:id/refuser', adminAuth, (req, res) => {
    annoncesService.refuseAnnonce(req.params.id)
        .then(ok => {
            if (!ok) return res.status(404).json({ error: 'Annonce introuvable' });
            res.json({ success: true });
        })
        .catch(err => {
            console.error('annonces refuser:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

module.exports = router;
