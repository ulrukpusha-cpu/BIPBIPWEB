/* =========================================================
   Bipbip Cabine — logique métier des commerciaux (Kbine)
   Tables Supabase : cabines, cabine_orders, cabine_deposits
   - Plafond 5 transactions → lock → dépôt Wave → unlock admin
   - Objectif 30 commandes / semaine → % de progression + commission
   - Reset hebdo (lundi 00h Abidjan=UTC) + reset mensuel (1er du mois)
   Tout passe par le service_role (contourne le RLS).
   ========================================================= */
const { getSupabase } = require('../database/supabase-client');

const TX_PLAFOND = 5;          // ventes avant blocage
const OBJECTIF_HEBDO = 30;     // commandes / semaine pour 100 %
const GATEWAY = (process.env.USSD_GATEWAY_URL || 'http://localhost:3002').replace(/\/$/, '');

// ---- helpers temps (fuseau Afrique/Abidjan = UTC) ------------------------
function isoWeekKey(d) {
    // clé "YYYY-Www" basée sur la semaine ISO (lundi = début de semaine)
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = date.getUTCDay() || 7;                 // dimanche=7
    date.setUTCDate(date.getUTCDate() + 4 - day);      // jeudi de la semaine
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}
function monthKey(d) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function addMonths(d, n) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }

// ---- génération de code NUMÉRIQUE (clavier de l'app = chiffres uniquement) -
// expire au bout d'1 mois ; longueur par défaut 8 chiffres, 1er chiffre 1-9.
function genCodeRaw(len) {
    const n = len || 8;
    let s = String(1 + Math.floor(Math.random() * 9)); // 1er chiffre 1..9
    for (let i = 1; i < n; i++) s += String(Math.floor(Math.random() * 10));
    return s;
}
function isExpired(c) {
    return !!(c && c.expires_at && new Date(c.expires_at).getTime() < Date.now());
}

// ---- mapping opérateur <-> préfixe numéro CI -----------------------------
function operatorFromPhone(phone) {
    const p = String(phone || '').replace(/\D/g, '').replace(/^225/, '');
    const prefix = p.substring(0, 2);
    if (['07', '08', '09'].includes(prefix)) return 'orange';
    if (['05', '06'].includes(prefix)) return 'mtn';
    if (['01', '02'].includes(prefix)) return 'moov';
    return null;
}

function db() {
    const s = getSupabase();
    if (!s) throw new Error('Supabase non configuré');
    return s;
}

// ---- resets hebdo / mensuel par comparaison de clé -----------------------
// Renvoie l'objet cabine éventuellement modifié (et persiste si changement).
async function applyResets(cabine) {
    const now = new Date();
    const wk = isoWeekKey(now);
    const mk = monthKey(now);
    const patch = {};

    // initialisation (première connexion)
    if (!cabine.semaine_courante) patch.semaine_courante = wk;
    if (!cabine.mois_courant) patch.mois_courant = mk;

    // changement de semaine : verser le surplus (>30) au compteur mensuel, repartir à 0
    if (cabine.semaine_courante && cabine.semaine_courante !== wk) {
        const surplus = Math.max(0, (cabine.commandes_semaine || 0) - OBJECTIF_HEBDO);
        patch.surplus_mensuel = (cabine.surplus_mensuel || 0) + surplus;
        patch.commandes_semaine = 0;
        patch.semaine_courante = wk;
    }
    // changement de mois : le bonus est versé hors-ligne par l'admin → on remet à 0
    if (cabine.mois_courant && cabine.mois_courant !== mk) {
        patch.surplus_mensuel = 0;
        patch.mois_courant = mk;
    }

    if (Object.keys(patch).length) {
        const { data, error } = await db()
            .from('cabines').update(patch).eq('id', cabine.id).select().single();
        if (error) throw error;
        return data;
    }
    return cabine;
}

function pctObjectif(commandes) {
    return Math.min(100, Math.round(((commandes || 0) / OBJECTIF_HEBDO) * 100));
}

function publicView(c) {
    return {
        ok: true,
        code: c.code,
        nom_cabine: c.nom_cabine,
        actif: c.actif,
        locked: c.locked,
        tx_since_deposit: c.tx_since_deposit,
        tx_plafond: TX_PLAFOND,
        commandes_semaine: c.commandes_semaine,
        objectif_hebdo: OBJECTIF_HEBDO,
        pct: pctObjectif(c.commandes_semaine),
        surplus_mensuel: c.surplus_mensuel,
        commission_hebdo: c.commission_hebdo,
        montant_du: c.montant_du,
        expires_at: c.expires_at || null,
        expired: isExpired(c),
        photo_url: c.photo_url || null,
    };
}

async function getCabineByCode(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return null;
    const { data, error } = await db().from('cabines').select('*').eq('code', clean).maybeSingle();
    if (error) throw error;
    return data || null;
}

// ---- LOGIN ---------------------------------------------------------------
async function login(code) {
    let cabine = await getCabineByCode(code);
    if (!cabine) return { ok: false, error: 'Code invalide' };
    if (!cabine.actif) return { ok: false, error: 'Cabine désactivée' };
    if (isExpired(cabine)) return { ok: false, error: 'Code expiré' };
    cabine = await applyResets(cabine);
    return publicView(cabine);
}

// ---- appel gateway (transfert crédit OU souscription forfait) ------------
async function callGateway(operator, recipient, { type, amount, bundleId, bundleType }) {
    const fetch = (await import('node-fetch')).default;
    const phone = String(recipient).replace(/\D/g, '').replace(/^225/, '');
    if (type === 'bundle') {
        const res = await fetch(`${GATEWAY}/api/bundle/subscribe`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operator, recipient: phone, type: bundleType || 'data', bundleId }),
        });
        return res.json();
    }
    const res = await fetch(`${GATEWAY}/api/transfer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator, recipient: phone, amount }),
    });
    return res.json();
}

// ---- RECHARGE (crédit ou forfait) ----------------------------------------
async function recharge({ code, operator, recipient, amount, type = 'credit', bundleId, bundleType }) {
    let cabine = await getCabineByCode(code);
    if (!cabine) return { ok: false, error: 'Code invalide' };
    if (!cabine.actif) return { ok: false, error: 'Cabine désactivée' };
    if (isExpired(cabine)) return { ok: false, error: 'Code expiré' };
    cabine = await applyResets(cabine);
    if (cabine.locked) {
        return { ok: false, error: 'Plafond atteint — versement Wave requis', locked: true, montant_du: cabine.montant_du };
    }

    // sécurité : l'opérateur choisi doit correspondre au préfixe du numéro
    const detected = operatorFromPhone(recipient);
    if (!detected) return { ok: false, error: 'Numéro invalide (préfixe inconnu)' };
    if (operator && operator !== detected) {
        return { ok: false, error: `Ce numéro est ${detected.toUpperCase()}, pas ${String(operator).toUpperCase()}` };
    }
    operator = detected;

    const montant = Number(amount || 0);
    if (type === 'credit' && (!montant || montant < 100)) {
        return { ok: false, error: 'Montant invalide' };
    }

    // Validation-first : on enregistre la commande EN ATTENTE.
    // Le gateway n'est PAS appelé ici — la recharge s'exécute à la validation admin.
    const { data: order, error } = await db().from('cabine_orders').insert({
        cabine_code: cabine.code, operator, type,
        recipient: String(recipient).replace(/\s/g, ''),
        amount: montant, bundle_id: bundleId || null, bundle_type: bundleType || null,
        status: 'pending',
    }).select().single();
    if (error) return { ok: false, error: error.message };

    return {
        ok: true,
        status: 'pending',
        order_id: order.id,
        order: order,
        cabine: publicView(cabine),
    };
}

// ---- VALIDATION ADMIN : exécute réellement la recharge -------------------
async function adminValidateOrder(orderId) {
    const { data: order, error: e1 } = await db().from('cabine_orders')
        .select('*').eq('id', orderId).maybeSingle();
    if (e1) return { ok: false, error: e1.message };
    if (!order) return { ok: false, error: 'Commande introuvable' };
    if (order.status !== 'pending') return { ok: false, error: 'Commande déjà traitée (' + order.status + ')' };

    let cabine = await getCabineByCode(order.cabine_code);
    if (!cabine) return { ok: false, error: 'Cabine introuvable' };
    if (cabine.locked) return { ok: false, error: 'Cabine bloquée (plafond) — versement Wave requis avant validation' };

    // appel gateway (exécution réelle sur les nœuds)
    let gw;
    try {
        gw = await callGateway(order.operator, order.recipient, {
            type: order.type, amount: order.amount, bundleId: order.bundle_id, bundleType: order.bundle_type,
        });
    } catch (e) { gw = { success: false, error: 'Gateway injoignable' }; }
    const success = !!(gw && gw.success);
    const gwErr = String((gw && gw.error) || '');
    // Le gateway abandonne l'attente USSD après 30 s, mais la recharge passe
    // souvent EN DIFFÉRÉ (le client reçoit ses unités). On considère donc un
    // timeout USSD comme un SUCCÈS OPTIMISTE (réf = transferId), annulable ensuite.
    const isTimeout = !success && /timeout/i.test(gwErr);
    const ok = success || isTimeout;
    const gatewayRef = (gw && (gw.ref || gw.reference || gw.id || gw.transferId)) || null;

    await db().from('cabine_orders').update({
        status: ok ? 'ok' : 'failed',
        gateway_ref: gatewayRef,
        validated_at: new Date().toISOString(),
    }).eq('id', orderId);

    let updated = cabine;
    if (ok) {
        const txn = (cabine.tx_since_deposit || 0) + 1;
        const patch = {
            tx_since_deposit: txn,
            commandes_semaine: (cabine.commandes_semaine || 0) + 1,
            montant_du: (cabine.montant_du || 0) + order.amount,
            locked: txn >= TX_PLAFOND,
        };
        const { data } = await db().from('cabines').update(patch).eq('id', cabine.id).select().single();
        updated = data || { ...cabine, ...patch };
    }
    return {
        ok: ok,
        timeout: isTimeout,
        error: ok ? null : (gwErr || 'Échec de la recharge au gateway'),
        gateway_ref: gatewayRef,
        order: { ...order, status: ok ? 'ok' : 'failed', gateway_ref: gatewayRef },
        cabine: publicView(updated),
        locked: updated.locked, montant_du: updated.montant_du,
    };
}

// Annule une commande validée (échec USSD réel) : remet 'cancelled' + réajuste compteurs
async function adminCancelOrder(orderId) {
    const { data: order } = await db().from('cabine_orders').select('*').eq('id', orderId).maybeSingle();
    if (!order) return { ok: false, error: 'Commande introuvable' };
    if (order.status !== 'ok') return { ok: false, error: 'Seule une commande validée peut être annulée (statut: ' + order.status + ')' };
    await db().from('cabine_orders').update({ status: 'cancelled' }).eq('id', orderId);
    const cabine = await getCabineByCode(order.cabine_code);
    let updated = cabine;
    if (cabine) {
        const txn = Math.max(0, (cabine.tx_since_deposit || 0) - 1);
        const patch = {
            tx_since_deposit: txn,
            commandes_semaine: Math.max(0, (cabine.commandes_semaine || 0) - 1),
            montant_du: Math.max(0, (cabine.montant_du || 0) - order.amount),
            locked: txn >= TX_PLAFOND,
        };
        const { data } = await db().from('cabines').update(patch).eq('id', cabine.id).select().single();
        updated = data || { ...cabine, ...patch };
    }
    return { ok: true, order: { ...order, status: 'cancelled' }, cabine: updated ? publicView(updated) : null };
}

async function adminRejectOrder(orderId, reason) {
    const { data: order } = await db().from('cabine_orders').select('*').eq('id', orderId).maybeSingle();
    if (!order) return { ok: false, error: 'Commande introuvable' };
    if (order.status !== 'pending') return { ok: false, error: 'Commande déjà traitée (' + order.status + ')' };
    await db().from('cabine_orders').update({ status: 'rejected', validated_at: new Date().toISOString() }).eq('id', orderId);
    return { ok: true, order: { ...order, status: 'rejected' } };
}

async function adminListPendingOrders() {
    const { data, error } = await db().from('cabine_orders')
        .select('*').eq('status', 'pending').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

// Statut d'une commande (pour le polling de l'app) — scopé au code de la cabine
async function getOrder(code, orderId) {
    const clean = String(code || '').trim().toUpperCase();
    const { data, error } = await db().from('cabine_orders')
        .select('*').eq('id', orderId).eq('cabine_code', clean).maybeSingle();
    if (error) throw error;
    return data || null;
}

// ---- HISTORIQUE ----------------------------------------------------------
async function history(code, limit = 50) {
    const clean = String(code || '').trim().toUpperCase();
    const { data, error } = await db().from('cabine_orders')
        .select('*').eq('cabine_code', clean)
        .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
}

// ---- BUNDLES (proxy gateway) ---------------------------------------------
async function bundles(operator) {
    const fetch = (await import('node-fetch')).default;
    const op = String(operator || '').toLowerCase();
    const url = op ? `${GATEWAY}/api/bundles/${encodeURIComponent(op)}` : `${GATEWAY}/api/bundles`;
    const r = await fetch(url);
    return r.json();
}

// ---- PREUVE DE VERSEMENT WAVE --------------------------------------------
async function waveProof({ code, preuve_url, montant }) {
    let cabine = await getCabineByCode(code);
    if (!cabine) return { ok: false, error: 'Code invalide' };
    const m = Number(montant || cabine.montant_du || 0);
    const { data, error } = await db().from('cabine_deposits').insert({
        cabine_code: cabine.code, montant: m, preuve_url: preuve_url || null, status: 'en_attente',
    }).select().single();
    if (error) throw error;
    return { ok: true, deposit: data };
}

// ======================= ADMIN ===========================================
async function adminListCabines() {
    const { data, error } = await db().from('cabines').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(c => ({ ...publicView(c), id: c.id, created_at: c.created_at }));
}

async function adminCreateCabine({ code, nom_cabine, commission_hebdo, bonus_taux, photo_url }) {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean || !nom_cabine) return { ok: false, error: 'code et nom_cabine requis' };
    const now = new Date();
    const { data, error } = await db().from('cabines').insert({
        code: clean, nom_cabine,
        commission_hebdo: Number(commission_hebdo) || 5000,
        bonus_taux: Number(bonus_taux) || 0,
        photo_url: photo_url || null,
        semaine_courante: isoWeekKey(now), mois_courant: monthKey(now),
    }).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, cabine: data };
}

// Génère un code unique valable `mois` mois (défaut 1) et crée la cabine
async function adminGenerateCabine({ nom_cabine, commission_hebdo, bonus_taux, mois, photo_url }) {
    if (!nom_cabine) return { ok: false, error: 'nom_cabine requis' };
    const now = new Date();
    const expires = addMonths(now, Number(mois) > 0 ? Number(mois) : 1);
    // tirer un code unique (quelques tentatives)
    let code = null;
    for (let i = 0; i < 8; i++) {
        const candidate = genCodeRaw(8);
        const existing = await getCabineByCode(candidate);
        if (!existing) { code = candidate; break; }
    }
    if (!code) return { ok: false, error: 'Impossible de générer un code unique, réessaie' };
    const { data, error } = await db().from('cabines').insert({
        code, nom_cabine,
        commission_hebdo: Number(commission_hebdo) || 5000,
        bonus_taux: Number(bonus_taux) || 0,
        semaine_courante: isoWeekKey(now), mois_courant: monthKey(now),
        expires_at: expires.toISOString(),
        photo_url: photo_url || null,
    }).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, code, expires_at: data.expires_at, cabine: data };
}

// ---- photo du commercial -------------------------------------------------
async function adminSetPhoto(code, photo_url) {
    const clean = String(code || '').trim().toUpperCase();
    const { data, error } = await db().from('cabines').update({ photo_url: photo_url || null }).eq('code', clean).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, cabine: data };
}

// ---- messages "LED" diffusés aux cabines ---------------------------------
async function getActiveMessage() {
    const { data, error } = await db().from('cabine_messages')
        .select('*').eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return null;
    return data || null;
}
async function adminSetMessage(message) {
    if (!message || !String(message).trim()) return { ok: false, error: 'Message vide' };
    // désactive les anciens, active le nouveau
    await db().from('cabine_messages').update({ active: false }).eq('active', true);
    const { data, error } = await db().from('cabine_messages').insert({ message: String(message).trim(), active: true }).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, message: data };
}
async function adminClearMessage() {
    await db().from('cabine_messages').update({ active: false }).eq('active', true);
    return { ok: true };
}

async function adminSetCabine(code, patch) {
    const clean = String(code || '').trim().toUpperCase();
    const allowed = {};
    if (patch.actif !== undefined) allowed.actif = !!patch.actif;
    if (patch.commission_hebdo !== undefined) allowed.commission_hebdo = Number(patch.commission_hebdo);
    if (patch.bonus_taux !== undefined) allowed.bonus_taux = Number(patch.bonus_taux);
    if (patch.locked !== undefined) allowed.locked = !!patch.locked;
    // renouvellement : prolonge l'expiration de `renew_mois` mois à partir de maintenant
    if (patch.renew_mois !== undefined) allowed.expires_at = addMonths(new Date(), Number(patch.renew_mois) > 0 ? Number(patch.renew_mois) : 1).toISOString();
    if (patch.expires_at !== undefined) allowed.expires_at = patch.expires_at; // null = jamais
    const { data, error } = await db().from('cabines').update(allowed).eq('code', clean).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, cabine: data };
}

async function adminListDeposits(status = 'en_attente') {
    let q = db().from('cabine_deposits').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

// Confirmer un versement → reset tx_since_deposit + montant_du, unlock opérateurs
async function adminConfirmDeposit(depositId) {
    const { data: dep, error: e1 } = await db().from('cabine_deposits')
        .select('*').eq('id', depositId).maybeSingle();
    if (e1) return { ok: false, error: e1.message };
    if (!dep) return { ok: false, error: 'Versement introuvable' };

    await db().from('cabine_deposits')
        .update({ status: 'confirme', confirmed_at: new Date().toISOString() }).eq('id', depositId);
    const { data: cab } = await db().from('cabines')
        .update({ tx_since_deposit: 0, montant_du: 0, locked: false })
        .eq('code', dep.cabine_code).select().single();
    return { ok: true, cabine: cab ? publicView(cab) : null, deposit: { ...dep, status: 'confirme' } };
}

// ---- Archivage hebdo des preuves Wave ------------------------------------
// Liste les versements qui ont encore une preuve (image) à archiver.
async function listDepositsWithProof() {
    const { data, error } = await db().from('cabine_deposits')
        .select('*').not('preuve_url', 'is', null).order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}
// Retire la référence de preuve après archivage (l'image locale est supprimée).
async function clearDepositProof(depositId) {
    await db().from('cabine_deposits').update({ preuve_url: null }).eq('id', depositId);
    return { ok: true };
}

// ---- Candidatures KYC (bouton "Postuler" de l'APK) ------------------------
async function createCandidature({ nom, telephone, date_naissance, commune, piece_type, piece_numero, piece_url, selfie_url }) {
    if (!nom || !String(nom).trim()) return { ok: false, error: 'Nom requis' };
    const tel = String(telephone || '').replace(/\D/g, '');
    if (tel.length < 10) return { ok: false, error: 'Numéro de téléphone invalide' };
    const { data, error } = await db().from('cabine_candidatures').insert({
        nom: String(nom).trim(), telephone: tel,
        date_naissance: date_naissance || null, commune: commune || null,
        piece_type: piece_type || null, piece_numero: piece_numero || null,
        piece_url: piece_url || null, selfie_url: selfie_url || null,
        status: 'en_attente',
    }).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, candidature: data };
}
async function adminListCandidatures(status = 'en_attente') {
    let q = db().from('cabine_candidatures').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}
async function getCandidature(id) {
    const { data, error } = await db().from('cabine_candidatures').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data || null;
}
// Approuver = créer la cabine (code généré, photo = selfie) + marquer la candidature
async function adminApproveCandidature(id) {
    const cand = await getCandidature(id);
    if (!cand) return { ok: false, error: 'Candidature introuvable' };
    if (cand.status !== 'en_attente') return { ok: false, error: 'Candidature déjà traitée (' + cand.status + ')' };
    const gen = await adminGenerateCabine({ nom_cabine: cand.nom, mois: 1, photo_url: cand.selfie_url || null });
    if (!gen.ok) return gen;
    await db().from('cabine_candidatures').update({ status: 'approuve' }).eq('id', id);
    return { ok: true, code: gen.code, expires_at: gen.expires_at, candidature: { ...cand, status: 'approuve' } };
}
async function adminRejectCandidature(id) {
    const cand = await getCandidature(id);
    if (!cand) return { ok: false, error: 'Candidature introuvable' };
    if (cand.status !== 'en_attente') return { ok: false, error: 'Candidature déjà traitée (' + cand.status + ')' };
    await db().from('cabine_candidatures').update({ status: 'rejete' }).eq('id', id);
    return { ok: true, candidature: { ...cand, status: 'rejete' } };
}

module.exports = {
    TX_PLAFOND, OBJECTIF_HEBDO,
    operatorFromPhone, isoWeekKey, monthKey, pctObjectif,
    login, recharge, history, bundles, waveProof, getOrder,
    getCabineByCode, isExpired, addMonths,
    adminValidateOrder, adminRejectOrder, adminCancelOrder, adminListPendingOrders,
    adminListCabines, adminCreateCabine, adminGenerateCabine, adminSetCabine, adminSetPhoto,
    adminListDeposits, adminConfirmDeposit, listDepositsWithProof, clearDepositProof,
    getActiveMessage, adminSetMessage, adminClearMessage,
    createCandidature, adminListCandidatures, getCandidature, adminApproveCandidature, adminRejectCandidature,
};
