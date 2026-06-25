// services/giftDelivery.js — livraison automatique des cartes cadeaux via Reloadly.
// Stockage sidecar (gift-orders.json) des paramètres + du code livré, indépendant du schéma orders.
const fs = require('fs');
const path = require('path');
const reloadly = require('./reloadly');
const STORE = path.join(__dirname, '..', 'gift-orders.json');

function load() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return {}; } }
function save(d) { try { fs.writeFileSync(STORE, JSON.stringify(d)); } catch (e) {} }

// Enregistré à la création de commande (avant paiement).
function saveParams(orderId, params) {
  const d = load();
  d[orderId] = Object.assign({ status: 'pending', createdAt: Date.now() }, d[orderId] || {}, params);
  save(d);
}
function getGift(orderId) { return load()[orderId] || null; }

// Exécuté à la validation du paiement : achète la carte chez Reloadly et récupère le code.
async function deliver(order) {
  const orderId = order.id;
  const d = load(); const g = d[orderId];
  if (!g || !g.reloadlyProductId) return { ok: false, manual: true };
  if (g.status === 'delivered' && g.card) return { ok: true, already: true, card: g.card };

  // Pays + devise du produit (requis pour la commande Reloadly)
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
  g.txId = txId; g.status = 'ordered'; g.orderedAt = Date.now(); d[orderId] = g; save(d);

  // Récupération du code (Reloadly peut prendre quelques secondes)
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
  // Recharge l'objet courant (au cas où saveParams a tourné entre-temps) puis persiste
  const d2 = load(); d2[orderId] = g; save(d2);
  return { ok: !!(card && card.code), card, txId, raw: res };
}

// Recharge internationale (airtime) : exécute le top-up Reloadly à la validation.
async function deliverAirtime(order) {
  const orderId = order.id;
  const d = load(); const g = d[orderId];
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
  const d2 = load(); d2[orderId] = g; save(d2);
  return { ok: true, raw: res };
}

module.exports = { saveParams, getGift, deliver, deliverAirtime };
