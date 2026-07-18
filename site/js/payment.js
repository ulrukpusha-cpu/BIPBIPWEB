/* =========================================================
   Bipbip Recharge — Web · Shared payment flow (BBPay)
   POST /api/orders → payment modal (Djamo / Wave / TON) →
   proof (proof-base64) → success. Used by recharge, gift cards,
   article packs, etc. The modal markup is injected once into <body>.
   Uses window.BB (core.js).
   ========================================================= */
(function () {
  if (window.BBPay) return;

  var WAVE_URL = 'https://pay.wave.com/m/M_ci_KslOdTnbqD3G/c/ci/';
  var TON_WALLET_URL = 'https://t.me/wallet?startattach=tonconnect_v2';

  var currentOrder = null;
  var proofDataUrl = null;
  var onDoneCb = null;
  var cfg = null;
  var built = false;

  function $(id) { return document.getElementById(id); }
  function toast(m, k) { window.BB && BB.appToast(m, k); }
  function fmt(n) { return (n | 0).toLocaleString('fr-FR'); }
  function esc(s) { return window.BB ? BB.escapeHtml(s) : String(s == null ? '' : s); }

  async function getConfig() { if (cfg) return cfg; try { cfg = await window.BipbipAPI.getConfig(); } catch (e) { cfg = {}; } return cfg; }

  // ── Build modal once ────────────────────────────────────
  function build() {
    if (built) return;
    built = true;
    var wrap = document.createElement('div');
    wrap.className = 'bb-modal-backdrop';
    wrap.id = 'payModal';
    wrap.innerHTML =
      '<div class="bb-modal bb-modal--wide">' +
        '<div id="payView_pay">' +
          '<div class="bb-modal__head"><h3>Mode de paiement</h3><button class="bb-modal__close" type="button" data-pay-close aria-label="Fermer">✕</button></div>' +
          '<div class="order-id-display" id="payOrderId"></div>' +
          '<p class="pay-hint">Choisissez comment payer, puis envoyez une capture à l\'étape suivante.</p>' +
          '<div class="pay-tabs"><button class="pay-tab is-active" type="button" data-tab="djamo">Djamo</button><button class="pay-tab" type="button" data-tab="ton">TON</button></div>' +
          '<div class="pay-panel pay-panel--djamo is-active"><div class="pay-card">' +
            '<div class="pay-card__head"><div class="pay-card__ico" style="background:rgba(16,185,129,.18);color:#10b981"><iconify-icon icon="solar:card-linear" width="24"></iconify-icon></div><div><h3>Djamo</h3><p>Paiement FCFA — capture d\'écran à l\'étape suivante</p></div></div>' +
            '<a class="pay-card__cta pay-card__cta--djamo" id="djamoPayLink" href="https://pay.djamo.com/pkbyg" target="_blank" rel="noopener"><iconify-icon icon="solar:square-top-up-linear" width="18"></iconify-icon> Ouvrir Djamo Pay</a>' +
            '<p class="pay-card__url" id="djamoPayUrl">pay.djamo.com/pkbyg</p>' +
            '<button type="button" class="pay-card__continue" data-choose="djamo"><iconify-icon icon="solar:arrow-right-linear" width="16"></iconify-icon> Continuer vers la preuve</button>' +
          '</div></div>' +
          '<div class="pay-panel pay-panel--ton"><div class="pay-card">' +
            '<div class="pay-card__head"><div class="pay-card__ico" style="background:rgba(56,189,248,.18);color:#38bdf8"><span style="font-size:20px">◆</span></div><div><h3>Paiement en TON</h3><p>Connexion wallet + envoi en une étape</p></div></div>' +
            '<div class="pay-card__ton-box"><span class="lbl">Montant à envoyer</span><strong id="tonAmount">—</strong><small id="tonUsd">—</small></div>' +
            '<button type="button" class="pay-card__cta pay-card__cta--ton" id="tonOpen"><iconify-icon icon="solar:wallet-money-linear" width="18"></iconify-icon> Ouvrir le wallet TON</button>' +
            '<button type="button" class="pay-card__continue" data-choose="ton"><iconify-icon icon="solar:arrow-right-linear" width="16"></iconify-icon> J\'ai payé · Continuer</button>' +
          '</div></div>' +
          '<div class="pay-card"><button type="button" class="pay-card__toggle" id="waveToggle">' +
            '<span class="pay-card__head" style="margin:0"><span class="pay-card__ico" style="background:rgba(139,92,246,.18);color:#a78bfa"><iconify-icon icon="solar:qr-code-linear" width="22"></iconify-icon></span><span style="font-weight:700">Wave</span></span>' +
            '<iconify-icon id="waveChevron" icon="solar:alt-arrow-down-linear" width="20" style="color:var(--bb-muted);transition:transform .2s"></iconify-icon></button>' +
            '<div id="wavePanelBody" style="display:none">' +
              '<a href="' + WAVE_URL + '" target="_blank" rel="noopener" class="pay-card__cta pay-card__cta--wave" style="margin-top:12px"><iconify-icon icon="solar:wallet-money-linear" width="18"></iconify-icon> Ouvrir Wave Pay</a>' +
              '<p class="pay-card__url">pay.wave.com/m/M_ci_KslOdTnbqD3G</p>' +
              '<p class="pay-card__qr-title">Scanne-moi</p><p class="pay-card__qr-hint">Scannez le QR Wave Business, payez le montant, puis envoyez une capture.</p>' +
              '<div class="pay-card__qr-wrap"><img src="/assets/wave-business-qr.png" alt="QR Wave Business" loading="lazy"></div>' +
              '<button type="button" class="pay-card__continue" data-choose="wave"><iconify-icon icon="solar:check-circle-linear" width="16"></iconify-icon> Continuer vers la preuve</button>' +
            '</div></div>' +
        '</div>' +
        '<div id="payView_proof" style="display:none">' +
          '<div class="bb-modal__head"><h3>Preuve de paiement</h3><button class="bb-modal__close" type="button" data-pay-close aria-label="Fermer">✕</button></div>' +
          '<div class="proof-info"><h3><iconify-icon icon="solar:wallet-money-linear" width="18"></iconify-icon> Effectuez votre paiement</h3><p id="proofMethodLabel">Paiement via Djamo</p><p>Une fois le paiement effectué, prenez une capture d\'écran et envoyez-la pour validation.</p></div>' +
          '<label class="proof-drop" for="proofInput"><iconify-icon icon="solar:camera-add-linear" width="36"></iconify-icon><span class="proof-drop__title">Cliquez pour ajouter une capture d\'écran</span><span class="proof-drop__hint">PNG, JPG (max 5 MB)</span></label>' +
          '<input id="proofInput" type="file" accept="image/*" hidden>' +
          '<div class="proof-preview" id="proofPreviewWrap" style="display:none"><img id="proofPreview" alt="Aperçu"><button type="button" class="proof-preview__remove" id="proofRemove">✕</button></div>' +
          '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="btn-ghost" id="proofBack">← Retour</button><button type="button" class="bb-cta bb-cta--block" id="sendProofBtn" style="margin:0;flex:1" disabled>Envoyer la preuve</button></div>' +
        '</div>' +
        '<div id="payView_done" style="display:none">' +
          '<div class="pay-success"><div class="pay-success__ico"><iconify-icon icon="solar:check-circle-bold" width="56"></iconify-icon></div><h3>Preuve envoyée !</h3><p>Votre commande est en cours de traitement. Vous recevrez une notification de validation.</p></div>' +
          '<div id="doneDetails"></div><button type="button" class="bb-cta bb-cta--block" id="doneClose">Fermer</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    // Wiring
    wrap.querySelectorAll('.pay-tab').forEach(function (t) { t.addEventListener('click', function () { setPayTab(t.dataset.tab); }); });
    wrap.querySelectorAll('[data-choose]').forEach(function (b) { b.addEventListener('click', function () { choosePayment(b.dataset.choose); }); });
    wrap.querySelectorAll('[data-pay-close]').forEach(function (b) { b.addEventListener('click', close); });
    $('waveToggle').addEventListener('click', toggleWave);
    $('tonOpen').addEventListener('click', function () { window.open(TON_WALLET_URL, '_blank'); });
    $('proofInput').addEventListener('change', handleProofUpload);
    $('proofRemove').addEventListener('click', removeProof);
    $('sendProofBtn').addEventListener('click', sendProof);
    $('proofBack').addEventListener('click', function () { showView('pay'); });
    $('doneClose').addEventListener('click', close);
  }

  function showView(v) { ['pay', 'proof', 'done'].forEach(function (x) { var el = $('payView_' + x); if (el) el.style.display = (x === v) ? '' : 'none'; }); }
  function setPayTab(tab) {
    document.querySelectorAll('#payModal .pay-tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === tab); });
    document.querySelectorAll('#payModal .pay-panel').forEach(function (p) { p.classList.toggle('is-active', p.classList.contains('pay-panel--' + tab)); });
  }
  function toggleWave() {
    var body = $('wavePanelBody'), chev = $('waveChevron');
    var open = body.style.display === 'none' || !body.style.display;
    body.style.display = open ? 'block' : 'none';
    if (chev) chev.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
  }
  function close() { var m = $('payModal'); if (m) m.classList.remove('is-open'); }

  async function openForOrder() {
    build();
    $('payModal').classList.add('is-open');
    showView('pay');
    $('payOrderId').textContent = 'Commande #' + currentOrder.id + ' — ' + fmt(currentOrder.amountTotal) + ' FCFA';
    setPayTab('djamo');
    var c = await getConfig();
    var dj = (c && c.djamoPayUrl) || 'https://pay.djamo.com/pkbyg';
    var a = $('djamoPayLink'); if (a) a.href = dj;
    var u = $('djamoPayUrl'); if (u) u.textContent = dj.replace(/^https?:\/\//, '');
    refreshTonRate();
  }
  async function refreshTonRate() {
    var box = $('tonAmount'), usdEl = $('tonUsd');
    var fcfa = currentOrder ? (currentOrder.amountTotal | 0) : 0;
    try {
      var c = await getConfig();
      var tonUsd = Number(c && c.tonUsd) || 0;
      var fcfaPerUsdt = Number(c && c.cryptoFcfaPerUsdt) || 600;
      if (!tonUsd) throw new Error('no rate');
      var fcfaPerTon = tonUsd * fcfaPerUsdt;
      if (box) box.textContent = (fcfa / fcfaPerTon).toFixed(4) + ' TON';
      if (usdEl) usdEl.textContent = 'Cours actuel : 1 TON ≈ ' + tonUsd.toFixed(2) + ' $ (' + fmt(Math.round(fcfaPerTon)) + ' FCFA)';
    } catch (e) { if (box) box.textContent = '—'; if (usdEl) usdEl.textContent = 'Cours TON indisponible. Réessaie dans un instant.'; }
  }
  function choosePayment(method) {
    if (!currentOrder) { toast('Aucune commande en cours.', 'error'); return; }
    currentOrder.paymentMethod = method;
    var labels = { djamo: 'Paiement via Djamo', wave: 'Paiement via Wave', ton: 'Paiement via TON' };
    $('proofMethodLabel').textContent = labels[method] || 'Paiement';
    proofDataUrl = null;
    $('proofPreviewWrap').style.display = 'none';
    $('proofPreview').src = '';
    $('sendProofBtn').disabled = true;
    showView('proof');
  }
  function handleProofUpload(ev) {
    var f = ev.target.files && ev.target.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Image trop volumineuse (max 5 MB).', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function (e) { proofDataUrl = e.target.result; $('proofPreview').src = proofDataUrl; $('proofPreviewWrap').style.display = ''; $('sendProofBtn').disabled = false; };
    reader.readAsDataURL(f);
  }
  function removeProof() { proofDataUrl = null; $('proofPreviewWrap').style.display = 'none'; $('sendProofBtn').disabled = true; $('proofInput').value = ''; }
  function compress(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var max = 1280, w = img.width, h = img.height;
        if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }
  async function sendProof() {
    if (!currentOrder || !proofDataUrl) return;
    var sb = $('sendProofBtn'); sb.disabled = true; var prev = sb.innerHTML; sb.textContent = 'Envoi…';
    try {
      var compressed = await compress(proofDataUrl);
      var r = await fetch(BB.apiBase() + '/api/orders/' + encodeURIComponent(currentOrder.id) + '/proof-base64', {
        method: 'POST', headers: BB.apiHeaders(), body: JSON.stringify({ image: compressed, paymentMethod: currentOrder.paymentMethod || 'djamo' })
      });
      var data = await r.json().catch(function () { return null; });
      if (!r.ok || !data || !data.success) throw new Error((data && data.error) || ('HTTP ' + r.status));
      try {
        var olist = JSON.parse(localStorage.getItem('bb_orders') || '[]');
        olist.unshift({ id: currentOrder.id, operator: currentOrder.operator, amount: currentOrder.amount, amountTotal: currentOrder.amountTotal, phone: currentOrder.phone, paymentMethod: currentOrder.paymentMethod, status: 'proof_sent', createdAt: currentOrder.createdAt, type: currentOrder.type, at: Date.now() });
        localStorage.setItem('bb_orders', JSON.stringify(olist.slice(0, 50)));
      } catch (e) {}
      $('doneDetails').innerHTML = '<div class="done-grid">' +
        '<span>N° commande</span><strong>' + esc(String(currentOrder.id)) + '</strong>' +
        '<span>Type</span><strong>' + esc(currentOrder.label || currentOrder.operator) + '</strong>' +
        '<span>Montant</span><strong>' + fmt(currentOrder.amountTotal) + ' FCFA</strong>' +
        '<span>Paiement</span><strong>' + esc(currentOrder.paymentMethod || '?') + '</strong>' +
        '<span>Statut</span><strong style="color:#facc15">⏳ En attente de validation</strong></div>';
      showView('done');
      try { BB.refreshServerPoints(); } catch (e) {}
      if (typeof onDoneCb === 'function') { try { onDoneCb(currentOrder); } catch (e) {} }
    } catch (e) {
      sb.disabled = false; sb.innerHTML = prev;
      toast('Échec envoi : ' + (e.message || e), 'error');
    }
  }

  // ── Public: create an order then open the payment modal ──
  // opts = { operator, amount, amountTotal?, phone?, type?, label?, payload?, onDone? }
  async function startOrder(opts) {
    var amount = opts.amount | 0;
    var amountTotal = (opts.amountTotal != null) ? (opts.amountTotal | 0) : amount;
    var payload = Object.assign({
      operator: opts.operator, amount: amount, amountTotal: amountTotal,
      phone: opts.phone || ('svc-' + Date.now()),
      label: opts.label || opts.operator
    }, opts.payload || {}, BB.userPayloadFields());
    toast('Création de la commande…');
    try {
      var r = await fetch(BB.apiBase() + '/api/orders', { method: 'POST', headers: BB.apiHeaders(), body: JSON.stringify(payload) });
      var data = await r.json().catch(function () { return null; });
      if (!r.ok || !data || !data.order) throw new Error((data && data.error) || ('HTTP ' + r.status));
      currentOrder = {
        id: data.order.id, operator: opts.operator, amount: amount, amountTotal: amountTotal,
        phone: payload.phone, paymentMethod: null, type: opts.type || 'service', label: opts.label,
        createdAt: data.order.createdAt || new Date().toISOString()
      };
      onDoneCb = opts.onDone || null;
      await openForOrder();
      return true;
    } catch (e) {
      toast('Erreur commande : ' + (e.message || e), 'error');
      return false;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  window.BBPay = { startOrder: startOrder, close: close };
})();
