// services/giftDelivery.js — livraison automatique cartes cadeaux + recharge internationale (Reloadly).
// PERSISTANCE :
//   - Primaire : Supabase, colonne orders.notes = JSON { reloadly: {...params, code, txId, status} }
//   - Secours  : fichier sidecar gift-orders.json (rapide, survit si Supabase indispo)
const fs = require('fs');
const path = require('path');
const reloadly = require('./reloadly');
let getSupabase = null;
try { ({ getSupabase } = require('../database/supabase-client')); } catch (e) { getSupabase = null; }
const STORE = path.join(__dirname, '..', 'gift-orders.json');

function load() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return {}; } }
function save(d) { try { fs.writeFileSync(STORE, JSON.stringify(d)); } catch (e) {} }

// ── Miroir Supabase (orders.notes) ──
async function dbMirror(orderId, rec) {
  try {
    if (!getSupabase) return;
    const sb = getSupabase(); if (!sb) return;
    await sb.from('orders').update({ notes: JSON.stringify({ reloadly: rec }) }).eq('id', orderId);
  } catch (e) { console.error('[Gift dbMirror]', e.message); }
}
async function dbRead(orderId) {
  try {
    if (!getSupabase) return null;
    const sb = getSupabase(); if (!sb) return null;
    const { data } = await sb.from('orders').select('notes').eq('id', orderId).single();
    if (data && data.notes) { const p = JSON.parse(data.notes); return (p && p.reloadly) || null; }
  } catch (e) { /* fallback sidecar */ }
  return null;
}

// Enregistré à la création de commande (avant paiement).
function saveParams(orderId, params) {
  const d = load();
  d[orderId] = Object.assign({ status: 'pending', createdAt: Date.now() }, d[orderId] || {}, params);
  save(d);
  dbMirror(orderId, d[orderId]);   // miroir Supabase (fire-and-forget)
}
// Lecture : sidecar d'abord (rapide), sinon Supabase (durable).
async function getGift(orderId) {
  const local = load()[orderId];
  if (local) return local;
  return await dbRead(orderId);
}

// Exécuté à la validation du paiement : achète la carte chez Reloadly et récupère le code.
async function deliver(order) {
  const orderId = order.id;
  const d = load(); const g = d[orderId] || (await dbRead(orderId));
  if (g && g.source === 'bitrefill') return deliverBitrefill(order, g);
  if (!g || !g.reloadlyProductId) return { ok: false, manual: true };
  if (g.status === 'delivered' && g.card) return { ok: true, already: true, card: g.card };

  let countryCode = g.countryCode;
  if (!countryCode) {
    try {
      const p = await reloadly.giftcards.product(g.reloadlyProductId);
      countryCode = (p.country || {}).isoName;
      if (!g.recipientCurrency) g.recipientCurrency = p.recipientCurrencyCode;
    } catch (e) { /* fallback plus bas */ }
  }

  const res = await reloadly.giftcards.order({
    productId: Number(g.reloadlyProductId),
    countryCode: countryCode || 'US',
    quantity: 1,
    unitPrice: Number(g.faceValue),
    customIdentifier: 'BIP-' + orderId,
    senderName: process.env.RELOADLY_SENDER_NAME || 'Bipbip Recharge',
    recipientEmail: process.env.RELOADLY_RECIPIENT_EMAIL || 'cartes@bipbiprecharge.ci'
  });
  const txId = res.transactionId || res.id || (res.transaction && res.transaction.transactionId);
  g.txId = txId; g.status = 'ordered'; g.orderedAt = Date.now(); d[orderId] = g; save(d); dbMirror(orderId, g);

  let cards = null;
  for (let i = 0; i < 8 && txId; i++) {
    try { cards = await reloadly.giftcards.cards(txId); } catch (e) { cards = null; }
    if (Array.isArray(cards) && cards.length) break;
    if (cards && (cards.cardNumber || cards.pinCode)) { cards = [cards]; break; }
    await new Promise(r => setTimeout(r, 4000));
  }
  let card = null;
  if (Array.isArray(cards) && cards.length) {
    const c = cards[0];
    card = {
      code: c.cardNumber || c.redemptionCode || c.pinCode || '',
      pin: c.pinCode || '',
      info: c.redemptionInstructions || c.additionalInfo || ''
    };
  }
  g.card = card;
  g.status = (card && card.code) ? 'delivered' : 'ordered';
  g.deliveredAt = Date.now();
  const d2 = load(); d2[orderId] = g; save(d2); await dbMirror(orderId, g);
  return { ok: !!(card && card.code), card, txId, raw: res };
}

// Recharge internationale (airtime) : exécute le top-up Reloadly à la validation.
async function deliverAirtime(order) {
  const orderId = order.id;
  const d = load(); const g = d[orderId] || (await dbRead(orderId));
  if (!g || !g.operatorId) return { ok: false, manual: true };
  if (g.status === 'delivered') return { ok: true, already: true };
  const res = await reloadly.airtime.topup({
    operatorId: Number(g.operatorId),
    amount: Number(g.senderEUR),
    useLocalAmount: false,
    customIdentifier: 'BIP-' + orderId,
    recipientPhone: { countryCode: g.iso, number: g.number }
  });
  g.txId = res.transactionId || res.id || null;
  g.providerStatus = res.status || null;
  g.status = 'delivered'; g.deliveredAt = Date.now();
  const d2 = load(); d2[orderId] = g; save(d2); await dbMirror(orderId, g);
  return { ok: true, raw: res };
}

// Carte cadeau Bitrefill — achat via invoice payée par solde, puis récupération du code.
// DÉFENSIF : toute erreur (solde insuffisant, format inattendu) -> { manual:true } => livraison manuelle admin.
async function deliverBitrefill(order, g) {
  const orderId = order.id;
  g = g || load()[orderId] || (await dbRead(orderId));
  if (!g || !g.bitrefillProductId) return { ok: false, manual: true };
  if (g.status === 'delivered' && g.card) return { ok: true, already: true, card: g.card };
  try {
    const bitrefill = require('./bitrefill');
    const inv = await bitrefill.invoice({
      products: [{ product_id: g.bitrefillProductId, package_id: g.bitrefillPackageId, quantity: 1 }],
      payment_method: 'balance'
    });
    const data = (inv && inv.data) || inv || {};
    const invId = data.id || data.invoice_id || (data.invoice && data.invoice.id);
    g.invoiceId = invId; g.status = 'ordered'; g.orderedAt = Date.now();
    const d1 = load(); d1[orderId] = g; save(d1); await dbMirror(orderId, g);

    let card = null;
    for (let i = 0; i < 8 && invId; i++) {
      try {
        const st = await bitrefill.getInvoice(invId);
        const sd = (st && st.data) || st || {};
        const items = sd.items || sd.orders || (sd.order && [sd.order]) || [];
        const it = items[0] || {};
        const code = it.value || it.code || it.pinCode || (it.delivery && (it.delivery.code || it.delivery.link)) || (it.redemptionInfo && it.redemptionInfo.code);
        if (code) { card = { code: String(code), pin: it.pinCode || '', info: it.redemptionInfo ? JSON.stringify(it.redemptionInfo).slice(0, 300) : 'Bitrefill' }; break; }
      } catch (e) { /* retry */ }
      await new Promise(r => setTimeout(r, 4000));
    }
    g.card = card; g.status = (card && card.code) ? 'delivered' : 'ordered'; g.deliveredAt = Date.now();
    const d2 = load(); d2[orderId] = g; save(d2); await dbMirror(orderId, g);
    return { ok: !!(card && card.code), card, manual: !card };
  } catch (e) {
    console.error('[Bitrefill deliver]', e.message);
    return { ok: false, manual: true };   // solde insuffisant / non testé -> livraison manuelle
  }
}

module.exports = { saveParams, getGift, deliver, deliverAirtime, deliverBitrefill };
