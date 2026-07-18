// routes/reloadly.js — endpoints /api/reloadly/* (proxy sécurisé vers Reloadly).
// Lecture : libre. Achats (topup/order) : ADMIN seulement (protège le solde) tant que
// le flux "commande payée -> recharge auto" n'est pas branché.

const express = require('express');
const router = express.Router();
const reloadly = require('../services/reloadly');

function isAdmin(req) {
  const key = String(req.headers['x-admin-key'] || '').trim();
  const expected = String(process.env.ADMIN_SECRET_KEY || '').trim();
  return !!expected && key === expected;
}
function fail(res, e) { res.status(e.status || 500).json({ error: e.message, data: e.data || null }); }

// Marge + change (configurables en .env)
const GC_MARKUP = parseFloat(process.env.RELOADLY_GIFTCARD_MARKUP || '5') / 100;   // 0.05 = +5%
const EUR_XOF = parseFloat(process.env.EUR_XOF_RATE || '585');                     // 1 EUR -> XOF
function priceXof(costSenderEur) {
  const raw = Number(costSenderEur) * EUR_XOF * (1 + GC_MARKUP);
  return Math.round(raw / 5) * 5;   // arrondi au 5 F
}

// ───────── LECTURE (libre) ─────────
router.get('/status', (req, res) => res.json({ ok: true, configured: reloadly.configured, env: reloadly.ENV }));

router.get('/airtime/detect', async (req, res) => {
  try {
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    const iso = String(req.query.iso || 'CI').toUpperCase();
    if (!phone) return res.status(400).json({ error: 'phone requis' });
    res.json(await reloadly.airtime.detect(phone, iso));
  } catch (e) { fail(res, e); }
});

router.get('/airtime/operators', async (req, res) => {
  try { res.json(await reloadly.airtime.operatorsByCountry(String(req.query.iso || 'CI').toUpperCase())); }
  catch (e) { fail(res, e); }
});

// Détection tolérante : essaie le numéro tel quel, avec/sans 0 initial, et avec l'indicatif.
async function detectFlexible(phone, iso, dial) {
  const set = new Set();
  set.add(phone);
  if (phone.startsWith('0')) set.add(phone.replace(/^0+/, ''));
  else set.add('0' + phone);
  if (dial) { set.add(dial + phone.replace(/^0+/, '')); }
  let lastErr = null;
  for (const v of set) {
    try { const op = await reloadly.airtime.detect(v, iso); if (op && op.operatorId) return op; }
    catch (e) { lastErr = e; }
  }
  throw (lastErr || new Error('Opérateur introuvable pour ce numéro (' + iso + ').'));
}

// Devis recharge internationale : détecte l'opérateur + propose des montants au prix client (XOF, +marge).
router.get('/airtime/quote', async (req, res) => {
  try {
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    const iso = String(req.query.iso || '').toUpperCase();
    const dial = String(req.query.dial || '').replace(/\D/g, '') || null;
    const operatorId = req.query.operatorId ? Number(req.query.operatorId) : null;
    if (!iso || (!phone && !operatorId)) return res.status(400).json({ error: 'iso + (phone ou operatorId) requis' });
    let op;
    if (operatorId) {
      op = await reloadly.airtime.operator(operatorId);
    } else {
      try {
        op = await detectFlexible(phone, iso, dial);
      } catch (e) {
        // Détection impossible (opérateurs MVNO/PIN, ex. France) -> liste pour choix manuel
        try {
          const list = await reloadly.airtime.operatorsByCountry(iso);
          const arr = Array.isArray(list) ? list : (list.content || []);
          const operators = arr.map(o => ({ operatorId: o.operatorId, name: o.name, logo: (o.logoUrls || [])[0] || null }));
          return res.json({ ok: false, needsManual: true, operators });
        } catch (e2) { return fail(res, e); }
      }
    }
    const dest = op.destinationCurrencyCode;
    const rate = (op.fx && op.fx.rate) || 0;
    let items = [];
    if (op.denominationType === 'FIXED' && (op.fixedAmounts || []).length) {
      op.fixedAmounts.forEach((eur, i) => {
        const local = (op.localFixedAmounts || [])[i];
        items.push({ senderEUR: +Number(eur).toFixed(4), localAmount: local != null ? Number(local) : Math.round(eur * rate), recipientCurrency: dest, prixClientXOF: priceXof(eur) });
      });
    } else {
      const sugg = (op.suggestedAmounts && op.suggestedAmounts.length) ? op.suggestedAmounts : [2, 5, 10, 15, 20, 30];
      sugg.filter(v => v >= op.minAmount && v <= op.maxAmount).slice(0, 8).forEach(eur => {
        items.push({ senderEUR: +Number(eur).toFixed(4), localAmount: Math.round(eur * rate), recipientCurrency: dest, prixClientXOF: priceXof(eur) });
      });
    }
    items.sort((a, b) => a.senderEUR - b.senderEUR);
    // Montant libre (opérateurs RANGE) : si customLocal fourni -> 1 item calculé (clampé à la plage)
    const customLocal = req.query.customLocal ? Number(req.query.customLocal) : null;
    const isRange = op.denominationType !== 'FIXED';
    if (customLocal && isRange && rate) {
      const minL = Number(op.localMinAmount || 0), maxL = Number(op.localMaxAmount || customLocal);
      const L = Math.max(minL, Math.min(maxL, customLocal));
      const eur = L / rate;
      items = [{ senderEUR: +eur.toFixed(4), localAmount: Math.round(L), recipientCurrency: dest, prixClientXOF: priceXof(eur), custom: true }];
    }
    res.json({
      operatorId: op.operatorId, name: op.name, logo: (op.logoUrls || [])[0] || null,
      country: (op.country || {}).isoName || iso, denominationType: op.denominationType,
      range: isRange ? { minLocal: Number(op.localMinAmount) || null, maxLocal: Number(op.localMaxAmount) || null } : null,
      recipientCurrency: dest, markupPct: GC_MARKUP * 100, items
    });
  } catch (e) { fail(res, e); }
});

router.get('/giftcards/products', async (req, res) => {
  try { res.json(await reloadly.giftcards.products(req.query.iso ? String(req.query.iso).toUpperCase() : null)); }
  catch (e) { fail(res, e); }
});

// Transforme un produit Reloadly brut -> carte affichable (prix client +5% en XOF).
const SUGG = [5, 10, 15, 25, 50, 100, 150, 200];
function toCard(p) {
  const fee = Number(p.senderFee || 0);
  const feePct = Number(p.senderFeePercentage || 0) / 100;
  const cost = (senderBase) => +(Number(senderBase) * (1 + feePct) + fee).toFixed(4);
  let items = [];
  if (p.denominationType === 'FIXED') {
    const map = p.fixedRecipientToSenderDenominationsMap || {};
    items = Object.keys(map).map(faceStr => {
      const c = cost(map[faceStr]);
      return { faceValue: parseFloat(faceStr), faceCurrency: p.recipientCurrencyCode, costEUR: c, prixClientXOF: priceXof(c) };
    });
  } else if (p.denominationType === 'RANGE') {
    const minR = Number(p.minRecipientDenomination), maxR = Number(p.maxRecipientDenomination);
    const minS = Number(p.minSenderDenomination), maxS = Number(p.maxSenderDenomination);
    const picks = SUGG.filter(v => v >= minR && v <= maxR);
    if (!picks.length || picks[0] !== minR) picks.unshift(minR);
    items = picks.map(R => {
      const senderBase = (maxR > minR) ? (minS + (R - minR) / (maxR - minR) * (maxS - minS)) : minS;
      const c = cost(senderBase);
      return { faceValue: R, faceCurrency: p.recipientCurrencyCode, costEUR: c, prixClientXOF: priceXof(c) };
    });
  }
  // Écarte les montants au prix invalide/nul (évite les cartes affichées "0 XOF")
  items = items.filter(it => Number.isFinite(Number(it.prixClientXOF)) && Number(it.prixClientXOF) > 0
    && Number.isFinite(Number(it.faceValue)) && Number(it.faceValue) > 0);
  items.sort((a, b) => a.faceValue - b.faceValue);
  return {
    productId: p.productId, name: p.productName,
    brand: (p.brand || {}).brandName, logo: (p.logoUrls || [])[0] || null,
    country: (p.country || {}).isoName, recipientCurrency: p.recipientCurrencyCode,
    denominationType: p.denominationType,
    range: p.denominationType === 'RANGE' ? { min: p.minRecipientDenomination, max: p.maxRecipientDenomination } : null,
    items
  };
}
// Choisit la meilleure variante d'une marque : FIXED d'abord, puis devise/pays courants.
function pickBest(matches) {
  const curRank = (c) => ({ USD: 0, EUR: 1, GBP: 2 }[c] !== undefined ? { USD: 0, EUR: 1, GBP: 2 }[c] : 3);
  const ctyRank = (c) => ({ US: 0, GB: 1, FR: 2, DE: 3 }[c] !== undefined ? { US: 0, GB: 1, FR: 2, DE: 3 }[c] : 4);
  return matches.slice().sort((a, b) => {
    const fa = a.denominationType === 'FIXED' ? 0 : 1, fb = b.denominationType === 'FIXED' ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ca = curRank(a.recipientCurrencyCode), cb = curRank(b.recipientCurrencyCode);
    if (ca !== cb) return ca - cb;
    return ctyRank((a.country || {}).isoName) - ctyRank((b.country || {}).isoName);
  })[0];
}

// Variantes d'une marque : privilégie US + FR (pertinent Afrique de l'Ouest / CI), puis GB.
// Une carte par pays trouvé parmi ces régions ; fallback sur la meilleure variante sinon.
function pickVariants(matches) {
  const byCountry = {};
  matches.forEach(m => { const c = (m.country || {}).isoName; if (c && !byCountry[c]) byCountry[c] = m; });
  const out = [];
  ['US', 'FR', 'GB'].forEach(c => { if (byCountry[c]) out.push(byCountry[c]); });
  if (!out.length) out.push(pickBest(matches));
  return out;
}

// Catalogue prêt pour l'app : recherche GLOBALE par marque -> variantes US+FR, prix client +5%.
router.get('/giftcards/catalog', async (req, res) => {
  try {
    const iso = req.query.iso ? String(req.query.iso).toUpperCase() : null;
    const brandQ = String(req.query.brand || '').toLowerCase().trim();
    const brands = brandQ ? brandQ.split(',').map(s => s.trim()).filter(Boolean) : null;
    let chosen = [];
    if (brands && brands.length) {
      const results = await Promise.all(brands.map(b =>
        reloadly.giftcards.search(b).then(d => (d && d.content) || (Array.isArray(d) ? d : [])).catch(() => [])));
      brands.forEach((b, i) => {
        const matches = (results[i] || []).filter(p => {
          const n = String(p.productName || '').toLowerCase(), bn = String((p.brand || {}).brandName || '').toLowerCase();
          return n.includes(b) || bn.includes(b);
        });
        if (matches.length) chosen = chosen.concat(pickVariants(matches));
      });
    } else {
      const data = await reloadly.giftcards.products(iso);
      chosen = Array.isArray(data) ? data : (data.content || []);
    }
    const products = chosen.map(toCard).filter(c => c.items.length);
    res.json({ markupPct: GC_MARKUP * 100, eurXof: EUR_XOF, count: products.length, products });
  } catch (e) { fail(res, e); }
});

router.get('/balance', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin requis' });
  try {
    const [a, g] = await Promise.allSettled([reloadly.airtime.balance(), reloadly.giftcards.balance()]);
    res.json({ airtime: a.value || a.reason?.message, giftcards: g.value || g.reason?.message });
  } catch (e) { fail(res, e); }
});

// ───────── ACHATS (ADMIN seulement pour l'instant) ─────────
router.post('/airtime/topup', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin requis' });
  try {
    const { operatorId, amount, recipientPhone, useLocalAmount = true, customIdentifier } = req.body || {};
    if (!operatorId || !amount || !recipientPhone) return res.status(400).json({ error: 'operatorId, amount, recipientPhone requis' });
    res.json(await reloadly.airtime.topup({ operatorId, amount, useLocalAmount, customIdentifier, recipientPhone }));
  } catch (e) { fail(res, e); }
});

router.post('/giftcards/order', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin requis' });
  try { res.json(await reloadly.giftcards.order(req.body || {})); }
  catch (e) { fail(res, e); }
});

router.get('/giftcards/order/:txId/cards', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin requis' });
  try { res.json(await reloadly.giftcards.cards(req.params.txId)); }
  catch (e) { fail(res, e); }
});

module.exports = router;
