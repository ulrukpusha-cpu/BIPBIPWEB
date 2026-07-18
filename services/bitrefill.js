// services/bitrefill.js — Intégration Bitrefill (cartes cadeaux + recharges + eSIM).
// Clé dans .env (BITREFILL_API_KEY). API v2, auth Bearer. Jamais exposée au client.
const API = 'https://api.bitrefill.com/v2';
const KEY = (process.env.BITREFILL_API_KEY || '').trim();

async function _fetch() { return (await import('node-fetch')).default; }

async function call(method, path, body) {
  if (!KEY) throw new Error('Bitrefill: clé non configurée (.env)');
  const fetch = await _fetch();
  const opts = { method, headers: { 'Authorization': 'Bearer ' + KEY, 'Accept': 'application/json' } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(API + path, opts);
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = { raw: txt }; }
  if (!r.ok) { const err = new Error((data && (data.message || (data.error && data.error.message))) || ('HTTP ' + r.status)); err.status = r.status; err.data = data; throw err; }
  return data;
}

// Liste/recherche de produits. country=ISO2, product_type=giftcard|esim, query=marque.
function list(params) {
  const p = params || {};
  const qs = new URLSearchParams();
  qs.set('country', (p.country || 'US').toUpperCase());
  if (p.product_type) qs.set('product_type', p.product_type);
  if (p.query) qs.set('query', p.query);
  qs.set('in_stock', 'true');
  qs.set('per_page', String(Math.min(500, p.per_page || 200)));
  qs.set('page', String(p.page || 1));
  return call('GET', '/products?' + qs.toString());
}
// Vraie recherche par marque : GET /products/search?q=...  (param = q)
function search(params) {
  const p = params || {};
  const qs = new URLSearchParams();
  qs.set('q', p.q || '');
  if (p.country) qs.set('country', String(p.country).toUpperCase());
  if (p.product_type) qs.set('product_type', p.product_type);
  qs.set('limit', String(Math.min(50, p.limit || 20)));
  return call('GET', '/products/search?' + qs.toString());
}
const product = (id) => call('GET', '/products/' + encodeURIComponent(id));
const balance = () => call('GET', '/accounts/balance');
// Achat (commande) — paiement par solde de compte. Pour plus tard (gated).
const invoice = (payload) => call('POST', '/invoices', payload);
const getInvoice = (id) => call('GET', '/invoices/' + encodeURIComponent(id));
const order = (id) => call('GET', '/orders/' + encodeURIComponent(id));

module.exports = { list, search, product, balance, invoice, getInvoice, order, configured: !!KEY };
