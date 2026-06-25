// services/reloadly.js — Intégration Reloadly (Airtime + Gift Cards) pour BIPBIPWEB.
// Les clés vivent dans .env (RELOADLY_CLIENT_ID / RELOADLY_CLIENT_SECRET / RELOADLY_ENV).
// Jamais exposées au client : seules les routes /api/reloadly/* sont publiques.

const ENV = (process.env.RELOADLY_ENV || 'live').toLowerCase();
const SANDBOX = ENV === 'sandbox';
const CLIENT_ID = (process.env.RELOADLY_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.RELOADLY_CLIENT_SECRET || '').trim();

const HOSTS = {
  airtime:   SANDBOX ? 'https://topups-sandbox.reloadly.com'    : 'https://topups.reloadly.com',
  giftcards: SANDBOX ? 'https://giftcards-sandbox.reloadly.com' : 'https://giftcards.reloadly.com',
};
const ACCEPT = {
  airtime:   'application/com.reloadly.topups-v1+json',
  giftcards: 'application/com.reloadly.giftcards-v1+json',
};

const _tokens = {}; // product -> { token, exp }

async function _fetch() { return (await import('node-fetch')).default; }

async function getToken(product) {
  const cached = _tokens[product];
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Reloadly: clés non configurées (.env)');
  const fetch = await _fetch();
  const r = await fetch('https://auth.reloadly.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials', audience: HOSTS[product] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('Reloadly auth: ' + String(d.message || JSON.stringify(d)).slice(0, 160));
  _tokens[product] = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return d.access_token;
}

async function call(product, method, path, body) {
  const fetch = await _fetch();
  const token = await getToken(product);
  const opts = { method, headers: { 'Authorization': 'Bearer ' + token, 'Accept': ACCEPT[product] } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(HOSTS[product] + path, opts);
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = { raw: txt }; }
  if (!r.ok) { const err = new Error((data && data.message) || ('HTTP ' + r.status)); err.status = r.status; err.data = data; throw err; }
  return data;
}

const airtime = {
  detect: (phone, iso) => call('airtime', 'GET', `/operators/auto-detect/phone/${encodeURIComponent(phone)}/countries/${iso}`),
  operatorsByCountry: (iso) => call('airtime', 'GET', `/operators/countries/${iso}`),
  topup: (payload) => call('airtime', 'POST', '/topups', payload),
  balance: () => call('airtime', 'GET', '/accounts/balance'),
};
const giftcards = {
  products: (iso) => call('giftcards', 'GET', iso ? `/countries/${iso}/products` : `/products?page=1&size=200`),
  search: (name) => call('giftcards', 'GET', `/products?size=200&page=1&productName=${encodeURIComponent(name)}`),
  product: (id) => call('giftcards', 'GET', `/products/${id}`),
  order: (payload) => call('giftcards', 'POST', '/orders', payload),
  cards: (txId) => call('giftcards', 'GET', `/orders/transactions/${txId}/cards`),
  balance: () => call('giftcards', 'GET', '/accounts/balance'),
};

module.exports = { airtime, giftcards, getToken, ENV, configured: !!(CLIENT_ID && CLIENT_SECRET) };
