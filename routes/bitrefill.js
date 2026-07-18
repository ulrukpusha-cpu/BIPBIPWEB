// routes/bitrefill.js — endpoints /api/bitrefill/* (proxy sécurisé Bitrefill).
// Lecture libre ; achats (à venir) protégés admin/commande.
const express = require('express');
const router = express.Router();
const bitrefill = require('../services/bitrefill');

const BR_MARKUP = parseFloat(process.env.BITREFILL_GIFTCARD_MARKUP || '5') / 100;
const USD_XOF = parseFloat(process.env.USD_XOF_RATE || process.env.BITREFILL_USD_XOF || '610');
function priceXof(usd) { return Math.round(Number(usd) * USD_XOF * (1 + BR_MARKUP) / 5) * 5; }
function fail(res, e) { res.status(e.status || 500).json({ error: e.message, data: e.data || null }); }
function isAdmin(req) {
  const key = String(req.headers['x-admin-key'] || '').trim();
  const expected = String(process.env.ADMIN_SECRET_KEY || '').trim();
  return !!expected && key === expected;
}

// Marques par défaut (complément Reloadly) — catalogue large : jeux, streaming, shopping, food, outils/IA/VPN.
const DEFAULT_BRANDS = [
  // Jeux
  'steam', 'playstation', 'xbox', 'roblox', 'nintendo', 'razer gold', 'minecraft', 'riot', 'ea play', 'battlenet', 'epic games', 'fortnite', 'valorant', 'twitch', 'discord',
  // Streaming / musique
  'netflix', 'spotify', 'youtube', 'disney', 'hbo', 'crunchyroll', 'apple',
  // Shopping
  'amazon', 'nike', 'adidas', 'ebay', 'walmart', 'target', 'sephora', 'asos', 'zalando',
  // Food / voyage
  'doordash', 'uber eats', 'uber', 'starbucks', 'airbnb', 'booking',
  // Outils / IA / VPN / Cashback
  'nordvpn', 'nordpass', 'nordlocker', 'expressvpn', 'surfshark', 'openai', 'perplexity', 'google play'
].join(',');

// Logo fiable par marque (Bitrefill ne renvoie qu'un slug). icon.horse + domaine.
const BRAND_DOMAIN = {
  steam: 'store.steampowered.com', playstation: 'playstation.com', xbox: 'xbox.com', roblox: 'roblox.com',
  nintendo: 'nintendo.com', razer: 'razer.com', minecraft: 'minecraft.net', riot: 'riotgames.com',
  ea: 'ea.com', battlenet: 'blizzard.com', battle: 'blizzard.com', epic: 'epicgames.com', fortnite: 'epicgames.com',
  valorant: 'riotgames.com', twitch: 'twitch.tv', discord: 'discord.com', netflix: 'netflix.com',
  spotify: 'spotify.com', youtube: 'youtube.com', disney: 'disneyplus.com', hbo: 'hbomax.com',
  crunchyroll: 'crunchyroll.com', apple: 'apple.com', itunes: 'apple.com', amazon: 'amazon.com',
  nike: 'nike.com', adidas: 'adidas.com', ebay: 'ebay.com', walmart: 'walmart.com', target: 'target.com',
  sephora: 'sephora.com', asos: 'asos.com', zalando: 'zalando.com', doordash: 'doordash.com',
  uber: 'uber.com', ubereats: 'ubereats.com', starbucks: 'starbucks.com', airbnb: 'airbnb.com',
  booking: 'booking.com', nordvpn: 'nordvpn.com', nordpass: 'nordpass.com', nordlocker: 'nordlocker.com',
  expressvpn: 'expressvpn.com', surfshark: 'surfshark.com', openai: 'openai.com', chatgpt: 'openai.com',
  perplexity: 'perplexity.ai', google: 'play.google.com', exitlag: 'exitlag.com', gemini: 'gemini.google.com',
  claude: 'claude.ai', grubhub: 'grubhub.com'
};
function logoFor(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  for (const k of Object.keys(BRAND_DOMAIN)) { if (key.indexOf(k) !== -1) return 'https://icon.horse/icon/' + BRAND_DOMAIN[k]; }
  const slug = key.replace(/\b(usa?|usd|uk|gb|fr|global|store|international|eshop|gift|card)\b/g, '').replace(/\s+/g, '');
  return slug ? 'https://icon.horse/icon/' + slug + '.com' : null;
}

// Cache mémoire du catalogue (clé = country|brands), 1h — évite ~22 appels API par requête.
const _catCache = {};
const CAT_TTL = 60 * 60 * 1000;

router.get('/status', (req, res) => res.json({ ok: true, configured: bitrefill.configured }));

router.get('/balance', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin requis' });
  try { res.json(await bitrefill.balance()); } catch (e) { fail(res, e); }
});

// Catalogue prêt pour l'app : marques choisies -> 1 carte/marque, prix client XOF.
router.get('/catalog', async (req, res) => {
  try {
    const country = String(req.query.country || 'US').toUpperCase();
    const brandQ = String(req.query.brand || '').toLowerCase().trim();
    const brands = brandQ ? brandQ.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_BRANDS.split(',');
    const cacheKey = country + '|' + brands.join(',');
    const cached = _catCache[cacheKey];
    if (cached && cached.exp > Date.now()) return res.json(cached.body);

    // Vraie recherche par marque (1 requête /products/search par marque)
    const results = await Promise.all(brands.map(b =>
      bitrefill.search({ q: b, country, product_type: 'giftcard', limit: 20 }).then(d => (d && d.data) || []).catch(() => [])));
    const matched = []; const seen = {};
    brands.forEach((b, i) => {
      const hits = (results[i] || []).filter(p => {
        const n = String(p.name || '').toLowerCase(), id = String(p.id || '').toLowerCase();
        return n.includes(b) || id.includes(b);
      });
      // préfère le pays demandé (prix en devise locale = USD pour US)
      const inCountry = hits.filter(p => String(p.country_code || '').toUpperCase() === country);
      const pick = inCountry[0] || hits[0];
      if (pick && !seen[pick.id]) { seen[pick.id] = 1; matched.push(pick); }
    });

    // Détails (prix) — en parallèle
    const details = await Promise.all(matched.map(m => bitrefill.product(m.id).then(d => d && d.data).catch(() => null)));
    const products = details.filter(Boolean).map(d => {
      const cur = d.currency || 'USD';
      const items = (d.packages || []).map(pk => ({
        faceValue: parseFloat(pk.value), faceCurrency: cur,
        prixClientXOF: priceXof(pk.value), packageId: pk.id
      })).filter(it => it.faceValue > 0 && Number.isFinite(Number(it.prixClientXOF)) && Number(it.prixClientXOF) > 0).sort((a, b) => a.faceValue - b.faceValue);
      return {
        productId: d.id, name: d.name, logo: logoFor(d.name),
        country: d.country_code, recipientCurrency: cur, inStock: d.in_stock !== false,
        categories: d.categories || [], items, source: 'bitrefill'
      };
    }).filter(p => p.items.length && p.recipientCurrency === 'USD'); // USD -> prix XOF corrects

    const body = { markupPct: BR_MARKUP * 100, usdXof: USD_XOF, count: products.length, products };
    if (products.length) _catCache[cacheKey] = { body, exp: Date.now() + CAT_TTL };
    res.json(body);
  } catch (e) { fail(res, e); }
});

module.exports = router;
