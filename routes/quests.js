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

        // Accorder les points uniquement aux utilisateurs enregistrés (Telegram ou Google)
        // Les anonymes (web_xxx) sont exclus côté serveur
        const isRegistered = userId && !userId.startsWith('web_') && /^-?\d+$/.test(userId);
        if (isRegistered) {
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


// Reclamer la recompense d'une quete (nouvelle mecanique, utilisee par quetes Telegram)
router.post('/claim', async (req, res) => {
    try {
        const userId = (req.userId || (req.body && req.body.userId) || '').toString();
        const code = (req.body && req.body.code) ? String(req.body.code) : '';
        if (!userId) return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
        if (userId.startsWith('web_')) return res.status(403).json({ error: 'Compte Telegram ou Google requis' });
        if (!code) return res.status(400).json({ error: 'Code quete requis' });
        const result = await questsService.claimQuestByCode(userId, code);
        if (result.error) return res.status(400).json({ error: result.error });
        return res.json(result);
    } catch (err) {
        console.error('quests claim:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ==================== ADMIN : CRUD quêtes ====================
// Vérification admin simple via X-Admin-Key (même pattern que les autres routes admin)
function isAdmin(req) {
    const key = String(req.headers['x-admin-key'] || '').trim();
    const expected = String(process.env.ADMIN_SECRET_KEY || '').trim();
    return !!expected && key === expected;
}

// GET /api/quests/admin/list — lister toutes les quêtes (actives + inactives)
router.get('/admin/list', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Clé admin requise' });
    try {
        const db = require('../database/supabase-client');
        const supabase = db.getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Base indisponible' });
        const { data, error } = await supabase.from('quests').select('*').order('is_active', { ascending: false }).order('points_reward', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        res.json({ quests: data || [] });
    } catch (e) {
        console.error('[admin quests list]', e);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// POST /api/quests/admin — créer une quête
router.post('/admin', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Clé admin requise' });
    try {
        const { code, type, titre, description, points_reward, is_active } = req.body || {};
        if (!code || !type) return res.status(400).json({ error: 'code et type requis' });
        const db = require('../database/supabase-client');
        const supabase = db.getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Base indisponible' });
        const { data, error } = await supabase.from('quests').insert({
            code: String(code).trim(),
            type: String(type).trim(),
            titre: titre || code,
            description: description || '',
            points_reward: Number(points_reward) || 0,
            is_active: is_active !== false,
        }).select().single();
        if (error) return res.status(400).json({ error: error.message });
        res.json({ ok: true, quest: data });
    } catch (e) {
        console.error('[admin quests create]', e);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// PUT /api/quests/admin/:id — modifier une quête
router.put('/admin/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Clé admin requise' });
    try {
        const id = req.params.id;
        const patch = {};
        ['code', 'type', 'titre', 'description'].forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
        if (req.body.points_reward !== undefined) patch.points_reward = Number(req.body.points_reward) || 0;
        if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;
        const db = require('../database/supabase-client');
        const supabase = db.getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Base indisponible' });
        const { data, error } = await supabase.from('quests').update(patch).eq('id', id).select().single();
        if (error) return res.status(400).json({ error: error.message });
        res.json({ ok: true, quest: data });
    } catch (e) {
        console.error('[admin quests update]', e);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// DELETE /api/quests/admin/:id — supprimer une quête
router.delete('/admin/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Clé admin requise' });
    try {
        const id = req.params.id;
        const db = require('../database/supabase-client');
        const supabase = db.getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Base indisponible' });
        const { error } = await supabase.from('quests').delete().eq('id', id);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ ok: true });
    } catch (e) {
        console.error('[admin quests delete]', e);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
