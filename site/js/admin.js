/* =========================================================
   Bipbip Recharge — Web · Admin panel (port of app/index.html)
   PIN gate (/api/admin/verify-pin) → X-Admin-Key for all admin
   calls: config (maintenance/LED/banners/theme), gift cards,
   quests, orders, market moderation. Uses window.BB (core.js).
   ========================================================= */
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.BB ? BB.escapeHtml(s) : String(s == null ? '' : s); }
  function toast(m, k) { window.BB && BB.appToast(m, k); }
  function apiBase() { return (window.BipbipAPI && window.BipbipAPI.base) || 'https://bipbiprecharge.ci'; }
  function absUrl(u) { if (!u) return ''; if (/^https?:\/\//i.test(u) || u.indexOf('data:') === 0) return u; return apiBase() + (u.charAt(0) === '/' ? '' : '/') + u; }
  var makeAbsImg = absUrl;

  // ── Admin session ──
  function getAdminKey() { try { return localStorage.getItem('bb_admin_key') || ''; } catch (e) { return ''; } }
  function setAdminKey(k) { try { if (k) localStorage.setItem('bb_admin_key', k); else localStorage.removeItem('bb_admin_key'); } catch (e) {} }
  function isAdminUnlocked() { try { return sessionStorage.getItem('bb_admin_ok') === '1'; } catch (e) { return false; } }
  window.adminLogout = function () {
    setAdminKey(''); try { sessionStorage.removeItem('bb_admin_ok'); } catch (e) {}
    toast('Déconnecté admin.'); location.reload();
  };

  async function adminFetch(path, opts) {
    var key = getAdminKey();
    if (!key) { toast('Clé admin requise.', 'error'); throw new Error('no admin key'); }
    opts = opts || {};
    var headers = Object.assign({ 'X-Admin-Key': key }, opts.headers || {});
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
    var r = await fetch(apiBase() + path, Object.assign({}, opts, { headers: headers }));
    var data = await r.json().catch(function () { return null; });
    if (!r.ok || (data && data.ok === false) || (data && data.error)) throw new Error((data && data.error) || ('HTTP ' + r.status));
    return data;
  }
  function refreshConfigCache() { try { window.BipbipAPI._clearCache(); } catch (e) {} }
  function btnDelete(attr) { return '<button type="button" onclick="' + attr + '" class="admin-del">Suppr.</button>'; }
  function emptyMsg(t) { return '<p class="hint" style="padding:6px 4px">' + t + '</p>'; }
  function clearInputs(ids) { ids.forEach(function (id) { var el = $(id); if (el) el.value = ''; }); }
  function clearFile(id) { var el = $(id); if (el) el.value = ''; }

  // ── PIN prompt ──
  function showPinPrompt() {
    var modal = document.createElement('div');
    modal.id = 'admin-pin-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:1rem';
    modal.innerHTML =
      '<div style="background:var(--bb-card-bg);border:1px solid var(--bb-tile-border);border-radius:20px;padding:28px 24px;max-width:320px;width:100%;text-align:center">' +
        '<div style="width:56px;height:56px;margin:0 auto 16px;border-radius:14px;background:color-mix(in srgb,var(--bb-accent) 16%,transparent);display:grid;place-items:center"><iconify-icon icon="solar:lock-keyhole-bold" width="28" style="color:var(--bb-accent)"></iconify-icon></div>' +
        '<h3 style="margin:0 0 4px">Accès Admin</h3><p class="hint" style="margin:0 0 20px">Entrez le code PIN à 4 chiffres</p>' +
        '<div id="pin-dots" style="display:flex;justify-content:center;gap:12px;margin-bottom:18px">' +
          Array(4).join(0).split('').concat([0,0,0,0]).slice(0,4).map(function(){return '<span class="pin-dot"></span>';}).join('') +
        '</div>' +
        '<div id="pin-err" style="color:#f87171;font-size:12px;min-height:18px;margin-bottom:10px"></div>' +
        '<div id="pin-pad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:240px;margin:0 auto">' +
          [1,2,3,4,5,6,7,8,9].map(function(n){return '<button type="button" class="pin-key" data-val="'+n+'">'+n+'</button>';}).join('') +
          '<button type="button" class="pin-key" data-val="close" style="color:#f87171">✕</button>' +
          '<button type="button" class="pin-key" data-val="0">0</button>' +
          '<button type="button" class="pin-key" data-val="del">⌫</button>' +
        '</div></div>';
    document.body.appendChild(modal);
    var pin = '', dots = modal.querySelectorAll('.pin-dot'), errEl = modal.querySelector('#pin-err');
    function upd() { dots.forEach(function (d, i) { d.classList.toggle('on', i < pin.length); }); }
    modal.querySelector('#pin-pad').addEventListener('click', async function (e) {
      var b = e.target.closest('.pin-key'); if (!b) return;
      var v = b.dataset.val;
      if (v === 'close') { modal.remove(); location.href = '/site/profil.html'; return; }
      if (v === 'del') { pin = pin.slice(0, -1); errEl.textContent = ''; upd(); return; }
      if (pin.length >= 4) return;
      pin += v; upd();
      if (pin.length === 4) {
        try {
          var r = await fetch(apiBase() + '/api/admin/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin }) });
          var data = await r.json().catch(function () { return null; });
          if (r.ok && data && data.ok) {
            if (data.adminKey) setAdminKey(data.adminKey);
            try { sessionStorage.setItem('bb_admin_ok', '1'); } catch (e) {}
            modal.remove(); reveal();
          } else { pin = ''; upd(); errEl.textContent = 'Code incorrect'; }
        } catch (err) { pin = ''; upd(); errEl.textContent = 'Erreur réseau'; }
      }
    });
  }

  // ── Load all sections ──
  async function loadAdminScreen() {
    var key = getAdminKey();
    var statusEl = $('adminKeyStatus');
    if (statusEl) statusEl.textContent = key ? '✓ Authentifié (' + key.slice(0, 6) + '…)' : '✗ Non authentifié';
    refreshConfigCache();
    var cfg;
    try { cfg = await window.BipbipAPI.getConfig(); } catch (e) { toast('Erreur chargement config.', 'error'); return; }

    var maint = cfg.maintenance || { enabled: false };
    var st = $('adminMaintStatus'); if (st) st.textContent = 'Statut : ' + (maint.enabled ? '🔴 ACTIVÉ' : '🟢 Désactivé');
    var mMsg = $('adminMaintMessage'); if (mMsg) mMsg.value = maint.message || '';
    __maintImageUrl = maint.image || null;
    var mPrev = $('adminMaintImgPreview');
    if (mPrev) { if (maint.image) { mPrev.src = makeAbsImg(maint.image); mPrev.style.display = 'block'; } else mPrev.style.display = 'none'; }
    var mImgSt = $('adminMaintImgStatus'); if (mImgSt) mImgSt.textContent = maint.image ? '✓ Image actuelle configurée' : 'Aucune image (carte par défaut)';

    var ledSec = cfg.ledScrollSeconds || 60;
    var speed = Math.max(1, Math.min(10, Math.round(10 - ((ledSec - 15) / (300 - 15)) * 9)));
    var slider = $('adminLedSpeed'), label = $('adminLedSpeedLabel'), cur = $('adminLedSpeedCurrent');
    if (slider) slider.value = speed; if (label) label.textContent = speed;
    if (cur) cur.textContent = 'Vitesse actuelle : ' + speed + '/10 (' + ledSec + 's)';

    var banners = cfg.pubBanners || [];
    var bList = $('adminBannersList');
    var placeLabels = { home1: 'Market', actualites: 'Actualités' };
    if (bList) bList.innerHTML = banners.length === 0 ? emptyMsg('Aucune bannière configurée.') : banners.map(function (b) {
      var nImg = (Array.isArray(b.images) && b.images.length) ? b.images.length : 1;
      return '<div class="admin-row"><img src="' + absUrl(b.image) + '" alt="" style="width:60px;height:40px;object-fit:cover;border-radius:6px">' +
        '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px;color:var(--bb-accent)">' + esc(placeLabels[b.placement] || b.placement) + ' · ' + (nImg > 1 ? '🖼️ ' + nImg + ' images' : '1 image') + '</div>' +
        '<div class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(b.text || b.url || '—') + '</div></div>' +
        btnDelete("adminDeleteBanner('" + b.placement + "')") + '</div>';
    }).join('');

    loadAdminGiftCards();
    loadAdminQuests();
    loadAdminOrders('pending');
    loadAdminMarketItems();

    try {
      var msgs = await window.BipbipAPI.getLedMessages();
      var ledList = $('adminLedList');
      if (ledList) ledList.innerHTML = (msgs && msgs.length) ? msgs.map(function (m) { return '<div class="admin-pill">' + esc((m.content || m.text || '').toString().slice(0, 80)) + '</div>'; }).join('') : emptyMsg('Aucun message LED actif.');
    } catch (e) {}

    var sel = $('adminThemeSelect'); if (sel) sel.value = (typeof cfg.themeForce === 'string' ? cfg.themeForce : '');
  }

  // ── Banners ──
  async function loadCurrentBanners() { var cfg = await fetch(apiBase() + '/api/config?_=' + Date.now(), { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); }); return (cfg && cfg.pubBanners) || []; }
  window.adminSaveBanner = async function () {
    var placement = $('adminBannerPlacement').value;
    var fileInput = $('adminBannerFile');
    var text = $('adminBannerText').value.trim();
    var url = $('adminBannerUrl').value.trim();
    var file = fileInput && fileInput.files && fileInput.files[0];
    var imageUrl = null;
    try {
      if (file) { toast('Upload de l\'image…'); var fd = new FormData(); fd.append('image', file); var up = await adminFetch('/api/admin/pub-banner-image', { method: 'POST', body: fd }); imageUrl = up.url; }
      var current = await loadCurrentBanners();
      var existing = current.find(function (b) { return b.placement === placement; }) || null;
      var images = (existing && Array.isArray(existing.images)) ? existing.images.slice() : [];
      if (existing && existing.image && images.indexOf(existing.image) === -1) images.unshift(existing.image);
      if (imageUrl && images.indexOf(imageUrl) === -1) images.push(imageUrl);
      var firstImg = imageUrl || (existing && existing.image) || images[0] || '';
      if (!firstImg) { toast('Aucune image fournie.', 'error'); return; }
      var newBanner = { placement: placement, image: firstImg, images: images.length ? images : [firstImg], text: text || (existing && existing.text) || '', scrollSpeed: 5 };
      var keepUrl = url || (existing && existing.url); if (keepUrl) newBanner.url = keepUrl;
      var updated = current.filter(function (b) { return b.placement !== placement; }).concat([newBanner]);
      await adminFetch('/api/admin/config', { method: 'PUT', body: { pubBanners: updated } });
      toast('Image ajoutée au carrousel ✓ (' + newBanner.images.length + ')', 'success');
      if (fileInput) fileInput.value = '';
      refreshConfigCache(); loadAdminScreen();
    } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); }
  };
  window.adminDeleteBanner = async function (placement) {
    if (!confirm('Supprimer cette bannière ?')) return;
    try {
      var current = await loadCurrentBanners();
      await adminFetch('/api/admin/config', { method: 'PUT', body: { pubBanners: current.filter(function (b) { return b.placement !== placement; }) } });
      toast('Bannière supprimée ✓', 'success'); refreshConfigCache(); loadAdminScreen();
    } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); }
  };

  // ── Maintenance ──
  var __maintImageUrl = null;
  window.adminUploadMaintImage = async function (ev) {
    var f = ev.target.files && ev.target.files[0]; if (!f) return;
    var statusEl = $('adminMaintImgStatus'); if (statusEl) statusEl.textContent = 'Upload…';
    try {
      var fd = new FormData(); fd.append('image', f);
      var up = await adminFetch('/api/admin/pub-banner-image', { method: 'POST', body: fd });
      __maintImageUrl = up.url;
      if (statusEl) statusEl.textContent = '✓ Image prête';
      var prev = $('adminMaintImgPreview'); if (prev) { prev.src = makeAbsImg(up.url); prev.style.display = 'block'; }
    } catch (e) { if (statusEl) statusEl.textContent = '⚠ ' + (e.message || e); }
  };
  window.adminToggleMaintenance = async function (enabled) {
    var mMsg = $('adminMaintMessage'); var msg = mMsg ? mMsg.value : '';
    toast(enabled ? 'Activation…' : 'Désactivation…');
    try {
      var body = { maintenance: { enabled: !!enabled, message: msg } };
      if (__maintImageUrl) body.maintenance.image = __maintImageUrl;
      await adminFetch('/api/admin/config', { method: 'PUT', body: body });
      toast(enabled ? 'Maintenance ON ✓' : 'Maintenance OFF ✓', 'success');
      refreshConfigCache();
      var st = $('adminMaintStatus'); if (st) st.textContent = 'Statut : ' + (enabled ? '🔴 ACTIVÉ' : '🟢 Désactivé');
    } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); }
  };

  // ── LED speed ──
  window.adminSaveLedSpeed = async function () {
    var sl = $('adminLedSpeed'); var v = sl ? (parseInt(sl.value, 10) || 5) : 5;
    var sec = Math.round(300 - ((v - 1) / 9) * (300 - 15));
    try {
      await adminFetch('/api/admin/config', { method: 'PUT', body: { ledScrollSeconds: sec } });
      toast('Vitesse LED → ' + v + '/10 (' + sec + 's) ✓', 'success'); refreshConfigCache();
      var cur = $('adminLedSpeedCurrent'); if (cur) cur.textContent = 'Vitesse actuelle : ' + v + '/10 (' + sec + 's)';
    } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); }
  };

  // ── Gift cards ──
  var __adminGiftCards = [];
  function loadAdminGiftCards() {
    refreshConfigCache();
    window.BipbipAPI.getGiftCards().then(function (d) { __adminGiftCards = (d && d.giftCards) || []; renderAdminGiftCards(); }).catch(function (e) { toast('Erreur gift cards', 'error'); });
  }
  function renderAdminGiftCards() {
    var list = $('adminGiftCardsList'); if (!list) return;
    if (!__adminGiftCards.length) { list.innerHTML = emptyMsg('Aucune carte cadeau.'); return; }
    list.innerHTML = __adminGiftCards.map(function (c, i) {
      var img = absUrl(c.img);
      return '<div class="admin-row">' + (img ? '<img src="' + img + '" style="width:46px;height:46px;border-radius:8px;object-fit:cover">' : '') +
        '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + esc(c.name || '') + ' — ' + esc(c.value || '') + '</div>' +
        '<div class="hint">' + (c.price ? Number(c.price).toLocaleString('fr-FR') + ' XOF' : '—') + ' · ' + esc(c.category || 'app') + ' ' + (c.flag || '') + '</div></div>' +
        btnDelete('adminDeleteGiftCard(' + i + ')') + '</div>';
    }).join('');
  }
  window.adminAddGiftCard = async function () {
    var name = $('gcAdminName').value.trim(), value = $('gcAdminValue').value.trim(), price = parseInt($('gcAdminPrice').value, 10);
    var category = $('gcAdminCategory').value, img = $('gcAdminImg').value.trim(), flag = $('gcAdminFlag').value.trim();
    var fileInput = $('gcAdminFile'); var file = fileInput && fileInput.files && fileInput.files[0];
    if (!name || !value || !price) { toast('Nom, valeur et prix requis.', 'error'); return; }
    try {
      if (file && !img) { var fd = new FormData(); fd.append('image', file); var up = await adminFetch('/api/admin/gift-card-image', { method: 'POST', body: fd }); img = up.url; }
      __adminGiftCards.push({ id: 'gc_' + Math.random().toString(36).slice(2, 12), name: name, value: value, price: price, category: category, img: img, flag: flag });
      renderAdminGiftCards(); clearInputs(['gcAdminName', 'gcAdminValue', 'gcAdminPrice', 'gcAdminImg', 'gcAdminFlag']); clearFile('gcAdminFile');
      toast('Carte ajoutée (non sauvée). Clique "Sauvegarder".');
    } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); }
  };
  window.adminDeleteGiftCard = function (idx) { if (!confirm('Supprimer cette carte ?')) return; __adminGiftCards.splice(idx, 1); renderAdminGiftCards(); };
  window.adminSaveGiftCards = async function () {
    try { await adminFetch('/api/admin/gift-cards', { method: 'PUT', body: { giftCards: __adminGiftCards } }); toast('Cartes sauvegardées ✓', 'success'); refreshConfigCache(); }
    catch (e) { toast('Erreur : ' + (e.message || e), 'error'); }
  };

  // ── Quests ──
  window.loadAdminQuests = async function () {
    try {
      var d = await adminFetch('/api/quests/admin/list', { method: 'GET' });
      var quests = (d && d.quests) || []; var list = $('adminQuestsList'); if (!list) return;
      if (!quests.length) { list.innerHTML = emptyMsg('Aucune quête.'); return; }
      list.innerHTML = quests.map(function (q) {
        var active = !!q.is_active;
        return '<div class="admin-row" style="opacity:' + (active ? '1' : '.5') + '"><div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;font-size:13px">' + esc(q.titre || q.code || '') + ' <span style="color:var(--bb-warn);font-size:11px">+' + (q.points_reward || 0) + ' pts</span></div>' +
          '<div class="hint">' + esc(q.code) + ' · ' + esc(q.type || '') + '</div></div>' +
          '<button type="button" onclick="adminToggleQuest(\'' + q.id + '\',' + (!active) + ')" class="admin-toggle ' + (active ? 'on' : 'off') + '">' + (active ? 'ON' : 'OFF') + '</button>' +
          btnDelete("adminDeleteQuest('" + q.id + "')") + '</div>';
      }).join('');
    } catch (e) {}
  };
  window.adminAddQuest = async function () {
    var body = { code: $('questAdminCode').value.trim(), type: $('questAdminType').value, titre: $('questAdminTitle').value.trim(), description: $('questAdminDesc').value.trim(), points_reward: parseInt($('questAdminPoints').value, 10) || 0, is_active: $('questAdminActive').checked };
    if (!body.code) { toast('Code unique requis.', 'error'); return; }
    try { await adminFetch('/api/quests/admin', { method: 'POST', body: body }); toast('Quête ajoutée ✓', 'success'); clearInputs(['questAdminCode', 'questAdminTitle', 'questAdminDesc']); window.loadAdminQuests(); }
    catch (e) { toast('Erreur : ' + (e.message || e), 'error'); }
  };
  window.adminToggleQuest = async function (id, na) { try { await adminFetch('/api/quests/admin/' + id, { method: 'PUT', body: { is_active: !!na } }); toast(na ? 'Activée' : 'Désactivée', 'success'); window.loadAdminQuests(); } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); } };
  window.adminDeleteQuest = async function (id) { if (!confirm('Supprimer cette quête ?')) return; try { await adminFetch('/api/quests/admin/' + id, { method: 'DELETE' }); toast('Quête supprimée ✓', 'success'); window.loadAdminQuests(); } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); } };

  // ── Orders ──
  window.loadAdminOrders = async function (tab) {
    tab = tab || 'pending';
    document.querySelectorAll('.orders-tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === tab); });
    try {
      var status = (tab === 'validated') ? 'validated' : 'proof_sent';
      var d = await adminFetch('/api/admin/orders?status=' + status, { method: 'GET' });
      var orders = (d && d.orders) || []; var list = $('adminOrdersList'); if (!list) return;
      if (!orders.length) { list.innerHTML = emptyMsg('Aucune commande ' + (tab === 'validated' ? 'validée' : 'en attente') + '.'); return; }
      list.innerHTML = orders.map(function (o) {
        var when = o.created_at ? new Date(o.created_at).toLocaleString('fr-FR') : '';
        return '<div class="admin-card"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;font-weight:700">' +
          '<span>' + esc(o.operator || '?') + ' · ' + (o.amount ? Number(o.amount).toLocaleString('fr-FR') + ' F' : '—') + '</span>' +
          '<span class="hint" style="font-weight:500">' + esc(when) + '</span></div>' +
          '<div class="hint" style="margin:4px 0;font-family:ui-monospace,monospace">' + esc(o.phone || '') + '</div>' +
          '<div class="hint">ID : ' + esc(String(o.id || '').slice(0, 8)) + ' · ' + esc(o.payment_method || o.paymentMethod || '?') + '</div>' +
          (tab === 'pending' ? '<div class="profil-row-2" style="margin-top:8px"><button class="profil-btn-secondary admin-reject" type="button" onclick="adminRejectOrder(\'' + o.id + '\')">Rejeter</button><button class="profil-btn-warn admin-ok" type="button" onclick="adminValidateOrder(\'' + o.id + '\')">Valider</button></div>' : '') + '</div>';
      }).join('');
    } catch (e) {}
  };
  window.adminValidateOrder = async function (id) { try { await adminFetch('/api/admin/orders/' + id + '/validate', { method: 'POST', body: {} }); toast('Commande validée ✓', 'success'); window.loadAdminOrders('pending'); } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); } };
  window.adminRejectOrder = async function (id) { if (!confirm('Rejeter cette commande ?')) return; try { await adminFetch('/api/admin/orders/' + id + '/reject', { method: 'POST', body: { reason: 'manual' } }); toast('Commande rejetée', 'success'); window.loadAdminOrders('pending'); } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); } };

  // ── Market moderation ──
  window.loadAdminMarketItems = async function () {
    var list = $('adminMarketList'); if (!list) return;
    try {
      var d = await adminFetch('/api/admin/market/items?status=pending', { method: 'GET' });
      var items = (d && d.items) || [];
      if (!items.length) { list.innerHTML = emptyMsg('Aucun article en attente.'); return; }
      list.innerHTML = items.map(function (it) {
        var img = it.photo ? (it.photo.indexOf('data:') === 0 ? it.photo : makeAbsImg(it.photo)) : '';
        return '<div class="admin-card"><div style="display:flex;gap:10px">' + (img ? '<img src="' + img + '" style="width:54px;height:54px;border-radius:8px;object-fit:cover;flex-shrink:0">' : '') +
          '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + esc(it.name) + ' · <span style="color:var(--bb-accent)">' + (it.price ? Number(it.price).toLocaleString('fr-FR') + ' F' : '—') + '</span></div>' +
          '<div class="hint">' + esc(it.cat) + ' · ' + esc(it.sellerName || it.sellerId || '') + '</div>' +
          '<div class="hint" style="margin-top:2px">' + esc((it.desc || '').slice(0, 90)) + '</div>' +
          (it.phone ? '<div class="hint" style="font-family:ui-monospace,monospace">' + esc(it.phone) + '</div>' : '') + '</div></div>' +
          '<div class="profil-row-2" style="margin-top:8px"><button class="profil-btn-secondary admin-reject" type="button" onclick="adminRejectMarketItem(\'' + it.id + '\')">Refuser</button><button class="profil-btn-warn admin-ok" type="button" onclick="adminValidateMarketItem(\'' + it.id + '\')">Valider</button></div></div>';
      }).join('');
    } catch (e) {}
  };
  window.adminValidateMarketItem = async function (id) { try { await adminFetch('/api/admin/market/items/' + id + '/validate', { method: 'POST', body: {} }); toast('Article publié ✓', 'success'); window.loadAdminMarketItems(); } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); } };
  window.adminRejectMarketItem = async function (id) { if (!confirm('Refuser cet article ?')) return; try { await adminFetch('/api/admin/market/items/' + id + '/reject', { method: 'POST', body: {} }); toast('Article refusé', 'success'); window.loadAdminMarketItems(); } catch (e) { toast('Erreur : ' + (e.message || e), 'error'); } };

  // ── Theme ──
  window.adminApplyTheme = async function () {
    var sel = $('adminThemeSelect'); var v = sel ? sel.value : '';
    toast('Application du thème…');
    try { await adminFetch('/api/admin/config', { method: 'PUT', body: { themeForce: v || '' } }); refreshConfigCache(); } catch (e) { toast('Erreur serveur : ' + (e.message || e), 'error'); }
    try { if (v) localStorage.setItem('bb-theme-force', v); else localStorage.removeItem('bb-theme-force'); } catch (e) {}
    try { if (window.BipbipTheme) { window.BipbipTheme.apply(v || null); if (window.BipbipTheme.mountParticles) window.BipbipTheme.mountParticles({ density: 30 }); } } catch (e) {}
    toast(v ? 'Thème "' + v + '" forcé pour tous ✓' : 'Thème automatique restauré ✓', 'success');
  };

  // ── Gate ──
  function reveal() {
    var gate = $('adminGate'); if (gate) gate.style.display = 'none';
    var panel = $('adminPanel'); if (panel) panel.style.display = '';
    (function ready() { if (window.BipbipAPI && window.BB) loadAdminScreen(); else setTimeout(ready, 120); })();
  }
  function boot() {
    if (!$('adminPanel')) return;
    if (isAdminUnlocked() && getAdminKey()) reveal();
    else { var u = $('adminUnlockBtn'); if (u) u.addEventListener('click', showPinPrompt); showPinPrompt(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
