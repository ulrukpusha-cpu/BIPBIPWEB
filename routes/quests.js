/**
 * API Quêtes : liste, progression utilisateur, liens approuvés
 */
const express = require('express');
const router = express.Router();
const questsService = require('../services/questsService');
const telegramUsersService = require('../services/telegramUsersService');

// Liens YouTube/X approuvés (visibles dans l'onglet Quêtes)
router.get('/approved-links', async (req, res) => {
    try {
        const userId = req.query.userId || '';
        const links = await telegramUsersService.listApprovedLinks();
        const approved_links = await Promise.all(links.map(async (item) => {
            const already_clicked = userId
                ? await telegramUsersService.hasUserClickedLink(userId, item.id)
                : false;
            return { ...item, already_clicked };
        }));
        res.json({ approved_links, points_per_click: telegramUsersService.POINTS_PER_LINK_CLICK });
    } catch (err) {
        console.error('approved-links:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Clic sur un lien approuvé → enregistre le clic, crédite les points, redirige
router.get('/click-link/:id', async (req, res) => {
    try {
        const userId = req.query.userId || '';
        const linkOwnerId = req.params.id;

        if (userId) {
            await telegramUsersService.recordLinkClickAndAddPoints(userId, linkOwnerId);
        }

        const links = await telegramUsersService.listApprovedLinks();
        const item = links.find(l => l.id === linkOwnerId);
        if (item && item.link) {
            return res.redirect(302, item.link);
        }
        res.status(404).json({ error: 'Lien introuvable' });
    } catch (err) {
        console.error('click-link:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Liste des quêtes actives
router.get('/', (req, res) => {
    questsService.listActiveQuests()
        .then(list => res.json({ quests: list }))
        .catch(err => {
            console.error('quests list:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

// Progression d'un utilisateur
router.get('/user/:userId', (req, res) => {
    questsService.getUserProgress(req.params.userId)
        .then(list => res.json({ user_quests: list }))
        .catch(err => {
            console.error('quests user:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

// Mise à jour progression (appelé par le backend après une action: recharge, annonce, etc.)
router.put('/user/:userId/quest/:questId/progress', (req, res) => {
    const progress = parseInt(req.body.progress, 10);
    const completed = !!req.body.completed;
    if (isNaN(progress) && !completed) return res.status(400).json({ error: 'progress ou completed requis' });
    questsService.getOrCreateUserQuest(req.params.userId, req.params.questId)
        .then(() => questsService.setProgress(req.params.userId, req.params.questId, progress, completed))
        .then(data => res.json({ success: true, user_quest: data }))
        .catch(err => {
            console.error('quests progress:', err);
            res.status(500).json({ error: 'Erreur serveur' });
        });
});

module.exports = router;
