/* =========================================================
   Bipbip Recharge — API client
   Centralise tous les appels à https://bipbiprecharge.ci/api/*
   - Détecte automatiquement le bon base URL (web vs APK Capacitor)
   - Cache localStorage + fallback offline
   - Headers Telegram initData / Capacitor-Platform automatiques
   Exposé en : window.BipbipAPI
   ========================================================= */
(function () {
  if (window.BipbipAPI) return;

  // Détecte la base URL selon l'environnement
  function resolveBase() {
    var h = window.location.hostname;
    // En APK Capacitor : hostname = "localhost" → utiliser le VPS prod
    if (h === 'localhost' || h === '127.0.0.1' || h === '') {
      return 'https://bipbiprecharge.ci';
    }
    // En web : même origine (proxy par le serveur)
    return '';
  }

  var BASE = resolveBase();

  // Auth headers (Telegram WebApp initData si dispo, sinon rien)
  function authHeaders() {
    var h = { 'Accept': 'application/json' };
    try {
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
        h['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData;
      }
    } catch (e) {}
    try {
      if (window.Capacitor && window.Capacitor.getPlatform) {
        h['X-Capacitor-Platform'] = window.Capacitor.getPlatform();
      }
    } catch (e) {}
    return h;
  }

  // ─── HTTP helpers ─────────────────────────────────────
  async function getJSON(path, opts) {
    opts = opts || {};
    var url = BASE + path;
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000);
    try {
      var res = await fetch(url, {
        method: 'GET',
        headers: Object.assign({}, authHeaders(), opts.headers || {}),
        signal: ctrl.signal,
        credentials: 'omit'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(to); }
  }

  async function postJSON(path, body, opts) {
    opts = opts || {};
    var url = BASE + path;
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000);
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          authHeaders(),
          opts.headers || {}
        ),
        body: JSON.stringify(body || {}),
        signal: ctrl.signal,
        credentials: 'omit'
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok) {
        var e = new Error((data && data.error) || ('HTTP ' + res.status));
        e.status = res.status; e.data = data;
        throw e;
      }
      return data;
    } finally { clearTimeout(to); }
  }

  // ─── Cache localStorage ──────────────────────────────
  var CACHE_PREFIX = 'bb_api_';
  function getCache(key, maxAgeMs) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.at) return null;
      if (Date.now() - o.at > (maxAgeMs || 600000)) return null;
      return o.data;
    } catch (e) { return null; }
  }
  function setCache(key, data) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data: data })); }
    catch (e) {}
  }

  // ─── Endpoints ───────────────────────────────────────

  // GET /api/config
  async function getConfig() {
    var cached = getCache('config', 5 * 60 * 1000);
    if (cached) return cached;
    var d = await getJSON('/api/config');
    setCache('config', d);
    return d;
  }

  // GET /api/weather?city=Abidjan
  async function getWeather(city) {
    city = city || 'Abidjan';
    var key = 'weather_' + city;
    var cached = getCache(key, 10 * 60 * 1000);
    if (cached) return cached;
    try {
      var d = await getJSON('/api/weather?city=' + encodeURIComponent(city));
      setCache(key, d);
      return d;
    } catch (e) { return cached || null; }
  }

  // GET /api/bundles/:operator  (operator = 'mtn' | 'orange' | 'moov')
  async function getBundles(operator) {
    var key = 'bundles_' + operator;
    var cached = getCache(key, 30 * 60 * 1000);
    if (cached) return cached;
    var d = await getJSON('/api/bundles/' + encodeURIComponent(operator));
    setCache(key, d);
    return d;
  }

  // POST /api/bundle/subscribe
  function subscribeBundle(body) {
    // body = { phone, operator, bundleId, paymentMethod }
    return postJSON('/api/bundle/subscribe', body, { timeout: 30000 });
  }

  // GET /api/quests
  async function getQuests() {
    var cached = getCache('quests', 5 * 60 * 1000);
    if (cached) return cached;
    var d = await getJSON('/api/quests');
    setCache('quests', d);
    return d;
  }

  // GET /api/quests/user/:userId
  function getUserQuests(userId) {
    return getJSON('/api/quests/user/' + encodeURIComponent(userId));
  }

  // POST /api/quests/claim
  function claimQuest(questCode) {
    return postJSON('/api/quests/claim', { questCode: questCode });
  }

  // GET /api/telegram/daily-checkin
  function getDailyCheckin() {
    return getJSON('/api/telegram/daily-checkin').catch(function () { return null; });
  }

  // POST /api/telegram/daily-checkin/claim
  function claimDailyCheckin() {
    return postJSON('/api/telegram/daily-checkin/claim', {});
  }

  // GET /api/actualites?limit=N
  async function getActualites(limit) {
    limit = limit || 10;
    var key = 'actualites_' + limit;
    var cached = getCache(key, 15 * 60 * 1000);
    if (cached) return cached;
    var d = await getJSON('/api/actualites?limit=' + limit);
    setCache(key, d);
    return d;
  }

  // POST /api/orders   (création d'une commande de recharge)
  function createOrder(body) {
    // body = { operator, amount, phone, paymentMethod, ... }
    return postJSON('/api/orders', body, { timeout: 30000 });
  }

  // GET /api/orders/:id
  function getOrder(id) {
    return getJSON('/api/orders/' + encodeURIComponent(id));
  }

  // POST /api/momo/request-to-pay
  function momoRequest(body) {
    return postJSON('/api/momo/request-to-pay', body, { timeout: 30000 });
  }

  // GET /api/momo/status/:referenceId
  function momoStatus(refId) {
    return getJSON('/api/momo/status/' + encodeURIComponent(refId));
  }

  // GET /api/led/messages — bandeau LED actif
  async function getLedMessages() {
    // Pas de cache : on veut les derniers messages payés
    try {
      var d = await getJSON('/api/led/messages', { timeout: 8000 });
      return (d && d.messages) || [];
    } catch (e) { return []; }
  }

  // POST /api/annonces — créer une annonce LED en attente paiement
  function createAnnonceLed(body) {
    // body = { contenu, prix, userId? }
    return postJSON('/api/annonces', body, { timeout: 20000 });
  }

  // POST /api/annonces/:id/request-payment — déclencher MoMo
  function requestAnnoncePayment(id, body) {
    // body = { phone }
    return postJSON('/api/annonces/' + encodeURIComponent(id) + '/request-payment', body, { timeout: 30000 });
  }

  // Telegram poll (auth APK natif via deep link bot)
  function createTelegramPoll() {
    return postJSON('/api/auth/telegram-poll/create', {});
  }
  function checkTelegramPoll(token) {
    return getJSON('/api/auth/telegram-poll/check?token=' + encodeURIComponent(token), { timeout: 8000 });
  }

  // GET /api/gift-cards
  async function getGiftCards() {
    var cached = getCache('giftcards', 60 * 60 * 1000);
    if (cached) return cached;
    var d = await getJSON('/api/gift-cards');
    setCache('giftcards', d);
    return d;
  }

  // Public API
  window.BipbipAPI = {
    base: BASE,
    getConfig: getConfig,
    getWeather: getWeather,
    getBundles: getBundles,
    subscribeBundle: subscribeBundle,
    getQuests: getQuests,
    getUserQuests: getUserQuests,
    claimQuest: claimQuest,
    getDailyCheckin: getDailyCheckin,
    claimDailyCheckin: claimDailyCheckin,
    getActualites: getActualites,
    createOrder: createOrder,
    getOrder: getOrder,
    momoRequest: momoRequest,
    momoStatus: momoStatus,
    getLedMessages: getLedMessages,
    createAnnonceLed: createAnnonceLed,
    requestAnnoncePayment: requestAnnoncePayment,
    getGiftCards: getGiftCards,
    createTelegramPoll: createTelegramPoll,
    checkTelegramPoll: checkTelegramPoll,
    // Cache utils (exposed for debug)
    _getCache: getCache,
    _setCache: setCache,
    _clearCache: function () {
      try {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf(CACHE_PREFIX) === 0) localStorage.removeItem(k);
        });
      } catch (e) {}
    }
  };

  console.log('[BipbipAPI] ready, base =', BASE || '(same-origin)');
})();
