/* =========================================================
   Bipbip Recharge — Web core (shared across all /site pages)
   Ports the connected logic from app/index.html (the APK reference):
   user/session, Google auth, server points, avatar proxy, headers, toast.
   Exposed as window.BB ; a few helpers also on window for inline handlers.
   ========================================================= */
(function () {
  if (window.BB) return;

  var POINTS_KEY = 'bb_points';
  var POINTS_HIST_KEY = 'bb_points_history';

  function apiBase() {
    return (window.BipbipAPI && window.BipbipAPI.base) || 'https://bipbiprecharge.ci';
  }

  // ── Toast ───────────────────────────────────────────────
  function appToast(msg, kind) {
    var n = document.getElementById('bbToast');
    if (!n) {
      n = document.createElement('div');
      n.id = 'bbToast';
      document.body.appendChild(n);
    }
    n.textContent = msg;
    n.className = 'show' + (kind ? ' kind-' + kind : '');
    clearTimeout(window.__bbToastT);
    window.__bbToastT = setTimeout(function () { n.className = n.className.replace('show', '').trim(); }, 2800);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Current user / session ──────────────────────────────
  function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem('bb_user') || 'null'); } catch (e) { return null; }
  }
  function setCurrentUser(u) {
    if (u) localStorage.setItem('bb_user', JSON.stringify(u));
    else { localStorage.removeItem('bb_user'); localStorage.removeItem('bb_google_token'); }
    applyAuthUI();
  }

  // id numérique enregistré côté serveur. ⚠️ comptes Google = id SYNTHÉTIQUE NÉGATIF.
  function getRegisteredUserId() {
    var u = getCurrentUser();
    if (!u) return null;
    var id = u.tgId;
    if (id == null && typeof u.id === 'string' && u.id.indexOf('g_') === 0) id = u.id.slice(2);
    if (id == null) id = u.id;
    if (id != null && /^-?\d+$/.test(String(id))) return String(id);   // accepte négatifs
    return null;
  }

  // Headers pour les routes "points" (quests, points-history, auth/me, track-read)
  function serverPointHeaders() {
    var h = { 'Accept': 'application/json' };
    var u = getCurrentUser();
    var uid = getRegisteredUserId();
    if (uid) h['X-User-Id'] = uid;
    var gtok = (u && (u.googleSession || u.sessionToken)) || '';
    if (gtok) { h['X-Google-Session'] = gtok; h['X-Session-Token'] = gtok; }
    return h;
  }
  // Headers pour les routes "orders" (recharge)
  function apiHeaders() {
    var h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    var u = getCurrentUser();
    if (u && u.tgId) h['X-User-Id'] = String(u.tgId);
    if (u && u.sessionToken) h['X-Session-Token'] = u.sessionToken;
    return h;
  }
  function userPayloadFields() {
    var u = getCurrentUser() || {};
    return {
      userId: u.tgId || u.id || ('br_' + (localStorage.getItem('bb_browser_id') || '')),
      username: u.username || u.handle || u.email || null,
      displayName: u.name || null,
      provider: u.provider || 'guest',
      email: u.email || null,
      photoUrl: u.photoUrl || null
    };
  }

  // ── Points ──────────────────────────────────────────────
  function getRealPoints() {
    try { var p = parseInt(localStorage.getItem(POINTS_KEY) || '', 10); if (!isNaN(p)) return p; } catch (e) {}
    return 0;
  }
  function setServerPoints(total) {
    if (typeof total !== 'number' || isNaN(total)) return;
    try { localStorage.setItem(POINTS_KEY, String(total)); } catch (e) {}
    refreshUserPoints();
  }
  function refreshUserPoints() {
    var pts = getRealPoints();
    var fmt = pts.toLocaleString('fr-FR');
    var el = document.getElementById('bbPointsVal'); if (el) el.textContent = fmt;
    var p2 = document.getElementById('profilPoints'); if (p2) p2.textContent = fmt;
  }
  // Ajoute des points en local + log historique (invités / hors-ligne)
  function addPoints(amount, reason) {
    amount = parseInt(amount, 10) || 0;
    if (!amount) return getRealPoints();
    var next = getRealPoints() + amount; if (next < 0) next = 0;
    try { localStorage.setItem(POINTS_KEY, String(next)); } catch (e) {}
    try {
      var hist = JSON.parse(localStorage.getItem(POINTS_HIST_KEY) || '[]');
      hist.unshift({ reason: reason || 'Points', delta: amount, when: new Date().toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), at: Date.now() });
      localStorage.setItem(POINTS_HIST_KEY, JSON.stringify(hist.slice(0, 100)));
    } catch (e) {}
    refreshUserPoints();
    if (window.BBQuests && BBQuests.renderPointsHistory) BBQuests.renderPointsHistory();
    return next;
  }
  function getLocalPointsHistory() {
    try { return JSON.parse(localStorage.getItem(POINTS_HIST_KEY) || '[]'); } catch (e) { return []; }
  }

  // Tracker la lecture d'un article → quête "lire_5_articles" (crédite côté serveur)
  function trackArticleRead(slug) {
    if (!slug) return;
    var uid = getRegisteredUserId();
    if (!uid) return;   // invité : pas de points serveur (parité prod)
    var cacheKey = 'bb_articles_read_slugs', dayKey = 'bb_articles_read_day';
    var today = new Date().toISOString().slice(0, 10), lastDay = '';
    try { lastDay = localStorage.getItem(dayKey) || ''; } catch (e) {}
    var read = [];
    if (lastDay === today) { try { read = JSON.parse(localStorage.getItem(cacheKey) || '[]'); } catch (e) {} }
    else { try { localStorage.setItem(dayKey, today); localStorage.removeItem(cacheKey); } catch (e) {} }
    if (read.indexOf(slug) >= 0) return;
    read.push(slug);
    try { localStorage.setItem(cacheKey, JSON.stringify(read.slice(-50))); } catch (e) {}
    fetch(apiBase() + '/api/quests/track-read', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, serverPointHeaders()),
      body: JSON.stringify({ code: 'lire_5_articles', item_id: slug, userId: uid })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.success) return;
        if (typeof data.total_points === 'number') setServerPoints(data.total_points);
        if (data.just_completed && data.points_earned) {
          appToast('Quête validée ! +' + data.points_earned + ' points 🎉', 'success');
          if (window.BBQuests && BBQuests.reload) BBQuests.reload();
        }
      })
      .catch(function () {});
  }
  // Total réel depuis le serveur (utilisateur Google enregistré)
  async function refreshServerPoints() {
    var uid = getRegisteredUserId();
    if (!uid) return;
    try {
      var r = await fetch(apiBase() + '/api/auth/google/me?uid=' + encodeURIComponent(uid), { headers: serverPointHeaders() });
      if (!r.ok) return;
      var d = await r.json();
      var user = d && d.user;
      if (!user) return;
      var cu = getCurrentUser(); var changed = false;
      if (typeof user.points === 'number') { setServerPoints(user.points); if (cu) { cu.points = user.points; changed = true; } }
      var srvPhoto = user.photo_url || user.picture || '';
      if (cu && srvPhoto && cu.photoUrl !== srvPhoto) { cu.photoUrl = srvPhoto; changed = true; }
      if (cu && changed) { try { localStorage.setItem('bb_user', JSON.stringify(cu)); } catch (e) {} applyAuthUI(); }
    } catch (e) { /* silencieux */ }
  }

  // ── Avatar (proxy serveur pour les URLs googleusercontent) ──
  function normalizeAvatarUrl(url) {
    if (!url) return '';
    try {
      url = String(url).trim();
      if (url.indexOf('//') === 0) url = 'https:' + url;
      if (url.indexOf('http://') === 0) url = 'https://' + url.slice(7);
      if (/googleusercontent\.com/.test(url)) {
        if (/=s\d+(-c)?$/.test(url)) url = url.replace(/=s\d+(-c)?$/, '=s200-c');
        else if (url.indexOf('=') === -1) url = url + '=s200-c';
        url = apiBase() + '/api/avatar?u=' + encodeURIComponent(url);
      }
      return url;
    } catch (e) { return url; }
  }
  function setAvatarEl(el, photo, fallbackHtml) {
    if (!el) return;
    if (!photo) {
      el.classList.remove('bb-has-photo');
      el.style.backgroundImage = '';
      if (!el.querySelector('img, svg, iconify-icon')) el.innerHTML = fallbackHtml || '';
      return;
    }
    var img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = function () {
      el.classList.add('bb-has-photo');
      el.innerHTML = '';
      el.style.backgroundImage = 'url("' + photo + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center center';
      el.style.backgroundRepeat = 'no-repeat';
    };
    img.onerror = function () {
      if (!img.__retried && /=s\d+(-c)?$/.test(photo)) { img.__retried = true; img.src = photo.replace(/=s\d+(-c)?$/, ''); return; }
      el.classList.remove('bb-has-photo');
      el.style.backgroundImage = '';
      if (!el.querySelector('img')) el.innerHTML = fallbackHtml || '';
    };
    img.src = photo;
  }

  // ── Auth UI (tolérant : marche sur toutes les pages) ──────
  function applyAuthUI() {
    var u = getCurrentUser();
    var isLogged = !!u;
    var photo = normalizeAvatarUrl((u && u.photoUrl) || '');

    // Top nav
    var loginBtn = document.getElementById('bbLoginBtn');
    var pill = document.getElementById('bbPointsPill');
    var avatar = document.getElementById('bbAvatar');
    if (loginBtn) loginBtn.style.display = isLogged ? 'none' : '';
    if (pill) pill.style.display = isLogged ? '' : 'none';
    if (avatar) {
      avatar.style.display = isLogged ? '' : 'none';
      setAvatarEl(avatar, photo, '<iconify-icon icon="solar:user-bold" width="18"></iconify-icon>');
    }

    // Profil page
    var nameEl = document.getElementById('profilName');
    var hintEl = document.getElementById('profilHint');
    var loginCta = document.getElementById('profilLoginCta');
    var logoutBtn = document.getElementById('logoutBtn');
    var refInput = document.getElementById('profilReferral');
    var profPhoto = document.getElementById('profilPhoto');
    if (nameEl) nameEl.textContent = isLogged ? (u.name || u.username || 'Utilisateur') : 'Invité';
    if (hintEl) hintEl.textContent = isLogged
      ? ('Connecté avec ' + (u.provider === 'google' ? 'Google' : 'Telegram') + (u.handle ? ' · ' + u.handle : ''))
      : 'Non connecté · Tes points ne sont pas sauvegardés';
    if (loginCta) loginCta.style.display = isLogged ? 'none' : '';
    var acct = document.getElementById('profilAccount');
    if (acct) acct.style.display = isLogged ? '' : 'none';
    if (logoutBtn) logoutBtn.style.display = isLogged ? '' : 'none';
    if (refInput) refInput.value = 'https://bipbiprecharge.ci/r/' + (u && u.referralCode ? u.referralCode : '—');
    if (profPhoto) setAvatarEl(profPhoto, photo, '<iconify-icon icon="solar:user-bold"></iconify-icon>');

    refreshUserPoints();
  }

  // ── Google Sign-In (web GIS only — pas de Capacitor sur le site) ──
  var __googleClientId = null;
  async function loadGoogleClientId() {
    if (__googleClientId) return __googleClientId;
    try {
      var cfg = await window.BipbipAPI.getConfig();
      __googleClientId = (cfg && (cfg.googleClientId || cfg.google_client_id)) || null;
    } catch (e) {}
    return __googleClientId;
  }
  function waitForGoogleSdk(maxMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function tick() {
        if (window.google && window.google.accounts && window.google.accounts.id) return resolve(true);
        if (Date.now() - start > (maxMs || 5000)) return resolve(false);
        setTimeout(tick, 100);
      })();
    });
  }
  async function handleGoogleCredential(credential) {
    appToast('Connexion en cours…');
    try {
      var r = await fetch(apiBase() + '/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ credential: credential })
      });
      var data = await r.json().catch(function () { return null; });
      if (r.ok && data && data.ok && data.user) {
        var u = data.user;
        var numericId = u.telegram_id || u.id || '';
        setCurrentUser({
          provider: 'google',
          id: 'g_' + numericId,
          tgId: numericId,
          googleSession: data.sessionToken,
          name: ((u.first_name || '') + (u.last_name ? ' ' + u.last_name : '')) || u.name || 'Utilisateur',
          handle: u.email || '',
          username: u.username || u.email || '',
          referralCode: u.referralCode || (u.username || ('u' + (u.telegram_id || ''))).toString().toLowerCase().slice(0, 12),
          email: u.email,
          photoUrl: u.photo_url || u.picture || '',
          points: (typeof u.points === 'number') ? u.points : 0,
          sessionToken: data.sessionToken
        });
        try { if (data.sessionToken) localStorage.setItem('bb_google_token', data.sessionToken); } catch (e) {}
        try { refreshServerPoints(); } catch (e) {}
        appToast('Bienvenue ' + (u.first_name || '') + ' !', 'success');
        // Redirige vers le profil si on est sur la page login, sinon reste sur place
        if (document.body.getAttribute('data-page') === 'login') {
          location.href = '/site/profil.html';
        }
      } else {
        appToast((data && data.error) || 'Erreur de connexion Google', 'error');
      }
    } catch (e) {
      console.error('[GoogleAuth]', e);
      appToast('Erreur réseau. Réessayez.', 'error');
    }
  }
  async function loginGoogle(fallbackMountId) {
    var clientId = await loadGoogleClientId();
    if (!clientId) { appToast('Google Sign-In indisponible.', 'error'); return; }
    var ok = await waitForGoogleSdk(5000);
    if (!ok) { appToast('SDK Google en cours de chargement…', 'error'); return; }
    try {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: function (resp) {
          if (resp && resp.credential) handleGoogleCredential(resp.credential);
          else appToast('Connexion Google annulée.', 'error');
        },
        auto_select: false, cancel_on_tap_outside: true, ux_mode: 'popup'
      });
      google.accounts.id.prompt(function (notification) {
        if (notification.isNotDisplayed && (notification.isNotDisplayed() || (notification.isSkippedMoment && notification.isSkippedMoment()))) {
          var container = document.getElementById(fallbackMountId || 'googleSigninFallback');
          if (container) {
            container.style.display = '';
            container.innerHTML = '';
            google.accounts.id.renderButton(container, { theme: 'filled_blue', size: 'large', shape: 'pill', width: 280, text: 'continue_with', locale: 'fr' });
          } else {
            appToast('Ouvre la page Connexion pour te connecter.', 'error');
          }
        }
      });
    } catch (e) {
      console.error('[GoogleAuth]', e);
      appToast('Erreur Google : ' + (e.message || e), 'error');
    }
  }
  function logoutUser() {
    if (!confirm('Es-tu sûr de vouloir te déconnecter ?')) return;
    setCurrentUser(null);
    try { localStorage.removeItem(POINTS_KEY); } catch (e) {}
    refreshUserPoints();
    appToast('Déconnecté.');
    if (document.body.getAttribute('data-page') === 'profil') location.reload();
  }

  // ── Public API ──────────────────────────────────────────
  window.BB = {
    apiBase: apiBase,
    appToast: appToast,
    escapeHtml: escapeHtml,
    getCurrentUser: getCurrentUser,
    setCurrentUser: setCurrentUser,
    getRegisteredUserId: getRegisteredUserId,
    serverPointHeaders: serverPointHeaders,
    apiHeaders: apiHeaders,
    userPayloadFields: userPayloadFields,
    getRealPoints: getRealPoints,
    setServerPoints: setServerPoints,
    refreshUserPoints: refreshUserPoints,
    refreshServerPoints: refreshServerPoints,
    addPoints: addPoints,
    getLocalPointsHistory: getLocalPointsHistory,
    trackArticleRead: trackArticleRead,
    normalizeAvatarUrl: normalizeAvatarUrl,
    setAvatarEl: setAvatarEl,
    applyAuthUI: applyAuthUI,
    loadGoogleClientId: loadGoogleClientId,
    handleGoogleCredential: handleGoogleCredential,
    loginGoogle: loginGoogle,
    logoutUser: logoutUser
  };
  // Inline handlers convenience
  window.loginGoogle = loginGoogle;
  window.logoutUser = logoutUser;
})();
