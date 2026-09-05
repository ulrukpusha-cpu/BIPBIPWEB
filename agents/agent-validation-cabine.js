#!/usr/bin/env node
/* =========================================================
   Agent VALIDATION CABINE — réseau Kbine physique
   Pendant "cabine" de /opt/bipbip-validation-agent (app grand public).

   Ce que fait l'agent, toutes les POLL_SEC secondes :
     1. COMMANDES  : lit /api/cabine/admin/orders (statut pending) et décide
        auto_validate | manual_review | reject selon des règles métier chiffrées
        (montant, plafond de la cabine, doublon, cadence, heures, budget du jour).
        auto_validate ⇒ POST /admin/orders/:id/validate = VRAIE recharge au gateway.
     2. CANDIDATURES KYC : lit /api/cabine/admin/candidatures et fait une
        pré-analyse du dossier (champs, âge, doublons, photos ; Vision Groq en
        option) puis recommande à l'admin. N'approuve rien sauf si on l'active.

   Tout passe par l'API admin (X-Admin-Key: CABINE_ADMIN_KEY) : la logique
   métier (compteurs, lock, gateway) reste celle du serveur, jamais dupliquée.

   Les alertes partent sur le bot @Kbineadbot (TELEGRAM_BOT_TOKEN_CABINE) avec
   les MÊMES boutons que le bot (callbacks cab_ord_ok_/cab_ord_no_/cab_ord_cancel_/
   cab_cand_ok_/cab_cand_no_) : un clic admin est traité par le webhook existant.

   SÉCURITÉ : valider = dépenser de l'argent réel. L'agent démarre donc en
   SIMULATION (CABINE_AGENT_DRY_RUN=1 par défaut) : il décide et rapporte tout
   sur Telegram sans rien exécuter. Mettre CABINE_AGENT_DRY_RUN=0 pour armer.

   Usage : node agent-validation-cabine.js [--once] [--dry]
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

// ---- .env du serveur (dotenv si présent, sinon parseur minimal) ----------
(function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    try { require('dotenv').config({ path: envPath }); return; } catch (e) { /* pas de dotenv ici */ }
    try {
        for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
            if (!m) continue;
            const v = m[2].trim().replace(/^["']|["']$/g, '');
            if (process.env[m[1]] === undefined) process.env[m[1]] = v;
        }
    } catch (e) { console.error('[cabval] .env illisible :', e.message); }
})();

// ---- helpers config ------------------------------------------------------
const ARGS = process.argv.slice(2);
const num = (k, d) => { const v = parseInt(process.env[k], 10); return Number.isFinite(v) ? v : d; };
const bool = (k, d) => { const v = process.env[k]; return v === undefined || v === '' ? d : !['0', 'false', 'False', 'non', 'off'].includes(String(v).trim()); };
const csv = (k) => String(process.env[k] || '').split(',').map(s => s.trim()).filter(Boolean);

function parseHours(s, dStart, dEnd) {
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return { start: dStart, end: dEnd };
    return { start: (+m[1]) * 60 + (+m[2]), end: (+m[3]) * 60 + (+m[4]) };
}

const CFG = {
    enabled: bool('CABINE_AGENT_ENABLED', true),
    // SIMULATION par défaut : aucune recharge réelle tant que ce n'est pas armé.
    dryRun: ARGS.includes('--dry') || bool('CABINE_AGENT_DRY_RUN', true),
    pollSec: num('CABINE_AGENT_POLL_SEC', 60),

    apiBase: (process.env.CABINE_API_BASE || `http://127.0.0.1:${process.env.PORT || 3000}/api/cabine`).replace(/\/$/, ''),
    adminKey: (process.env.CABINE_ADMIN_KEY || '').trim(),
    botToken: (process.env.TELEGRAM_BOT_TOKEN_CABINE || '').trim(),
    adminIds: csv('CABINE_ADMIN_CHAT_IDS').length ? csv('CABINE_ADMIN_CHAT_IDS')
        : (csv('ADMIN_CHAT_IDS').length ? csv('ADMIN_CHAT_IDS') : csv('ADMIN_CHAT_ID')),

    // ---- règles COMMANDES ----
    minAgeSec: num('CABINE_AGENT_MIN_AGE_SEC', 60),        // laisse l'admin humain devant
    minAmount: num('CABINE_AGENT_MIN_AMOUNT', 100),
    maxAmount: num('CABINE_AGENT_MAX_AMOUNT', 5000),       // au-delà → contrôle humain
    dailyCap: num('CABINE_AGENT_DAILY_CAP', 50000),        // FCFA auto-validés / jour (toutes cabines)
    cabineDayCap: num('CABINE_AGENT_CABINE_DAY_CAP', 25000), // FCFA auto-validés / jour / cabine
    maxPerHour: num('CABINE_AGENT_MAX_PER_HOUR', 4),       // commandes validées / heure / cabine
    dupWindowMin: num('CABINE_AGENT_DUP_WINDOW_MIN', 15),  // doublon même numéro + même montant
    hours: parseHours(process.env.CABINE_AGENT_HOURS, 6 * 60, 21 * 60), // Abidjan = UTC
    allowBundles: bool('CABINE_AGENT_ALLOW_BUNDLES', false), // forfaits : prix variable → humain
    autoRejectInvalid: bool('CABINE_AGENT_AUTO_REJECT', true), // rejet auto des commandes impossibles
    onlyCabines: csv('CABINE_AGENT_CABINES'),              // vide = toutes ; sinon liste blanche
    blacklist: csv('CABINE_AGENT_BLACKLIST').map(s => s.replace(/\D/g, '')),

    // ---- règles CANDIDATURES KYC ----
    candEnabled: bool('CABINE_AGENT_CANDIDATURES', true),
    candAutoApprove: bool('CABINE_AGENT_CAND_AUTO_APPROVE', false),
    candAutoReject: bool('CABINE_AGENT_CAND_AUTO_REJECT', false),
    candVision: bool('CABINE_AGENT_CAND_VISION', false),   // envoie pièce+selfie à Groq
    visionModel: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
    ageMin: num('CABINE_AGENT_AGE_MIN', 18),
    ageMax: num('CABINE_AGENT_AGE_MAX', 75),

    // ---- divers ----
    remindHours: num('CABINE_AGENT_REMIND_HOURS', 3),
    maxReminders: num('CABINE_AGENT_MAX_REMINDERS', 2),
    maxAttempts: num('CABINE_AGENT_MAX_ATTEMPTS', 3),
    reportHour: num('CABINE_AGENT_REPORT_HOUR', 20),       // UTC = Abidjan
    announce: bool('CABINE_AGENT_ANNOUNCE', true),
    // --silent / CABINE_AGENT_SILENT=1 : aucune écriture Telegram (test à blanc)
    silent: ARGS.includes('--silent') || bool('CABINE_AGENT_SILENT', false),
    stateFile: process.env.CABINE_AGENT_STATE || path.join(__dirname, 'state-validation-cabine.json'),
};

const TAG = '[cabval]';
const log = (...a) => console.log(TAG, new Date().toISOString(), ...a);
const err = (...a) => console.error(TAG, new Date().toISOString(), ...a);

// ---- format ---------------------------------------------------------------
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dayKey = (d) => (d || new Date()).toISOString().slice(0, 10);
const hhmm = (d) => String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');

// Même table de préfixes que services/cabineService.js
function operatorFromPhone(phone) {
    const p = String(phone || '').replace(/\D/g, '').replace(/^225/, '');
    const prefix = p.substring(0, 2);
    if (['07', '08', '09'].includes(prefix)) return 'orange';
    if (['05', '06'].includes(prefix)) return 'mtn';
    if (['01', '02'].includes(prefix)) return 'moov';
    return null;
}
function cleanPhone(p) { return String(p || '').replace(/\D/g, '').replace(/^225/, ''); }

// ---- état persistant ------------------------------------------------------
function loadState() {
    let s = {};
    try { if (fs.existsSync(CFG.stateFile)) s = JSON.parse(fs.readFileSync(CFG.stateFile, 'utf8')); }
    catch (e) { err('state.json illisible, repart à zéro :', e.message); }
    s.orders = s.orders || {};          // id -> { ts, decision, notifiedAt, reminders, attempts }
    s.cands = s.cands || {};            // id -> { ts, decision }
    s.budget = s.budget || { day: dayKey(), total: 0, count: 0, perCabine: {} };
    s.stats = s.stats || { validated: 0, review: 0, rejected: 0, failed: 0, cands: 0 };
    s.lastReportDay = s.lastReportDay || null;
    s.lastErrorAt = s.lastErrorAt || 0;
    return s;
}
function saveState(s) {
    try {
        // purge : on ne garde que 7 jours d'historique de décisions
        const limit = Date.now() - 7 * 86400000;
        for (const k of Object.keys(s.orders)) if ((s.orders[k].ts || 0) < limit) delete s.orders[k];
        for (const k of Object.keys(s.cands)) if ((s.cands[k].ts || 0) < limit) delete s.cands[k];
        fs.writeFileSync(CFG.stateFile, JSON.stringify(s, null, 2));
    } catch (e) { err('écriture state.json :', e.message); }
}
function rollDay(s) {
    const today = dayKey();
    if (s.budget.day !== today) s.budget = { day: today, total: 0, count: 0, perCabine: {} };
}

// ---- API admin cabine -----------------------------------------------------
async function api(method, route, body) {
    const r = await fetch(CFG.apiBase + route, {
        method,
        headers: Object.assign({ 'X-Admin-Key': CFG.adminKey }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await r.text();
    let json = null; try { json = JSON.parse(txt); } catch (e) { /* réponse non-JSON */ }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${String(txt).slice(0, 160)}`);
    return json || {};
}

// ---- Telegram (@Kbineadbot) ----------------------------------------------
async function tg(method, body) {
    if (!CFG.botToken) return null;
    try {
        const r = await fetch(`https://api.telegram.org/bot${CFG.botToken}/${method}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!j.ok) {
            err('telegram', method, j.description);
            // Un admin qui n'a jamais fait /start sur @Kbineadbot renvoie "chat not
            // found" à CHAQUE envoi : on le retire pour la durée du process.
            if (body && body.chat_id && /chat not found|bot was blocked|user is deactivated/i.test(j.description || '')) {
                CFG.adminIds = CFG.adminIds.filter(id => String(id) !== String(body.chat_id));
                err(`admin ${body.chat_id} retiré des destinataires (${j.description}) — reste : ${CFG.adminIds.join(',') || 'aucun'}`);
            }
        }
        return j;
    } catch (e) { err('telegram', method, e.message); return null; }
}
async function notify(text, keyboard) {
    if (CFG.silent) { log('[telegram muet]', text.replace(/<[^>]+>/g, '').replace(/\n/g, ' | ')); return; }
    const prefix = CFG.dryRun ? '🧪 <b>SIMULATION</b>\n' : '';
    for (const id of CFG.adminIds) {
        await tg('sendMessage', Object.assign(
            { chat_id: id, text: prefix + text, parse_mode: 'HTML', disable_web_page_preview: true },
            keyboard ? { reply_markup: keyboard } : {}));
    }
}
const kbOrder = (id) => ({ inline_keyboard: [[
    { text: '✅ Valider', callback_data: `cab_ord_ok_${id}` },
    { text: '❌ Rejeter', callback_data: `cab_ord_no_${id}` },
]] });
const kbCancel = (id) => ({ inline_keyboard: [[{ text: '❌ Annuler (non reçu)', callback_data: `cab_ord_cancel_${id}` }]] });
const kbCand = (id) => ({ inline_keyboard: [[
    { text: '✅ Approuver (créer le code)', callback_data: `cab_cand_ok_${id}` },
    { text: '❌ Rejeter', callback_data: `cab_cand_no_${id}` },
]] });

// =========================================================================
//  1. COMMANDES — moteur de décision
// =========================================================================
/**
 * Décide du sort d'une commande en attente.
 * @returns {{decision:'auto_validate'|'manual_review'|'reject'|'wait', reasons:string[]}}
 */
function evaluateOrder(order, cab, hist, budget) {
    const reasons = [];
    const bad = [];        // motifs de rejet (la commande NE PEUT PAS aboutir)
    const doubts = [];     // motifs de contrôle humain

    const now = Date.now();
    const created = new Date(order.created_at).getTime();
    const ageSec = Math.round((now - created) / 1000);
    if (ageSec < CFG.minAgeSec) return { decision: 'wait', reasons: [`commande trop récente (${ageSec}s)`] };

    const phone = cleanPhone(order.recipient);
    const detected = operatorFromPhone(phone);
    const amount = Number(order.amount || 0);

    // ---- motifs de REJET : la validation échouerait ou est interdite ----
    if (CFG.blacklist.includes(phone)) bad.push(`numéro ${phone} sur liste noire`);
    if (phone.length !== 10) bad.push(`numéro ${order.recipient} : ${phone.length} chiffres au lieu de 10`);
    else if (!detected) bad.push(`numéro ${phone} : préfixe inconnu`);
    else if (order.operator && order.operator !== detected) {
        bad.push(`numéro ${phone} est ${detected.toUpperCase()}, commande passée en ${String(order.operator).toUpperCase()}`);
    }

    // ---- motifs de CONTRÔLE HUMAIN ----
    if (!cab) doubts.push(`cabine ${order.cabine_code} introuvable`);
    else {
        if (!cab.actif) doubts.push('cabine désactivée');
        if (cab.expired) doubts.push('code de la cabine expiré');
        if (cab.locked) doubts.push(`cabine bloquée (plafond ${cab.tx_since_deposit}/${cab.tx_plafond || 5}) — versement Wave requis`);
        if (CFG.onlyCabines.length && !CFG.onlyCabines.includes(String(cab.code))) {
            doubts.push('cabine hors liste blanche de l\'agent');
        }
    }

    if (order.type === 'bundle') {
        // Un forfait est encadré par le même plafond que le crédit, à condition que
        // son prix soit bien enregistré (amount) — sinon on ne sait pas ce qu'on paie.
        if (!CFG.allowBundles) doubts.push(`forfait ${order.bundle_id || ''} — validation humaine`);
        else if (!amount) doubts.push(`forfait ${order.bundle_id || ''} — prix non enregistré`);
        else if (amount > CFG.maxAmount) doubts.push(`forfait à ${fmt(amount)} > plafond auto ${fmt(CFG.maxAmount)}`);
    } else {
        if (amount < CFG.minAmount) doubts.push(`montant ${fmt(amount)} < minimum ${fmt(CFG.minAmount)}`);
        if (amount > CFG.maxAmount) doubts.push(`montant ${fmt(amount)} > plafond auto ${fmt(CFG.maxAmount)}`);
    }

    // heures ouvrées (Abidjan = UTC)
    const d = new Date();
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    const inHours = CFG.hours.start <= CFG.hours.end
        ? (minutes >= CFG.hours.start && minutes <= CFG.hours.end)
        : (minutes >= CFG.hours.start || minutes <= CFG.hours.end);
    if (!inHours) doubts.push(`hors heures ouvrées (${hhmm(d)} UTC)`);

    // budget du jour
    if (budget.total + amount > CFG.dailyCap) {
        doubts.push(`budget auto du jour dépassé (${fmt(budget.total)} + ${fmt(amount)} > ${fmt(CFG.dailyCap)})`);
    }
    const perCab = (budget.perCabine || {})[order.cabine_code] || 0;
    if (perCab + amount > CFG.cabineDayCap) {
        doubts.push(`budget auto du jour de la cabine dépassé (${fmt(perCab)} + ${fmt(amount)} > ${fmt(CFG.cabineDayCap)})`);
    }

    // doublon : même numéro + même montant dans la fenêtre
    const dupMs = CFG.dupWindowMin * 60000;
    const dup = (hist || []).find(o => String(o.id) !== String(order.id)
        && cleanPhone(o.recipient) === phone
        && Number(o.amount || 0) === amount
        && ['ok', 'pending'].includes(o.status)
        && Math.abs(new Date(o.created_at).getTime() - created) < dupMs);
    if (dup) doubts.push(`doublon possible : commande #${dup.id} (${dup.status}) même numéro et même montant il y a ${Math.round(Math.abs(created - new Date(dup.created_at).getTime()) / 60000)} min`);

    // cadence : commandes validées dans la dernière heure pour cette cabine
    const lastHour = (hist || []).filter(o => o.status === 'ok' && (now - new Date(o.validated_at || o.created_at).getTime()) < 3600000).length;
    if (lastHour >= CFG.maxPerHour) doubts.push(`cadence : ${lastHour} recharges validées dans l'heure (max ${CFG.maxPerHour})`);

    if (bad.length) return { decision: 'reject', reasons: bad };
    if (doubts.length) return { decision: 'manual_review', reasons: doubts };

    reasons.push(`${order.type === 'bundle' ? 'forfait' : fmt(amount)} ≤ plafond auto ${fmt(CFG.maxAmount)}`);
    reasons.push(`${String(detected).toUpperCase()} cohérent avec le numéro`);
    if (cab) reasons.push(`cabine active ${cab.tx_since_deposit}/${cab.tx_plafond || 5}`);
    reasons.push('pas de doublon, cadence normale, heures ouvrées');
    return { decision: 'auto_validate', reasons };
}

function orderHeader(order, cab) {
    const nom = (cab && cab.nom_cabine) || order.cabine_code;
    const detail = order.type === 'bundle' ? `Forfait <code>${esc(order.bundle_id || '')}</code>` : fmt(order.amount);
    return `🏪 ${esc(nom)} (${esc(order.cabine_code)})\n` +
        `📲 ${esc(String(order.operator).toUpperCase())} · ${detail}\n` +
        `📞 ${esc(order.recipient)}`;
}

async function processOrders(state) {
    const res = await api('GET', '/admin/orders');
    const orders = res.orders || [];
    if (!orders.length) return;

    const cabRes = await api('GET', '/admin/cabines');
    const cabines = {};
    for (const c of (cabRes.cabines || [])) cabines[c.code] = c;

    const histCache = {};
    async function historyOf(code) {
        if (histCache[code]) return histCache[code];
        try {
            const h = await api('GET', `/history?code=${encodeURIComponent(code)}`);
            histCache[code] = h.orders || [];
        } catch (e) { err('history', code, e.message); histCache[code] = []; }
        return histCache[code];
    }

    log(`${orders.length} commande(s) en attente`);

    for (const order of orders) {
        const id = String(order.id);
        const seen = state.orders[id] || { ts: Date.now(), reminders: 0, attempts: 0 };
        const cab = cabines[order.cabine_code] || null;
        const hist = await historyOf(order.cabine_code);
        const { decision, reasons } = evaluateOrder(order, cab, hist, state.budget);

        if (decision === 'wait') continue;

        // ---- déjà traitée : simple relance périodique si toujours en attente ----
        if (seen.decision) {
            if (decision !== 'manual_review') continue;
            const since = Date.now() - (seen.notifiedAt || seen.ts);
            if (CFG.remindHours > 0 && seen.reminders < CFG.maxReminders && since > CFG.remindHours * 3600000) {
                seen.reminders++; seen.notifiedAt = Date.now();
                state.orders[id] = seen; saveState(state);
                await notify(`⏰ <b>Rappel — commande #${id} toujours en attente</b>\n${orderHeader(order, cab)}\n\n` +
                    `Motifs : ${esc(reasons.join(' ; '))}`, kbOrder(id));
            }
            continue;
        }

        log(`#${id} → ${decision} : ${reasons.join(' ; ')}`);

        if (decision === 'manual_review') {
            seen.decision = decision; seen.notifiedAt = Date.now(); seen.ts = Date.now();
            state.orders[id] = seen; state.stats.review++; saveState(state);
            await notify(`🤖 ⚠️ <b>Commande #${id} — VALIDATION MANUELLE</b>\n${orderHeader(order, cab)}\n\n` +
                `Motifs : ${esc(reasons.join(' ; '))}`, kbOrder(id));
            continue;
        }

        if (decision === 'reject') {
            if (!CFG.autoRejectInvalid) {
                seen.decision = 'manual_review'; seen.notifiedAt = Date.now(); seen.ts = Date.now();
                state.orders[id] = seen; state.stats.review++; saveState(state);
                await notify(`🤖 ⚠️ <b>Commande #${id} invalide — décision humaine</b>\n${orderHeader(order, cab)}\n\n` +
                    `Motifs : ${esc(reasons.join(' ; '))}`, kbOrder(id));
                continue;
            }
            if (!CFG.dryRun) {
                try { await api('POST', `/admin/orders/${id}/reject`, { reason: reasons.join(' ; ') }); }
                catch (e) { err(`rejet #${id}`, e.message); continue; }
            }
            seen.decision = 'reject'; seen.ts = Date.now();
            state.orders[id] = seen; state.stats.rejected++; saveState(state);
            await notify(`🤖 ❌ <b>Commande #${id} rejetée automatiquement</b>\n${orderHeader(order, cab)}\n\n` +
                `Motif : ${esc(reasons.join(' ; '))}`);
            continue;
        }

        // ---- auto_validate : RECHARGE RÉELLE ----
        if (CFG.dryRun) {
            seen.decision = 'auto_validate'; seen.ts = Date.now();
            state.orders[id] = seen; saveState(state);
            await notify(`🤖 ✅ <b>Commande #${id} serait validée automatiquement</b>\n${orderHeader(order, cab)}\n\n` +
                `Contrôles OK : ${esc(reasons.join(' ; '))}\n\n` +
                `<i>Mode simulation — aucune recharge envoyée. Boutons ci-dessous pour valider à la main.</i>`, kbOrder(id));
            continue;
        }

        seen.attempts = (seen.attempts || 0) + 1;
        state.orders[id] = seen; saveState(state);
        if (seen.attempts > CFG.maxAttempts) {
            seen.decision = 'manual_review'; seen.notifiedAt = Date.now();
            state.orders[id] = seen; state.stats.review++; saveState(state);
            await notify(`⛔ <b>Commande #${id} abandonnée par l'agent</b>\n${orderHeader(order, cab)}\n\n` +
                `${CFG.maxAttempts} tentatives de validation infructueuses → validation manuelle.`, kbOrder(id));
            continue;
        }

        let r;
        try { r = await api('POST', `/admin/orders/${id}/validate`); }
        catch (e) { err(`validate #${id}`, e.message); continue; }   // re-essayé au prochain cycle

        if (r && r.ok) {
            seen.decision = 'auto_validate'; seen.ts = Date.now();
            state.orders[id] = seen;
            state.budget.total += Number(order.amount || 0);
            state.budget.count++;
            state.budget.perCabine[order.cabine_code] = (state.budget.perCabine[order.cabine_code] || 0) + Number(order.amount || 0);
            state.stats.validated++;
            saveState(state);
            await notify(`🤖 ✅ <b>Commande #${id} validée automatiquement — recharge envoyée</b>\n${orderHeader(order, cab)}\n` +
                `🧾 Réf : ${esc(r.gateway_ref || '—')}\n\n` +
                `Contrôles OK : ${esc(reasons.join(' ; '))}` +
                (r.timeout ? `\n\nℹ️ Confirmation différée (normal). Si le client ne reçoit <b>rien</b>, appuie sur Annuler.` : '') +
                (r.locked ? `\n🔒 Cabine bloquée (plafond atteint) — versement Wave requis.` : '') +
                `\n💰 Budget auto du jour : ${fmt(state.budget.total)} / ${fmt(CFG.dailyCap)}`,
                r.timeout ? kbCancel(id) : undefined);
        } else {
            const msg = (r && r.error) || 'erreur inconnue';
            // "déjà traitée" = un admin a cliqué avant nous : rien à signaler.
            if (/déjà trait/i.test(msg)) { seen.decision = 'skipped'; state.orders[id] = seen; saveState(state); continue; }
            seen.decision = 'failed'; seen.ts = Date.now();
            state.orders[id] = seen; state.stats.failed++; saveState(state);
            await notify(`🤖 ⚠️ <b>Échec de validation auto — commande #${id}</b>\n${orderHeader(order, cab)}\n\n` +
                `Erreur : ${esc(msg)}\n<i>La commande est passée en échec côté serveur, elle n'est plus validable.</i>`);
        }
    }
}

// =========================================================================
//  2. CANDIDATURES KYC — pré-analyse
// =========================================================================
function ageFrom(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let a = now.getUTCFullYear() - d.getUTCFullYear();
    const m = now.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) a--;
    return a;
}

function evaluateCandidature(cand, allCands, cabines) {
    const bad = [];      // dossier inexploitable → rejet recommandé
    const doubts = [];   // à vérifier par l'humain
    const ok = [];

    const nom = String(cand.nom || '').trim();
    if (nom.length < 3) bad.push('nom absent ou trop court');
    else if (!/\s/.test(nom)) doubts.push(`nom en un seul mot ("${nom}") — nom + prénom attendus`);
    else ok.push(`nom « ${nom} »`);

    const tel = cleanPhone(cand.telephone);
    const op = operatorFromPhone(tel);
    if (tel.length !== 10 || !op) bad.push(`téléphone ${cand.telephone || '—'} invalide`);
    else ok.push(`tél ${tel} (${op.toUpperCase()})`);

    const age = ageFrom(cand.date_naissance);
    if (age === null) doubts.push('date de naissance absente ou illisible');
    else if (age < CFG.ageMin) bad.push(`candidat mineur (${age} ans)`);
    else if (age > CFG.ageMax) doubts.push(`âge déclaré ${age} ans`);
    else ok.push(`${age} ans`);

    if (!cand.commune) doubts.push('commune non renseignée');
    else ok.push(String(cand.commune));

    if (!cand.piece_type || !cand.piece_numero) doubts.push('type ou numéro de pièce manquant');
    else ok.push(`${cand.piece_type} n° ${cand.piece_numero}`);

    if (!cand.piece_url) bad.push('photo de la pièce d\'identité absente');
    if (!cand.selfie_url) bad.push('photo du candidat (selfie) absente');
    if (cand.piece_url && cand.selfie_url) ok.push('2 photos fournies');

    // doublons
    const dupTel = (allCands || []).find(c => String(c.id) !== String(cand.id)
        && cleanPhone(c.telephone) === tel && ['approuve', 'en_attente'].includes(c.status));
    if (dupTel) doubts.push(`même numéro que la candidature #${dupTel.id} (${dupTel.status})`);
    const dupPiece = cand.piece_numero && (allCands || []).find(c => String(c.id) !== String(cand.id)
        && c.piece_numero && String(c.piece_numero).trim().toLowerCase() === String(cand.piece_numero).trim().toLowerCase());
    if (dupPiece) doubts.push(`même n° de pièce que la candidature #${dupPiece.id} (${dupPiece.status})`);
    const dupCab = (cabines || []).find(c => String(c.nom_cabine || '').trim().toLowerCase() === nom.toLowerCase());
    if (dupCab) doubts.push(`une cabine existe déjà au nom « ${dupCab.nom_cabine} » (${dupCab.code})`);

    const decision = bad.length ? 'reject' : (doubts.length ? 'manual_review' : 'auto_validate');
    return { decision, bad, doubts, ok };
}

// ---- Vision (option) : lit la pièce d'identité et le selfie --------------
function groqKey() {
    if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
    // même emplacement que /opt/bipbip-validation-agent
    try {
        for (const line of fs.readFileSync('/root/.hermes/.env', 'utf8').split(/\r?\n/)) {
            if (line.startsWith('GROQ_API_KEY=')) {
                const v = line.split('=', 2)[1].trim().replace(/^["']|["']$/g, '');
                if (v) return v;
            }
        }
    } catch (e) { /* pas de fichier */ }
    return null;
}
function localFile(u) {
    if (!u || /^https?:\/\//i.test(u)) return null;
    const p = path.join(__dirname, '..', String(u).replace(/^\//, ''));
    return fs.existsSync(p) ? p : null;
}
function dataUri(file) {
    const b = fs.readFileSync(file);
    if (b.length > 4 * 1024 * 1024) return null;           // trop lourd pour l'API
    const ext = (file.split('.').pop() || 'jpg').toLowerCase();
    const type = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    return `data:${type};base64,${b.toString('base64')}`;
}

async function visionCandidature(cand) {
    const key = groqKey();
    const pieceFile = localFile(cand.piece_url);
    const selfieFile = localFile(cand.selfie_url);
    if (!key || !pieceFile || !selfieFile) return null;
    const imgs = [dataUri(pieceFile), dataUri(selfieFile)];
    if (imgs.some(x => !x)) return null;

    const prompt = `Tu vérifies un dossier d'inscription (Côte d'Ivoire). Image 1 = pièce d'identité, image 2 = selfie du candidat.
Déclaré : nom "${cand.nom}", né le "${cand.date_naissance || '?'}", pièce ${cand.piece_type || '?'} n° "${cand.piece_numero || '?'}".
Réponds UNIQUEMENT par un JSON :
{"piece_lisible":true/false,"type_document":"CNI|passeport|permis|autre|aucun","nom_sur_document":"...","numero_sur_document":"...","date_naissance_sur_document":"...","nom_correspond":true/false/"inconnu","numero_correspond":true/false/"inconnu","selfie_visage_humain":true/false,"selfie_correspond_photo_piece":true/false/"inconnu","confiance":"high|medium|low","raison":"une phrase"}`;

    try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model: CFG.visionModel,
                temperature: 0,
                messages: [{ role: 'user', content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: imgs[0] } },
                    { type: 'image_url', image_url: { url: imgs[1] } },
                ] }],
            }),
        });
        const j = await r.json();
        const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!content) return null;
        const m = /\{[\s\S]*\}/.exec(content);
        return m ? JSON.parse(m[0]) : null;
    } catch (e) { err('vision', e.message); return null; }
}

async function processCandidatures(state) {
    const res = await api('GET', '/admin/candidatures?status=en_attente');
    const list = res.candidatures || [];
    if (!list.length) return;

    const all = (await api('GET', '/admin/candidatures?status=').catch(() => ({}))).candidatures || list;
    const cabines = (await api('GET', '/admin/cabines').catch(() => ({}))).cabines || [];

    log(`${list.length} candidature(s) en attente`);

    for (const cand of list) {
        const id = String(cand.id);
        if (state.cands[id]) continue;                    // déjà analysée

        const ev = evaluateCandidature(cand, all, cabines);
        let vision = null;
        if (CFG.candVision) {
            vision = await visionCandidature(cand);
            if (vision) {
                if (vision.piece_lisible === false) ev.doubts.push('Vision : pièce d\'identité illisible');
                if (vision.nom_correspond === false) ev.doubts.push(`Vision : nom du document « ${vision.nom_sur_document || '?'} » ≠ nom déclaré`);
                if (vision.numero_correspond === false) ev.doubts.push(`Vision : n° du document « ${vision.numero_sur_document || '?'} » ≠ n° déclaré`);
                if (vision.selfie_visage_humain === false) ev.doubts.push('Vision : pas de visage humain sur le selfie');
                if (vision.selfie_correspond_photo_piece === false) ev.doubts.push('Vision : le selfie ne semble pas correspondre à la photo de la pièce');
                if (ev.decision === 'auto_validate' && ev.doubts.length) ev.decision = 'manual_review';
            }
        }

        const lignes = [];
        if (ev.ok.length) lignes.push(`✔️ ${esc(ev.ok.join(' · '))}`);
        if (ev.doubts.length) lignes.push(`⚠️ À vérifier : ${esc(ev.doubts.join(' ; '))}`);
        if (ev.bad.length) lignes.push(`❌ Bloquant : ${esc(ev.bad.join(' ; '))}`);
        if (vision) lignes.push(`👁 Vision (${esc(vision.confiance || '?')}) : ${esc(vision.raison || '')}`);

        const reco = ev.decision === 'auto_validate' ? '✅ dossier complet — approbation recommandée'
            : ev.decision === 'reject' ? '❌ rejet recommandé'
                : '⚠️ contrôle humain recommandé';

        let action = '';
        if (ev.decision === 'auto_validate' && CFG.candAutoApprove && !CFG.dryRun) {
            const r = await api('POST', `/admin/candidatures/${id}/approve`).catch(e => ({ ok: false, error: e.message }));
            action = r && r.ok
                ? `\n\n✅ <b>Approuvée automatiquement</b>\n🔑 Code : <code>${esc(r.code)}</code>\n⏳ Expire le ${r.expires_at ? new Date(r.expires_at).toLocaleDateString('fr-FR') : '—'}\nEnvoie le code au commercial (${esc(cand.telephone)}).`
                : `\n\n⚠️ Approbation auto échouée : ${esc((r && r.error) || '?')}`;
        } else if (ev.decision === 'reject' && CFG.candAutoReject && !CFG.dryRun) {
            const r = await api('POST', `/admin/candidatures/${id}/reject`).catch(e => ({ ok: false, error: e.message }));
            action = r && r.ok ? '\n\n❌ <b>Rejetée automatiquement</b>' : `\n\n⚠️ Rejet auto échoué : ${esc((r && r.error) || '?')}`;
        }

        state.cands[id] = { ts: Date.now(), decision: ev.decision };
        state.stats.cands++;
        saveState(state);

        await notify(`🤖 🔎 <b>Pré-analyse candidature #${id}</b>\n👤 ${esc(cand.nom)} · 📞 ${esc(cand.telephone)}\n\n` +
            lignes.join('\n') + `\n\nRecommandation : ${reco}${action}`,
            action ? undefined : kbCand(id));
    }
}

// =========================================================================
//  Boucle
// =========================================================================
let running = true;
let busy = false;

async function cycle() {
    if (busy) { log('cycle précédent encore en cours — on saute'); return; }
    busy = true;
    const state = loadState();
    rollDay(state);
    try {
        await processOrders(state);
        if (CFG.candEnabled) await processCandidatures(state);
        await maybeDailyReport(state);
        saveState(state);
    } catch (e) {
        err('cycle :', e.message);
        // une alerte par heure au maximum, pour ne pas noyer les admins
        if (Date.now() - (state.lastErrorAt || 0) > 3600000) {
            state.lastErrorAt = Date.now(); saveState(state);
            await notify(`⚠️ <b>Agent Validation Cabine — erreur</b>\n<code>${esc(String(e.message).slice(0, 300))}</code>`);
        }
    } finally { busy = false; }
}

async function maybeDailyReport(state) {
    const today = dayKey();
    if (state.lastReportDay === today) return;
    if (new Date().getUTCHours() < CFG.reportHour) return;
    state.lastReportDay = today;
    const s = state.stats;
    await notify(`📊 <b>Rapport Agent Validation Cabine</b> — ${today}\n\n` +
        `• Validées auto : ${s.validated}\n` +
        `• Envoyées en contrôle humain : ${s.review}\n` +
        `• Rejetées auto : ${s.rejected}\n` +
        `• Échecs gateway : ${s.failed}\n` +
        `• Candidatures analysées : ${s.cands}\n` +
        `• Montant auto du jour : ${fmt(state.budget.total)} / ${fmt(CFG.dailyCap)} (${state.budget.count} recharge(s))\n` +
        (CFG.dryRun ? '\n🧪 Mode SIMULATION — rien n\'a été exécuté.' : ''));
    state.stats = { validated: 0, review: 0, rejected: 0, failed: 0, cands: 0 };
}

function configSummary() {
    return `mode ${CFG.dryRun ? 'SIMULATION' : 'ACTIF'} · poll ${CFG.pollSec}s · ` +
        `plafond auto ${fmt(CFG.maxAmount)} · budget jour ${fmt(CFG.dailyCap)} (cabine ${fmt(CFG.cabineDayCap)}) · ` +
        `${CFG.maxPerHour}/h · doublon ${CFG.dupWindowMin} min · ` +
        `heures ${String(Math.floor(CFG.hours.start / 60)).padStart(2, '0')}h-${String(Math.floor(CFG.hours.end / 60)).padStart(2, '0')}h · ` +
        `forfaits ${CFG.allowBundles ? 'auto' : 'humain'} · ` +
        `candidatures ${CFG.candEnabled ? (CFG.candAutoApprove ? 'auto' : 'pré-analyse') : 'off'}${CFG.candVision ? ' + vision' : ''}` +
        (CFG.onlyCabines.length ? ` · cabines ${CFG.onlyCabines.join(',')}` : '');
}

async function main() {
    if (!CFG.adminKey) { err('CABINE_ADMIN_KEY absente du .env — arrêt'); process.exit(1); }
    if (!CFG.botToken) err('TELEGRAM_BOT_TOKEN_CABINE absent — les alertes Telegram seront muettes');
    if (!CFG.adminIds.length) err('aucun admin (CABINE_ADMIN_CHAT_IDS / ADMIN_CHAT_IDS) — alertes muettes');
    if (!CFG.enabled) { log('CABINE_AGENT_ENABLED=0 — arrêt'); return; }

    log('Agent Validation Cabine démarré —', configSummary());
    log('API :', CFG.apiBase, '| admins :', CFG.adminIds.join(',') || 'aucun', CFG.silent ? '| TELEGRAM MUET' : '');

    if (ARGS.includes('--once')) { await cycle(); log('cycle unique terminé'); return; }

    if (CFG.announce) {
        await notify(`🤖 <b>Agent Validation Cabine démarré</b>\n<code>${esc(configSummary())}</code>\n\n` +
            (CFG.dryRun
                ? 'Il analyse et rapporte, <b>sans rien exécuter</b>. Pour l\'armer : <code>CABINE_AGENT_DRY_RUN=0</code> puis <code>pm2 restart bipbip-cabine-validation</code>.'
                : '⚡ Mode ACTIF : les commandes conformes seront rechargées automatiquement.'));
    }

    await cycle();
    const timer = setInterval(() => { if (running) cycle(); }, CFG.pollSec * 1000);
    const stop = (sig) => { log('signal', sig, '— arrêt'); running = false; clearInterval(timer); process.exit(0); };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
}

if (require.main === module) {
    main().catch(e => { err('erreur fatale :', e); process.exit(1); });
}

// exporté pour les tests des règles (aucun effet de bord à l'import)
module.exports = { CFG, evaluateOrder, evaluateCandidature, operatorFromPhone, ageFrom };
