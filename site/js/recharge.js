/* =========================================================
   Bipbip Recharge — Web · Recharge flow (Phase 2)
   operator → amount/bundle → phone → BBPay.startOrder (payment).
   Bundles via getBundles. Payment/proof handled by payment.js (BBPay).
   ========================================================= */
(function () {
  var PREFIX = { MTN: ['05', '06'], Orange: ['07', '08', '09'], Moov: ['01', '02'] };
  var order = { op: null, amount: 0, bundleId: null, phone: '' };

  function $(id) { return document.getElementById(id); }
  function toast(m, k) { window.BB && BB.appToast(m, k); }
  function fmt(n) { return (n | 0).toLocaleString('fr-FR'); }

  try { if (!localStorage.getItem('bb_browser_id')) localStorage.setItem('bb_browser_id', Math.random().toString(36).slice(2, 12)); } catch (e) {}

  function refreshSubmit() {
    var btn = $('rechargeSubmit');
    if (!order.op) { btn.textContent = 'Choisir un opérateur'; return; }
    if (!order.amount) { btn.textContent = 'Choisir un montant'; return; }
    btn.textContent = 'Valider la recharge · ' + fmt(order.amount) + ' F';
  }
  function selectOperator(op) {
    order.op = op;
    Array.from($('opGrid').children).forEach(function (b) { b.classList.toggle('is-active', b.dataset.op === op); });
    $('bundlesRow').style.display = '';
    revalidatePhone(); refreshSubmit();
  }
  function selectAmount(amt) {
    order.amount = amt; order.bundleId = null;
    Array.from($('amtGrid').children).forEach(function (b) { b.classList.toggle('is-active', parseInt(b.dataset.amt, 10) === amt); });
    var bd = $('bundleChosen'); if (bd) bd.style.display = 'none';
    var ca = $('customAmount'); if (ca) ca.value = '';   // un preset annule le montant libre
    refreshSubmit();
  }
  function setCustomAmount(v) {
    var amt = parseInt(v, 10) || 0;
    order.bundleId = null;
    Array.from($('amtGrid').children).forEach(function (b) { b.classList.remove('is-active'); });   // déselectionne les presets
    var bd = $('bundleChosen'); if (bd) bd.style.display = 'none';
    order.amount = amt > 0 ? amt : 0;
    refreshSubmit();
  }
  function revalidatePhone() {
    var input = $('phoneInput'), hint = $('phoneHint');
    var digits = (input.value || '').replace(/\D/g, '').slice(0, 10);
    var ok = digits.length === 10 && order.op && PREFIX[order.op].indexOf(digits.slice(0, 2)) >= 0;
    if (digits.length < 10) hint.textContent = 'Entrez les 10 chiffres';
    else if (order.op && PREFIX[order.op].indexOf(digits.slice(0, 2)) < 0) hint.textContent = '⚠ Préfixe non compatible ' + order.op + ' (' + PREFIX[order.op].join(', ') + ')';
    else hint.textContent = '✓ Numéro valide';
    hint.style.color = ok ? 'var(--bb-good,#16a34a)' : 'var(--bb-muted)';
    order.phone = digits;
    return ok;
  }

  // ── Bundles modal ──
  function countryFromBundle(name) {
    var n = String(name || '').toUpperCase();
    if (/\bBF\b|BURKINA/.test(n)) return 'Burkina Faso';
    if (/\bML\b|\bMALI\b/.test(n)) return 'Mali';
    if (/\bSNG\b|SENEGAL|SÉNÉGAL/.test(n)) return 'Sénégal';
    return '';
  }
  async function openBundles(kind) {
    if (!order.op) { toast('Choisissez d\'abord un opérateur.', 'error'); return; }
    var modal = $('bundlesModal'), list = $('bundlesModalList');
    $('bundlesModalTitle').textContent = (kind === 'mix' ? 'Mix Voix + Data' : 'Forfaits Internet') + ' · ' + order.op;
    list.innerHTML = '<div class="bb-modal__empty">Chargement…</div>';
    modal.classList.add('is-open');
    try {
      var d = await window.BipbipAPI.getBundles(String(order.op).toLowerCase());
      var dataList = (d && Array.isArray(d.data)) ? d.data.slice() : [];
      var mixList = (d && Array.isArray(d.mix)) ? d.mix.slice() : [];
      var items = (kind === 'mix')
        ? (mixList.length ? mixList : dataList.filter(function (b) { return /mix|voix|appel|min|sms/i.test(String(b.name || '') + ' ' + String(b.option || '')); }))
        : (dataList.length ? dataList : (Array.isArray(d) ? d : [])).filter(function (b) { return !/mix|voix|appel/i.test(String(b.name || '') + ' ' + String(b.option || '')); });
      items.sort(function (a, b) { return (a.price | 0) - (b.price | 0); });
      if (!items.length) { list.innerHTML = '<div class="bb-modal__empty">Aucun forfait ' + (kind === 'mix' ? 'mix' : 'data') + ' pour ' + order.op + '</div>'; return; }
      list.innerHTML = items.map(function (b) {
        var meta = []; if (b.data) meta.push(b.data); if (b.duration) meta.push(b.duration);
        var name = b.name || b.option || 'Forfait';
        var country = countryFromBundle(name); if (country) meta.unshift(country);
        var id = b.id || b.option || '';
        return '<button class="bundle-item" type="button" data-id="' + BB.escapeHtml(id) + '" data-price="' + (b.price | 0) + '">' +
          '<span class="bundle-item__price">' + (b.price ? fmt(b.price) + ' F' : '—') + '</span>' +
          '<span class="bundle-item__body"><span class="bundle-item__name">' + BB.escapeHtml(name) + '</span>' +
          '<span class="bundle-item__meta">' + BB.escapeHtml(meta.join(' · ')) + '</span></span></button>';
      }).join('');
    } catch (e) { list.innerHTML = '<div class="bb-modal__empty">⚠ Forfaits indisponibles — réessayez plus tard</div>'; }
  }
  function closeBundles() { $('bundlesModal').classList.remove('is-open'); }
  function selectBundle(id, price) {
    order.amount = price; order.bundleId = id;
    Array.from($('amtGrid').children).forEach(function (b) { b.classList.remove('is-active'); });
    var ca = $('customAmount'); if (ca) ca.value = '';
    var bd = $('bundleChosen'); if (bd) { bd.style.display = ''; bd.textContent = 'Forfait sélectionné · ' + fmt(price) + ' F'; }
    closeBundles(); refreshSubmit();
  }

  // ── Validate → BBPay ──
  async function validateRecharge() {
    if (!order.op) { toast('Choisissez un opérateur.', 'error'); return; }
    if (!revalidatePhone()) { toast('Numéro invalide pour ' + order.op + '.', 'error'); return; }
    if (!order.amount) { toast('Choisissez un montant ou un forfait.', 'error'); return; }
    var amount = order.amount | 0;
    var payload = {};
    if (order.bundleId) { payload.bundleType = 'data'; payload.bundleId = order.bundleId; }
    var btn = $('rechargeSubmit'); btn.disabled = true; btn.textContent = 'Création de la commande…';
    await BBPay.startOrder({
      operator: order.op, amount: amount, amountTotal: amount + Math.round(amount * 0.05),
      phone: order.phone, type: 'recharge', label: order.op, payload: payload,
      onDone: function () { renderOrders(); }
    });
    btn.disabled = false; refreshSubmit();
  }

  // ── Orders list (local bb_orders) ──
  function sinceFmt(ms) {
    var min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return 'il y a ' + min + ' min';
    var h = Math.round(min / 60); if (h < 24) return 'il y a ' + h + ' h';
    return 'il y a ' + Math.round(h / 24) + ' j';
  }
  function renderOrders() {
    var root = $('ordersList'); if (!root) return;
    var orders = [];
    try { orders = JSON.parse(localStorage.getItem('bb_orders') || '[]'); } catch (e) {}
    if (!orders.length) {
      root.innerHTML = '<div class="empty-block"><iconify-icon icon="solar:bag-cross-linear" width="30"></iconify-icon><div class="t">Aucune commande pour le moment</div><div class="s">Tes recharges et achats apparaîtront ici.</div></div>';
      return;
    }
    var pm = { djamo: 'Djamo', wave: 'Wave', ton: 'TON', momo: 'MoMo' };
    root.innerHTML = orders.map(function (o) {
      var op = o.operator || o.op || '?';
      var validated = (o.status === 'ok' || o.status === 'valide' || o.status === 'validated');
      var badge = validated ? '<span class="bb-badge bb-badge--ok">Validé</span>' : '<span class="bb-badge bb-badge--pending">En cours</span>';
      var when = o.at || (o.createdAt ? new Date(o.createdAt).getTime() : Date.now());
      var amt = (o.amountTotal != null ? o.amountTotal : o.amount) || 0;
      var letter = ({ CARTE_CADEAU: 'C', ANNONCE_LED: 'A', PACK_ARTICLES: 'P', RECHARGE_INTL: '🌍' })[op] || (String(op)[0] || '?').toUpperCase();
      return '<div class="tx-row"><span class="bb-op-chip" data-op="' + BB.escapeHtml(op) + '" style="width:26px;height:26px;font-size:10px">' + BB.escapeHtml(letter) + '</span>' +
        '<span class="num">' + BB.escapeHtml(o.phone || '') + '</span>' +
        '<span class="when">' + sinceFmt(when) + (pm[o.paymentMethod] ? ' · ' + pm[o.paymentMethod] : '') + '</span>' + badge +
        '<span class="amt">' + fmt(amt) + ' F</span></div>' +
        (op === 'CARTE_CADEAU' ? '<div id="ocode-' + BB.escapeHtml(o.id || '') + '"></div>' : '');
    }).join('');
    try { hydrateGiftCodes(orders); } catch (e) {}
  }
  // Récupère + affiche le code des cartes cadeaux livrées
  async function hydrateGiftCodes(orders) {
    var gifts = orders.filter(function (o) { return (o.operator || o.op) === 'CARTE_CADEAU'; });
    for (var i = 0; i < gifts.length; i++) {
      var o = gifts[i], el = $('ocode-' + (o.id || '')); if (!el) continue;
      try {
        var r = await fetch(BB.apiBase() + '/api/orders/' + encodeURIComponent(o.id) + '/giftcard', { cache: 'no-store' });
        if (!r.ok) continue;
        var d = await r.json();
        if (d && d.card && d.card.code) {
          el.innerHTML = '<div class="gift-code-box">🔑 <span class="gc-val">' + BB.escapeHtml(d.card.code) + '</span>' +
            (d.card.pin ? ' · PIN <span class="gc-val">' + BB.escapeHtml(d.card.pin) + '</span>' : '') +
            ' <button type="button" class="gc-copy" data-copy="' + BB.escapeHtml(d.card.code) + '">Copier</button></div>';
        } else if (d && (d.status === 'ordered' || d.status === 'pending')) {
          el.innerHTML = '<div class="gift-code-box" style="border-style:solid;opacity:.7">⏳ Code en cours de génération…</div>';
        }
      } catch (e) {}
    }
  }

  // ── Recharge internationale (Reloadly airtime) ──
  var INTL_COUNTRIES = [
    { n: 'Nigeria', iso: 'NG', d: '234', f: '🇳🇬' }, { n: 'Ghana', iso: 'GH', d: '233', f: '🇬🇭' },
    { n: 'Sénégal', iso: 'SN', d: '221', f: '🇸🇳' }, { n: 'Mali', iso: 'ML', d: '223', f: '🇲🇱' },
    { n: 'Burkina Faso', iso: 'BF', d: '226', f: '🇧🇫' }, { n: 'Guinée', iso: 'GN', d: '224', f: '🇬🇳' },
    { n: 'Togo', iso: 'TG', d: '228', f: '🇹🇬' }, { n: 'Bénin', iso: 'BJ', d: '229', f: '🇧🇯' },
    { n: 'Niger', iso: 'NE', d: '227', f: '🇳🇪' }, { n: 'Cameroun', iso: 'CM', d: '237', f: '🇨🇲' },
    { n: 'RD Congo', iso: 'CD', d: '243', f: '🇨🇩' }, { n: 'Congo', iso: 'CG', d: '242', f: '🇨🇬' },
    { n: 'Gabon', iso: 'GA', d: '241', f: '🇬🇦' }, { n: 'Kenya', iso: 'KE', d: '254', f: '🇰🇪' },
    { n: 'Maroc', iso: 'MA', d: '212', f: '🇲🇦' }, { n: 'Algérie', iso: 'DZ', d: '213', f: '🇩🇿' },
    { n: 'Tunisie', iso: 'TN', d: '216', f: '🇹🇳' }, { n: 'France', iso: 'FR', d: '33', f: '🇫🇷' },
    { n: 'États-Unis', iso: 'US', d: '1', f: '🇺🇸' }, { n: 'Royaume-Uni', iso: 'GB', d: '44', f: '🇬🇧' },
    { n: 'Belgique', iso: 'BE', d: '32', f: '🇧🇪' }, { n: 'Canada', iso: 'CA', d: '1', f: '🇨🇦' }
  ];
  var intl = { quote: null, selected: null, number: '', iso: '' };
  function intlCountry() { var s = $('intlCountry'); var i = s ? (s.value | 0) : 0; return INTL_COUNTRIES[i] || INTL_COUNTRIES[0]; }
  function intlPopulate() {
    var s = $('intlCountry'); if (!s || s.options.length) return;
    s.innerHTML = INTL_COUNTRIES.map(function (c, i) { return '<option value="' + i + '">' + c.f + '  ' + c.n + '  (+' + c.d + ')</option>'; }).join('');
    intlSyncDial();
  }
  function intlSyncDial() { var c = intlCountry(), d = $('intlDial'); if (d) d.textContent = '+' + c.d; }
  function openIntl() { intlPopulate(); intlSyncDial(); $('intlResult').innerHTML = ''; $('intlConfirmBtn').style.display = 'none'; $('intlModal').classList.add('is-open'); }
  function closeIntl() { $('intlModal').classList.remove('is-open'); }
  async function intlDetect() {
    var c = intlCountry();
    var num = ($('intlPhone').value || '').replace(/\D/g, '');
    if (num.length < 5) { toast('Entre un numéro valide.', 'error'); return; }
    var res = $('intlResult'); res.innerHTML = '<p class="hint" style="text-align:center">Détection de l\'opérateur…</p>';
    $('intlConfirmBtn').style.display = 'none';
    try {
      intl.number = c.d + num.replace(/^0+/, ''); intl.iso = c.iso;
      var r = await fetch(BB.apiBase() + '/api/reloadly/airtime/quote?phone=' + encodeURIComponent(num) + '&iso=' + c.iso, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      var d = await r.json();
      if (!r.ok || !d.items || !d.items.length) throw new Error(d.error || 'Opérateur introuvable pour ce numéro.');
      intl.quote = d; intl.selected = null;
      res.innerHTML = '<div class="intl-op">' + (d.logo ? '<img src="' + BB.escapeHtml(d.logo) + '" alt="">' : '') + '<div><strong>' + BB.escapeHtml(d.name || 'Opérateur') + '</strong><div class="hint">' + BB.escapeHtml(d.country || c.iso) + ' · paiement en XOF</div></div></div>' +
        '<div class="intl-amounts">' + d.items.map(function (it, idx) { return '<button type="button" class="intl-amt" data-idx="' + idx + '"><span class="recv">' + fmt(it.localAmount) + ' ' + BB.escapeHtml(it.recipientCurrency || '') + '</span><span class="pay">' + fmt(it.prixClientXOF) + ' XOF</span></button>'; }).join('') + '</div>';
    } catch (e) { res.innerHTML = '<p class="hint" style="text-align:center;color:#ef4444">' + BB.escapeHtml(e.message || 'Erreur') + '</p>'; }
  }
  function intlSelect(idx) {
    var it = intl.quote && intl.quote.items[idx]; if (!it) return;
    intl.selected = it;
    document.querySelectorAll('#intlResult .intl-amt').forEach(function (b, i) { b.classList.toggle('is-active', i === idx); });
    $('intlConfirmBtn').style.display = '';
  }
  async function intlConfirm() {
    if (!intl.selected) { toast('Choisis un montant.', 'error'); return; }
    var it = intl.selected, q = intl.quote;
    var price = Number(it.prixClientXOF) || 0;
    var label = (q.name || 'Recharge') + ' ' + fmt(it.localAmount) + ' ' + (it.recipientCurrency || '');
    closeIntl();
    await BBPay.startOrder({
      operator: 'RECHARGE_INTL', amount: price, amountTotal: price,
      phone: '+' + intl.number, type: 'airtime_intl', label: label,
      payload: { giftCard: label, operatorId: q.operatorId, senderEUR: it.senderEUR, iso: intl.iso, number: intl.number },
      onDone: function () { renderOrders(); }
    });
  }

  function boot() {
    if (!$('opGrid')) return;
    // International
    var ib = $('openIntlBtn'); if (ib) ib.addEventListener('click', openIntl);
    var sc = $('intlCountry'); if (sc) sc.addEventListener('change', intlSyncDial);
    var idb = $('intlDetectBtn'); if (idb) idb.addEventListener('click', intlDetect);
    var icb = $('intlConfirmBtn'); if (icb) icb.addEventListener('click', intlConfirm);
    var ir = $('intlResult'); if (ir) ir.addEventListener('click', function (e) { var b = e.target.closest('.intl-amt'); if (b) intlSelect(b.dataset.idx | 0); });
    document.querySelectorAll('[data-close="intl"]').forEach(function (b) { b.addEventListener('click', closeIntl); });
    $('opGrid').addEventListener('click', function (e) { var b = e.target.closest('.op-btn'); if (b) selectOperator(b.dataset.op); });
    $('amtGrid').addEventListener('click', function (e) { var b = e.target.closest('.amt-btn'); if (b) selectAmount(parseInt(b.dataset.amt, 10)); });
    var ca = $('customAmount'); if (ca) ca.addEventListener('input', function (e) { setCustomAmount(e.target.value); });
    $('phoneInput').addEventListener('input', function (e) {
      var v = e.target.value.replace(/\D/g, '').slice(0, 10);
      e.target.value = v.match(/.{1,2}/g) ? v.match(/.{1,2}/g).join(' ') : '';
      revalidatePhone();
    });
    $('rechargeSubmit').addEventListener('click', validateRecharge);
    var bi = $('btnBundlesData'); if (bi) bi.addEventListener('click', function () { openBundles('data'); });
    var bm = $('btnBundlesMix'); if (bm) bm.addEventListener('click', function () { openBundles('mix'); });
    $('bundlesModalList').addEventListener('click', function (e) { var b = e.target.closest('.bundle-item'); if (b) selectBundle(b.dataset.id, parseInt(b.dataset.price, 10) || 0); });
    document.querySelectorAll('[data-close="bundles"]').forEach(function (el) { el.addEventListener('click', closeBundles); });
    var ol = $('ordersList');
    if (ol) ol.addEventListener('click', function (e) { var b = e.target.closest('[data-copy]'); if (b) { try { navigator.clipboard.writeText(b.dataset.copy); toast('Code copié !', 'success'); } catch (err) {} } });
    renderOrders(); refreshSubmit();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.BBRecharge = { openBundles: openBundles, renderOrders: renderOrders };
})();
