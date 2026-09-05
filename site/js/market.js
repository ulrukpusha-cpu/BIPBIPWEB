/* =========================================================
   Bipbip Recharge — Web · Market (Phase 4)
   Ports from app/index.html: parents, gift cards (/api/gift-cards),
   second-hand items (/api/market/items), item/card detail, my items
   (/api/market/items/mine, POST, DELETE), add-item (3 photos, free
   limit 3 + 500F pack). Purchases routed through BBPay. Uses window.BB.
   ========================================================= */
(function () {
  var FREE_ITEMS_LIMIT = 3, EXTRA_PACK_PRICE = 500;

  var ico = function (n, s) { return '<iconify-icon icon="' + n + '" width="' + (s || 28) + '"></iconify-icon>'; };
  var MARKET_PARENTS = [
    { id: 'cards', icon: ico('solar:gift-linear', 32), label: 'Cartes cadeaux', desc: 'Apple, Google, Spotify, Netflix, Steam, Amazon…', count: '6 marques' },
    { id: 'bazar', icon: ico('solar:cart-large-2-linear', 32), label: 'Bazar', desc: 'Mode, maison, beauté, sport, accessoires.', count: 'Occasion' },
    { id: 'electronics', icon: ico('solar:smartphone-linear', 32), label: 'Appareil électronique', desc: 'Smartphones, audio, tablettes, accessoires tech.', count: 'Occasion' },
    { id: 'books', icon: ico('solar:book-2-linear', 32), label: 'Livre', desc: 'Romans, scolaire, BD, dév. perso, religieux.', count: 'Occasion' }
  ];
  var MARKET_TITLES = { bazar: 'Bazar', electronics: 'Appareil électronique', books: 'Livre' };
  var MARKET_SUBCATS = {
    bazar: [{ slug: 'mode', label: 'Mode' }, { slug: 'maison', label: 'Maison' }, { slug: 'beaute', label: 'Beauté' }, { slug: 'sport', label: 'Sport' }, { slug: 'cuisine', label: 'Cuisine' }, { slug: 'enfants', label: 'Enfants' }],
    electronics: [{ slug: 'smartphones', label: 'Smartphones' }, { slug: 'ordinateurs', label: 'Ordi & Tablettes' }, { slug: 'audio', label: 'Audio' }, { slug: 'tv', label: 'TV & Image' }, { slug: 'accessoires', label: 'Accessoires' }, { slug: 'photo', label: 'Photo & Vidéo' }],
    books: [{ slug: 'romans', label: 'Romans' }, { slug: 'scolaire', label: 'Scolaire' }, { slug: 'perso', label: 'Dév. perso' }, { slug: 'bd', label: 'BD & Mangas' }, { slug: 'religieux', label: 'Religieux' }, { slug: 'jeunesse', label: 'Jeunesse' }]
  };

  var giftCards = [], giftCat = 'app', categoryItems = [];
  var shopProducts = [], shopUrl = '';
  var marketAllItems = [], marketParentId = '', marketSubFilter = '';
  var newItemPhotos = [null, null, null];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.BB ? BB.escapeHtml(s) : String(s == null ? '' : s); }
  function toast(m, k) { window.BB && BB.appToast(m, k); }
  function fmt(n) { return Number(n || 0).toLocaleString('fr-FR'); }
  function absUrl(u) { if (!u) return ''; if (/^https?:\/\//i.test(u)) return u; var b = BB.apiBase(); return b + (u.charAt(0) === '/' ? '' : '/') + u; }

  function showView(name) {
    ['home', 'category', 'cards', 'shop'].forEach(function (v) { var el = $('view-' + v); if (el) el.style.display = (v === name) ? '' : 'none'; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Parents ──
  function renderMarket() {
    $('marketGrid').innerHTML = MARKET_PARENTS.map(function (p) {
      return '<button class="market-parent" type="button" data-id="' + p.id + '"><div class="market-parent__icon">' + p.icon + '</div><h3>' + esc(p.label) + '</h3><p>' + esc(p.desc) + '</p><span class="bb-badge bb-badge--pending">' + esc(p.count) + '</span></button>';
    }).join('');
  }

  // \u2500\u2500 Boutique BIPBIP (catalogue Shopify via /api/shop/products) \u2500\u2500
  // La tuile n'appara\u00eet que si la boutique renvoie au moins un produit : tant
  // qu'elle est ferm\u00e9e ou vide, le Market reste stricto sensu comme avant.
  var SHOP_PARENT = { id: 'shop', icon: ico('solar:shop-2-linear', 32), label: 'Boutique BIPBIP', desc: 'Accessoires neufs, livr\u00e9s \u00e0 Abidjan.', count: 'Neuf' };
  function loadShopProducts() {
    return fetch(BB.apiBase() + '/api/shop/products', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        shopProducts = (d && Array.isArray(d.products)) ? d.products : [];
        shopUrl = (d && d.shopUrl) || '';
        if (!shopProducts.length) return;
        SHOP_PARENT.count = shopProducts.length + (shopProducts.length > 1 ? ' articles' : ' article');
        if (MARKET_PARENTS[0].id !== 'shop') MARKET_PARENTS.unshift(SHOP_PARENT);
        renderMarket();
      })
      .catch(function () { });
  }
  function renderShop() {
    var grid = $('shopGrid'); if (!grid) return;
    if (!shopProducts.length) {
      renderShopMore();
      grid.innerHTML = '<div class="cards-empty" style="grid-column:1/-1">' + ico('solar:shop-2-linear', 34) + '<div class="t">La boutique ouvre bient\u00f4t.</div><div class="s">Les premiers articles arrivent tr\u00e8s vite.</div></div>';
      return;
    }
    renderShopMore();
    grid.innerHTML = shopProducts.map(function (p) {
      var img = absUrl(p.img);
      return '<button class="gift-card" type="button" data-shop="' + esc(p.id) + '">' +
        '<div class="gift-card__art">' +
          (p.available ? '' : '<span class="gift-card__value">Rupture</span>') +
          (img ? '<img src="' + esc(img) + '" alt="' + esc(p.name || '') + '" loading="lazy">' : ico('solar:box-linear', 48)) +
        '</div><div class="gift-card__name">' + esc(p.name || '') + '</div>' +
        '<div class="gift-card__price">' + (p.price ? fmt(p.price) + ' ' + esc(p.currency || 'XOF') : '') + '</div></button>';
    }).join('');
  }
  function renderShopMore() {
    var box = $('shopMore'); if (!box) return;
    box.innerHTML = shopUrl
      ? '<a class="bb-cta" href="' + esc(shopUrl) + '" target="_blank" rel="noopener">' + ico('solar:shop-2-linear', 18) + ' Voir toute la boutique</a>'
      : '';
  }
  function openShopDetail(p) {
    var db = $('cardDenoms'); if (db) db.style.display = 'none';
    resetItemGallery();
    var img = absUrl(p.img);
    $('itemArt').innerHTML = img ? '<img src="' + esc(img) + '" alt="">' : ico('solar:box-linear', 60);
    $('itemName').textContent = p.name || '';
    $('itemPrice').textContent = p.price ? (fmt(p.price) + ' ' + (p.currency || 'XOF')) : '';
    setItemDesc(p.desc || 'Article neuf de la boutique Bipbip.');
    setItemLegal('Article vendu par Bipbip Recharge. Paiement et livraison g\u00e9r\u00e9s sur la boutique.');
    var act = $('itemAction');
    act.className = 'bb-cta bb-cta--block';
    if (p.available && p.url) {
      act.innerHTML = ico('solar:cart-large-2-bold', 18) + ' Acheter sur la boutique';
      act.onclick = function () { window.open(p.url, '_blank', 'noopener'); };
    } else {
      act.innerHTML = ico('solar:clock-circle-linear', 18) + ' Bient\u00f4t de retour';
      act.onclick = null;
    }
    $('itemModal').classList.add('is-open');
  }

  // ── Gift cards (catalogue Reloadly réel) ──
  var GIFT_BRANDS = 'itunes,google play,amazon,uber eats,airbnb,netflix,spotify,steam,playstation,xbox,roblox,nintendo,razer,minecraft';
  var selectedDenom = null, selectedCard = null;
  function giftCatOf(name) {
    var n = String(name || '').toLowerCase();
    if (/netflix|disney|youtube|hbo|prime video|crunchyroll/.test(n)) return 'films';
    if (/spotify|deezer|apple music|tidal|audible|\bmusic\b/.test(n)) return 'music';
    if (/steam|playstation|psn|xbox|roblox|nintendo|riot|valorant|fortnite|minecraft|razer|game|\bea\b/.test(n)) return 'jeux';
    return 'app';
  }
  async function loadGiftCards() {
    var grid = $('cardsGrid');
    if (grid && !giftCards.length) grid.innerHTML = '<div class="cards-empty">Chargement du catalogue…</div>';
    try {
      var r = await fetch(BB.apiBase() + '/api/reloadly/giftcards/catalog?brand=' + encodeURIComponent(GIFT_BRANDS), { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      var d = await r.json();
      var products = (d && d.products) || [];
      giftCards = products.map(function (p) {
        var first = (p.items && p.items[0]) || null;
        return {
          id: String(p.productId), name: p.name, img: p.logo,
          category: giftCatOf(p.name), price: first ? first.prixClientXOF : 0,
          items: p.items || [], recipientCurrency: p.recipientCurrency, reloadlyProductId: p.productId
        };
      });
    } catch (e) { giftCards = []; }
    renderCards();
  }
  function renderCards() {
    var grid = $('cardsGrid'); if (!grid) return;
    var filtered = giftCards.filter(function (c) { return c.category === giftCat; });
    if (!filtered.length) { grid.innerHTML = '<div class="cards-empty">Aucune carte dans cette catégorie pour le moment.</div>'; return; }
    grid.innerHTML = filtered.map(function (c) {
      var img = absUrl(c.img);
      return '<button class="gift-card" type="button" data-card="' + esc(c.id || '') + '">' +
        '<div class="gift-card__art">' +
          (c.price ? '<span class="gift-card__value">dès ' + fmt(c.price) + ' F</span>' : '') +
          (img ? '<img src="' + esc(img) + '" alt="' + esc(c.name || '') + '" loading="lazy">' : '') +
        '</div><div class="gift-card__name">' + esc(c.name || '') + '</div>' +
        '<div class="gift-card__price">' + (c.price ? fmt(c.price) + ' XOF' : '') + '</div></button>';
    }).join('');
  }
  function setGiftCat(cat) {
    giftCat = cat;
    document.querySelectorAll('#cardsTabs .cards-tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.cat === cat); });
    renderCards();
  }

  // ── Category items (second-hand) ──
  function renderCatItems() {
    var grid = $('catItemsGrid'); if (!grid) return;
    var list = marketAllItems;
    if (marketSubFilter) list = marketAllItems.filter(function (it) { return String(it.cat || '').toLowerCase() === (marketParentId + '/' + marketSubFilter); });
    categoryItems = list;
    if (!list.length) {
      grid.innerHTML = '<div class="cards-empty" style="grid-column:1/-1"><iconify-icon icon="solar:box-minimalistic-linear" width="34"></iconify-icon><div class="t">Aucun article pour le moment.</div><div class="s">Sois le premier à proposer un article dans cette catégorie.</div></div>';
      return;
    }
    grid.innerHTML = list.map(function (it) {
      var img = itemPhotos(it)[0] || '';
      return '<button class="gift-card" type="button" data-item="' + esc(it.id) + '">' +
        '<div class="gift-card__art">' +
          (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : ico('solar:box-linear', 48)) + '</div>' +
        '<div class="gift-card__name">' + esc(it.name || '') + '</div>' +
        '<div class="gift-card__price">' + (it.price ? fmt(it.price) + ' XOF' : '') + '</div></button>';
    }).join('');
  }
  function setSubcat(slug) {
    marketSubFilter = slug;
    document.querySelectorAll('#catSubTabs .cards-tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.slug === slug); });
    renderCatItems();
  }
  function openCategory(catId) {
    if (catId === 'cards') { showView('cards'); if (!giftCards.length) loadGiftCards(); return; }
    if (catId === 'shop') { showView('shop'); renderShop(); return; }
    $('catTitle').textContent = MARKET_TITLES[catId] || 'Catégorie';
    $('catIntro').textContent = "Catalogue d'articles d'occasion en Côte d'Ivoire.";
    marketParentId = catId; marketSubFilter = ''; marketAllItems = [];
    var subs = MARKET_SUBCATS[catId] || [];
    $('catSubTabs').innerHTML = ['<button class="cards-tab is-active" type="button" data-slug="">Tout</button>']
      .concat(subs.map(function (s) { return '<button class="cards-tab" type="button" data-slug="' + s.slug + '">' + esc(s.label) + '</button>'; })).join('');
    renderCatItems();
    showView('category');
    fetch(BB.apiBase() + '/api/market/items?category=' + encodeURIComponent(catId), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { marketAllItems = (d && Array.isArray(d.items)) ? d.items : []; renderCatItems(); })
      .catch(function () { renderCatItems(); });
  }

  // ── Detail modal ──
  function selectCardDenom(idx) {
    if (!selectedCard || !selectedCard.items || !selectedCard.items[idx]) return;
    selectedDenom = selectedCard.items[idx];
    var pr = $('itemPrice'); if (pr) pr.textContent = fmt(selectedDenom.prixClientXOF) + ' XOF';
    document.querySelectorAll('#cardDenoms .card-denom').forEach(function (el, i) { el.classList.toggle('is-active', i === idx); });
  }
  window.__selectCardDenom = selectCardDenom;
  // Galerie d'un article : `photos` (jusqu'à 3) avec repli sur l'ancien champ `photo`.
  // Dédoublonne car le serveur renvoie photo === photos[0].
  function itemPhotos(it) {
    var raw = Array.isArray(it.photos) ? it.photos.slice() : [];
    if (it.photo) raw.unshift(it.photo);
    var out = [];
    raw.forEach(function (p) {
      if (!p) return;
      var u = (String(p).indexOf('data:') === 0) ? String(p) : absUrl(String(p));
      if (out.indexOf(u) === -1) out.push(u);
    });
    return out.slice(0, 3);
  }
  var CAT_LABELS = (function () {
    var m = { bazar: 'Bazar', electronics: 'Appareil électronique', books: 'Livre' };
    Object.keys(MARKET_SUBCATS).forEach(function (p) {
      MARKET_SUBCATS[p].forEach(function (s) { m[s.slug] = s.label; });
    });
    return m;
  })();
  function catLabelOf(cat) {
    return String(cat || '').split('/').filter(Boolean)
      .map(function (s) { return CAT_LABELS[s] || s; }).join(' · ');
  }
  function setThumbActive(i) {
    var thumbs = $('itemThumbs'); if (!thumbs) return;
    Array.prototype.forEach.call(thumbs.children, function (t, k) { t.classList.toggle('is-active', k === i); });
    var counter = $('itemPhotoCount');
    if (counter && counter.style.display !== 'none') counter.textContent = (i + 1) + '/' + thumbs.children.length;
  }
  function showPhoto(i) {
    var art = $('itemArt'); if (!art || !art.children[i]) return;
    art.scrollTo({ left: art.children[i].offsetLeft - art.offsetLeft, behavior: 'smooth' });
    setThumbActive(i);
  }
  // Replie la description au-delà de 8 lignes, avec un bouton « Voir plus »
  function setItemDesc(txt) {
    var desc = $('itemDesc'), more = $('itemDescMore');
    if (!desc) return;
    desc.textContent = txt;
    desc.classList.remove('is-clamped');
    if (!more) return;
    more.style.display = 'none'; more.textContent = 'Voir plus';
    setTimeout(function () {
      desc.classList.add('is-clamped');
      if (desc.scrollHeight > desc.clientHeight + 4) more.style.display = '';
      else desc.classList.remove('is-clamped');
    }, 60);
  }
  // Repasse #itemArt en vignette simple (cartes cadeaux / boutique)
  function resetItemGallery() {
    var art = $('itemArt');
    if (art) { art.classList.remove('is-gallery'); art.onscroll = null; art.scrollLeft = 0; }
    var t = $('itemThumbs'); if (t) { t.style.display = 'none'; t.innerHTML = ''; }
    var c = $('itemPhotoCount'); if (c) c.style.display = 'none';
    var m = $('itemMeta'); if (m) { m.style.display = 'none'; m.innerHTML = ''; }
  }
  function openCardDetail(card) {
    selectedCard = card;
    resetItemGallery();
    selectedDenom = (card.items && card.items[0]) || null;
    var img = absUrl(card.img);
    $('itemArt').innerHTML = img ? '<img src="' + esc(img) + '" alt="">' : ico('solar:gift-linear', 60);
    $('itemName').textContent = card.name || '';
    $('itemPrice').textContent = fmt(selectedDenom ? selectedDenom.prixClientXOF : card.price) + ' XOF';
    // Sélecteur de montant (inséré sous le prix)
    var denomsHtml = (card.items && card.items.length)
      ? card.items.map(function (it, i) { return '<button type="button" class="card-denom' + (i === 0 ? ' is-active' : '') + '" onclick="__selectCardDenom(' + i + ')"><span>' + it.faceValue + ' ' + esc(it.faceCurrency || '') + '</span><small>' + fmt(it.prixClientXOF) + ' F</small></button>'; }).join('')
      : '';
    var denomsBox = $('cardDenoms');
    if (!denomsBox) { denomsBox = document.createElement('div'); denomsBox.id = 'cardDenoms'; denomsBox.className = 'card-denoms'; $('itemPrice').insertAdjacentElement('afterend', denomsBox); }
    denomsBox.innerHTML = denomsHtml; denomsBox.style.display = denomsHtml ? '' : 'none';
    setItemDesc('Choisis un montant. Après paiement validé, le code te sera livré dans tes commandes.');
    var act = $('itemAction');
    act.innerHTML = '<iconify-icon icon="solar:lock-keyhole-bold" width="18"></iconify-icon> Confirmer l\'achat';
    act.className = 'bb-cta bb-cta--block';
    setItemLegal(LEGAL_C2C);
    act.onclick = function () { confirmGiftCardPurchase(card); };
    $('itemModal').classList.add('is-open');
  }
  function openItemDetail(it) {
    var db = $('cardDenoms'); if (db) db.style.display = 'none';
    var photos = itemPhotos(it);
    var art = $('itemArt');
    art.classList.add('is-gallery');
    art.innerHTML = photos.length
      ? photos.map(function (u) { return '<div class="item-gallery__slide"><img src="' + esc(u) + '" alt="" loading="lazy"></div>'; }).join('')
      : '<div class="item-gallery__slide">' + ico('solar:box-linear', 60) + '</div>';
    art.scrollLeft = 0;
    art.onscroll = function () { setThumbActive(Math.round(art.scrollLeft / (art.clientWidth || 1))); };
    var thumbs = $('itemThumbs');
    thumbs.style.display = photos.length > 1 ? '' : 'none';
    thumbs.innerHTML = photos.length > 1
      ? photos.map(function (u, i) { return '<button type="button" class="item-gallery__thumb' + (i === 0 ? ' is-active' : '') + '" data-photo="' + i + '"><img src="' + esc(u) + '" alt=""></button>'; }).join('')
      : '';
    var counter = $('itemPhotoCount');
    counter.style.display = photos.length > 1 ? '' : 'none';
    counter.textContent = '1/' + photos.length;
    $('itemName').textContent = it.name || '';
    $('itemPrice').textContent = fmt(it.price) + ' XOF';
    var meta = $('itemMeta'), tags = [];
    var catLabel = catLabelOf(it.cat);
    if (catLabel) tags.push('<span>' + esc(catLabel) + '</span>');
    if (it.sellerName) tags.push('<span>' + esc(it.sellerName) + '</span>');
    if (it.createdAt) {
      var d = new Date(it.createdAt);
      if (!isNaN(d)) tags.push('<span>' + d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + '</span>');
    }
    meta.innerHTML = tags.join(''); meta.style.display = tags.length ? '' : 'none';
    setItemDesc((it.desc || '').trim() || 'Aucune description fournie.');
    var phone = (it.phone || '').replace(/\D/g, '');
    if (phone.length === 10 && phone.charAt(0) === '0') phone = '225' + phone;
    var href = phone ? ('https://wa.me/' + phone + '?text=' + encodeURIComponent('Bonjour, je suis intéressé(e) par votre article "' + (it.name || '') + '" sur Bipbip Market.')) : 'https://wa.me/2250152597408';
    var act = $('itemAction');
    act.innerHTML = '<iconify-icon icon="solar:chat-round-line-bold" width="18"></iconify-icon> Contacter le vendeur';
    act.className = 'bb-cta bb-cta--block';
    setItemLegal(LEGAL_C2C);
    act.onclick = function () { window.open(href, '_blank'); };
    $('itemModal').classList.add('is-open');
  }
  var LEGAL_C2C = "Transaction directe entre acheteur et vendeur pour les articles d'occasion. Bipbip n'intervient pas dans le paiement de l'article.";
  function setItemLegal(txt) { var el = $('itemLegal'); if (el) el.textContent = txt; }
  function closeItemModal() { $('itemModal').classList.remove('is-open'); }

  async function confirmGiftCardPurchase(card) {
    closeItemModal();
    if (!window.BBPay) { toast('Paiement indisponible.', 'error'); return; }
    var denom = selectedDenom || (card.items && card.items[0]) || { prixClientXOF: card.price, faceValue: card.value, faceCurrency: '' };
    var price = Number(denom.prixClientXOF) || 0;   // prix catalogue : marge +5% déjà incluse
    var faceLabel = (denom.faceValue != null ? denom.faceValue + ' ' + (denom.faceCurrency || '') : '').trim();
    await BBPay.startOrder({
      operator: 'CARTE_CADEAU', amount: price, amountTotal: price,
      phone: 'carte-' + (card.id || ''), type: 'giftcard', label: 'Carte cadeau ' + (card.name || ''),
      payload: {
        giftCard: (card.name || '') + ' ' + faceLabel,
        reloadlyProductId: card.reloadlyProductId || null,
        reloadlyFaceValue: denom.faceValue != null ? Number(denom.faceValue) : null,
        reloadlyRecipientCurrency: denom.faceCurrency || card.recipientCurrency || null
      },
      onDone: function () { if (window.BBRecharge && BBRecharge.renderOrders) BBRecharge.renderOrders(); }
    });
  }

  // ── My items ──
  function getMyItems() { try { return JSON.parse(localStorage.getItem('bb_my_items') || '[]'); } catch (e) { return []; } }
  function saveMyItems(items) { try { localStorage.setItem('bb_my_items', JSON.stringify(items)); } catch (e) {} }
  function myItemCandidateIds() {
    var u = BB.getCurrentUser(); if (!u) return [];
    var ids = []; function add(x) { x = x && String(x); if (x && ids.indexOf(x) < 0) ids.push(x); }
    var norm = BB.getRegisteredUserId();
    add(norm); add(u.tgId); add(u.id); if (norm) add('g_' + norm);
    return ids;
  }
  function renderMyItemsList(items) {
    var root = $('myItemsList'); if (!root) return;
    if (!items || !items.length) { root.innerHTML = '<p class="hint" style="margin:8px 0 0">Aucun article publié pour le moment.</p>'; return; }
    root.innerHTML = items.slice(0, 12).map(function (it) {
      var st = it.status || 'pending';
      var cls = (st === 'valide' || st === 'approved') ? 'approved' : (st === 'rejected' ? 'rejected' : 'pending');
      var label = ({ approved: 'En vente', rejected: 'Refusé', pending: 'En attente' })[cls];
      var photo = it.photo ? (it.photo.indexOf('data:') === 0 ? it.photo : absUrl(it.photo)) : '';
      return '<div class="my-item">' +
        '<div class="my-item__thumb"' + (photo ? ' style="background-image:url(\'' + esc(photo) + '\')"' : '') + '>' + (photo ? '' : esc((it.name || '?').charAt(0).toUpperCase())) + '</div>' +
        '<div style="flex:1;min-width:0"><div class="my-item__name">' + esc(it.name) + '</div><div class="my-item__meta">' + fmt(it.price) + ' F · ' + esc(it.cat || '') + '</div></div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="my-item__status ' + cls + '">' + label + '</span>' +
        '<button type="button" class="my-item__del" data-del="' + esc(it.id) + '">Supprimer</button></div></div>';
    }).join('');
  }
  async function renderMyItems() {
    renderMyItemsList(getMyItems());
    var ids = myItemCandidateIds(); if (!ids.length) return;
    var all = {};
    for (var i = 0; i < ids.length; i++) {
      try {
        var r = await fetch(BB.apiBase() + '/api/market/items/mine?userId=' + encodeURIComponent(ids[i]), { headers: BB.apiHeaders(), cache: 'no-store' });
        var d = await r.json().catch(function () { return null; });
        if (d && Array.isArray(d.items)) d.items.forEach(function (it) { all[it.id] = it; });
      } catch (e) {}
    }
    var merged = Object.keys(all).map(function (k) { return all[k]; });
    if (merged.length) { saveMyItems(merged); renderMyItemsList(merged); }
  }
  async function deleteMyItem(id) {
    if (!confirm('Supprimer cet article ?')) return;
    var items = getMyItems().filter(function (x) { return x.id !== id; });
    saveMyItems(items); renderMyItemsList(items);
    var ids = myItemCandidateIds();
    for (var i = 0; i < ids.length; i++) {
      try { var r = await fetch(BB.apiBase() + '/api/market/items/' + encodeURIComponent(id) + '?userId=' + encodeURIComponent(ids[i]), { method: 'DELETE', headers: BB.apiHeaders() }); if (r && r.ok) break; } catch (e) {}
    }
    toast('Article supprimé ✓', 'success');
  }

  // ── Add item ──
  function openAddItem() {
    if (!BB.getCurrentUser()) { toast('Connecte-toi (Google) pour publier un article.', 'error'); setTimeout(function () { location.href = '/site/profil.html'; }, 1200); return; }
    $('addItemModal').classList.add('is-open');
  }
  function closeAddItem() { $('addItemModal').classList.remove('is-open'); }
  function updatePhotoSlot(idx) {
    var slot = document.querySelector('.item-photo-slot[data-slot="' + idx + '"]'); if (!slot) return;
    var data = newItemPhotos[idx];
    if (data) { slot.classList.add('has-img'); slot.innerHTML = '<img src="' + data + '" alt=""><button type="button" class="rm" data-rmphoto="' + idx + '">✕</button>'; }
    else { slot.classList.remove('has-img'); slot.innerHTML = ico('solar:camera-add-linear', 26) + '<span>Image ' + (idx + 1) + '</span>'; }
  }
  function handleImageUpload(ev, idx) {
    var f = ev.target.files && ev.target.files[0]; var statusEl = $('newItemUploadStatus');
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { if (statusEl) statusEl.textContent = '⚠ Image ' + (idx + 1) + ' trop volumineuse (5 Mo max)'; return; }
    if (statusEl) statusEl.textContent = 'Traitement image ' + (idx + 1) + '…';
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var SIZE = 1000, c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
        var ctx = c.getContext('2d'); ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, SIZE, SIZE);
        var scale = Math.max(SIZE / img.width, SIZE / img.height), w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        newItemPhotos[idx] = c.toDataURL('image/jpeg', 0.82);
        updatePhotoSlot(idx);
        if (statusEl) statusEl.textContent = '✓ Image ' + (idx + 1) + ' prête (1000×1000)';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(f);
  }
  async function submitAddItem() {
    var u = BB.getCurrentUser(); var status = $('addItemStatus');
    if (!u) { status.className = 'hint is-error'; status.style.display = ''; status.textContent = '⚠ Connecte-toi (Google) pour publier.'; return; }
    var myCount = getMyItems().length, paidQuota = 0;
    try { paidQuota = parseInt(localStorage.getItem('bb_item_quota') || '0', 10) || 0; } catch (e) {}
    if (myCount >= (FREE_ITEMS_LIMIT + paidQuota)) { showLimitModal(); return; }
    var photos = newItemPhotos.filter(Boolean);
    var item = {
      id: 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      cat: $('newItemCat').value, name: $('newItemName').value, desc: $('newItemDesc').value,
      price: parseInt($('newItemPrice').value, 10) || 0, photo: photos[0] || '', photos: photos,
      phone: $('newItemPhone').value, sellerId: (BB.getRegisteredUserId() || u.tgId || u.id), sellerName: u.name,
      status: 'pending', createdAt: Date.now()
    };
    if (!item.cat || !item.name || !item.desc || !item.price || !item.phone) {
      status.className = 'hint is-error'; status.style.display = ''; status.textContent = '⚠ Tous les champs sont obligatoires (+ au moins 1 photo conseillée).'; return;
    }
    var items = getMyItems(); items.unshift(item); saveMyItems(items);
    var serverOk = false;
    try {
      var payload = Object.assign({}, item, BB.userPayloadFields());
      var r = await fetch(BB.apiBase() + '/api/market/items', { method: 'POST', headers: BB.apiHeaders(), body: JSON.stringify(payload) });
      var data = await r.json().catch(function () { return null; });
      serverOk = r.ok && data && data.ok;
    } catch (e) {}
    status.className = 'hint is-ok'; status.style.display = '';
    status.textContent = serverOk ? '✓ Article envoyé à l\'admin pour validation.' : '✓ Article enregistré localement (envoi serveur indisponible).';
    $('addItemForm').reset();
    newItemPhotos = [null, null, null]; [0, 1, 2].forEach(updatePhotoSlot);
    renderMyItems();
    setTimeout(closeAddItem, 1600);
  }
  // ── Aide IA à la rédaction de la description ──
  var aiPrevDesc = null;
  function aiStatus(msg, kind) {
    var el = $('aiItemStatus'); if (!el) return;
    el.className = 'ai-status' + (kind ? ' is-' + kind : '');
    el.innerHTML = msg || '';
    el.style.display = msg ? '' : 'none';
  }
  function aiBusy(busy, activeId) {
    ['aiItemGenerate', 'aiItemImprove'].forEach(function (id) {
      var b = $(id); if (!b) return;
      b.disabled = busy;
      b.classList.toggle('is-busy', busy && id === activeId);
    });
  }
  window.__aiUndoDesc = function () {
    var ta = $('newItemDesc');
    if (!ta || aiPrevDesc == null) return;
    ta.value = aiPrevDesc; aiPrevDesc = null;
    aiStatus('Texte précédent restauré.', '');
  };
  async function aiWriteDesc(mode) {
    var ta = $('newItemDesc'); if (!ta) return;
    var name = ($('newItemName') || {}).value || '';
    var current = ta.value.trim();
    if (mode === 'improve' && current.length < 15) {
      aiStatus('✏️ Écris d\'abord quelques mots, l\'IA les améliorera ensuite.', 'error'); return;
    }
    if (mode === 'generate' && !name.trim()) {
      aiStatus('✏️ Renseigne le nom de l\'article au-dessus pour que l\'IA puisse rédiger.', 'error'); return;
    }
    aiBusy(true, mode === 'improve' ? 'aiItemImprove' : 'aiItemGenerate');
    aiStatus(mode === 'improve' ? 'Amélioration en cours…' : 'Rédaction en cours…', '');
    try {
      var payload = Object.assign({
        mode: mode, name: name,
        cat: ($('newItemCat') || {}).value || '',
        price: parseInt(($('newItemPrice') || {}).value, 10) || 0,
        current: current
      }, BB.userPayloadFields());
      var r = await fetch(BB.apiBase() + '/api/ai/item-description', {
        method: 'POST', headers: BB.apiHeaders(), body: JSON.stringify(payload)
      });
      var d = await r.json().catch(function () { return null; });
      if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || 'Service indisponible (HTTP ' + r.status + ').');
      aiPrevDesc = ta.value;
      ta.value = d.text;
      aiStatus('✓ Proposition de l\'IA — relis et corrige avant de publier.' +
        '<button type="button" class="ai-undo" onclick="__aiUndoDesc()">Annuler</button>', 'ok');
    } catch (e) {
      aiStatus('⚠ ' + (e.message || 'Erreur inconnue'), 'error');
    } finally { aiBusy(false); }
  }

  function showLimitModal() {
    var m = $('itemLimitModal'); if (m) m.classList.add('is-open');
  }
  async function payItemPack() {
    $('itemLimitModal').classList.remove('is-open');
    if (!window.BBPay) return;
    var ok = await BBPay.startOrder({ operator: 'PACK_ARTICLES', amount: EXTRA_PACK_PRICE, type: 'pack_articles', label: 'Pack +3 articles Market', payload: { meta: { quota: 3 } } });
    if (ok) { try { var q = parseInt(localStorage.getItem('bb_item_quota') || '0', 10) || 0; localStorage.setItem('bb_item_quota', String(q + 3)); } catch (e) {} }
  }

  // ── Wiring ──
  function boot() {
    if (!$('marketGrid')) return;
    renderMarket();
    $('marketGrid').addEventListener('click', function (e) { var c = e.target.closest('.market-parent'); if (c) openCategory(c.dataset.id); });
    $('cardsTabs').addEventListener('click', function (e) { var b = e.target.closest('.cards-tab'); if (b) setGiftCat(b.dataset.cat); });
    $('cardsGrid').addEventListener('click', function (e) { var c = e.target.closest('[data-card]'); if (c) { var card = giftCards.find(function (x) { return String(x.id) === c.dataset.card; }); if (card) openCardDetail(card); } });
    var shopGrid = $('shopGrid');
    if (shopGrid) shopGrid.addEventListener('click', function (e) { var c = e.target.closest('[data-shop]'); if (c) { var p = shopProducts.find(function (x) { return String(x.id) === c.dataset.shop; }); if (p) openShopDetail(p); } });
    $('catSubTabs').addEventListener('click', function (e) { var b = e.target.closest('.cards-tab'); if (b) setSubcat(b.dataset.slug); });
    $('catItemsGrid').addEventListener('click', function (e) { var c = e.target.closest('[data-item]'); if (c) { var it = categoryItems.find(function (x) { return String(x.id) === c.dataset.item; }); if (it) openItemDetail(it); } });
    document.querySelectorAll('[data-market-back]').forEach(function (b) { b.addEventListener('click', function () { showView('home'); }); });

    // detail modal
    document.querySelectorAll('[data-close="item"]').forEach(function (b) { b.addEventListener('click', closeItemModal); });
    $('itemThumbs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-photo]'); if (t) showPhoto(parseInt(t.dataset.photo, 10) || 0);
    });
    $('itemDescMore').addEventListener('click', function () {
      var desc = $('itemDesc');
      this.textContent = desc.classList.toggle('is-clamped') ? 'Voir plus' : 'Voir moins';
    });

    // my items / add item
    var addBtn = $('openAddItemBtn'); if (addBtn) addBtn.addEventListener('click', openAddItem);
    $('myItemsList').addEventListener('click', function (e) { var d = e.target.closest('[data-del]'); if (d) deleteMyItem(d.dataset.del); });
    document.querySelectorAll('[data-close="additem"]').forEach(function (b) { b.addEventListener('click', closeAddItem); });
    $('addItemForm').addEventListener('submit', function (e) { e.preventDefault(); submitAddItem(); });
    [0, 1, 2].forEach(function (idx) {
      var slot = document.querySelector('.item-photo-slot[data-slot="' + idx + '"]');
      if (slot) slot.addEventListener('click', function (e) { if (e.target.closest('[data-rmphoto]')) return; $('newItemFile' + idx).click(); });
      var inp = $('newItemFile' + idx); if (inp) inp.addEventListener('change', function (ev) { handleImageUpload(ev, idx); });
    });
    document.addEventListener('click', function (e) { var r = e.target.closest('[data-rmphoto]'); if (r) { e.stopPropagation(); var i = parseInt(r.dataset.rmphoto, 10); newItemPhotos[i] = null; var f = $('newItemFile' + i); if (f) f.value = ''; updatePhotoSlot(i); } });
    $('payPackBtn').addEventListener('click', payItemPack);

    // Aide IA : boutons + masquage si le serveur n'a pas de clé configurée
    var aiBox = $('aiItemAssist');
    if (aiBox) {
      aiBox.addEventListener('click', function (e) {
        var b = e.target.closest('[data-ai]'); if (b) aiWriteDesc(b.dataset.ai);
      });
      fetch(BB.apiBase() + '/api/ai/health', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (!d || !d.enabled) aiBox.style.display = 'none'; })
        .catch(function () {});
    }
    document.querySelectorAll('[data-close="limit"]').forEach(function (b) { b.addEventListener('click', function () { $('itemLimitModal').classList.remove('is-open'); }); });

    // API-ready
    (function ready() { if (window.BipbipAPI && window.BB) { renderMyItems(); loadShopProducts(); } else setTimeout(ready, 120); })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.BBMarket = { renderMyItems: renderMyItems, loadShopProducts: loadShopProducts };
})();
