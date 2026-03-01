/**
 * Routes API MTN MoMo (RequestToPay, statut, callback).
 */
const express = require('express');
const router = express.Router();
const momoService = require('../services/mtn-momo');
const momoRepo = require('../database/momo-repository');

// Notification Telegram (réutilise la logique du serveur)
async function sendTelegramMessage(chatId, text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !chatId) return;
    try {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
        });
    } catch (e) {
        console.error('[MoMo] Telegram notify error:', e.message);
    }
}

/**
 * POST /api/momo/request-to-pay
 * Body: { amount, phone, orderId?, telegramChatId?, payerMessage?, payeeNote? }
 */
router.post('/request-to-pay', async (req, res) => {
    try {
        if (!momoService.getConfig().isConfigured) {
            return res.status(503).json({ error: 'MTN MoMo non configuré' });
        }
        if (!momoRepo.isAvailable()) {
            return res.status(503).json({ error: 'Supabase requis pour les paiements MoMo' });
        }

        const { amount, phone, orderId, telegramChatId, payerMessage, payeeNote } = req.body;
        if (!amount || !phone) {
            return res.status(400).json({ error: 'amount et phone requis' });
        }

        const result = await momoService.requestToPay({
            amount: String(amount),
            currency: 'XOF',
            payerPhone: phone,
            externalId: orderId || undefined,
            payerMessage,
            payeeNote
        });

        await momoRepo.createTransaction({
            referenceId: result.referenceId,
            phoneNumber: phone,
            amount: Number(amount),
            currency: 'XOF',
            status: 'PENDING',
            orderId: orderId || null,
            telegramChatId: telegramChatId || null
        });

        res.status(201).json({
            success: true,
            referenceId: result.referenceId,
            status: 'PENDING'
        });
    } catch (err) {
        console.error('[MoMo] request-to-pay error:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
});

/**
 * GET /api/momo/status/:referenceId
 */
router.get('/status/:referenceId', async (req, res) => {
    try {
        if (!momoRepo.isAvailable()) {
            return res.status(503).json({ error: 'Supabase requis pour les paiements MoMo' });
        }
        const { referenceId } = req.params;
        const tx = await momoRepo.getTransactionByReferenceId(referenceId);
        if (!tx) {
            return res.status(404).json({ error: 'Transaction introuvable' });
        }
        res.json({ transaction: tx });
    } catch (err) {
        console.error('[MoMo] status error:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
});

/**
 * GET /api/momo/poll-status/:referenceId
 * Interroge MTN et met à jour la DB puis retourne le statut.
 */
router.get('/poll-status/:referenceId', async (req, res) => {
    try {
        if (!momoRepo.isAvailable()) {
            return res.status(503).json({ error: 'Supabase requis pour les paiements MoMo' });
        }
        const { referenceId } = req.params;
        const tx = await momoRepo.getTransactionByReferenceId(referenceId);
        if (!tx) {
            return res.status(404).json({ error: 'Transaction introuvable' });
        }
        if (tx.status !== 'PENDING') {
            return res.json({ transaction: tx });
        }

        const statusResult = await momoService.getTransactionStatus(referenceId);
        const newStatus = (statusResult.status || '').toUpperCase();
        if (newStatus === 'SUCCESSFUL' || newStatus === 'FAILED') {
            await momoRepo.updateTransactionStatus(
                referenceId,
                newStatus,
                statusResult.reason || null
            );
            const updated = await momoRepo.getTransactionByReferenceId(referenceId);
            if (newStatus === 'SUCCESSFUL' && updated.telegramChatId) {
                await sendTelegramMessage(
                    updated.telegramChatId,
                    `✅ <b>Paiement MoMo reçu</b>\n\n` +
                    `Montant: ${updated.amount} FCFA\n` +
                    `Référence: ${referenceId}`
                );
            }
            return res.json({ transaction: updated });
        }

        res.json({ transaction: tx });
    } catch (err) {
        console.error('[MoMo] poll-status error:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
});

/**
 * PUT /api/momo/callback
 * Callback appelé par MTN quand le statut change.
 * Valider l'origine si MTN envoie un header (ex: X-Callback-Secret). Body attendu: referenceId, status.
 */
router.put('/callback', async (req, res) => {
    try {
        if (!momoRepo.isAvailable()) {
            return res.status(503).json({ error: 'Supabase requis pour les paiements MoMo' });
        }
        const secret = process.env.MTN_CALLBACK_SECRET;
        if (secret && req.headers['x-callback-secret'] !== secret) {
            return res.status(401).json({ error: 'Callback non autorisé' });
        }

        const referenceId = req.body.referenceId || req.body.reference_id || req.headers['x-reference-id'];
        const status = (req.body.status || '').toUpperCase();

        if (!referenceId || !['SUCCESSFUL', 'FAILED', 'PENDING'].includes(status)) {
            return res.status(400).json({ error: 'referenceId et status (SUCCESSFUL/FAILED/PENDING) requis' });
        }

        const tx = await momoRepo.getTransactionByReferenceId(referenceId);
        if (!tx) {
            return res.status(404).json({ error: 'Transaction introuvable' });
        }

        await momoRepo.updateTransactionStatus(referenceId, status, req.body.reason || null);

        if (status === 'SUCCESSFUL' && tx.telegramChatId) {
            const updated = await momoRepo.getTransactionByReferenceId(referenceId);
            await sendTelegramMessage(
                updated.telegramChatId,
                `✅ <b>Paiement MoMo reçu</b>\n\nMontant: ${updated.amount} FCFA\nRéférence: ${referenceId}`
            );
        }

        res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[MoMo] callback error:', err);
        res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
});

module.exports = router;
