/**
 * API Actualités : liste publique (approuvées), détail par slug, admin pending/approve/reject
 */
const express = require('express');
const router = express.Router();
const actualitesService = require('../services/actualitesService');
const { adminAuth } = require('../middleware/adminAuth');

// Diagnostic : vérifier Supabase + nombre d'actualités approuvées (pour config)
router.get('/health', (req, res) => {
    const db = require('../database/supabase-client');
    if (!db.isAvailable()) {
        return res.json({ ok: false, error: 'Supabase non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env)' });
    }
    actualitesService.listApproved(1, 0, 'date')
        .then(list => res.json({ ok: true, supabase: 'connecté', actualites_approvees: list.length >= 1 ? 'oui' : 'aucune', count: list.length }))
        .catch(err => res.json({ ok: false, error: err.message }));
});

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

// ——— Ingest : OpenClaw, API externe, météo, etc. (X-Ingest-Key requis)
// POST /api/actualites/ingest avec header X-Ingest-Key: <INGEST_SECRET_KEY>
// Body: { title, content, summary_short?, sources?, type?: "news"|"weather"|"other", auto_approve?: true }
router.post('/ingest', (req, res) => {
    const secret = process.env.INGEST_SECRET_KEY || process.env.ADMIN_SECRET_KEY;
    if (!secret) return res.status(503).json({ error: 'Ingest non configuré (INGEST_SECRET_KEY ou ADMIN_SECRET_KEY dans .env)' });
    const key = req.headers['x-ingest-key'] || req.headers['x-admin-key'];
    if (key !== secret) return res.status(401).json({ error: 'Clé ingest invalide' });

    const { title, content, summary_short, sources, type, auto_approve } = req.body || {};
    if (!title || !content) return res.status(400).json({ error: 'title et content requis' });

    const status = auto_approve === true ? 'approved' : 'pending';
    actualitesService.createActualite({
        title: String(title).slice(0, 255),
        content: String(content),
        summary_short: summary_short != null ? String(summary_short).slice(0, 500) : null,
        sources: sources || null,
        status,
    })
        .then(result => {
            if (result.error) return res.status(400).json({ error: result.error });
            res.status(201).json({ success: true, actualite: result.actualite, status: result.actualite.status });
        })
        .catch(err => {
            console.error('actualites ingest:', err);
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
