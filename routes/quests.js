/**
 * API Quêtes : liste, progression utilisateur
 */
const express = require('express');
const router = express.Router();
const questsService = require('../services/questsService');

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
