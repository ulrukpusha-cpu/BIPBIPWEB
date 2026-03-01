/**
 * API Actualités : liste publique (approuvées), détail par slug, admin pending/approve/reject
 */
const express = require('express');
const router = express.Router();
const actualitesService = require('../services/actualitesService');
const { adminAuth } = require('../middleware/adminAuth');

// Liste des actualités publiées (tout le monde)
router.get('/', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = parseInt(req.query.offset, 10) || 0;
    const sort = ['date', 'popularite'].includes(req.query.sort) ? req.query.sort : 'date';
    actualitesService.listApproved(limit, offset, sort)
        .then(list => res.json({ actualites: list }))
        .catch(err => {
            console.error('actualites list:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

// Détail d'une actualité par slug
router.get('/slug/:slug', (req, res) => {
    actualitesService.getBySlug(req.params.slug)
        .then(article => {
            if (!article) return res.status(404).json({ error: 'Article introuvable' });
            res.json({ actualite: article });
        })
        .catch(err => {
            console.error('actualites slug:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

// ——— Admin (X-Admin-Key requis) ———
router.get('/admin/pending', adminAuth, (req, res) => {
    actualitesService.listPending()
        .then(list => res.json({ actualites: list }))
        .catch(err => {
            console.error('actualites pending:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

router.post('/admin/:id/approve', adminAuth, (req, res) => {
    actualitesService.approveActualite(req.params.id)
        .then(actualite => {
            if (!actualite) return res.status(404).json({ error: 'Actualité introuvable ou déjà traitée' });
            res.json({ success: true, actualite });
        })
        .catch(err => {
            console.error('actualites approve:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

router.post('/admin/:id/reject', adminAuth, (req, res) => {
    actualitesService.rejectActualite(req.params.id)
        .then(ok => {
            if (!ok) return res.status(404).json({ error: 'Actualité introuvable' });
            res.json({ success: true });
        })
        .catch(err => {
            console.error('actualites reject:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

module.exports = router;
