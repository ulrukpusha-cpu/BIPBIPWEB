/* =========================================================
   Bipbip Cabine — BOT TELEGRAM DÉDIÉ (séparé du bot admin existant)
   Webhook : POST /api/telegram/webhook-cabine
   Token   : TELEGRAM_BOT_TOKEN_CABINE  (à créer via @BotFather)
   Admins  : CABINE_ADMIN_CHAT_IDS (csv) sinon ADMIN_CHAT_IDS / ADMIN_CHAT_ID
   Gère : commandes cabine + alertes de validation des commandes.
   ========================================================= */
const express = require('express');
const router = express.Router();
const cabine = require('../services/cabineService');

function token() { return (process.env.TELEGRAM_BOT_TOKEN_CABINE || '').trim(); }
function adminIds() {
    const csv = (process.env.CABINE_ADMIN_CHAT_IDS || process.env.ADMIN_CHAT_IDS || process.env.ADMIN_CHAT_ID || '').trim();
    return csv ? csv.split(',').map(s => s.trim()).filter(Boolean) : [];
}
function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F'; }

async function tg(method, body) {
    const tok = token();
    if (!tok) return null;
    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(`https://api.telegram.org/bot${tok}/${method}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return r.json();
    } catch (e) { console.error('[cabineBot]', method, e.message); return null; }
}
function send(chatId, text, extra) { return tg('sendMessage', Object.assign({ chat_id: chatId, text, parse_mode: 'HTML' }, extra || {})); }
function answer(cbId, text) { return tg('answerCallbackQuery', { callback_query_id: cbId, text: text || undefined }); }
// Retire les boutons du message d'origine (après clic Valider/Rejeter/Annuler)
function clearButtons(cq) {
    const m = cq && cq.message;
    if (!m || !m.chat) return null;
    return tg('editMessageReplyMarkup', { chat_id: m.chat.id, message_id: m.message_id, reply_markup: { inline_keyboard: [] } });
}

// Alerte "nouvelle commande à valider" → tous les admins cabine
async function notifyNewOrder(order, cab) {
    if (!token()) return; // bot non configuré : la validation se fait via le panneau web
    const ids = adminIds();
    const nom = (cab && cab.nom_cabine) || order.cabine_code;
    const detail = order.type === 'bundle'
        ? `Forfait <code>${order.bundle_id || ''}</code>`
        : fmt(order.amount);
    const txt = `🆕 <b>Nouvelle commande #${order.id}</b>\n` +
        `🏪 ${nom} (${order.cabine_code})\n` +
        `📲 ${String(order.operator).toUpperCase()} · ${detail}\n` +
        `📞 ${order.recipient}`;
    const kb = { inline_keyboard: [[
        { text: '✅ Valider', callback_data: `cab_ord_ok_${order.id}` },
        { text: '❌ Rejeter', callback_data: `cab_ord_no_${order.id}` },
    ]] };
    for (const id of ids) await send(id, txt, { reply_markup: kb });
}

// ---- Helpers photos / diffusion admins ----
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://bipbiprecharge.ci').replace(/\/$/, '');
function proofUrl(u) { return /^https?:\/\//i.test(u) ? u : (PUBLIC_BASE + (u.startsWith('/') ? u : '/' + u)); }
function localPath(u) { return require('path').resolve('./', String(u).replace(/^\//, '')); }
// Envoie une photo en UPLOADANT les octets (multipart) — fiable derrière Cloudflare.
// Fallback : envoi par URL si le fichier local est introuvable.
async function sendPhoto(chatId, fileOrUrl, caption, extra) {
    const tok = token(); if (!tok) return null;
    extra = extra || {};
    try {
        const fs = require('fs');
        const lp = /^https?:\/\//i.test(fileOrUrl) ? null : localPath(fileOrUrl);
        if (lp && fs.existsSync(lp)) {
            const buf = fs.readFileSync(lp);
            const ext = (lp.split('.').pop() || 'png').toLowerCase();
            const type = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
            const form = new FormData();
            form.append('chat_id', String(chatId));
            if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML'); }
            if (extra.reply_markup) form.append('reply_markup', JSON.stringify(extra.reply_markup));
            form.append('photo', new Blob([buf], { type }), 'preuve.' + ext);
            const r = await fetch(`https://api.telegram.org/bot${tok}/sendPhoto`, { method: 'POST', body: form });
            return r.json();
        }
        return tg('sendPhoto', Object.assign({ chat_id: chatId, photo: proofUrl(fileOrUrl), caption, parse_mode: 'HTML' }, extra));
    } catch (e) { console.error('[cabineBot sendPhoto]', e.message); return null; }
}
async function sendToAdmins(text, extra) { for (const id of adminIds()) await send(id, text, extra); }
async function sendPhotoToAdmins(file, caption, extra) { for (const id of adminIds()) await sendPhoto(id, file, caption, extra); }

// Alerte "preuve de versement Wave reçue" → admins (image + bouton Confirmer/débloquer)
async function notifyNewDeposit(dep, cab) {
    if (!token()) return;
    const nom = (cab && cab.nom_cabine) || dep.cabine_code;
    const caption = `💧 <b>Versement Wave reçu — #${dep.id}</b>\n` +
        `🏪 ${nom} (${dep.cabine_code})\n💰 ${fmt(dep.montant)}\n🗓 ${new Date(dep.created_at).toLocaleString('fr-FR')}`;
    const kb = { reply_markup: { inline_keyboard: [[ { text: '✅ Confirmer (débloque le compte)', callback_data: `cab_dep_ok_${dep.id}` } ]] } };
    for (const id of adminIds()) {
        if (dep.preuve_url) await sendPhoto(id, dep.preuve_url, caption, kb);
        else await send(id, caption + '\n⚠️ Pas de preuve jointe', kb);
    }
}

// Alerte "nouvelle candidature KYC" (bouton Postuler de l'APK) → admins
async function notifyNewCandidature(cand) {
    if (!token()) return;
    const txt = `📝 <b>Nouvelle candidature #${cand.id}</b>\n` +
        `👤 ${cand.nom}\n📞 ${cand.telephone}\n` +
        (cand.date_naissance ? `🎂 ${cand.date_naissance}\n` : '') +
        (cand.commune ? `📍 ${cand.commune}\n` : '') +
        (cand.piece_type ? `🪪 ${cand.piece_type}${cand.piece_numero ? ' · ' + cand.piece_numero : ''}\n` : '') +
        `🗓 ${new Date(cand.created_at).toLocaleString('fr-FR')}`;
    const kb = { reply_markup: { inline_keyboard: [[
        { text: '✅ Approuver (créer le code)', callback_data: `cab_cand_ok_${cand.id}` },
        { text: '❌ Rejeter', callback_data: `cab_cand_no_${cand.id}` },
    ]] } };
    for (const id of adminIds()) {
        if (cand.selfie_url) await sendPhoto(id, cand.selfie_url, '👤 Photo du candidat — ' + cand.nom);
        if (cand.piece_url) await sendPhoto(id, cand.piece_url, '🪪 Pièce d\'identité — ' + cand.nom);
        await send(id, txt, kb);
    }
}

// Archive hebdo : envoie toutes les preuves aux admins (datées), puis supprime les fichiers + référence DB
async function archiveAndCleanProofs() {
    if (!token()) return { ok: false, error: 'bot non configuré' };
    const fs = require('fs'); const path = require('path');
    const deps = await cabine.listDepositsWithProof();
    if (!deps.length) { await sendToAdmins('🧹 <b>Archive preuves Wave</b> : aucune preuve à archiver.'); return { ok: true, count: 0 }; }
    const now = new Date();
    await sendToAdmins(`📦 <b>Archive des preuves Wave</b>\n🗓 ${now.toLocaleString('fr-FR')}\n${deps.length} preuve(s) — envoi puis nettoyage du serveur.`);
    let done = 0;
    for (const d of deps) {
        const caption = `🧾 #${d.id} · <b>${d.cabine_code}</b> · ${fmt(d.montant)}\n🗓 déposé le ${new Date(d.created_at).toLocaleString('fr-FR')} · statut: ${d.status}`;
        try { await sendPhotoToAdmins(d.preuve_url, caption); } catch (e) { console.error('[cabineBot archive]', e.message); }
        try {
            const rel = String(d.preuve_url).replace(/^\//, '');
            const fp = path.resolve('./', rel);
            if (/uploads[\\/]/.test(fp) && fs.existsSync(fp)) fs.unlinkSync(fp);
        } catch (e) { /* ignore */ }
        await cabine.clearDepositProof(d.id);
        done++;
    }
    await sendToAdmins(`✅ Archive terminée : <b>${done}</b> preuve(s) envoyée(s) et supprimée(s) du serveur. Espace nettoyé.`);
    return { ok: true, count: done };
}

// ---- Webhook ----
router.post('/', (req, res) => {
    res.json({ ok: true });
    setImmediate(() => handle(req.body).catch(e => console.error('[cabineBot handle]', e)));
});

async function handle(body) {
    if (!token()) return;
    const { message, edited_message, callback_query } = body || {};
    const ids = adminIds();

    const msg = message || edited_message;
    if (msg && msg.text && msg.chat) {
        const chatId = msg.chat.id;
        const raw = (msg.text || '').trim();
        const cmd = raw.toLowerCase().split(/\s+/)[0];
        if (!ids.includes(String(chatId))) { await send(chatId, '⛔ Accès réservé aux admins Cabine.'); return; }

        if (cmd === '/start' || cmd === '/help') {
            await send(chatId, '🏪 <b>Bot Cabine</b>\n\n' +
                '/commandes — Commandes à valider\n' +
                '/cabines — Liste des cabines\n' +
                '/gencabine Nom — générer un code (1 mois)\n' +
                '/versements — Versements Wave en attente\n' +
                '/message Texte — diffuser un message LED\n' +
                '/clearmessage — retirer le message LED\n' +
                '/archiveproofs — archiver + nettoyer les preuves Wave\n' +
                '/candidatures — candidatures KYC en attente');
            return;
        }
        if (cmd === '/archiveproofs') {
            await send(chatId, '📦 Archivage des preuves Wave en cours…');
            const r = await archiveAndCleanProofs();
            if (!r.ok) await send(chatId, `❌ ${r.error}`);
            return;
        }
        if (cmd === '/candidatures') {
            const list = await cabine.adminListCandidatures('en_attente');
            if (!list.length) { await send(chatId, '📭 Aucune candidature en attente.'); return; }
            await send(chatId, `📝 <b>${list.length} candidature(s) en attente</b>`);
            for (const c of list.slice(0, 15)) await notifyNewCandidature(c);
            return;
        }
        if (cmd === '/commandes') {
            const list = await cabine.adminListPendingOrders();
            if (!list.length) { await send(chatId, '📭 Aucune commande en attente.'); return; }
            await send(chatId, `📋 <b>${list.length} commande(s) à valider</b>`);
            for (const o of list.slice(0, 20)) {
                const detail = o.type === 'bundle' ? `Forfait ${o.bundle_id || ''}` : fmt(o.amount);
                await send(chatId, `#${o.id} — <b>${o.cabine_code}</b>\n📲 ${String(o.operator).toUpperCase()} · ${detail}\n📞 ${o.recipient}`,
                    { reply_markup: { inline_keyboard: [[
                        { text: '✅ Valider', callback_data: `cab_ord_ok_${o.id}` },
                        { text: '❌ Rejeter', callback_data: `cab_ord_no_${o.id}` },
                    ]] } });
            }
            return;
        }
        if (cmd === '/cabines') {
            const all = await cabine.adminListCabines();
            if (!all.length) { await send(chatId, '📭 Aucune cabine. Crée : <code>/gencabine Nom</code>'); return; }
            await send(chatId, `🏪 <b>${all.length} cabine(s)</b>`);
            for (const c of all.slice(0, 25)) {
                const exp = c.expires_at ? new Date(c.expires_at).toLocaleDateString('fr-FR') : '∞';
                await send(chatId,
                    `<b>${c.code}</b> — ${c.nom_cabine}\n` +
                    `${c.actif ? '🟢 actif' : '🔴 inactif'}${c.expired ? ' · ⏰ EXPIRÉ' : ''} ${c.locked ? '· 🔒' : ''}\n` +
                    `Plafond ${c.tx_since_deposit}/${c.tx_plafond} · Dû ${fmt(c.montant_du)} · Expire ${exp}`,
                    { reply_markup: { inline_keyboard: [[ c.actif
                        ? { text: '🔴 Désactiver', callback_data: `cab_off_${c.code}` }
                        : { text: '🟢 Activer', callback_data: `cab_on_${c.code}` } ]] } });
            }
            return;
        }
        if (cmd === '/gencabine') {
            const nom = raw.split(/\s+/).slice(1).join(' ');
            if (!nom) { await send(chatId, 'Usage : <code>/gencabine Nom de la cabine</code>'); return; }
            const r = await cabine.adminGenerateCabine({ nom_cabine: nom, mois: 1 });
            if (r.ok) {
                const exp = r.expires_at ? new Date(r.expires_at).toLocaleDateString('fr-FR') : '';
                await send(chatId, `✅ Code pour <b>${nom}</b>\n\n🔑 <code>${r.code}</code>\n⏳ Expire le ${exp}`);
            } else await send(chatId, `❌ ${r.error}`);
            return;
        }
        if (cmd === '/versements') {
            const deps = await cabine.adminListDeposits('en_attente');
            if (!deps.length) { await send(chatId, '📭 Aucun versement Wave en attente.'); return; }
            await send(chatId, `💧 <b>${deps.length} versement(s) Wave en attente</b>`);
            for (const d of deps.slice(0, 20)) {
                await send(chatId, `#${d.id} — <b>${d.cabine_code}</b>\n💰 ${fmt(d.montant)}${d.preuve_url ? '\n🧾 Preuve envoyée' : '\n⚠️ Pas de preuve'}`,
                    { reply_markup: { inline_keyboard: [[ { text: '✅ Confirmer (débloque)', callback_data: `cab_dep_ok_${d.id}` } ]] } });
            }
            return;
        }
        if (cmd === '/message') {
            const m = raw.split(/\s+/).slice(1).join(' ');
            if (!m) { await send(chatId, 'Usage : <code>/message Ton texte à diffuser</code>'); return; }
            const r = await cabine.adminSetMessage(m);
            await send(chatId, r.ok ? '📢 Message LED diffusé à toutes les cabines.' : `❌ ${r.error}`);
            return;
        }
        if (cmd === '/clearmessage') {
            await cabine.adminClearMessage();
            await send(chatId, '🧹 Message LED retiré.');
            return;
        }
        await send(chatId, '❓ /commandes, /cabines, /gencabine, /versements, /message, /clearmessage');
        return;
    }

    if (callback_query) {
        const data = (callback_query.data || '').trim();
        const chatId = callback_query.message && callback_query.message.chat ? callback_query.message.chat.id : null;
        const cbId = callback_query.id;
        if (!chatId || !ids.includes(String(chatId))) { await answer(cbId, 'Non autorisé'); return; }

        if (data.startsWith('cab_ord_ok_')) {
            const id = data.replace('cab_ord_ok_', '');
            await clearButtons(callback_query); // les boutons Valider/Rejeter disparaissent
            const r = await cabine.adminValidateOrder(id);
            const o = r.order || {};
            const ligne = `📞 ${o.recipient || ''} · ${fmt(o.amount)}`;
            if (r.ok) {
                await answer(cbId, 'Validée — recharge envoyée');
                await send(chatId,
                    `✅ <b>Commande #${id} validée — recharge envoyée</b>\n${ligne}\nRéf : ${r.gateway_ref || '—'}` +
                    (r.timeout ? `\nℹ️ Confirmation différée (normal). Si le client ne reçoit <b>rien</b>, appuie sur Annuler.` : '') +
                    (r.locked ? `\n🔒 Cabine bloquée (plafond atteint) — versement Wave requis.` : ''),
                    r.timeout ? { reply_markup: { inline_keyboard: [[ { text: '❌ Annuler (non reçu)', callback_data: `cab_ord_cancel_${id}` } ]] } } : undefined);
            } else {
                await answer(cbId, r.error || 'Erreur');
                await send(chatId, `❌ Commande #${id} non validée : ${r.error}`);
            }
            return;
        }
        if (data.startsWith('cab_ord_no_')) {
            const id = data.replace('cab_ord_no_', '');
            await clearButtons(callback_query);
            const r = await cabine.adminRejectOrder(id);
            await answer(cbId, r.ok ? 'Rejetée' : (r.error || 'Erreur'));
            await send(chatId, r.ok ? `❌ Commande #${id} rejetée.` : `⚠️ #${id} : ${r.error}`);
            return;
        }
        if (data.startsWith('cab_ord_cancel_')) {
            const id = data.replace('cab_ord_cancel_', '');
            await clearButtons(callback_query);
            const r = await cabine.adminCancelOrder(id);
            await answer(cbId, r.ok ? 'Annulée' : (r.error || 'Erreur'));
            await send(chatId, r.ok
                ? `❌ Commande #${id} annulée (marquée échec, compteurs réajustés).`
                : `⚠️ #${id} : ${r.error}`);
            return;
        }
        if (data.startsWith('cab_cand_ok_')) {
            const id = data.replace('cab_cand_ok_', '');
            await clearButtons(callback_query);
            const r = await cabine.adminApproveCandidature(id);
            await answer(cbId, r.ok ? 'Approuvée — code créé' : (r.error || 'Erreur'));
            await send(chatId, r.ok
                ? `✅ <b>Candidature #${id} approuvée</b>\n👤 ${r.candidature.nom}\n\n🔑 Code d'accès : <code>${r.code}</code>\n⏳ Expire le ${r.expires_at ? new Date(r.expires_at).toLocaleDateString('fr-FR') : '—'}\n\nEnvoie ce code au commercial (WhatsApp/SMS : ${r.candidature.telephone}).`
                : `⚠️ Candidature #${id} : ${r.error}`);
            return;
        }
        if (data.startsWith('cab_cand_no_')) {
            const id = data.replace('cab_cand_no_', '');
            await clearButtons(callback_query);
            const r = await cabine.adminRejectCandidature(id);
            await answer(cbId, r.ok ? 'Rejetée' : (r.error || 'Erreur'));
            await send(chatId, r.ok ? `❌ Candidature #${id} rejetée.` : `⚠️ #${id} : ${r.error}`);
            return;
        }
        if (data.startsWith('cab_dep_ok_')) {
            const id = data.replace('cab_dep_ok_', '');
            await clearButtons(callback_query);
            const r = await cabine.adminConfirmDeposit(id);
            await answer(cbId, r.ok ? 'Versement confirmé — débloqué' : (r.error || 'Erreur'));
            if (r.ok) await send(chatId, `✅ Versement #${id} confirmé.\n🔓 <b>${r.deposit.cabine_code}</b> débloquée.`);
            return;
        }
        if (data.startsWith('cab_off_') || data.startsWith('cab_on_')) {
            const on = data.startsWith('cab_on_');
            const code = data.replace(on ? 'cab_on_' : 'cab_off_', '');
            await clearButtons(callback_query);
            const r = await cabine.adminSetCabine(code, { actif: on });
            await answer(cbId, r.ok ? (on ? 'Activée' : 'Désactivée') : (r.error || 'Erreur'));
            if (r.ok) await send(chatId, `${on ? '🟢' : '🔴'} Cabine <b>${code}</b> ${on ? 'activée' : 'désactivée'}.`);
            return;
        }
        await answer(cbId);
    }
}

module.exports = router;
module.exports.notifyNewOrder = notifyNewOrder;
module.exports.notifyNewDeposit = notifyNewDeposit;
module.exports.notifyNewCandidature = notifyNewCandidature;
module.exports.archiveAndCleanProofs = archiveAndCleanProofs;
