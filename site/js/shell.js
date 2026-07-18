/* =========================================================
   Bipbip Recharge — Web shell
   Injects the common chrome (top nav, footer, background scene,
   theme picker) into every /site page so markup isn't duplicated.
   A page only needs: <body class="bb-shell" data-page="recharge">
   plus its own content inside .site-wrap.
   ========================================================= */
(function () {
  var PAGES = [
    { id: 'recharge',   label: 'Recharge',   href: '/site/index.html' },
    { id: 'market',     label: 'Market',     href: '/site/market.html' },
    { id: 'actualites', label: 'Actualités', href: '/site/actualites.html' },
    { id: 'quests',     label: 'Quêtes',     href: '/site/quests.html' },
    { id: 'profil',     label: 'Profil',     href: '/site/profil.html' }
  ];

  function currentPage() { return document.body.getAttribute('data-page') || ''; }

  var I18N_KEY = { recharge: 'nav.recharge', market: 'nav.market', actualites: 'nav.actualites', quests: 'nav.quests', profil: 'nav.profil' };
  function buildNav() {
    var page = currentPage();
    var mk = function (p) {
      var key = I18N_KEY[p.id] || '';
      return '<a data-page="' + p.id + '" href="' + p.href + '"' + (key ? ' data-i18n="' + key + '"' : '') + (p.id === page ? ' class="is-active"' : '') + '>' + p.label + '</a>';
    };
    var links = PAGES.map(mk).join('');
    var mobileLinks = PAGES.map(mk).join('');

    var nav = document.createElement('header');
    nav.className = 'site-nav';
    nav.innerHTML =
      '<div class="site-nav__inner">' +
        '<a class="site-nav__brand" href="/site/index.html">' +
          '<img class="site-nav__logo" src="/Logo%20minia.png" alt="Bipbip Recharge Pro">' +
        '</a>' +
        '<nav class="site-nav__links">' + links + '</nav>' +
        '<div class="site-nav__right">' +
          '<span class="bb-weather" id="bbWeather" title="" style="display:none"><iconify-icon id="bbWeatherIcon" icon="solar:sun-linear" width="16"></iconify-icon><span id="bbWeatherTemp"></span></span>' +
          '<div class="bb-lang" id="bbLang"><button type="button" data-lang="fr">FR</button><button type="button" data-lang="en">EN</button></div>' +
          '<span class="bb-pill" id="bbPointsPill" style="display:none"><span class="bb-pill__dot"></span>Points :&nbsp;<strong id="bbPointsVal">0</strong></span>' +
          '<button class="bb-cta site-login-btn" id="bbLoginBtn" type="button" data-bbt="nav.login">Connexion</button>' +
          '<a class="site-nav__avatar" id="bbAvatar" href="/site/profil.html" title="Mon profil" style="display:none"></a>' +
          '<button class="site-nav__burger" id="bbBurger" type="button" aria-label="Menu">&#9776;</button>' +
        '</div>' +
      '</div>' +
      '<div class="site-mobile-menu" id="bbMobileMenu">' + mobileLinks + '</div>';
    document.body.insertBefore(nav, document.body.firstChild);

    document.getElementById('bbLoginBtn').addEventListener('click', function () {
      if (currentPage() === 'profil') { window.BB.loginGoogle('googleSigninFallback'); }
      else { location.href = '/site/profil.html'; }
    });
    var burger = document.getElementById('bbBurger');
    var menu = document.getElementById('bbMobileMenu');
    burger.addEventListener('click', function () { menu.classList.toggle('is-open'); });

    // Hidden admin trigger: 5 quick taps on the brand logo (else go home)
    var logo = document.querySelector('.site-nav__logo');
    if (logo) {
      var taps = 0, tt = null;
      logo.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        taps++; clearTimeout(tt);
        if (taps >= 5) { taps = 0; location.href = '/site/admin.html'; return; }
        tt = setTimeout(function () { var n = taps; taps = 0; if (n <= 1) location.href = '/site/index.html'; }, 500);
      });
    }

    // Language toggle (FR/EN)
    var lang = document.getElementById('bbLang');
    if (lang) {
      lang.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-lang]'); if (!b) return;
        try { if (window.setLanguage) window.setLanguage(b.dataset.lang); } catch (err) {}
        syncLang(); applyBBT();
      });
    }
  }
  function curLang() { try { return (window.__bipbipI18n && window.__bipbipI18n.getLang()) || 'fr'; } catch (e) { return 'fr'; } }
  function syncLang() {
    var cur = curLang();
    var lang = document.getElementById('bbLang');
    if (lang) Array.from(lang.querySelectorAll('button')).forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === cur); });
  }

  // ── Site translation layer (data-bbt) — complements shared data-i18n ──
  var BBT = {
    'nav.login':       { fr: 'Connexion', en: 'Sign in' },
    'hero.kicker':     { fr: 'Recharge mobile', en: 'Mobile top-up' },
    'hero.sub':        { fr: 'Rechargez votre crédit mobile en quelques clics — Orange, MTN, Moov. Paiement Djamo, Wave ou crypto. Gagnez des points à chaque action.', en: 'Top up your mobile credit in a few clicks — Orange, MTN, Moov. Pay with Djamo, Wave or crypto. Earn points on every action.' },
    'hero.cta':        { fr: 'Recharger maintenant →', en: 'Top up now →' },
    'rech.title':      { fr: 'Nouvelle recharge', en: 'New top-up' },
    'rech.op':         { fr: 'Opérateur', en: 'Operator' },
    'rech.bundles':    { fr: 'Forfaits Data & Voix', en: 'Data & Voice bundles' },
    'rech.bundlesData':{ fr: 'Forfaits Internet', en: 'Internet bundles' },
    'rech.bundlesMix': { fr: 'Mix Voix + Data', en: 'Voice + Data mix' },
    'rech.num':        { fr: 'Numéro', en: 'Phone number' },
    'rech.phoneHint':  { fr: 'Choisissez un opérateur puis entrez le numéro', en: 'Choose an operator then enter the number' },
    'rech.amount':     { fr: 'Montant', en: 'Amount' },
    'rech.fee':        { fr: '(+ 5% de frais)', en: '(+5% fee)' },
    'rech.custom':     { fr: 'Montant libre', en: 'Custom amount' },
    'rech.customPh':   { fr: 'Entrez le montant souhaité (FCFA)', en: 'Enter the amount you want (FCFA)' },
    'rech.orders':     { fr: 'Mes commandes', en: 'My orders' },
    'ph.recharge.t':   { fr: 'Bipbip Recharge', en: 'Bipbip Recharge' },
    'ph.market.t':     { fr: 'Market', en: 'Market' },
    'ph.market.s':     { fr: "Cartes cadeaux e-mailables et articles d'occasion entre particuliers.", en: 'E-mailable gift cards and second-hand items between members.' },
    'ph.actus.t':      { fr: 'Actualités', en: 'News' },
    'ph.actus.s':      { fr: "Télécom, mobile money & tech en Côte d'Ivoire. Lis un article connecté pour gagner des points.", en: 'Telecom, mobile money & tech in Côte d\'Ivoire. Read an article while signed in to earn points.' },
    'ph.quests.t':     { fr: 'Quêtes & Points', en: 'Quests & Points' },
    'ph.quests.s':     { fr: 'Connecte-toi chaque jour, accomplis des missions et lis des articles pour gagner des points.', en: 'Check in daily, complete missions and read articles to earn points.' },
    'ph.profil.t':     { fr: 'Mon profil', en: 'My profile' },
    'ph.profil.s':     { fr: 'Connectez-vous avec Google pour sauvegarder vos points, vos quêtes et votre historique.', en: 'Sign in with Google to save your points, quests and history.' },
    'market.mine':     { fr: 'Mes articles à vendre', en: 'My items for sale' },
    'market.sell':     { fr: 'Vendre un article', en: 'Sell an item' },
    'quests.daily':    { fr: 'Quêtes générales', en: 'General quests' },
    'quests.history':  { fr: 'Historique des points', en: 'Points history' },
    'faq.title': { fr: 'Aide & questions fréquentes', en: 'Help & frequently asked questions' },
    'faq.q1': { fr: 'Comment recharger un numéro ?', en: 'How do I top up a number?' },
    'faq.a1': { fr: "Choisissez votre opérateur (Orange, MTN ou Moov), entrez le numéro à recharger, sélectionnez le montant puis validez. Vous payez ensuite avec Wave ou Djamo, et le crédit est livré automatiquement — en général en moins de 5 minutes.", en: "Choose your operator (Orange, MTN or Moov), enter the number, pick the amount and confirm. Pay with Wave or Djamo and the credit is delivered automatically — usually in under 5 minutes." },
    'faq.q2': { fr: 'Quels moyens de paiement acceptez-vous ?', en: 'Which payment methods do you accept?' },
    'faq.a2': { fr: "Wave, Djamo et crypto. Après votre commande, les instructions de paiement s'affichent avec le montant total à régler.", en: "Wave, Djamo and crypto. After your order, payment instructions appear with the total amount to pay." },
    'faq.q3': { fr: 'Pourquoi le total est-il un peu plus élevé que le montant de la recharge ?', en: 'Why is the total slightly higher than the top-up amount?' },
    'faq.a3': { fr: "Un frais de service de 5% s'ajoute au montant de la recharge. Important : payez exactement le total affiché — un paiement incomplet est automatiquement refusé par notre système de validation.", en: "A 5% service fee is added to the top-up amount. Important: pay exactly the displayed total — an incomplete payment is automatically rejected by our validation system." },
    'faq.q4': { fr: 'En combien de temps ma recharge arrive-t-elle ?', en: 'How fast is my top-up delivered?' },
    'faq.a4': { fr: "La validation est automatique dès réception de votre paiement, et la livraison prend en général moins de 5 minutes. En cas de ralentissement réseau chez l'opérateur, vous recevez un SMS et la recharge part dès que possible.", en: "Validation is automatic as soon as your payment is received, and delivery usually takes under 5 minutes. If the operator network is slow, you get an SMS and the top-up goes out as soon as possible." },
    'faq.q5': { fr: 'Faites-vous la recharge internationale et les cartes cadeaux ?', en: 'Do you offer international top-up and gift cards?' },
    'faq.a5': { fr: "Oui ! La recharge internationale couvre plus de 150 pays (bouton « Recharge internationale » ci-dessus). Et dans le Market, vous trouvez des cartes cadeaux envoyées par e-mail : Netflix, Steam, Google Play et bien d'autres.", en: "Yes! International top-up covers 150+ countries (see the button above). And the Market offers gift cards delivered by e-mail: Netflix, Steam, Google Play and more." },
    'faq.q6': { fr: "J'ai un problème avec ma commande, qui contacter ?", en: 'I have an issue with my order, who do I contact?' },
    'faq.a6': { fr: "Notre équipe répond 7j/7. Écrivez-nous sur Telegram, ou suivez le canal officiel pour les annonces et promos :", en: "Our team replies 7 days a week. Message us on Telegram, or follow the official channel for news and promos:" }
  };
  function applyBBT() {
    var lang = curLang();
    document.querySelectorAll('[data-bbt]').forEach(function (el) {
      var k = el.getAttribute('data-bbt'); var entry = BBT[k];
      if (entry && entry[lang] != null) el.textContent = entry[lang];
    });
    // placeholders
    document.querySelectorAll('[data-bbt-ph]').forEach(function (el) {
      var k = el.getAttribute('data-bbt-ph'); var entry = BBT[k];
      if (entry && entry[lang] != null) el.setAttribute('placeholder', entry[lang]);
    });
  }
  window.__applyBBT = applyBBT;

  function buildFooter() {
    var f = document.createElement('footer');
    f.className = 'site-footer';
    f.innerHTML = 'Bipbip Recharge CI · Web · <a href="/#aide">Aide</a> · <a href="/app/">Ouvrir l\'application →</a>';
    // Insert after .site-wrap if present, else at end of body
    var wrap = document.querySelector('.site-wrap');
    if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(f, wrap.nextSibling);
    else document.body.appendChild(f);
  }

  function mountScene() {
    var bg = document.createElement('div');
    bg.className = 'site-bg';
    bg.id = 'siteBg';
    bg.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(bg, document.body.firstChild);
    var init = function () {
      if (!window.BipbipDynamicScene) return false;
      try { window.__bdsScene = new BipbipDynamicScene('#siteBg'); } catch (e) { console.warn('[scene]', e); }
      return true;
    };
    if (!init()) {
      var s = document.createElement('script');
      s.src = '/bipbip-dynamic-scene.js';
      s.onload = init;
      s.onerror = function () { console.warn('[scene] failed to load'); };
      document.body.appendChild(s);
    }
  }

  function buildThemePicker() {
    if (document.getElementById('picker')) return;
    var picker = document.createElement('div');
    picker.className = 'bb-picker';
    picker.id = 'picker';
    picker.setAttribute('aria-label', 'Thème saisonnier');
    document.body.appendChild(picker);
  }

  function bootTheme() {
    if (!window.BipbipTheme) return;
    BipbipTheme.bootstrap({ particles: true, density: 30 }).then(function () {
      var picker = document.getElementById('picker');
      if (!picker) return;
      var list = BipbipTheme.listSeasons();
      picker.innerHTML = ['<button data-id=""><span class="emo">🎨</span>Auto</button>']
        .concat(list.map(function (s) { return '<button data-id="' + s.id + '"><span class="emo">' + s.emoji + '</span>' + s.label + '</button>'; }))
        .join('');
      picker.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-id]');
        if (!btn) return;
        var id = btn.dataset.id || null;
        BipbipTheme.apply(id);
        BipbipTheme.mountParticles({ density: 30 });
        Array.from(picker.querySelectorAll('button')).forEach(function (b) { b.classList.toggle('is-active', b.dataset.id === (id || '')); });
      });
      // Thème forcé par l'admin (cache) appliqué instantanément, avant le poll serveur
      var forced = '';
      try { forced = localStorage.getItem('bb-theme-force') || ''; } catch (e) {}
      if (forced) { BipbipTheme.apply(forced); BipbipTheme.mountParticles({ density: 30 }); }
      var active = BipbipTheme.getActive();
      var sel = picker.querySelector('button[data-id="' + (active ? active.id : '') + '"]');
      if (sel) sel.classList.add('is-active');
    });
  }

  // ── Maintenance overlay + server-forced theme ──
  function makeAbsImg(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.indexOf('data:') === 0) return u;
    var base = (window.BipbipAPI && window.BipbipAPI.base) || 'https://bipbiprecharge.ci';
    return base + (u.charAt(0) === '/' ? '' : '/') + u;
  }
  function buildMaintenance() {
    if (document.getElementById('bbMaintenance')) return;
    var ov = document.createElement('div');
    ov.id = 'bbMaintenance';
    ov.innerHTML =
      '<img id="bbMaintImg" alt="" style="display:none">' +
      '<iconify-icon id="bbMaintDefault" icon="solar:settings-bold-duotone" width="64" style="color:var(--bb-accent)"></iconify-icon>' +
      '<h1>Maintenance en cours</h1>' +
      '<p id="bbMaintMsg" class="muted" style="max-width:420px;font-size:15px"></p>' +
      '<p class="hint">Le service sera de retour très bientôt. Merci de votre patience.</p>';
    document.body.appendChild(ov);
  }
  function applyMaintenanceUI(m) {
    var on = !!(m && m.enabled);
    document.documentElement.classList.toggle('is-maintenance', on);
    var ov = document.getElementById('bbMaintenance');
    if (ov) ov.classList.toggle('is-on', on);
    var imgEl = document.getElementById('bbMaintImg');
    var defEl = document.getElementById('bbMaintDefault');
    var customImg = (m && m.image) ? makeAbsImg(m.image) : '';
    if (imgEl && defEl) {
      if (on && customImg) { imgEl.src = customImg; imgEl.style.display = 'block'; defEl.style.display = 'none'; }
      else { imgEl.style.display = 'none'; defEl.style.display = ''; }
    }
    var msgEl = document.getElementById('bbMaintMsg');
    if (msgEl) msgEl.textContent = (m && m.message) || '';
  }

  var __lastServerTheme = '';
  function syncPickerActive(id) {
    var picker = document.getElementById('picker'); if (!picker) return;
    Array.from(picker.querySelectorAll('button')).forEach(function (b) { b.classList.toggle('is-active', b.dataset.id === (id || '')); });
  }
  function applyServerTheme(cfg) {
    if (!cfg || !Object.prototype.hasOwnProperty.call(cfg, 'themeForce')) return;
    var tf = cfg.themeForce || '';
    if (tf === __lastServerTheme) return;
    __lastServerTheme = tf;
    try { if (tf) localStorage.setItem('bb-theme-force', tf); else localStorage.removeItem('bb-theme-force'); } catch (e) {}
    if (!window.BipbipTheme) return;
    if (tf) { BipbipTheme.apply(tf); syncPickerActive(tf); }
    else { var d = BipbipTheme.detect && BipbipTheme.detect(); BipbipTheme.apply(d ? d.id : null); syncPickerActive(d ? d.id : ''); }
    if (BipbipTheme.mountParticles) BipbipTheme.mountParticles({ density: 30 });
  }
  async function checkConfig() {
    var base = (window.BipbipAPI && window.BipbipAPI.base) || 'https://bipbiprecharge.ci';
    // ⚠️ Accept seulement (pas de Cache-Control → préflight refusé). ?_=ts suffit.
    var r = await fetch(base + '/api/config?_=' + Date.now(), { method: 'GET', headers: { 'Accept': 'application/json' }, cache: 'no-store', credentials: 'omit' });
    if (!r || !r.ok) throw new Error('config http ' + (r && r.status));
    var cfg = await r.json();
    if (!cfg || typeof cfg !== 'object') throw new Error('config invalide');
    applyServerTheme(cfg);
    if (!Object.prototype.hasOwnProperty.call(cfg, 'maintenance') || cfg.maintenance == null) throw new Error('config sans maintenance');
    try { localStorage.setItem('bb_maintenance', JSON.stringify(cfg.maintenance)); } catch (e) {}
    applyMaintenanceUI(cfg.maintenance);
    return true;
  }
  function startConfig() {
    buildMaintenance();
    // 1) état caché instantané
    try { var cached = JSON.parse(localStorage.getItem('bb_maintenance') || 'null'); if (cached) applyMaintenanceUI(cached); } catch (e) {}
    __lastServerTheme = (function () { try { return localStorage.getItem('bb-theme-force') || ''; } catch (e) { return ''; } })();
    // 2) confirme depuis le serveur (retries) + re-check 30s
    var attempts = 0;
    (function tryOnce() { attempts++; checkConfig().catch(function () { if (attempts < 10) setTimeout(tryOnce, 2000); }); })();
    setInterval(function () { checkConfig().catch(function () {}); }, 30000);
  }

  // ── Weather (drives the nav chip + scene rain) ──
  function parseTempC(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return Math.round(raw);
    var m = String(raw).match(/-?\d+(?:\.\d+)?/);
    return m ? Math.round(parseFloat(m[0])) : null;
  }
  function applyWeather(d) {
    if (!d || d.fallback === true) return;
    var t = parseTempC(d.temp != null ? d.temp : d.temperature);
    if (t == null) return;
    var cond = d.condition || '';
    var chip = document.getElementById('bbWeather');
    if (chip) {
      document.getElementById('bbWeatherTemp').textContent = t + '°C';
      chip.title = cond + (d.location || d.city ? ' · ' + (d.location || d.city) : '');
      var c = String(cond).toLowerCase(), solar = 'solar:sun-linear';
      if (/rain|pluie|drizzle|averse/.test(c)) solar = 'solar:cloud-rain-linear';
      else if (/snow|neige/.test(c)) solar = 'solar:snowflake-linear';
      else if (/storm|orage/.test(c)) solar = 'solar:cloud-storm-linear';
      else if (/fog|brume|mist|haze/.test(c)) solar = 'solar:fog-linear';
      else if (/cloud|nuag|couvert/.test(c)) solar = 'solar:cloud-sun-linear';
      var ic = document.getElementById('bbWeatherIcon'); if (ic) ic.setAttribute('icon', solar);
      chip.style.display = '';
    }
    try { if (window.__bdsScene && window.__bdsScene.setRain) window.__bdsScene.setRain(/pluie|rain|averse|orage|drizzle/i.test(cond)); } catch (e) {}
  }
  function refreshWeather() {
    if (!window.BipbipAPI) return;
    var city = (function () { try { return localStorage.getItem('bb-weather-city') || 'Abidjan'; } catch (e) { return 'Abidjan'; } })();
    try { localStorage.removeItem('bb_api_weather_' + city); } catch (e) {}
    window.BipbipAPI.getWeather(city).then(function (d) { if (d) applyWeather(d); }).catch(function () {});
  }

  // ── LED marquee (paid messages + news titles + base) ──
  var LED_BASE = ['Bienvenue sur Bipbip Recharge', 'Offres disponibles 24/7', 'Paiement Djamo · Wave · Crypto', 'MTN · Orange · Moov'];
  var ledPaid = [], ledNews = [], ledSeconds = 60;
  function rebuildMarquee() {
    var track = document.getElementById('ledTrack'); if (!track) return;
    var all = ledPaid.concat(ledNews).concat(LED_BASE).filter(Boolean);
    if (!all.length) return;
    var esc = window.BB ? BB.escapeHtml : function (s) { return s; };
    track.innerHTML = all.concat(all).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
    var dur = Math.min(300, Math.max(15, ledSeconds || 60));
    track.style.animation = 'none'; void track.offsetWidth;
    track.style.setProperty('--bb-led-dur', dur + 's'); track.style.animation = '';
  }
  function refreshLed() {
    if (!document.getElementById('ledTrack') || !window.BipbipAPI) return;
    window.BipbipAPI.getConfig().then(function (cfg) { if (cfg && cfg.ledScrollSeconds) { ledSeconds = parseInt(cfg.ledScrollSeconds, 10) || 60; rebuildMarquee(); } }).catch(function () {});
    window.BipbipAPI.getLedMessages().then(function (msgs) { ledPaid = (msgs || []).map(function (m) { return (m && (m.content || m.text)) || ''; }).filter(function (s) { return s.trim().length; }); rebuildMarquee(); }).catch(function () {});
    window.BipbipAPI.getActualites(8).then(function (d) { var list = (d && (d.actualites || d.items || d.data)) || []; ledNews = list.map(function (n) { var t = (n && (n.title || n.titre)) || ''; return t ? '📰 ' + t : ''; }).filter(Boolean).slice(0, 8); rebuildMarquee(); }).catch(function () {});
  }

  // ── Ad banners (pubBanners from /api/config) ──
  var __adTimers = {};
  function makeAbsImgB(u) {
    if (!u) return ''; if (/^https?:\/\//i.test(u) || u.indexOf('data:') === 0) return u;
    var base = (window.BipbipAPI && window.BipbipAPI.base) || 'https://bipbiprecharge.ci';
    return base + (u.charAt(0) === '/' ? '' : '/') + u;
  }
  function renderAdBanner(slotId, banner) {
    var slot = document.getElementById(slotId); if (!slot) return;
    if (__adTimers[slotId]) { clearInterval(__adTimers[slotId]); __adTimers[slotId] = null; }
    var imgs = (Array.isArray(banner && banner.images) && banner.images.length) ? banner.images.slice() : (banner && banner.image ? [banner.image] : []);
    if (!banner || !imgs.length) { slot.style.display = 'none'; slot.innerHTML = ''; return; }
    slot.style.display = '';
    var text = (banner.text || '').trim();
    var slides = imgs.map(function (src, i) { return '<div class="ad-banner__slide' + (i === 0 ? ' is-active' : '') + '"><img src="' + makeAbsImgB(src).replace(/"/g, '&quot;') + '" alt="" loading="lazy"></div>'; }).join('');
    var dots = imgs.length > 1 ? '<div class="ad-banner__dots">' + imgs.map(function (_, i) { return '<div class="ad-banner__dot' + (i === 0 ? ' is-active' : '') + '"></div>'; }).join('') + '</div>' : '';
    slot.innerHTML = '<div class="ad-banner__view">' + slides + dots + '</div>' + (text ? '<p class="ad-banner__caption">' + (window.BB ? BB.escapeHtml(text) : text) + '</p>' : '');
    if (imgs.length > 1) {
      var sl = slot.querySelectorAll('.ad-banner__slide'), dt = slot.querySelectorAll('.ad-banner__dot'), idx = 0;
      __adTimers[slotId] = setInterval(function () { sl[idx].classList.remove('is-active'); if (dt[idx]) dt[idx].classList.remove('is-active'); idx = (idx + 1) % sl.length; sl[idx].classList.add('is-active'); if (dt[idx]) dt[idx].classList.add('is-active'); }, 6000);
    }
    slot.onclick = banner.url ? function () { window.open(banner.url, '_blank', 'noopener,noreferrer'); } : null;
  }
  function loadAdBanners() {
    if (!document.getElementById('adMarket') && !document.getElementById('adActualites')) return;
    if (!window.BipbipAPI) return;
    window.BipbipAPI.getConfig().then(function (cfg) {
      var banners = (cfg && cfg.pubBanners) || [];
      var by = function (p) { return banners.find(function (b) { return b.placement === p; }) || null; };
      renderAdBanner('adMarket', by('home1'));
      renderAdBanner('adActualites', by('actualites'));
    }).catch(function () {});
  }

  // Admin reveal for theme picker (?admin=1 / localStorage)
  function adminReveal() {
    try {
      var p = new URLSearchParams(location.search).get('admin');
      if (p === '1' || p === 'true') localStorage.setItem('bb-admin', '1');
      if (localStorage.getItem('bb-admin') === '1') document.documentElement.classList.add('is-admin');
    } catch (e) {}
  }

  function boot() {
    adminReveal();
    mountScene();
    buildNav();
    buildFooter();
    buildThemePicker();
    bootTheme();
    startConfig();
    // i18n : applique la langue courante (les libs sont en defer)
    var i18nTries = 0;
    (function applyI18nWhenReady() {
      if (window.applyI18n) { try { window.applyI18n(); } catch (e) {} syncLang(); applyBBT(); return; }
      if (i18nTries++ < 50) { applyBBT(); setTimeout(applyI18nWhenReady, 100); }
    })();
    // API-dependent extras (weather, ad banners) once BipbipAPI is ready
    var apiTries = 0;
    (function whenApi() {
      if (window.BipbipAPI) {
        refreshWeather(); loadAdBanners(); refreshLed();
        setInterval(refreshWeather, 5 * 60 * 1000);
        setInterval(refreshLed, 5 * 60 * 1000);
        return;
      }
      if (apiTries++ < 50) setTimeout(whenApi, 100);
    })();
    // Auth UI once core is present
    if (window.BB) {
      window.BB.applyAuthUI();
      try { window.BB.refreshServerPoints(); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
