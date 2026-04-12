// ==================== CONFIG ====================
// Base URL de l'API (même origine que la page pour éviter "erreur réseau" en Mini App Telegram)
const API_BASE = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';

function isBipbipLite() {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('bipbip-lite');
}
function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

const CONFIG = {
    FRAIS_PERCENT: 10,
    ADMIN_ID: '6735995998',
    /** Préfixes numéros CI (aligné server.js USSD) */
    OPERATORS: {
        MTN: { prefixes: ['05', '06'], icon: '📲', color: '#ffcc00' },
        Orange: { prefixes: ['07', '08', '09'], icon: '📶', color: '#ff6600' },
        Moov: { prefixes: ['01', '02'], icon: '📡', color: '#0066cc' }
    },
    AMOUNTS: [500, 1000, 2000, 5000, 10000, 15000, 20000, 25000]
};

// Config serveur (MoMo activé, numéro marchand, bandeau LED, bannières pub)
let serverConfig = {
    momoEnabled: false,
    mtnMerchantPhone: null,
    ledScrollSeconds: 60,
    pubBanners: null,
    djamoPayUrl: null,
    telegramWalletUrl: null,
    cryptoDepositAddress: null,
    cryptoDepositNetwork: null,
    cryptoFcfaPerUsdt: null,
    telegramBotUsername: null,
    twaReturnUrl: null,
    tonConnectManifestUrl: null
};
var __tonConnectUi = null;
/** Onglet paiement actif : djamo | momo | ton (UX type StickerStreet) */
var bipbipPayTab = 'djamo';

// En-têtes API avec initData Telegram pour validation côté serveur (sécurité comme v2)
function getApiHeaders(extra) {
    var h = { 'Content-Type': 'application/json' };
    if (tg && tg.initData) h['X-Telegram-Init-Data'] = tg.initData;
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
}

// ==================== STATE ====================
let currentOrder = {
    id: null,
    operator: null,
    amount: null,
    amountTotal: null,
    phone: null,
    proof: null,
    status: 'pending',
    createdAt: null,
    paymentMethod: null
};

let orders = JSON.parse(localStorage.getItem('bipbip_orders') || '[]');
/** Brouillon recharge (opérateur + montant) — survit à un rechargement de la Mini App */
var ORDER_DRAFT_KEY = 'bipbip_order_draft';

// ID navigateur persistant pour les utilisateurs hors Telegram
function getBrowserUserId() {
    try {
        var id = localStorage.getItem('bipbip_browser_uid');
        if (!id) {
            id = 'web_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
            localStorage.setItem('bipbip_browser_uid', id);
        }
        return id;
    } catch (e) {
        return null;
    }
}
let currentScreen = 'home';
let momoReferenceId = null;
let userPoints = parseInt(localStorage.getItem('bipbip_points') || '0', 10);
var lastAnnonceId = null;
var lastAnnoncePrix = null;
var annoncePaymentRef = null;

// Bannières pub par défaut (tant que /api/config n’a pas répondu ou si le tableau serveur est vide côté config — le serveur renvoie toujours une liste)
var DEFAULT_PUB_BANNERS = [
    { text: 'Recharge ton crédit en ligne sur Bipbip Recharge CI.', image: '/img/recharge-banner.jpg', url: 'https://bipbiprecharge.ci', placement: 'home1', scrollSpeed: 5 },
    { text: 'Service 24/7 — MTN, Orange, Moov en quelques secondes.', image: '/img/recharge-banner-2.jpg', url: 'https://bipbiprecharge.ci', placement: 'home2', scrollSpeed: 5 },
    { text: 'Gagne du temps : recharge directement depuis Bipbip Recharge CI.', image: '/img/recharge-banner-3.jpg', url: 'https://bipbiprecharge.ci', placement: 'actualites', scrollSpeed: 5 }
];
var pubBannerInterval = null;

var PUB_PLACEMENT_LABELS = {
    home1: 'Accueil — bannière 1 (sous le bandeau LED)',
    home2: 'Accueil — bannière 2 (sous la bannière 1)',
    actualites: 'Actualités — bandeau publicitaire'
};

function getPubBannerList() {
    if (Array.isArray(serverConfig.pubBanners) && serverConfig.pubBanners.length > 0) return serverConfig.pubBanners;
    return DEFAULT_PUB_BANNERS.slice();
}

function findBannerByPlacement(placement) {
    var list = getPubBannerList();
    for (var i = 0; i < list.length; i++) {
        var p = list[i].placement || 'actualites';
        if (p === placement) return list[i];
    }
    return null;
}

/** Durée d’animation (secondes) : scrollSpeed 1 = lent, 10 = rapide (ancien scrollSeconds encore pris en charge). */
function pubMarqueeDurationSec(banner) {
    if (!banner) return 45;
    var sp = parseInt(banner.scrollSpeed, 10);
    if (Number.isFinite(sp) && sp >= 1 && sp <= 10) {
        return Math.min(120, Math.max(6, Math.round(118 - (sp - 1) * (112 / 9))));
    }
    var leg = parseInt(banner.scrollSeconds, 10);
    if (Number.isFinite(leg)) return Math.min(180, Math.max(6, leg));
    return 45;
}

function adminBannerScrollSpeedUi(b) {
    var sp = parseInt(b && b.scrollSpeed, 10);
    if (Number.isFinite(sp) && sp >= 1 && sp <= 10) return sp;
    var dur = parseInt(b && b.scrollSeconds, 10);
    if (Number.isFinite(dur)) {
        var d = Math.min(180, Math.max(8, dur));
        return Math.min(10, Math.max(1, Math.round(10 - ((d - 8) / 172) * 9)));
    }
    return 5;
}

// ==================== TELEGRAM WEBAPP ====================
let tg = window.Telegram?.WebApp;

function initTelegram() {
    if (tg) {
        // bipbip-telegram.js gère ready(), expand(), couleurs, safe areas, back button, haptic, thème
        console.log('Telegram WebApp initialisé', tg.initDataUnsafe);
        
        if (tg.initData) {
            registerTelegramUser();
        } else {
            setTimeout(function () { if (tg && tg.initData) registerTelegramUser(); }, 800);
            setTimeout(function () { if (tg && tg.initData) registerTelegramUser(); }, 2000);
        }
    }
}

function registerTelegramUser() {
    if (!tg || !tg.initData) return;
    var startParam = (tg.initDataUnsafe && tg.initDataUnsafe.start_param) ? String(tg.initDataUnsafe.start_param) : '';
    if (startParam && !startParam.startsWith('ref_')) startParam = 'ref_' + startParam;
    console.log('[Bipbip] Inscription auto — envoi POST /api/telegram/register', startParam ? '(parrain: ' + startParam + ')' : '');
    fetch(API_BASE + '/api/telegram/register', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify(startParam ? { referral_code: startParam } : {})
    })
    .then(function (res) {
        return res.json().then(function (data) {
            if (data.ok && data.user) {
                window.__bipbipRegisteredUser = data.user;
                if (typeof data.user.points === 'number' || (data.user.points != null)) {
                    userPoints = Number(data.user.points);
                    try { localStorage.setItem('bipbip_points', String(userPoints)); } catch (e) {}
                }
                console.log('[Bipbip] Utilisateur enregistré:', data.user.telegram_id, data.user.photo_url ? '(avec photo)' : '');
                updateProfilPhoto();
                updateHeaderUserInfo();
                updateHeaderPoints();
                updateProfilPoints();
            } else {
                console.warn('[Bipbip] Register réponse:', res.status, data.error || data.code || data);
            }
            return data;
        }).catch(function () {
            console.warn('[Bipbip] Register réponse non-JSON:', res.status);
        });
    })
    .catch(function (err) {
        console.warn('[Bipbip] Register erreur réseau:', err);
    });
}

// ==================== POINTS & PROFIL ====================
function updateHeaderPoints() {
    var el = document.getElementById('header-points');
    if (el) el.textContent = userPoints;
}

function updateProfilPoints() {
    var el = document.getElementById('profil-points-totale');
    if (el) el.textContent = userPoints;
}

function saveSocialLink() {
    var input = document.getElementById('profil-social-link');
    var link = input ? input.value.trim() : '';
    if (!tg || !tg.initData) {
        showToast('Connexion Telegram requise', 'error');
        return;
    }
    fetch(API_BASE + '/api/telegram/profile', {
        method: 'PATCH',
        headers: getApiHeaders(),
        body: JSON.stringify({ social_link: link || null })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (data.ok && data.user) {
            window.__bipbipRegisteredUser = window.__bipbipRegisteredUser || {};
            window.__bipbipRegisteredUser.social_link = data.user.social_link || '';
            showToast('Lien enregistré', 'success');
        } else {
            showToast(data.error || 'Erreur', 'error');
        }
    })
    .catch(function () {
        showToast('Erreur réseau', 'error');
    });
}

function requestPromoLikes() {
    var input = document.getElementById('profil-social-link');
    var link = input ? input.value.trim() : '';
    if (!link) {
        showToast('Ajoutez d\'abord votre lien YouTube, X ou Telegram', 'error');
        return;
    }
    if (!tg || !tg.initData) {
        showToast('Connexion Telegram requise', 'error');
        return;
    }
    var select = document.getElementById('profil-promo-formule');
    var amount = 150;
    var durationDays = 4;
    if (select && select.options[select.selectedIndex]) {
        var opt = select.options[select.selectedIndex];
        amount = parseInt(opt.value, 10) || 150;
        durationDays = parseInt(opt.getAttribute('data-days'), 10) || 4;
    }
    fetch(API_BASE + '/api/telegram/promo-likes', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({ social_link: link, amount: amount, duration_days: durationDays })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (data.success && data.order) {
            var orderAmount = data.order.amount || 150;
            showToast('Demande créée — ' + orderAmount + ' F. Choisissez votre mode de paiement.', 'success');
            currentOrder = {
                id: data.order.id,
                operator: data.order.operator || 'PROMO_LIKES',
                amount: orderAmount,
                amountTotal: orderAmount,
                phone: '',
                proof: null,
                status: 'pending',
                createdAt: data.order.createdAt,
                paymentMethod: null
            };
            goToPaymentMethodScreen();
        } else {
            showToast(data.error || 'Erreur', 'error');
        }
    })
    .catch(function () {
        showToast('Erreur réseau', 'error');
    });
}

function getDisplayUserId() {
    var user = window.__bipbipRegisteredUser;
    if (user && user.telegram_id) return String(user.telegram_id);
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) return String(tg.initDataUnsafe.user.id);
    return null;
}

function getDisplayUserName() {
    var user = window.__bipbipRegisteredUser;
    if (user) {
        var first = (user.first_name || '').trim();
        var last = (user.last_name || '').trim();
        var name = (first + ' ' + last).trim();
        if (name) return name;
        if (user.username) return '@' + user.username;
        if (user.telegram_id) return 'ID: ' + user.telegram_id;
    }
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        var u = tg.initDataUnsafe.user;
        var n = ((u.first_name || '') + ' ' + (u.last_name || '')).trim();
        if (n) return n;
        if (u.username) return '@' + u.username;
        if (u.id) return 'ID: ' + u.id;
    }
    return '—';
}

function fetchTelegramMe() {
    // Si connecté via Google, charger le profil Google à la place
    var gs = getGoogleSession();
    if (gs && !isInsideTelegram()) {
        initGoogleAuth();
        return;
    }
    if (!tg || !tg.initData) return;
    fetch(API_BASE + '/api/telegram/me', { method: 'GET', headers: getApiHeaders() })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.ok && data.user) {
                var incoming = data.user;
                var existing = window.__bipbipRegisteredUser;
                if (existing && existing.photo_url && !incoming.photo_url) {
                    incoming.photo_url = existing.photo_url;
                }
                window.__bipbipRegisteredUser = incoming;
                if (typeof incoming.points === 'number' || (incoming.points !== undefined && incoming.points !== null)) {
                    userPoints = Number(incoming.points);
                    try { localStorage.setItem('bipbip_points', String(userPoints)); } catch (e) {}
                }
                updateHeaderUserInfo();
                updateHeaderPoints();
                updateProfilPoints();
                updateProfilPhoto();
                var refInput = document.getElementById('profil-referral-link');
                if (refInput && incoming.referral_link) refInput.value = incoming.referral_link;
            }
        })
        .catch(function () {});
}

function setPlaceholderPhoto(container, isProfil) {
    if (isProfil) {
        container.innerHTML = '👤';
        container.classList.add('flex', 'items-center', 'justify-center', 'text-4xl', 'text-slate-400');
        container.classList.remove('overflow-hidden');
    } else {
        container.innerHTML = '👤';
        container.classList.remove('overflow-hidden');
    }
}

function loadAvatarInto(container, isProfil) {
    if (!container) return;

    // Google user : utiliser photo_url directement
    var user = window.__bipbipRegisteredUser;
    if (user && user.auth_type === 'google' && user.photo_url) {
        var img = document.createElement('img');
        img.alt = isProfil ? 'Photo profil' : '';
        img.className = isProfil ? 'w-full h-full rounded-full object-cover' : 'w-full h-full object-cover';
        img.referrerPolicy = 'no-referrer';
        img.onerror = function () { setPlaceholderPhoto(container, isProfil); };
        img.src = user.photo_url;
        container.innerHTML = '';
        container.classList.remove('flex', 'items-center', 'justify-center', 'text-4xl', 'text-slate-400');
        container.classList.add('overflow-hidden');
        container.appendChild(img);
        return;
    }

    if (!tg || !tg.initData) {
        setPlaceholderPhoto(container, isProfil);
        return;
    }
    setPlaceholderPhoto(container, isProfil);
    fetch(API_BASE + '/api/telegram/avatar', { method: 'GET', headers: getApiHeaders() })
        .then(function (res) {
            if (!res.ok) throw new Error();
            return res.blob();
        })
        .then(function (blob) {
            var url = URL.createObjectURL(blob);
            var img2 = document.createElement('img');
            img2.alt = isProfil ? 'Photo profil' : '';
            img2.className = isProfil ? 'w-full h-full rounded-full object-cover' : 'w-full h-full object-cover';
            img2.onload = function () { URL.revokeObjectURL(url); };
            img2.onerror = function () {
                URL.revokeObjectURL(url);
                setPlaceholderPhoto(container, isProfil);
            };
            img2.src = url;
            container.innerHTML = '';
            container.classList.remove('flex', 'items-center', 'justify-center', 'text-4xl', 'text-slate-400');
            container.classList.add('overflow-hidden');
            container.appendChild(img2);
        })
        .catch(function () { setPlaceholderPhoto(container, isProfil); });
}

function updateProfilPhoto() {
    var container = document.getElementById('profil-photo');
    var nameEl = document.getElementById('profil-user-name');
    var hintEl = document.getElementById('profil-telegram-hint');
    var logoutBtn = document.getElementById('btn-google-logout');
    var userName = getDisplayUserName();
    if (nameEl) nameEl.textContent = userName;

    var user = window.__bipbipRegisteredUser;
    var isTg = !!(tg && tg.initDataUnsafe && tg.initDataUnsafe.user);
    var isGoogle = !!(user && user.auth_type === 'google');

    if (hintEl) {
        hintEl.style.display = (user || isTg) ? '' : 'none';
        hintEl.textContent = isGoogle ? 'Connecté avec Google' : 'Connecté avec Telegram';
    }
    if (logoutBtn) logoutBtn.style.display = isGoogle ? '' : 'none';

    if (!container) return;
    if (user && (isGoogle || (tg && tg.initData))) {
        loadAvatarInto(container, true);
    } else {
        setPlaceholderPhoto(container, true);
    }
}

function updateHeaderUserInfo() {
    var nameEl = document.getElementById('header-user-name');
    var photoEl = document.getElementById('header-photo');
    if (nameEl) nameEl.textContent = getDisplayUserName();
    if (!photoEl) return;
    var user = window.__bipbipRegisteredUser;
    var isGoogle = !!(user && user.auth_type === 'google');
    if (user && (isGoogle || (tg && tg.initData))) {
        loadAvatarInto(photoEl, false);
    } else {
        setPlaceholderPhoto(photoEl, false);
    }
}

function showConvertBbrWipBlock() {
    var block = document.getElementById('convert-bbr-wip-block');
    if (block) {
        block.classList.remove('hidden');
        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {}
    }
}

function hideConvertBbrWipBlock() {
    var block = document.getElementById('convert-bbr-wip-block');
    if (block) block.classList.add('hidden');
}

var actualitesSort = 'all';

function initAnnonceCharCount() {
    var ta = document.getElementById('annonce-led-text');
    var span = document.getElementById('annonce-char-count');
    if (!ta || !span) return;
    function update() { span.textContent = (ta.value || '').length; }
    ta.addEventListener('input', update);
    update();
}

function publierAnnonceLed() {
    var textarea = document.getElementById('annonce-led-text');
    var select = document.getElementById('annonce-prix');
    var msg = textarea && textarea.value ? textarea.value.trim() : '';
    if (!msg) {
        showToast('Écrivez un message pour le bandeau LED (200 car. max)', 'error');
        return;
    }
    var prix = select ? parseInt(select.value, 10) : 150;
    var userId = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) ? String(tg.initDataUnsafe.user.id) : 'web';
    fetch(API_BASE + '/api/annonces', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({ userId: userId, contenu: msg, prix: prix })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (data.error) {
            showToast(data.error, 'error');
            return;
        }
        lastAnnonceId = data.annonce && data.annonce.id ? data.annonce.id : null;
        lastAnnoncePrix = prix;
        textarea.value = '';
        var span = document.getElementById('annonce-char-count');
        if (span) span.textContent = '0';
        showToast('Annonce créée — ' + prix + ' F. Choisissez votre mode de paiement.', 'success');
        fetch(API_BASE + '/api/annonces/' + encodeURIComponent(lastAnnonceId) + '/create-order', {
            method: 'POST',
            headers: getApiHeaders()
        })
        .then(function (r) { return r.json(); })
        .then(function (orderData) {
            if (orderData.success && orderData.order) {
                currentOrder = {
                    id: orderData.order.id,
                    operator: 'ANNONCE_LED',
                    amount: orderData.order.amount || prix,
                    amountTotal: orderData.order.amount || prix,
                    phone: '',
                    proof: null,
                    status: 'pending',
                    createdAt: orderData.order.createdAt,
                    paymentMethod: null
                };
                goToPaymentMethodScreen();
            } else {
                showToast(orderData.error || 'Erreur création commande', 'error');
            }
        })
        .catch(function () {
            showToast('Erreur réseau. Réessayez.', 'error');
        });
    })
    .catch(function () {
        showToast('Erreur réseau. Réessayez.', 'error');
    });
}

function requestAnnonceMomoPayment() {
    if (!lastAnnonceId) { showToast('Créez d\'abord une annonce', 'error'); return; }
    var phoneEl = document.getElementById('annonce-payment-phone');
    var phone = (phoneEl && phoneEl.value || '').replace(/\D/g, '');
    if (phone.length < 10) { showToast('Entrez un numéro MTN valide (10 chiffres)', 'error'); return; }
    var btn = document.getElementById('btn-annonce-momo-request');
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi...'; }
    fetch(API_BASE + '/api/annonces/' + encodeURIComponent(lastAnnonceId) + '/request-payment', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({ phone: phone, telegramChatId: (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) ? String(tg.initDataUnsafe.user.id) : null })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (btn) { btn.disabled = false; btn.textContent = 'Envoyer la demande MoMo'; }
        if (data.error) { showToast(data.error, 'error'); return; }
        annoncePaymentRef = data.referenceId;
        var waiting = document.getElementById('annonce-momo-waiting');
        if (waiting) waiting.classList.remove('hidden');
        showToast('Demande envoyée. Acceptez sur votre téléphone.', 'success');
    })
    .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Envoyer la demande MoMo'; }
        showToast('Erreur réseau.', 'error');
    });
}

function checkAnnonceMomoStatus() {
    if (!annoncePaymentRef) return;
    var btn = document.getElementById('btn-annonce-momo-check');
    var msgEl = document.getElementById('annonce-momo-status-msg');
    if (btn) { btn.disabled = true; btn.textContent = 'Vérification...'; }
    fetch(API_BASE + '/api/momo/poll-status/' + encodeURIComponent(annoncePaymentRef))
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (btn) { btn.disabled = false; btn.textContent = 'Vérifier le statut'; }
        if (!msgEl) return;
        msgEl.classList.remove('hidden');
        var tx = data.transaction;
        if (!tx) { msgEl.textContent = 'Référence introuvable.'; msgEl.className = 'rounded-xl p-3 text-sm text-center border border-white/15 text-slate-400'; return; }
        if (tx.status === 'SUCCESSFUL') {
            msgEl.className = 'rounded-xl p-3 text-sm text-center border border-emerald-500/30 text-emerald-400';
            msgEl.textContent = 'Paiement reçu. Votre annonce sera diffusée après validation par l\'admin.';
            document.getElementById('annonce-momo-waiting').classList.add('hidden');
            lastAnnonceId = null;
            annoncePaymentRef = null;
        } else if (tx.status === 'FAILED') {
            msgEl.className = 'rounded-xl p-3 text-sm text-center border border-red-500/30 text-red-400';
            msgEl.textContent = 'Paiement refusé ou expiré.';
        } else {
            msgEl.className = 'rounded-xl p-3 text-sm text-center border border-white/15 text-slate-400';
            msgEl.textContent = 'En attente sur votre téléphone...';
        }
    })
    .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Vérifier le statut'; }
        msgEl.classList.remove('hidden');
        msgEl.className = 'rounded-xl p-3 text-sm text-center border border-red-500/30 text-red-400';
        msgEl.textContent = 'Erreur réseau.';
    });
}

// ==================== ACTUALITÉS ====================
var CATEGORY_LABELS = {
    all:     '📰 Actualités IA',
    region:  '🏛️ Actualités du pays',
    finance: '💰 Finance — Crypto & Marchés',
    tech:    '🚀 Tech — Innovation',
    mode:    '🎤 Mode — Stars & Events'
};

function setActualitesSort(sort) {
    actualitesSort = sort;
    document.querySelectorAll('#screen-actualites .sort-btn').forEach(function (btn) {
        var isActive = btn.getAttribute('data-sort') === sort;
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('bg-white/10', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('bg-white/5', !isActive);
        btn.classList.toggle('text-slate-400', !isActive);
    });
    var titleEl = document.getElementById('actualites-section-title');
    if (titleEl) titleEl.innerHTML = '<iconify-icon icon="solar:document-text-linear" width="18"></iconify-icon> ' + (CATEGORY_LABELS[sort] || CATEGORY_LABELS.all);
    loadActualites(sort);
}

/** Défilement horizontal type bandeau LED (image dupliquée pour boucle) — sans cadre visible */
function renderPubBannerIntoContainer(container, banner) {
    if (!container) return;
    if (!banner || !banner.image) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    container.classList.remove('hidden');
    var dur = pubMarqueeDurationSec(banner);
    if (isBipbipLite()) dur = Math.min(120, Math.round(dur * 1.12));

    var imgEsc = escapeHtml(banner.image);
    var textUnder = (banner.text || '').trim();
    var url = (banner.url || '').trim();
    var open = function (e) {
        if (!url) return;
        e && e.preventDefault();
        try {
            if (window.tg && window.tg.openTelegramLink && /t\.me\//i.test(url)) window.tg.openTelegramLink(url);
            else window.open(url, '_blank');
        } catch (_) {}
    };

    container.innerHTML =
        '<div class="pub-marquee-root overflow-hidden bg-transparent border-0 shadow-none">' +
        '  <div class="pub-marquee-view overflow-hidden h-[4.5rem] sm:h-[5rem] flex items-center bg-transparent">' +
        '    <div class="pub-marquee-strip flex" style="--pub-dur:' + dur + 's">' +
        '      <div class="pub-marquee-seg flex items-center justify-center px-1 h-[4.5rem] sm:h-[5rem] flex-shrink-0">' +
        '        <img src="' + imgEsc + '" alt="" class="max-h-[4rem] sm:max-h-[4.5rem] w-auto max-w-[min(92vw,28rem)] object-contain select-none pointer-events-none" draggable="false" /></div>' +
        '      <div class="pub-marquee-seg flex items-center justify-center px-1 h-[4.5rem] sm:h-[5rem] flex-shrink-0" aria-hidden="true">' +
        '        <img src="' + imgEsc + '" alt="" class="max-h-[4rem] sm:max-h-[4.5rem] w-auto max-w-[min(92vw,28rem)] object-contain select-none pointer-events-none" draggable="false" /></div>' +
        '    </div>' +
        '  </div>' +
        (textUnder ? '<p class="text-[11px] text-slate-400/90 px-0 py-1 truncate">' + escapeHtml(textUnder) + '</p>' : '') +
        '  <span class="sr-only">Publicité</span>' +
        '</div>';

    var strip = container.querySelector('.pub-marquee-strip');
    if (strip && !prefersReducedMotion()) {
        strip.style.animation = 'none';
        void strip.offsetWidth;
        strip.style.animation = 'pub-marquee-scroll ' + dur + 's linear infinite';
    } else if (strip) {
        strip.style.transform = 'translateX(0)';
        strip.style.justifyContent = 'center';
    }

    var root = container.querySelector('.pub-marquee-root');
    if (root) {
        root.style.cursor = url ? 'pointer' : 'default';
        root.onclick = url ? open : null;
    }

    if (prefersReducedMotion()) {
        var segs = container.querySelectorAll('.pub-marquee-seg');
        if (segs.length > 1) segs[1].style.display = 'none';
        var s2 = container.querySelector('.pub-marquee-strip');
        if (s2) {
            s2.style.animation = 'none';
            s2.style.justifyContent = 'center';
        }
    }
}

function initHomePubBanners() {
    var b1 = findBannerByPlacement('home1');
    var b2 = findBannerByPlacement('home2');
    var el1 = document.getElementById('home-pub-slot-1');
    var el2 = document.getElementById('home-pub-slot-2');
    renderPubBannerIntoContainer(el1, b1);
    renderPubBannerIntoContainer(el2, b2);
    var wrap = document.getElementById('home-pub-banners-wrap');
    if (wrap) {
        var show1 = el1 && !el1.classList.contains('hidden');
        var show2 = el2 && !el2.classList.contains('hidden');
        wrap.classList.toggle('hidden', !show1 && !show2);
    }
}

function initPubBanner() {
    var container = document.getElementById('tendances-list');
    var section = document.getElementById('actualites-section-tendances');
    if (!container) return;

    if (pubBannerInterval) {
        clearInterval(pubBannerInterval);
        pubBannerInterval = null;
    }

    var b = findBannerByPlacement('actualites');
    if (!b || !b.image) {
        if (section) section.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    if (section) section.classList.remove('hidden');
    renderPubBannerIntoContainer(container, b);
}

function loadActualites(sort) {
    sort = sort || actualitesSort;
    var actualitesList = document.getElementById('actualites-list');
    var annoncesList = document.getElementById('annonces-list');
    if (!actualitesList) return;

    var apiUrl = API_BASE + '/api/actualites?limit=15&sort=date';
    if (sort && sort !== 'all') {
        apiUrl += '&category=' + encodeURIComponent(sort);
    }
    fetch(apiUrl)
        .then(function (res) { return res.json(); })
        .then(function (data) {
            var items = (data && data.actualites) ? data.actualites : [];
            if (items.length === 0) {
                actualitesList.innerHTML = '<div class="glass-panel rounded-xl p-5 border border-white/15"><p class="text-slate-400 text-sm">Aucune actualité pour le moment.</p></div>';
            } else {
                actualitesList.innerHTML = items.map(function (a) {
                    var date = a.published_at || a.created_at || '';
                    if (date) date = new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
                    return '<a href="#" onclick="openActualite(\'' + (a.slug || a.id) + '\'); return false;" class="block glass-panel rounded-xl p-4 border border-white/15 hover:bg-white/10 transition-colors">' +
                        '<h4 class="font-semibold text-white">' + escapeHtml(a.title || 'Sans titre') + '</h4>' +
                        (a.summary_short ? '<p class="text-sm text-slate-400 mt-1">' + escapeHtml(a.summary_short) + '</p>' : '') +
                        '<p class="text-xs text-slate-500 mt-2">' + date + '</p></a>';
                }).join('');
            }
        })
        .catch(function () {
            actualitesList.innerHTML = '<div class="glass-panel rounded-xl p-5 border border-white/15"><p class="text-slate-400 text-sm">Impossible de charger les actualités.</p></div>';
        });

    var sortAnnonces = (sort === 'popularite') ? 'date' : sort;
    fetch(API_BASE + '/api/annonces/valides?sort=' + encodeURIComponent(sortAnnonces))
        .then(function (res) { return res.json(); })
        .then(function (data) {
            var items = (data && data.annonces) ? data.annonces : [];
            if (!annoncesList) return;
            if (items.length === 0) {
                annoncesList.innerHTML = '<div class="glass-panel rounded-xl p-4 border border-white/15"><p class="text-slate-400 text-sm">Aucune annonce sponsorisée.</p></div>';
            } else {
                annoncesList.innerHTML = items.map(function (a) {
                    return '<div class="glass-panel rounded-xl p-4 border border-emerald-500/20 bg-emerald-500/5">' +
                        '<p class="text-sm text-white">' + escapeHtml(a.contenu || '') + '</p>' +
                        '<p class="text-xs text-slate-500 mt-2">' + (a.prix || 0) + ' F · ' + (a.position_actualite || '') + '</p></div>';
                }).join('');
            }
        })
        .catch(function () {
            if (annoncesList) annoncesList.innerHTML = '<div class="glass-panel rounded-xl p-4 border border-white/15"><p class="text-slate-400 text-sm">Impossible de charger les annonces.</p></div>';
        });

    initPubBanner();
}

function openActualite(slug) {
    fetch(API_BASE + '/api/actualites/slug/' + encodeURIComponent(slug))
        .then(function (res) { return res.json(); })
        .then(function (data) {
            var a = data && data.actualite;
            if (!a) { showToast('Article introuvable', 'error'); return; }
            var content = a.content || '';
            var sources = a.sources;
            try { if (typeof sources === 'string') sources = JSON.parse(sources); } catch (_) {}
            var sourceHtml = '';
            if (Array.isArray(sources) && sources.length) {
                sourceHtml = '<div class="mt-6 pt-4 border-t border-white/10"><p class="text-xs text-slate-500 mb-2">Sources</p><div class="flex flex-wrap gap-2">' +
                    sources.map(function (s) {
                        var label = escapeHtml(s.name || (s.url || 'Source'));
                        var tag = s.url
                            ? '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener" class="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30">' + label + '</a>'
                            : '<span class="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium bg-slate-500/20 text-slate-400 border border-slate-500/30">' + label + '</span>';
                        return tag;
                    }).join('') + '</div></div>';
            }
            var html = '<div class="glass-panel rounded-xl p-5 border border-white/15">' +
                '<h3 class="text-lg font-semibold text-white">' + escapeHtml(a.title || '') + '</h3>' +
                '<p class="text-slate-400 text-sm mt-2">' + (a.published_at ? new Date(a.published_at).toLocaleDateString('fr-FR') : '') + '</p>' +
                '<div class="prose prose-invert mt-4 text-slate-300 text-sm">' + escapeHtml(content).replace(/\n/g, '<br>') + '</div>' +
                sourceHtml +
                '<div class="mt-6"><button type="button" onclick="closeArticleOverlay()" class="flex items-center gap-2 py-2 px-4 rounded-xl border border-white/15 bg-white/10 text-white hover:bg-white/20 text-sm"><iconify-icon icon="solar:arrow-left-linear" width="16"></iconify-icon> Retour</button></div></div>';
            var overlay = document.getElementById('article-overlay');
            var contentEl = document.getElementById('article-overlay-content');
            if (contentEl) contentEl.innerHTML = html;
            if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('block'); }
        })
        .catch(function () { showToast('Erreur chargement article', 'error'); });
}

function closeArticleOverlay() {
    var overlay = document.getElementById('article-overlay');
    if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('block'); }
}

function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

// ==================== QUÊTES ====================
var DJAMO_PAY_URL = 'https://pay.djamo.com/pkbyg';

var dailyCheckinState = null;

function loadDailyCheckin() {
    var gridEl = document.getElementById('daily-checkin-grid');
    var streakEl = document.getElementById('daily-checkin-streak');
    var btnEl = document.getElementById('btn-daily-claim');
    if (!gridEl) return;
    fetch(API_BASE + '/api/telegram/daily-checkin', { headers: getApiHeaders() })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            dailyCheckinState = data;
            var rewards = (data && data.rewards) ? data.rewards : [5, 10, 15, 20, 25, 30, 50];
            if (streakEl) streakEl.textContent = (data && data.streak != null) ? data.streak + '/7' : '0/7';
            gridEl.innerHTML = rewards.map(function (pts, i) {
                var day = i + 1;
                var claimed = data && data.streak != null && day <= data.streak;
                var isNext = data && data.can_claim && data.next_streak === day;
                var cls = 'rounded-lg p-2 text-center text-xs border ';
                if (isNext) cls += 'border-amber-500/50 bg-amber-500/20 text-amber-400 font-semibold';
                else if (claimed) cls += 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
                else cls += 'border-white/15 bg-white/5 text-slate-500';
                return '<div class="' + cls + '"><span class="block font-bold">' + day + '</span><span>+' + pts + '</span></div>';
            }).join('');
            if (btnEl) {
                btnEl.disabled = !(data && data.can_claim);
                btnEl.textContent = data && data.can_claim ? 'RÉCLAMER (+' + (data.reward_today || 0) + ' pts)' : 'Déjà réclamé';
            }
        })
        .catch(function () {
            if (streakEl) streakEl.textContent = '0/7';
            if (btnEl) btnEl.disabled = true;
        });
}

function claimDailyCheckin() {
    var btnEl = document.getElementById('btn-daily-claim');
    if (btnEl) btnEl.disabled = true;
    fetch(API_BASE + '/api/telegram/daily-checkin/claim', { method: 'POST', headers: getApiHeaders() })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.success) {
                if (data.total_points != null) {
                    userPoints = data.total_points;
                    try { localStorage.setItem('bipbip_points', String(userPoints)); } catch (e) {}
                }
                updateHeaderPoints();
                loadDailyCheckin();
                /* Pas de toast : la mise à jour du bloc (série, bouton) suffit */
            } else {
                showToast(data.error || 'Impossible de réclamer', 'error');
                loadDailyCheckin();
            }
        })
        .catch(function () {
            showToast('Erreur réseau', 'error');
            if (btnEl) btnEl.disabled = false;
            loadDailyCheckin();
        });
}

function loadApprovedLinks() {
    var listEl = document.getElementById('approved-links-list');
    if (!listEl) return;
    var userId = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) ? String(tg.initDataUnsafe.user.id) : '';
    var url = API_BASE + '/api/quests/approved-links' + (userId ? '?userId=' + encodeURIComponent(userId) : '');
    fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
            var items = (data && data.approved_links) ? data.approved_links : [];
            var pointsPerClick = (data && data.points_per_click) ? data.points_per_click : 5;
            if (items.length === 0) {
                listEl.innerHTML = '';
                return;
            }
            listEl.innerHTML = items.map(function (item) {
                var clickUrl = API_BASE + '/api/quests/click-link/' + encodeURIComponent(item.id) + (userId ? '?userId=' + encodeURIComponent(userId) : '');
                var icon = item.icon || '🔗';
                var title = escapeHtml(item.label || 'Découvre ce lien');
                var desc = escapeHtml(item.desc || '');
                var by = item.by ? '<span class="text-slate-500 text-xs">par ' + escapeHtml(item.by) + '</span>' : '';
                if (item.already_clicked) {
                    return '<div class="glass-panel rounded-xl p-4 border border-white/15 flex items-center justify-between opacity-60">' +
                        '<div class="flex items-center gap-3 min-w-0"><span class="text-2xl flex-shrink-0">' + icon + '</span><div>' +
                        '<span class="font-medium text-white block">' + title + '</span>' +
                        (desc ? '<span class="text-slate-400 text-sm">' + desc + '</span>' : '') +
                        by + '</div></div>' +
                        '<span class="text-green-400 text-sm flex-shrink-0">✓ Fait</span></div>';
                }
                return '<a href="' + escapeHtml(clickUrl) + '" target="_blank" rel="noopener" class="flex items-center justify-between glass-panel rounded-xl p-4 border border-white/15 hover:bg-white/10 transition-colors">' +
                    '<div class="flex items-center gap-3 min-w-0"><span class="text-2xl flex-shrink-0">' + icon + '</span><div>' +
                    '<span class="font-medium text-white block">' + title + '</span>' +
                    (desc ? '<span class="text-slate-400 text-sm block">' + desc + '</span>' : '') +
                    '<span class="text-amber-400 text-sm">+' + pointsPerClick + ' pts</span>' +
                    by + '</div></div>' +
                    '<iconify-icon icon="solar:arrow-right-linear" width="20" class="text-slate-400 flex-shrink-0"></iconify-icon></a>';
            }).join('');
        })
        .catch(function () { listEl.innerHTML = ''; });
}

function getQuestMeta(type) {
    var meta = {
        referral:  { icon: '👥', action: 'quest_referral',  cta: 'Partager mon lien' },
        recharge:  { icon: '📲', action: 'quest_recharge',  cta: 'Faire une recharge' },
        annonce:   { icon: '📢', action: 'quest_annonce',   cta: 'Publier une annonce' },
        reading:   { icon: '📰', action: 'quest_reading',   cta: 'Lire les articles' }
    };
    return meta[type] || { icon: '🏆', action: '', cta: '' };
}

function handleQuestAction(type) {
    if (type === 'quest_referral') {
        var refLink = (window.__bipbipRegisteredUser && window.__bipbipRegisteredUser.referral_link) || '';
        if (!refLink) {
            var refInput = document.getElementById('profil-referral-link');
            refLink = refInput && refInput.value ? refInput.value : '';
        }
        if (!refLink) {
            showToast('Ouvre ton profil pour obtenir ton lien de parrainage', 'info');
            navigateTo('profil');
            return;
        }
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(refLink) + '&text=' + encodeURIComponent('🎁 Rejoins Bipbip Recharge CI et gagne 20 points offerts !\nRecharge ton crédit mobile et accumule des récompenses.'));
        } else if (navigator.share) {
            navigator.share({ title: 'Bipbip Recharge CI', text: 'Rejoins Bipbip Recharge CI et gagne des points !', url: refLink }).catch(function () {});
        } else {
            try { navigator.clipboard.writeText(refLink); showToast('Lien copié ! Partage-le à tes amis.', 'success'); } catch (e) { showToast('Copie le lien manuellement', 'info'); }
        }
    } else if (type === 'quest_recharge') {
        navigateTo('home');
    } else if (type === 'quest_annonce') {
        navigateTo('profil');
        setTimeout(function () {
            var section = document.getElementById('profil-annonce-section');
            if (section) section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
    } else if (type === 'quest_reading') {
        navigateTo('actualites');
    }
}

function loadQuests() {
    loadDailyCheckin();
    loadApprovedLinks();
    var container = document.getElementById('quests-list-container');
    if (!container) return;
    fetch(API_BASE + '/api/quests')
        .then(function (res) { return res.json(); })
        .then(function (data) {
            var items = (data && data.quests) ? data.quests : [];
            if (items.length === 0) {
                container.innerHTML = '<p class="text-slate-400 text-sm">Aucune quête disponible.</p>';
                return;
            }
            container.innerHTML = items.map(function (q) {
                var pts = q.points_reward || 0;
                var m = getQuestMeta(q.type);
                return '<div class="glass-panel rounded-xl p-4 border border-white/15 hover:bg-white/10 transition-colors cursor-pointer" onclick="handleQuestAction(\'' + escapeHtml(m.action) + '\')">' +
                    '<div class="flex items-center justify-between">' +
                    '<div class="flex items-center gap-3 min-w-0">' +
                    '<span class="text-2xl flex-shrink-0">' + m.icon + '</span>' +
                    '<div>' +
                    '<span class="font-medium text-white block">' + escapeHtml(q.titre || q.code || '') + '</span>' +
                    '<span class="text-slate-400 text-sm block">' + escapeHtml((q.description || '').slice(0, 50)) + (q.description && q.description.length > 50 ? '…' : '') + '</span>' +
                    '<span class="text-amber-400 text-sm block">+' + pts + ' pts</span>' +
                    '</div></div>' +
                    '<iconify-icon icon="solar:arrow-right-linear" width="20" class="text-slate-400 flex-shrink-0"></iconify-icon>' +
                    '</div>' +
                    (m.cta ? '<button class="mt-3 w-full py-2 rounded-lg text-sm font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors">' + escapeHtml(m.cta) + '</button>' : '') +
                    '</div>';
            }).join('');
        })
        .catch(function () {
            container.innerHTML = '<p class="text-slate-400 text-sm">Impossible de charger les quêtes.</p>';
        });
}

// ==================== LED BANDEAU ====================
function firstPhrase(text, maxLen) {
    if (!text || typeof text !== 'string') return '';
    var t = text.trim();
    var max = maxLen || 70;
    if (t.length <= max) return t;
    var i1 = t.indexOf('. ');
    var i2 = t.indexOf('! ');
    var i3 = t.indexOf('? ');
    var ends = [i1, i2, i3].filter(function (i) { return i > 0; });
    var end = ends.length ? Math.min.apply(null, ends) + 1 : max;
    return t.slice(0, end).trim();
}

function applyLedAnimation() {
    var el = document.getElementById('led-text');
    if (!el) return;
    if (prefersReducedMotion()) {
        el.style.animation = 'none';
        el.style.paddingLeft = '0';
        el.style.whiteSpace = 'normal';
        el.style.textAlign = 'center';
        return;
    }
    el.style.paddingLeft = '';
    el.style.whiteSpace = '';
    el.style.textAlign = '';
    // Durée = réglage admin (secondes pour un cycle)
    var duration = Math.min(300, Math.max(15, parseInt(serverConfig.ledScrollSeconds, 10) || 60));
    if (isBipbipLite()) duration = Math.min(300, Math.round(duration * 1.15));
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'led-scroll ' + duration + 's linear infinite';
}

function loadLedMessages() {
    var el = document.getElementById('led-text');
    if (!el) return;
    var welcome = 'Bienvenue sur Bipbip Recharge';
    var parts = [welcome];

    Promise.all([
        fetch(API_BASE + '/api/actualites?limit=8&sort=date').then(function (r) { return r.json(); }),
        fetch(API_BASE + '/api/led/messages').then(function (r) { return r.json(); })
    ])
    .then(function (results) {
        var actualites = (results[0] && results[0].actualites) ? results[0].actualites : [];
        var ledData = results[1] || {};
        var ledMessages = (ledData.messages || []).map(function (m) { return m.content || ''; }).filter(Boolean);

        actualites.forEach(function (a) {
            var phrase = firstPhrase(a.summary_short || a.content || a.title, 70);
            if (phrase) parts.push(phrase);
        });
        ledMessages.forEach(function (m) { if (m) parts.push(m); });

        el.textContent = parts.join('  ·  ') || welcome + ' — Rechargez en un clic';
        applyLedAnimation();
    })
    .catch(function () {
        el.textContent = welcome + ' — Rechargez en un clic';
        applyLedAnimation();
    });
}

// Météo accueil (bannière en haut de l'écran Home)
function loadHomeWeather() {
    var statusEl = document.getElementById('service-status-text');
    if (!statusEl) return;
    var baseText = 'Service disponible 24/7';
    var city = (typeof localStorage !== 'undefined' && localStorage.getItem('bipbip_weather_city')) || '';
    var url = API_BASE + '/api/weather' + (city ? ('?city=' + encodeURIComponent(city)) : '');
    fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (!data || !data.ok || data.fallback || !data.temp || data.temp === '--°C') {
                // On garde le texte par défaut si la météo n'est pas vraiment disponible
                statusEl.textContent = baseText;
                return;
            }
            var temp = (data.temp || '').replace('+', '');
            var condition = data.condition || '';
            var txt = baseText + ' · ' + temp;
            if (condition) txt += ' · ' + condition;
            statusEl.textContent = txt;
        })
        .catch(function () {
            statusEl.textContent = baseText;
        });
}

// ==================== NAVIGATION ====================
var SCREEN_SESSION_KEY = 'bipbip_last_screen';

function canRestoreScreen(screen) {
    var need = {
        amount: function () { return !!currentOrder.operator; },
        phone: function () { return !!currentOrder.operator && currentOrder.amount != null; },
        confirm: function () { return !!currentOrder.operator && !!currentOrder.phone && currentOrder.amount != null; },
        'payment-method': function () { return !!currentOrder.id; },
        'crypto-pay': function () {
            var pm = currentOrder.paymentMethod;
            return !!currentOrder.id && (pm === 'usdt' || pm === 'usdc' || pm === 'ton');
        },
        momo: function () { return !!currentOrder.id; },
        proof: function () { return !!currentOrder.id; },
        success: function () { return false; }
    };
    var fn = need[screen];
    if (typeof fn === 'function') return fn();
    return true;
}

function getRestorableScreen() {
    try {
        if (typeof sessionStorage === 'undefined') return 'home';
        var s = sessionStorage.getItem(SCREEN_SESSION_KEY);
        if (!s) return 'home';
        if (!document.getElementById('screen-' + s)) return 'home';
        return canRestoreScreen(s) ? s : 'home';
    } catch (e) {
        return 'home';
    }
}

function navigateTo(screen) {
    var target = screen;

    if (target === 'amount') {
        if (!currentOrder.operator) {
            var loA = typeof window.__bipbipLastOperator === 'string' ? window.__bipbipLastOperator : '';
            if (loA && CONFIG.OPERATORS[loA]) currentOrder.operator = loA;
        }
        if (!currentOrder.operator) {
            currentOrder = { id: null, operator: null, amount: null, amountTotal: null, phone: null, proof: null, status: 'pending', createdAt: null, paymentMethod: null };
            target = 'buy';
        }
    }

    if (target === 'phone') {
        if (!currentOrder.operator) {
            var loP = typeof window.__bipbipLastOperator === 'string' ? window.__bipbipLastOperator : '';
            if (loP && CONFIG.OPERATORS[loP]) currentOrder.operator = loP;
        }
        if (!currentOrder.operator) {
            showToast('Choisissez d’abord un opérateur', 'info');
            currentOrder = { id: null, operator: null, amount: null, amountTotal: null, phone: null, proof: null, status: 'pending', createdAt: null, paymentMethod: null };
            target = 'buy';
        } else if (currentOrder.amount == null) {
            target = 'amount';
        }
    }

    // Rediriger vers l'écran de connexion si l'utilisateur navigateur n'est pas authentifié
    if (target === 'profil' && !isInsideTelegram() && !getGoogleSession()) {
        target = 'login';
    }

    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
    });

    var targetScreen = document.getElementById('screen-' + target);
    if (targetScreen) {
        targetScreen.classList.add('active');
        currentScreen = target;
        if (typeof window.__bipbipTgUpdateBackButton === 'function') window.__bipbipTgUpdateBackButton(target);
        if (typeof window.__bipbipTgClosingGuard === 'function') window.__bipbipTgClosingGuard(target);
        if (typeof window.__bipbipHaptic === 'function') window.__bipbipHaptic('impact', 'light');
        if (target === 'status') renderOrdersList();
        if (target === 'cartes') renderGiftCards(gcCurrentCategory);
        if (target === 'home') {
            updateHeaderUserInfo();
            loadHomeWeather();
            initHomePubBanners();
        }
        if (target === 'profil') {
            fetchTelegramMe();
            updateProfilPoints();
            updateProfilPhoto();
            updateHeaderPoints();
            initAnnonceCharCount();
            var sl = document.getElementById('profil-social-link');
            if (sl) sl.value = (window.__bipbipRegisteredUser && window.__bipbipRegisteredUser.social_link) || '';
            var refInput = document.getElementById('profil-referral-link');
            if (refInput && window.__bipbipRegisteredUser && window.__bipbipRegisteredUser.referral_link) refInput.value = window.__bipbipRegisteredUser.referral_link;
            var wSel = document.getElementById('profil-weather-city');
            if (wSel && typeof localStorage !== 'undefined') {
                var storedCity = localStorage.getItem('bipbip_weather_city') || '';
                if (storedCity) wSel.value = storedCity;
            }
        }
        if (target === 'actualites') loadActualites(actualitesSort);
        if (target === 'quests') loadQuests();
        if (target === 'payment-method' && currentOrder.id) {
            var pmEl = document.getElementById('payment-method-order-id');
            if (pmEl) pmEl.textContent = 'Commande #' + currentOrder.id + ' — ' + formatNumber((currentOrder.amountTotal != null ? currentOrder.amountTotal : currentOrder.amount) || 0) + ' FCFA';
            applyPaymentMethodScreenFromConfig();
            var wblk = document.getElementById('wave-pay-block');
            var wbtn = document.getElementById('btn-wave-toggle');
            var wch = document.getElementById('icon-wave-chevron');
            if (wblk) wblk.classList.add('hidden');
            if (wbtn) wbtn.setAttribute('aria-expanded', 'false');
            if (wch) wch.classList.remove('rotate-180');
        }
        if (target === 'crypto-pay') {
            var totalC = (currentOrder.amountTotal != null ? currentOrder.amountTotal : currentOrder.amount) || 0;
            var cref = document.getElementById('crypto-pay-order-ref');
            if (cref && currentOrder.id) cref.textContent = 'Commande #' + currentOrder.id + ' — ' + formatNumber(totalC) + ' FCFA';
            var labelMap = { usdt: 'USDT', usdc: 'USDC', ton: 'TON' };
            var pm = currentOrder.paymentMethod || 'usdt';
            var al = document.getElementById('crypto-pay-asset-label');
            if (al) al.textContent = labelMap[pm] || 'Crypto';
            var netEl = document.getElementById('crypto-pay-network');
            if (netEl) netEl.textContent = serverConfig.cryptoDepositNetwork || '—';
            var memo = document.getElementById('crypto-pay-memo');
            if (memo && currentOrder.id) memo.textContent = '#' + currentOrder.id;
            var addrEl = document.getElementById('crypto-pay-address');
            var addr = serverConfig.cryptoDepositAddress || '';
            if (addrEl) addrEl.textContent = addr || '—';
            var qr = document.getElementById('crypto-pay-qr');
            if (qr) {
                if (addr) {
                    qr.src = API_BASE + '/api/qr?size=220&margin=2&data=' + encodeURIComponent(addr);
                    qr.classList.remove('hidden');
                } else {
                    qr.removeAttribute('src');
                    qr.classList.add('hidden');
                }
            }
            var est = document.getElementById('crypto-pay-estimate');
            var rate = serverConfig.cryptoFcfaPerUsdt;
            if (est && rate && totalC > 0) {
                est.textContent = 'Estimation indicative : ~' + (totalC / rate).toFixed(2) + ' USDT (≈ ' + rate + ' FCFA / USDT)';
                est.classList.remove('hidden');
            } else if (est) est.classList.add('hidden');
        }
        if (target === 'proof' && currentOrder.id) {
            var odEl = document.getElementById('order-id-display');
            if (odEl) odEl.textContent = 'Commande #' + currentOrder.id;
            syncProofScreenInstructions();
        }
        if (target === 'admin') {
            var speedVal = (serverConfig && serverConfig.ledScrollSeconds) ? serverConfig.ledScrollSeconds : 60;
            var speedInput = document.getElementById('admin-led-speed');
            var speedSpan = document.getElementById('admin-led-speed-value');
            if (speedInput) speedInput.value = speedVal;
            if (speedSpan) speedSpan.textContent = speedVal;
            renderAdminPubBanners();
        }
        if (target === 'amount' && currentOrder.operator) {
            renderAmountScreenOperatorBanner(currentOrder.operator);
        }
        if (target === 'phone') {
            refreshPhoneOrderSummary();
            var phoneInputEl = document.getElementById('phone-input');
            if (phoneInputEl) formatPhoneInput(phoneInputEl);
        }
        try {
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem(SCREEN_SESSION_KEY, target);
            }
        } catch (e) { /* quota / mode privé */ }
    }
    
    document.querySelectorAll('.nav-bottom-btn').forEach(function (btn) {
        var t = (btn.textContent || '').trim();
        var isRecharge = t.indexOf('Recharge') !== -1;
        var isCartes = t.indexOf('Cartes') !== -1;
        var isActualites = t.indexOf('Actualités') !== -1;
        var isQuests = t.indexOf('Quêtes') !== -1;
        var active = (target === 'home' && isRecharge) || (target === 'cartes' && isCartes) || (target === 'actualites' && isActualites) || (target === 'quests' && isQuests);
        btn.classList.toggle('text-amber-400', active);
        btn.classList.toggle('text-slate-400', !active);
    });
    
    window.scrollTo(0, 0);
}

// ==================== UTILS ====================
function generateOrderId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function operatorPrefixes(operatorName) {
    var o = CONFIG.OPERATORS[operatorName];
    if (!o) return [];
    if (Array.isArray(o.prefixes)) return o.prefixes;
    return [];
}

function operatorPrefixHint(operatorName) {
    var p = operatorPrefixes(operatorName);
    return p.length ? p.join(', ') + '…' : '…';
}

function verifyNetwork(operator, phone) {
    if (!phone || !operator) return false;
    return operatorPrefixes(operator).some(function (prefix) {
        return phone.startsWith(prefix);
    });
}

function persistOrderDraft() {
    try {
        if (typeof sessionStorage === 'undefined') return;
        if (!currentOrder.operator) {
            sessionStorage.removeItem(ORDER_DRAFT_KEY);
            return;
        }
        sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify({
            operator: currentOrder.operator,
            amount: currentOrder.amount,
            amountTotal: currentOrder.amountTotal
        }));
    } catch (e) { /* quota / privé */ }
}

function loadOrderDraft() {
    try {
        if (typeof sessionStorage === 'undefined') return;
        var raw = sessionStorage.getItem(ORDER_DRAFT_KEY);
        if (!raw) return;
        var d = JSON.parse(raw);
        if (!d || !CONFIG.OPERATORS[d.operator]) return;
        currentOrder.operator = d.operator;
        if (typeof d.amount === 'number') {
            currentOrder.amount = d.amount;
            currentOrder.amountTotal = d.amountTotal != null ? d.amountTotal : d.amount + Math.floor(d.amount * CONFIG.FRAIS_PERCENT / 100);
        }
    } catch (e) { /* JSON / quota */ }
}

function refreshPhoneOrderSummary() {
    var summary = document.getElementById('order-summary-phone');
    if (!summary || !currentOrder.operator || currentOrder.amount == null) return;
    var amount = currentOrder.amount;
    var frais = currentOrder.amountTotal != null ? (currentOrder.amountTotal - amount) : Math.floor(amount * CONFIG.FRAIS_PERCENT / 100);
    var total = currentOrder.amountTotal != null ? currentOrder.amountTotal : amount + frais;
    summary.innerHTML =
        '<p><span>Opérateur</span><span>' + currentOrder.operator + '</span></p>' +
        '<p><span>Montant</span><span>' + formatNumber(amount) + ' FCFA</span></p>' +
        '<p><span>Frais (' + CONFIG.FRAIS_PERCENT + '%)</span><span>' + formatNumber(frais) + ' FCFA</span></p>' +
        '<p><span>Total à payer</span><span>' + formatNumber(total) + ' FCFA</span></p>';
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    if (typeof window.__bipbipHaptic === 'function') {
        if (type === 'success') window.__bipbipHaptic('notification', 'success');
        else if (type === 'error') window.__bipbipHaptic('notification', 'error');
    }
    var duration = type === 'success' ? 1500 : 3000;
    setTimeout(function () {
        toast.classList.remove('show');
    }, duration);
}

function saveOrders() {
    try {
        const toSave = orders.map(function (o) {
            // Ne jamais sauvegarder l'image base64 (dépasse le quota localStorage)
            var p = o.proof;
            if (typeof p === 'string' && p.length > 100) o = { ...o, proof: true };
            return o;
        });
        localStorage.setItem('bipbip_orders', JSON.stringify(toSave));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            // Garder seulement les 20 dernières commandes
            orders = orders.slice(-20).map(function (o) { return { ...o, proof: o.proof ? true : o.proof }; });
            try { localStorage.setItem('bipbip_orders', JSON.stringify(orders)); } catch (_) {}
        }
    }
}

/** Vide le stockage local (liste des commandes) pour libérer l'espace. */
function clearLocalOrders() {
    localStorage.removeItem('bipbip_orders');
    orders = [];
    renderOrdersList();
    showToast('Liste locale vidée.', 'success');
}

// ==================== BUY FLOW ====================
function renderAmountScreenOperatorBanner(operator) {
    if (!operator || !CONFIG.OPERATORS[operator]) return;
    var operatorColors = {
        MTN: { bg: 'linear-gradient(135deg, #FFCC00, #FFB300)', text: '#000' },
        Orange: { bg: 'linear-gradient(135deg, #FF6600, #E65100)', text: '#fff' },
        Moov: { bg: 'linear-gradient(135deg, #0066CC, #1565C0)', text: '#fff' }
    };
    var display = document.getElementById('selected-operator-display');
    var colors = operatorColors[operator];
    if (display && colors) {
        display.innerHTML =
            '<span class="operator-badge-display" style="background: ' + colors.bg + '; color: ' + colors.text + '; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 14px;">' + operator + '</span>' +
            '<span style="flex: 1; font-weight: 600;">Opérateur sélectionné</span>' +
            '<span style="color: #4CAF50;">✓</span>';
    }
}

function selectOperator(operator) {
    if (!CONFIG.OPERATORS[operator]) {
        showToast('Opérateur inconnu', 'error');
        return;
    }
    currentOrder = {
        id: null,
        operator: operator,
        amount: null,
        amountTotal: null,
        phone: null,
        proof: null,
        status: 'pending',
        createdAt: null,
        paymentMethod: null
    };
    try {
        if (typeof window.__bipbipHaptic === 'function') window.__bipbipHaptic('selection');
        if (typeof window.__bipbipDeviceStorage === 'object') window.__bipbipDeviceStorage.set('last_operator', operator);
        window.__bipbipLastOperator = operator;
    } catch (err) {
        console.error('[Bipbip] selectOperator side-effects:', err);
    }
    persistOrderDraft();

    renderAmountScreenOperatorBanner(operator);

    navigateTo('amount');
}

function selectAmount(amount) {
    if (!currentOrder.operator) {
        var lo = typeof window.__bipbipLastOperator === 'string' ? window.__bipbipLastOperator : '';
        if (lo && CONFIG.OPERATORS[lo]) currentOrder.operator = lo;
    }
    if (!currentOrder.operator) {
        showToast('Choisissez d’abord un opérateur', 'info');
        navigateTo('buy');
        return;
    }

    if (typeof window.__bipbipHaptic === 'function') window.__bipbipHaptic('impact', 'medium');
    const frais = Math.floor(amount * CONFIG.FRAIS_PERCENT / 100);
    const total = amount + frais;

    currentOrder.amount = amount;
    currentOrder.amountTotal = total;
    persistOrderDraft();

    refreshPhoneOrderSummary();

    var phoneInput = document.getElementById('phone-input');
    var lastPhone = window.__bipbipLastPhone || '';
    phoneInput.value = lastPhone;
    document.getElementById('btn-continue-phone').disabled = !lastPhone || lastPhone.length < 10;
    document.getElementById('phone-hint').textContent = 'Entrez un numéro valide';
    document.getElementById('phone-hint').className = 'input-hint';

    navigateTo('phone');
}

function formatPhoneInput(input) {
    // Garder seulement les chiffres
    let value = input.value.replace(/\D/g, '');
    input.value = value;
    
    const btn = document.getElementById('btn-continue-phone');
    const hint = document.getElementById('phone-hint');
    
    if (value.length >= 10) {
        if (!currentOrder.operator) {
            btn.disabled = true;
            hint.textContent = '❌ Opérateur non choisi — touchez « Changer d’opérateur » ci-dessus';
            hint.className = 'input-hint error';
        } else if (verifyNetwork(currentOrder.operator, value)) {
            btn.disabled = false;
            hint.textContent = '✅ Numéro valide';
            hint.className = 'input-hint success';
        } else {
            btn.disabled = true;
            hint.textContent = '❌ Ce numéro ne correspond pas à ' + currentOrder.operator + ' (' + operatorPrefixHint(currentOrder.operator) + ')';
            hint.className = 'input-hint error';
        }
    } else {
        btn.disabled = true;
        if (currentOrder.operator && CONFIG.OPERATORS[currentOrder.operator]) {
            hint.textContent = 'Entrez un numéro ' + currentOrder.operator + ' (' + operatorPrefixHint(currentOrder.operator) + ')';
        } else {
            hint.textContent = 'Choisissez un opérateur à l’étape précédente';
        }
        hint.className = 'input-hint';
    }
}

function validatePhone() {
    const phone = document.getElementById('phone-input').value.trim();

    if (!currentOrder.operator) {
        showToast('Choisissez d’abord un opérateur', 'info');
        navigateTo('buy');
        return;
    }

    if (phone.length < 10) {
        showToast('Numéro invalide', 'error');
        return;
    }
    
    if (!verifyNetwork(currentOrder.operator, phone)) {
        showToast('Numéro incompatible avec l\'opérateur', 'error');
        return;
    }
    
    currentOrder.phone = phone;
    if (typeof window.__bipbipDeviceStorage === 'object') window.__bipbipDeviceStorage.set('last_phone', phone);
    
    // Afficher les détails de confirmation
    const details = document.getElementById('confirmation-details');
    const frais = currentOrder.amountTotal - currentOrder.amount;
    
    details.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Opérateur</span>
            <span class="detail-value">${CONFIG.OPERATORS[currentOrder.operator].icon} ${currentOrder.operator}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Numéro</span>
            <span class="detail-value">+225 ${currentOrder.phone}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Montant recharge</span>
            <span class="detail-value">${formatNumber(currentOrder.amount)} FCFA</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Frais de service</span>
            <span class="detail-value">${formatNumber(frais)} FCFA</span>
        </div>
        <div class="detail-row total-row">
            <span class="detail-label">Total à payer</span>
            <span class="detail-value">${formatNumber(currentOrder.amountTotal)} FCFA</span>
        </div>
    `;
    
    navigateTo('confirm');
}

function confirmOrder() {
    var tgUserId = tg?.initDataUnsafe?.user?.id?.toString() || null;
    const payload = {
        operator: currentOrder.operator,
        amount: currentOrder.amount,
        amountTotal: currentOrder.amountTotal,
        phone: currentOrder.phone,
        userId: tgUserId || getBrowserUserId(),
        username: tg?.initDataUnsafe?.user?.username || null
    };

    fetch(API_BASE + '/api/orders', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify(payload)
    })
    .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    })
    .then(function (result) {
        if (result.ok && result.data.order) {
            currentOrder.id = result.data.order.id;
            currentOrder.createdAt = result.data.order.createdAt || new Date().toISOString();
            orders.push({...currentOrder});
            saveOrders();
            try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(ORDER_DRAFT_KEY); } catch (e) {}
            showToast('Commande créée ! Choisissez votre mode de paiement.', 'success');
            goToPaymentMethodScreen();
        } else {
            var msg = (result.data && result.data.error) ? result.data.error : ('Erreur serveur (' + result.status + ')');
            showToast(msg, 'error');
        }
    })
    .catch(function (err) {
        console.error('Erreur API /api/orders:', err);
        showToast('Erreur réseau. Vérifiez votre connexion et réessayez.', 'error');
    });
}

function goToPaymentMethodScreen() {
    var el = document.getElementById('payment-method-order-id');
    if (el && currentOrder.id) {
        var amount = (currentOrder.amountTotal != null ? currentOrder.amountTotal : currentOrder.amount) || 0;
        el.textContent = 'Commande #' + currentOrder.id + ' — ' + formatNumber(amount) + ' FCFA';
    }
    currentOrder.paymentMethod = null;
    bipbipPayTab = 'djamo';
    navigateTo('payment-method');
}

/* ========== Gift Cards (Cartes cadeaux) ========== */

var GIFT_CARDS = {
    app: [
        { id: 'gplay-5',   name: 'Google Play',  value: '5€',   price: 5000,   img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Google_Play_Store_badge_EN.svg/512px-Google_Play_Store_badge_EN.svg.png', flag: '🇫🇷' },
        { id: 'gplay-10',  name: 'Google Play',  value: '10€',  price: 8000,   img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Google_Play_Store_badge_EN.svg/512px-Google_Play_Store_badge_EN.svg.png', flag: '🇫🇷' },
        { id: 'gplay-25',  name: 'Google Play',  value: '25€',  price: 18000,  img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Google_Play_Store_badge_EN.svg/512px-Google_Play_Store_badge_EN.svg.png', flag: '🇫🇷' },
        { id: 'itunes-10', name: 'iTunes',       value: '10€',  price: 8000,   img: 'https://i.imgur.com/8QhGKGP.png', flag: '🇫🇷' },
        { id: 'itunes-20', name: 'iTunes',       value: '20€',  price: 15000,  img: 'https://i.imgur.com/8QhGKGP.png', flag: '🇫🇷' },
        { id: 'itunes-50', name: 'iTunes',       value: '50€',  price: 35000,  img: 'https://i.imgur.com/8QhGKGP.png', flag: '🇫🇷' },
    ],
    music: [
        { id: 'spotify-10',  name: 'Spotify',      value: '10€',  price: 8000,   img: 'https://i.imgur.com/3tCmGWM.png', flag: '🇫🇷' },
        { id: 'spotify-30',  name: 'Spotify',      value: '30€',  price: 22000,  img: 'https://i.imgur.com/3tCmGWM.png', flag: '🇫🇷' },
        { id: 'deezer-10',   name: 'Deezer',       value: '10€',  price: 8000,   img: 'https://i.imgur.com/YfJQoMu.png', flag: '🇫🇷' },
        { id: 'deezer-25',   name: 'Deezer',       value: '25€',  price: 18000,  img: 'https://i.imgur.com/YfJQoMu.png', flag: '🇫🇷' },
        { id: 'itunes-m15',  name: 'iTunes Music', value: '15€',  price: 11000,  img: 'https://i.imgur.com/8QhGKGP.png', flag: '🇫🇷' },
    ],
    films: [
        { id: 'netflix-15',  name: 'Netflix',       value: '15€',  price: 11000,  img: 'https://i.imgur.com/0xZGqYr.png', flag: '🇫🇷' },
        { id: 'netflix-25',  name: 'Netflix',       value: '25€',  price: 18000,  img: 'https://i.imgur.com/0xZGqYr.png', flag: '🇫🇷' },
        { id: 'netflix-50',  name: 'Netflix',       value: '50€',  price: 35000,  img: 'https://i.imgur.com/0xZGqYr.png', flag: '🇫🇷' },
        { id: 'disney-25',   name: 'Disney+',       value: '25€',  price: 18000,  img: 'https://i.imgur.com/4DPCLEJ.png', flag: '🇫🇷' },
        { id: 'prime-30',    name: 'Prime Video',   value: '30€',  price: 22000,  img: 'https://i.imgur.com/QjWEZ1v.png', flag: '🇫🇷' },
    ],
    jeux: [
        { id: 'psn-10',     name: 'PlayStation',   value: '10€',  price: 8000,   img: 'https://i.imgur.com/1v3THxX.png', flag: '🇫🇷' },
        { id: 'psn-20',     name: 'PlayStation',   value: '20€',  price: 15000,  img: 'https://i.imgur.com/1v3THxX.png', flag: '🇫🇷' },
        { id: 'psn-50',     name: 'PlayStation',   value: '50€',  price: 35000,  img: 'https://i.imgur.com/1v3THxX.png', flag: '🇫🇷' },
        { id: 'xbox-10',    name: 'Xbox',          value: '10€',  price: 8000,   img: 'https://i.imgur.com/6bKPfvN.png', flag: '🇫🇷' },
        { id: 'xbox-25',    name: 'Xbox',          value: '25€',  price: 18000,  img: 'https://i.imgur.com/6bKPfvN.png', flag: '🇫🇷' },
        { id: 'steam-10',   name: 'Steam',         value: '10€',  price: 8000,   img: 'https://i.imgur.com/YkHohJv.png', flag: '🇫🇷' },
        { id: 'steam-20',   name: 'Steam',         value: '20€',  price: 15000,  img: 'https://i.imgur.com/YkHohJv.png', flag: '🇫🇷' },
        { id: 'steam-50',   name: 'Steam',         value: '50€',  price: 35000,  img: 'https://i.imgur.com/YkHohJv.png', flag: '🇫🇷' },
    ]
};

var gcCurrentCategory = 'app';
var gcSelectedCard = null;

var GC_CATEGORY_LABELS = { app: 'App', music: 'Music', films: 'Films', jeux: 'Jeux' };

function setGiftCardCategory(cat) {
    if (!GIFT_CARDS[cat]) return;
    gcCurrentCategory = cat;

    // Update tabs
    document.querySelectorAll('.gc-tab').forEach(function (t) {
        t.classList.toggle('active', t.id === 'gc-tab-' + cat);
    });

    // Update title
    var title = document.getElementById('gc-category-title');
    if (title) title.textContent = GC_CATEGORY_LABELS[cat] || cat;

    renderGiftCards(cat);
    if (typeof window.__bipbipHaptic === 'function') window.__bipbipHaptic('impact', 'light');
}

function renderGiftCards(cat) {
    var carousel = document.getElementById('gc-carousel');
    var dotsWrap = document.getElementById('gc-dots');
    if (!carousel) return;

    var cards = GIFT_CARDS[cat] || [];
    carousel.innerHTML = '';
    if (dotsWrap) dotsWrap.innerHTML = '';

    cards.forEach(function (card, i) {
        var el = document.createElement('div');
        el.className = 'gc-card';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.onclick = function () { openGiftCardModal(card); };
        el.onkeydown = function (e) { if (e.key === 'Enter') openGiftCardModal(card); };

        el.innerHTML =
            '<div class="gc-card-inner">' +
                '<div style="position:relative">' +
                    '<img class="gc-card-img" src="' + card.img + '" alt="' + card.name + '" loading="lazy" onerror="this.src=\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22220%22 height=%22140%22><rect fill=%22%231e293b%22 width=%22220%22 height=%22140%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2228%22>' + card.name.charAt(0) + '</text></svg>\'">' +
                    '<span class="gc-card-value">' + card.value + '</span>' +
                    '<span class="gc-card-flag" style="position:absolute;top:10px;right:10px;font-size:20px;">' + card.flag + '</span>' +
                '</div>' +
                '<div class="gc-card-body">' +
                    '<p class="gc-card-name">' + card.name + '</p>' +
                    '<p class="gc-card-price">' + formatNumber(card.price) + 'XOF</p>' +
                '</div>' +
            '</div>';

        carousel.appendChild(el);

        // Dot
        if (dotsWrap) {
            var dot = document.createElement('span');
            dot.className = 'gc-dot' + (i === 0 ? ' active' : '');
            dot.dataset.index = i;
            dotsWrap.appendChild(dot);
        }
    });

    // Update dots on scroll
    carousel.onscroll = function () { updateGcDots(carousel); };
    // Reset scroll
    carousel.scrollLeft = 0;
}

function updateGcDots(carousel) {
    var dots = document.querySelectorAll('#gc-dots .gc-dot');
    if (!dots.length) return;
    var cardW = 220 + 16; // card width + gap
    var idx = Math.round(carousel.scrollLeft / cardW);
    dots.forEach(function (d, i) {
        d.classList.toggle('active', i === idx);
    });
}

function openGiftCardModal(card) {
    gcSelectedCard = card;
    var modal = document.getElementById('gc-confirm-modal');
    var preview = document.getElementById('gc-modal-preview');
    var title = document.getElementById('gc-modal-title');
    var price = document.getElementById('gc-modal-price');
    var desc = document.getElementById('gc-modal-desc');
    if (!modal) return;

    if (preview) preview.innerHTML = '<img src="' + card.img + '" alt="' + card.name + '">';
    if (title) title.textContent = card.name + ' — ' + card.value;
    if (price) price.textContent = formatNumber(card.price) + ' XOF';
    if (desc) desc.textContent = 'Carte cadeau ' + card.name + ' d\'une valeur de ' + card.value + '. Après paiement, le code sera envoyé par Telegram.';

    modal.classList.remove('hidden');
    if (typeof window.__bipbipHaptic === 'function') window.__bipbipHaptic('impact', 'medium');
}

function closeGiftCardModal(e) {
    if (e && e.target && !e.target.classList.contains('gc-modal-overlay')) return;
    var modal = document.getElementById('gc-confirm-modal');
    if (modal) modal.classList.add('hidden');
    gcSelectedCard = null;
}

function confirmGiftCardPurchase() {
    if (!gcSelectedCard) return;
    var card = gcSelectedCard;

    // Build order for gift card
    var frais = Math.round(card.price * 0.1);
    var total = card.price + frais;

    currentOrder = {
        id: null,
        operator: 'CARTE_CADEAU',
        amount: card.price,
        amountTotal: total,
        phone: '',
        proof: null,
        status: 'pending',
        createdAt: null,
        paymentMethod: null
    };
    // Store gift card details for reference
    currentOrder._giftCard = {
        cardId: card.id,
        name: card.name,
        value: card.value,
        category: gcCurrentCategory
    };

    // Close modal
    var modal = document.getElementById('gc-confirm-modal');
    if (modal) modal.classList.add('hidden');

    // Create order via API then navigate to payment
    var tgUserId = (typeof tg !== 'undefined' && tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user.id.toString() : null;
    var payload = {
        operator: 'CARTE_CADEAU',
        amount: card.price,
        amountTotal: total,
        phone: 'carte-' + card.id,
        userId: tgUserId || getBrowserUserId(),
        username: (typeof tg !== 'undefined' && tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user.username : null,
        giftCard: card.name + ' ' + card.value
    };

    fetch(API_BASE + '/api/orders', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify(payload)
    })
    .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    })
    .then(function (result) {
        if (result.ok && result.data.order) {
            currentOrder.id = result.data.order.id;
            currentOrder.createdAt = result.data.order.createdAt || new Date().toISOString();
            orders.push({...currentOrder});
            saveOrders();
            showToast('Commande créée ! Choisissez votre mode de paiement.', 'success');
            goToPaymentMethodScreen();
        } else {
            var msg = (result.data && result.data.error) ? result.data.error : ('Erreur serveur (' + result.status + ')');
            showToast(msg, 'error');
        }
    })
    .catch(function (err) {
        console.error('Erreur API /api/orders (gift card):', err);
        showToast('Erreur réseau. Vérifiez votre connexion.', 'error');
    });
}

// Initialize gift cards when navigating to cartes screen
(function () {
    var _origNav = typeof navigateTo === 'function' ? null : null; // patched below
})();

/* ========== / Gift Cards ========== */

/* ========== Google Sign-In (utilisateurs navigateur) ========== */

var __bipbipGoogleSession = null; // { token, userId }

/**
 * Vérifie si l'utilisateur est connecté via Google (session stockée en localStorage)
 */
function getGoogleSession() {
    if (__bipbipGoogleSession) return __bipbipGoogleSession;
    try {
        var raw = localStorage.getItem('bipbip_google_session');
        if (raw) {
            var s = JSON.parse(raw);
            if (s && s.token && s.userId) {
                __bipbipGoogleSession = s;
                return s;
            }
        }
    } catch (e) {}
    return null;
}

function saveGoogleSession(token, userId) {
    __bipbipGoogleSession = { token: token, userId: userId };
    try { localStorage.setItem('bipbip_google_session', JSON.stringify(__bipbipGoogleSession)); } catch (e) {}
}

function clearGoogleSession() {
    __bipbipGoogleSession = null;
    try { localStorage.removeItem('bipbip_google_session'); } catch (e) {}
}

/**
 * Retourne true si l'utilisateur est dans Telegram
 */
function isInsideTelegram() {
    return !!(tg && tg.initData && tg.initData.length > 0);
}

/**
 * Retourne true si l'utilisateur est connecté (Telegram ou Google)
 */
function isUserAuthenticated() {
    return isInsideTelegram() || !!getGoogleSession();
}

/**
 * Enrichit les headers API avec le token Google si connecté
 */
var _origGetApiHeaders = getApiHeaders;
getApiHeaders = function (extra) {
    var h = _origGetApiHeaders(extra);
    var gs = getGoogleSession();
    if (gs && !isInsideTelegram()) {
        h['X-Google-Session'] = gs.token;
    }
    return h;
};

/**
 * Retourne le userId à envoyer aux API
 */
var _origGetBrowserUserId = getBrowserUserId;
getBrowserUserId = function () {
    var gs = getGoogleSession();
    if (gs) return gs.userId;
    return _origGetBrowserUserId();
};

/**
 * Lance le flux Google Sign-In
 */
function startGoogleSignIn() {
    var clientId = serverConfig.googleClientId;
    if (!clientId) {
        showToast('Google Sign-In non configuré. Contactez le support.', 'error');
        return;
    }
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
        showToast('Chargement de Google en cours... Réessayez.', 'info');
        return;
    }

    google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
    });

    // Utiliser le popup Google natif
    google.accounts.id.prompt(function (notification) {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            // Fallback : afficher le bouton rendu par Google
            var container = document.getElementById('btn-google-signin');
            if (container) {
                container.style.display = 'none';
                var gDiv = document.createElement('div');
                gDiv.id = 'g_id_signin_rendered';
                gDiv.style.display = 'flex';
                gDiv.style.justifyContent = 'center';
                container.parentNode.insertBefore(gDiv, container);
                google.accounts.id.renderButton(gDiv, {
                    theme: 'filled_blue',
                    size: 'large',
                    shape: 'pill',
                    width: 300,
                    text: 'continue_with',
                    locale: 'fr',
                });
            }
        }
    });
}

/**
 * Callback après connexion Google réussie
 */
function handleGoogleCredentialResponse(response) {
    if (!response || !response.credential) {
        showToast('Connexion Google annulée.', 'info');
        return;
    }

    showToast('Connexion en cours...', 'info');

    fetch(API_BASE + '/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
    })
    .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    })
    .then(function (result) {
        if (result.ok && result.data.ok && result.data.user) {
            var user = result.data.user;
            saveGoogleSession(result.data.sessionToken, String(user.telegram_id));

            // Stocker les infos utilisateur comme pour Telegram
            window.__bipbipRegisteredUser = user;
            if (typeof user.points === 'number') {
                userPoints = user.points;
                try { localStorage.setItem('bipbip_points', String(userPoints)); } catch (e) {}
            }

            updateProfilPhoto();
            updateHeaderUserInfo();
            updateHeaderPoints();
            updateProfilPoints();

            showToast('Bienvenue ' + (user.first_name || '') + ' !', 'success');
            navigateTo('home');
        } else {
            showToast(result.data.error || 'Erreur de connexion Google', 'error');
        }
    })
    .catch(function (err) {
        console.error('[Google Auth]', err);
        showToast('Erreur réseau. Réessayez.', 'error');
    });
}

/**
 * Continuer sans compte (mode invité)
 */
function continueAsGuest() {
    showToast('Mode invité — fonctionnalités limitées.', 'info');
    navigateTo('home');
}

/**
 * Déconnexion Google
 */
function logoutGoogle() {
    clearGoogleSession();
    window.__bipbipRegisteredUser = null;
    userPoints = 0;
    try { localStorage.setItem('bipbip_points', '0'); } catch (e) {}

    // Réinitialiser le header
    var nameEl = document.getElementById('header-user-name');
    var photoEl = document.getElementById('header-photo');
    var pointsEl = document.getElementById('header-points');
    if (nameEl) nameEl.textContent = '—';
    if (photoEl) photoEl.innerHTML = '<span class="text-xl text-slate-400">👤</span>';
    if (pointsEl) pointsEl.textContent = '0';

    showToast('Déconnecté.', 'info');
    navigateTo('home');
}

/**
 * Charger le profil Google au démarrage si session existante
 */
function initGoogleAuth() {
    var gs = getGoogleSession();
    if (!gs || isInsideTelegram()) return;

    fetch(API_BASE + '/api/auth/google/me?uid=' + encodeURIComponent(gs.userId), {
        headers: { 'X-Google-Session': gs.token, 'Content-Type': 'application/json' }
    })
    .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    })
    .then(function (result) {
        if (result.ok && result.data.ok && result.data.user) {
            window.__bipbipRegisteredUser = result.data.user;
            if (typeof result.data.user.points === 'number') {
                userPoints = result.data.user.points;
                try { localStorage.setItem('bipbip_points', String(userPoints)); } catch (e) {}
            }
            updateProfilPhoto();
            updateHeaderUserInfo();
            updateHeaderPoints();
            updateProfilPoints();
        } else {
            // Session expirée
            clearGoogleSession();
        }
    })
    .catch(function () {
        // Silencieux en cas d'erreur réseau
    });
}

/* ========== / Google Sign-In ========== */

function toggleWavePayBlock() {
    var block = document.getElementById('wave-pay-block');
    var btn = document.getElementById('btn-wave-toggle');
    var chev = document.getElementById('icon-wave-chevron');
    if (!block) return;
    block.classList.toggle('hidden');
    var isOpen = !block.classList.contains('hidden');
    if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (chev) chev.classList.toggle('rotate-180', isOpen);
}

function chooseWavePayment() {
    currentOrder.paymentMethod = 'wave';
    showToast('Après paiement Wave, envoyez une capture d’écran à l’étape suivante.', 'info');
    resetProofUploadUi();
    navigateTo('proof');
}

function setPaymentMethodTab(tab) {
    if (tab !== 'djamo' && tab !== 'momo' && tab !== 'ton') tab = 'djamo';
    bipbipPayTab = tab;
    ['djamo', 'momo', 'ton'].forEach(function (t) {
        var btn = document.getElementById('pay-tab-' + t);
        var panel = document.getElementById('pay-panel-' + t);
        if (btn && !btn.classList.contains('hidden')) {
            var on = (t === tab);
            btn.classList.toggle('bg-white/15', on);
            btn.classList.toggle('text-white', on);
            btn.classList.toggle('text-slate-400', !on);
        }
        if (panel) panel.classList.toggle('hidden', t !== tab);
    });
    var hint = document.getElementById('payment-method-hint');
    if (hint) {
        hint.textContent = tab === 'ton'
            ? 'Cours en direct : envoi du montant exact en TON depuis ton wallet. Une preuve est générée et envoyée aux admins.'
            : 'Choisissez comment payer, puis envoyez une capture à l’étape suivante.';
    }
    if (tab === 'ton') refreshBipbipTonRate();
    else updateBipbipTonPayButton();
}

function applyPaymentMethodScreenFromConfig() {
    var manualWrap = document.getElementById('payment-manual-crypto-wrap');
    if (manualWrap) manualWrap.classList.toggle('hidden', !serverConfig.cryptoDepositAddress);
    var tabMomo = document.getElementById('pay-tab-momo');
    if (tabMomo) tabMomo.classList.toggle('hidden', !serverConfig.momoEnabled);
    var tabTon = document.getElementById('pay-tab-ton');
    if (tabTon) tabTon.classList.toggle('hidden', !serverConfig.cryptoDepositAddress);
    var url = serverConfig.djamoPayUrl || DJAMO_PAY_URL;
    var link = document.getElementById('djamo-pay-link');
    if (link) link.href = url;
    var urlText = document.getElementById('djamo-pay-url-text');
    if (urlText) urlText.textContent = url.replace(/^https?:\/\//, '');
    if (bipbipPayTab === 'momo' && !serverConfig.momoEnabled) bipbipPayTab = 'djamo';
    if (bipbipPayTab === 'ton' && !serverConfig.cryptoDepositAddress) bipbipPayTab = 'djamo';
    setPaymentMethodTab(bipbipPayTab);
}

function refreshBipbipTonRate() {
    var loadEl = document.getElementById('ton-rate-loading');
    var errEl = document.getElementById('ton-rate-error');
    var boxEl = document.getElementById('ton-rate-box');
    var amount = (currentOrder.amountTotal != null ? currentOrder.amountTotal : currentOrder.amount) || 0;
    if (loadEl) loadEl.classList.remove('hidden');
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
    if (boxEl) boxEl.classList.add('hidden');
    window.__bipbipTonRate = null;
    fetch(API_BASE + '/api/rates/ton?total_xof=' + encodeURIComponent(amount))
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (_ref) {
            var ok = _ref.ok, j = _ref.j;
            if (loadEl) loadEl.classList.add('hidden');
            if (!ok || j.error) {
                if (errEl) {
                    errEl.textContent = (j && j.error) ? j.error : 'Taux indisponible';
                    errEl.classList.remove('hidden');
                }
            } else {
                window.__bipbipTonRate = j;
                var tonAmt = document.getElementById('ton-rate-amount');
                var tonUsd = document.getElementById('ton-rate-usd');
                if (tonAmt) tonAmt.textContent = (j.amount_ton != null ? Number(j.amount_ton).toFixed(4) : '—') + ' TON';
                if (tonUsd) tonUsd.textContent = 'Cours actuel : 1 TON ≈ ' + (j.ton_usd != null ? j.ton_usd : '—') + ' $';
                if (boxEl) boxEl.classList.remove('hidden');
            }
            var u = getBipbipTonConnectUi();
            if (u) bipbipOnTonWalletUi(u.wallet);
            else updateBipbipTonPayButton();
        })
        .catch(function () {
            if (loadEl) loadEl.classList.add('hidden');
            if (errEl) {
                errEl.textContent = 'Réseau indisponible';
                errEl.classList.remove('hidden');
            }
            window.__bipbipTonRate = null;
            var u2 = getBipbipTonConnectUi();
            if (u2) bipbipOnTonWalletUi(u2.wallet);
            else updateBipbipTonPayButton();
        });
}

function getBipbipTonConnectUi() {
    var manifest = serverConfig.tonConnectManifestUrl;
    if (!manifest) return null;
    var TC = (window.TON_CONNECT_UI && window.TON_CONNECT_UI.TonConnectUI) || window.TonConnectUI;
    if (!TC) {
        if (typeof window.__loadTonConnect === 'function' && !window.__isTonConnectLoaded()) {
            window.__loadTonConnect(function () {
                var u = getBipbipTonConnectUi();
                if (u) bipbipOnTonWalletUi(u.wallet);
                else updateBipbipTonPayButton();
            });
        }
        return null;
    }
    if (!__tonConnectUi) {
        __tonConnectUi = new TC({ manifestUrl: manifest });
        if (tg && tg.initData && serverConfig.twaReturnUrl) {
            __tonConnectUi.uiOptions = { twaReturnUrl: serverConfig.twaReturnUrl };
        }
        __tonConnectUi.onStatusChange(function (wallet) {
            bipbipOnTonWalletUi(wallet);
        });
    }
    return __tonConnectUi;
}

function bipbipOnTonWalletUi(wallet) {
    var line = document.getElementById('ton-wallet-connected-line');
    var connectBtn = document.getElementById('btn-ton-connect-wallet');
    var acc = wallet && wallet.account;
    var addr = acc && acc.address;
    if (addr) {
        if (line) {
            line.textContent = '✓ Wallet · ' + addr.slice(0, 6) + '…' + addr.slice(-4);
            line.classList.remove('hidden');
        }
        if (connectBtn) connectBtn.textContent = 'Wallet connecté';
    } else {
        if (line) { line.classList.add('hidden'); line.textContent = ''; }
        if (connectBtn) connectBtn.textContent = 'Connecter le wallet';
    }
    updateBipbipTonPayButton();
}

function updateBipbipTonPayButton() {
    var btn = document.getElementById('btn-bipbip-ton-pay');
    if (!btn) return;
    var rate = window.__bipbipTonRate;
    var ui = getBipbipTonConnectUi();
    var connected = ui && ui.wallet && ui.wallet.account && ui.wallet.account.address;
    var merchant = serverConfig.cryptoDepositAddress;
    var totalFcfa = formatNumber((currentOrder.amountTotal != null ? currentOrder.amountTotal : currentOrder.amount) || 0);
    if (!merchant) {
        btn.disabled = true;
        btn.textContent = 'Paiement TON indisponible';
        return;
    }
    if (!rate || rate.amount_ton == null) {
        btn.disabled = true;
        btn.textContent = 'Chargement du cours…';
        return;
    }
    if (!connected) {
        btn.disabled = true;
        btn.textContent = 'Connecte ton wallet pour payer';
        return;
    }
    btn.disabled = false;
    btn.textContent = 'Payer ≈ ' + Number(rate.amount_ton).toFixed(4) + ' TON (' + totalFcfa + ' FCFA)';
}

function buildBipbipTonReceiptDataUrl(amountTon, tonUsd) {
    var canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 260;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 480, 260);
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 464, 244);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.fillText('Bipbip Recharge CI — TON Connect', 24, 42);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px Inter, system-ui, sans-serif';
    var idLine = 'Commande #' + (currentOrder.id || '') + ' · ' + formatNumber((currentOrder.amountTotal != null ? currentOrder.amountTotal : currentOrder.amount) || 0) + ' FCFA';
    ctx.fillText(idLine.slice(0, 52), 24, 68);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 21px Inter, system-ui, sans-serif';
    ctx.fillText('≈ ' + (amountTon != null ? Number(amountTon).toFixed(4) : '') + ' TON envoyés', 24, 108);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText('Cours indicatif : 1 TON ≈ ' + (tonUsd != null ? tonUsd : '—') + ' USD', 24, 134);
    ctx.fillText(new Date().toLocaleString('fr-FR'), 24, 198);
    return canvas.toDataURL('image/jpeg', 0.88);
}

function sendProofFromDataUrlCompressed(dataUrl, paymentMethod) {
    var pm = paymentMethod || 'djamo';
    currentOrder.paymentMethod = pm;
    compressProofImage(dataUrl).then(function (imageData) {
        return fetch(API_BASE + '/api/orders/' + encodeURIComponent(currentOrder.id) + '/proof-base64', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ image: imageData, paymentMethod: pm })
        });
    })
        .then(function (res) {
            return res.text().then(function (text) {
                try {
                    var data = JSON.parse(text);
                    return { ok: res.ok, status: res.status, data: data };
                } catch (_) {
                    return { ok: false, status: res.status, data: { error: res.status === 413 ? 'Image trop volumineuse' : 'Erreur serveur' } };
                }
            });
        })
        .then(function (_ref2) {
            var ok = _ref2.ok, status = _ref2.status, data = _ref2.data;
            var tonBtn = document.getElementById('btn-bipbip-ton-pay');
            if (tonBtn) { tonBtn.disabled = false; updateBipbipTonPayButton(); }
            if (ok && data.success) {
                var orderIndex = orders.findIndex(function (o) { return o.id === currentOrder.id; });
                if (orderIndex !== -1) {
                    orders[orderIndex].proof = true;
                    orders[orderIndex].status = 'proof_sent';
                } else {
                    orders.push({
                        id: currentOrder.id,
                        operator: currentOrder.operator,
                        amount: currentOrder.amount,
                        amountTotal: currentOrder.amountTotal,
                        phone: currentOrder.phone,
                        proof: true,
                        status: 'proof_sent',
                        createdAt: currentOrder.createdAt
                    });
                }
                saveOrders();
                var successInfo = document.getElementById('success-order-info');
                if (successInfo) {
                    successInfo.innerHTML = '\n                    <p><strong>Commande:</strong> #' + currentOrder.id + '</p>\n                    <p><strong>Montant:</strong> ' + formatNumber(currentOrder.amountTotal) + ' FCFA</p>\n                    <p><strong>Numéro:</strong> +225 ' + currentOrder.phone + '</p>\n                    <p><strong>Statut:</strong> ⏳ En attente de validation</p>\n                ';
                }
                showToast('Paiement TON enregistré !', 'success');
                navigateTo('success');
            } else {
                var msg = (data && data.error) ? data.error : ('Erreur serveur (' + status + ')');
                showToast(msg, 'error');
            }
        })
        .catch(function (err) {
            console.error('Erreur preuve TON:', err);
            var tonBtn2 = document.getElementById('btn-bipbip-ton-pay');
            if (tonBtn2) { tonBtn2.disabled = false; updateBipbipTonPayButton(); }
            showToast('Erreur réseau. Réessaie.', 'error');
        });
}

function bipbipTonWalletPay() {
    var ui = getBipbipTonConnectUi();
    var merchant = serverConfig.cryptoDepositAddress;
    var rate = window.__bipbipTonRate;
    if (!ui || !merchant || !rate || rate.amount_ton == null) {
        showToast('Vérifie le cours TON et l’adresse marchand', 'error');
        return;
    }
    if (!ui.wallet || !ui.wallet.account || !ui.wallet.account.address) {
        showToast('Connecte d’abord ton wallet', 'info');
        ui.openModal();
        return;
    }
    var amountTon = Number(rate.amount_ton);
    var amountNano = BigInt(Math.round(amountTon * 1e9));
    var btn = document.getElementById('btn-bipbip-ton-pay');
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }
    ui.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: merchant, amount: amountNano.toString() }]
    }).then(function () {
        currentOrder.paymentMethod = 'ton';
        var receipt = buildBipbipTonReceiptDataUrl(amountTon, rate.ton_usd);
        sendProofFromDataUrlCompressed(receipt, 'ton');
    }).catch(function (err) {
        if (btn) { btn.disabled = false; updateBipbipTonPayButton(); }
        var s = String(err && err.message ? err.message : err);
        if (!/declin|reject|cancel|annul/i.test(s)) console.warn('[TON]', err);
        showToast('Paiement annulé ou échoué', 'info');
    });
}

function resetProofUploadUi() {
    var orderEl = document.getElementById('order-id-display');
    if (orderEl && currentOrder.id) orderEl.textContent = 'Commande #' + currentOrder.id;
    var uploadEl = document.getElementById('upload-area');
    var previewEl = document.getElementById('preview-container');
    var btnEl = document.getElementById('btn-send-proof');
    if (uploadEl) uploadEl.style.display = 'block';
    if (previewEl) previewEl.style.display = 'none';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = '📤 Envoyer la preuve';
    }
    removePreview();
}

function syncProofScreenInstructions() {
    var hint = document.getElementById('proof-selected-method');
    var body = document.getElementById('proof-instructions-body');
    var pm = currentOrder.paymentMethod || 'djamo';
    var labels = { djamo: 'Djamo', usdt: 'USDT', usdc: 'USDC', ton: 'TON', momo: 'MTN MoMo', wave: 'Wave' };
    if (hint) {
        hint.textContent = 'Mode : ' + (labels[pm] || pm);
        hint.classList.remove('hidden');
    }
    if (!body) return;
    var payUrl = serverConfig.djamoPayUrl || DJAMO_PAY_URL;
    if (pm === 'djamo') {
        body.innerHTML = '<p>Nom affiché : <strong class="text-white">BIPBIP RECHARGE PRO</strong></p>' +
            '<p>Payez via Djamo puis envoyez une capture d’écran ci-dessous.</p>' +
            '<a href="' + escapeHtml(payUrl) + '" target="_blank" rel="noopener" class="inline-block mt-2 text-emerald-400 font-mono text-sm break-all underline">' + escapeHtml(payUrl) + '</a>';
    } else if (pm === 'momo') {
        body.innerHTML = '<p>Demande MoMo ou preuve manuelle : joignez une capture ci-dessous pour validation par l’admin.</p>';
    } else if (pm === 'wave') {
        body.innerHTML = '<p>Payez le montant indiqué via <strong class="text-white">Wave</strong> (QR affiché à l’étape précédente), puis joignez une <strong class="text-white">capture d’écran</strong> de la confirmation Wave ci-dessous.</p>' +
            '<p class="text-xs text-slate-500 mt-2">Vérifiez que le montant et la référence / date sont visibles sur la capture.</p>';
    } else if (pm === 'usdt' || pm === 'usdc' || pm === 'ton') {
        var addr = serverConfig.cryptoDepositAddress || '';
        body.innerHTML = '<p>Réseau indiqué : <strong class="text-white">' + escapeHtml(serverConfig.cryptoDepositNetwork || '—') + '</strong></p>' +
            (addr ? '<p class="font-mono text-xs text-emerald-400 break-all mt-2">' + escapeHtml(addr) + '</p>' : '<p class="text-amber-400 text-xs">Adresse non configurée côté serveur.</p>') +
            '<p class="text-xs text-slate-500 mt-2">Référence commande : <strong class="text-white">#' + escapeHtml(currentOrder.id || '') + '</strong></p>';
    } else {
        body.innerHTML = '<p class="text-slate-500 text-xs">Sélectionnez un mode de paiement à l’étape précédente.</p>';
    }
}

function chooseDjamoPayment() {
    currentOrder.paymentMethod = 'djamo';
    resetProofUploadUi();
    navigateTo('proof');
    showToast('Ajoutez une capture d’écran de votre paiement Djamo.', 'info');
}

function djamoPaid() {
    chooseDjamoPayment();
}

function startMomoFromPaymentScreen() {
    if (!serverConfig.momoEnabled) {
        showToast('Paiement MoMo indisponible', 'error');
        return;
    }
    if (!currentOrder.id) {
        showToast('Commande introuvable', 'error');
        return;
    }
    currentOrder.paymentMethod = 'momo';
    requestMomoPayment(currentOrder.id);
}

function goToCryptoPayment(asset) {
    if (!serverConfig.cryptoDepositAddress) {
        showToast('Paiement crypto non configuré', 'error');
        return;
    }
    if (asset === 'ton') {
        bipbipPayTab = 'ton';
        navigateTo('payment-method');
        return;
    }
    currentOrder.paymentMethod = asset === 'usdc' ? 'usdc' : 'usdt';
    navigateTo('crypto-pay');
}

function continueCryptoToProof() {
    resetProofUploadUi();
    navigateTo('proof');
}

function openTelegramWalletLinkFallback() {
    var u = serverConfig.telegramWalletUrl || 'https://t.me/wallet';
    if (tg && tg.openTelegramLink) tg.openTelegramLink(u);
    else if (tg && tg.openLink) tg.openLink(u);
    else if (typeof window !== 'undefined' && window.open) window.open(u, '_blank');
}

function openTelegramWalletPay() {
    var ui = getBipbipTonConnectUi();
    if (!ui) {
        if (!serverConfig.tonConnectManifestUrl) {
            showToast('Manifest TON Connect indisponible (PUBLIC_BASE_URL)', 'error');
        } else {
            showToast('SDK wallet indisponible', 'info');
        }
        openTelegramWalletLinkFallback();
        return;
    }
    try {
        ui.openModal();
    } catch (e) {
        console.warn('[TON Connect]', e);
        openTelegramWalletLinkFallback();
    }
}

function requestMomoPayment(orderId) {
    currentOrder.paymentMethod = 'momo';
    const telegramChatId = tg?.initDataUnsafe?.user?.id?.toString() || getBrowserUserId();
    return fetch(API_BASE + '/api/momo/request-to-pay', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
            amount: currentOrder.amountTotal,
            phone: '225' + currentOrder.phone.replace(/\D/g, ''),
            orderId: orderId,
            telegramChatId: telegramChatId
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.referenceId) {
            momoReferenceId = data.referenceId;
            document.getElementById('momo-order-id').textContent = 'Commande #' + currentOrder.id;
            document.getElementById('momo-phone-display').textContent = 'Une demande de ' + formatNumber(currentOrder.amountTotal) + ' FCFA a été envoyée au +225 ' + currentOrder.phone + '. Acceptez sur votre téléphone MoMo.';
            document.getElementById('momo-ref').textContent = data.referenceId;
            document.getElementById('momo-status-message').classList.add('hidden');
            showToast('Demande de paiement envoyée', 'success');
            navigateTo('momo');
        } else {
            showToast(data.error || 'Erreur MoMo', 'error');
            document.getElementById('order-id-display').textContent = 'Commande #' + currentOrder.id;
            document.getElementById('upload-area').style.display = 'block';
            document.getElementById('preview-container').style.display = 'none';
            document.getElementById('btn-send-proof').disabled = true;
            navigateTo('proof');
        }
    })
    .catch(err => {
        console.error('Erreur request-to-pay:', err);
        showToast('Paiement MoMo indisponible. Envoyez la preuve ci-dessous.', 'info');
        document.getElementById('order-id-display').textContent = 'Commande #' + currentOrder.id;
        document.getElementById('upload-area').style.display = 'block';
        document.getElementById('preview-container').style.display = 'none';
        document.getElementById('btn-send-proof').disabled = true;
        navigateTo('proof');
    });
}

function checkMomoStatus() {
    if (!momoReferenceId) return;
    const btn = document.getElementById('btn-momo-check');
    const msgEl = document.getElementById('momo-status-message');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>Vérification...</span>'; }
    msgEl.classList.add('hidden');

    fetch(API_BASE + '/api/momo/poll-status/' + encodeURIComponent(momoReferenceId))
    .then(res => res.json())
    .then(data => {
        if (btn) { btn.disabled = false; btn.innerHTML = '<iconify-icon icon="solar:refresh-linear" width="18"></iconify-icon><span>Vérifier le statut</span>'; }
        msgEl.classList.remove('hidden');
        const tx = data.transaction;
        if (!tx) {
            msgEl.textContent = 'Référence introuvable.';
            msgEl.className = 'glass-panel rounded-xl p-4 mb-4 border border-white/15 text-center text-slate-400';
            return;
        }
        if (tx.status === 'SUCCESSFUL') {
            const orderIndex = orders.findIndex(o => o.id === currentOrder.id);
            if (orderIndex !== -1) orders[orderIndex].status = 'validated';
            else orders.push({ ...currentOrder, status: 'validated' });
            saveOrders();
            msgEl.className = 'glass-panel rounded-xl p-4 mb-4 border border-emerald-500/30 text-center text-emerald-400';
            msgEl.textContent = 'Paiement reçu ! Recharge en cours.';
            const successInfo = document.getElementById('success-order-info');
            if (successInfo) {
                successInfo.innerHTML = '<p><strong>Commande:</strong> #' + currentOrder.id + '</p><p><strong>Montant:</strong> ' + formatNumber(currentOrder.amountTotal) + ' FCFA</p><p><strong>Numéro:</strong> +225 ' + currentOrder.phone + '</p><p><strong>Statut:</strong> Paiement MoMo reçu</p>';
            }
            showToast('Paiement reçu !', 'success');
            setTimeout(function () { navigateTo('success'); }, 1500);
        } else if (tx.status === 'FAILED') {
            msgEl.className = 'glass-panel rounded-xl p-4 mb-4 border border-red-500/30 text-center text-red-400';
            msgEl.textContent = 'Paiement refusé ou expiré. Vous pouvez réessayer ou envoyer une preuve.';
        } else {
            msgEl.className = 'glass-panel rounded-xl p-4 mb-4 border border-white/15 text-center text-slate-400';
            msgEl.textContent = 'En attente d\'acceptation sur votre téléphone...';
        }
    })
    .catch(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = '<iconify-icon icon="solar:refresh-linear" width="18"></iconify-icon><span>Vérifier le statut</span>'; }
        msgEl.classList.remove('hidden');
        msgEl.className = 'glass-panel rounded-xl p-4 mb-4 border border-white/15 text-center text-red-400';
        msgEl.textContent = 'Erreur réseau. Réessayez.';
    });
}

// ==================== PROOF UPLOAD ====================
function handleProofUpload(event) {
    const file = event.target.files[0];
    console.log('📸 Upload fichier:', file);
    
    if (!file) {
        console.log('❌ Pas de fichier sélectionné');
        return;
    }
    
    // Vérifier la taille (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image trop grande (max 5MB)', 'error');
        return;
    }
    
    // Vérifier le type
    if (!file.type.startsWith('image/')) {
        showToast('Fichier invalide (image requise)', 'error');
        return;
    }
    
    showToast('Chargement de l\'image...', 'info');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        console.log('✅ Image chargée');
        currentOrder.proof = e.target.result;
        
        // Afficher l'aperçu
        const previewImg = document.getElementById('proof-preview');
        const uploadArea = document.getElementById('upload-area');
        const previewContainer = document.getElementById('preview-container');
        const sendBtn = document.getElementById('btn-send-proof');
        
        if (previewImg) previewImg.src = e.target.result;
        if (uploadArea) uploadArea.style.display = 'none';
        if (previewContainer) previewContainer.style.display = 'block';
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = '📤 Envoyer la preuve';
            console.log('✅ Bouton activé');
        }
        
        showToast('Image prête !', 'success');
    };
    
    reader.onerror = function() {
        console.error('❌ Erreur lecture fichier');
        showToast('Erreur lors du chargement', 'error');
    };
    
    reader.readAsDataURL(file);
}

function removePreview() {
    currentOrder.proof = null;
    const proofInput = document.getElementById('proof-input');
    const uploadArea = document.getElementById('upload-area');
    const previewContainer = document.getElementById('preview-container');
    const sendBtn = document.getElementById('btn-send-proof');
    
    if (proofInput) proofInput.value = '';
    if (uploadArea) uploadArea.style.display = 'block';
    if (previewContainer) previewContainer.style.display = 'none';
    if (sendBtn) sendBtn.disabled = true;
}

/** Compresse l'image (réduction taille) pour éviter erreur réseau / 413. */
function compressProofImage(dataUrl) {
    return new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () {
            const maxW = 1024;
            const quality = 0.82;
            let w = img.width, h = img.height;
            if (w > maxW) {
                h = Math.round((h * maxW) / w);
                w = maxW;
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            try {
                const out = canvas.toDataURL('image/jpeg', quality);
                resolve(out);
            } catch (e) {
                resolve(dataUrl);
            }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
    });
}

function sendProof() {
    console.log('📤 sendProof appelé');
    console.log('📋 currentOrder:', currentOrder);
    
    const sendBtn = document.getElementById('btn-send-proof');
    
    if (!currentOrder.proof) {
        showToast('Veuillez ajouter une preuve', 'error');
        return;
    }
    
    if (!currentOrder.id) {
        showToast('Erreur: commande non trouvée', 'error');
        return;
    }
    
    // Désactiver le bouton pendant l'envoi
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = '⏳ Envoi en cours...';
    }
    
    // Compresser l'image pour réduire la taille (évite erreur réseau / 413)
    compressProofImage(currentOrder.proof).then(function (imageData) {
        const proofUrl = API_BASE + '/api/orders/' + encodeURIComponent(currentOrder.id) + '/proof-base64';
        return fetch(proofUrl, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                image: imageData,
                paymentMethod: currentOrder.paymentMethod || 'djamo'
            })
        });
    })
    .then(res => {
        return res.text().then(function (text) {
            try {
                const data = JSON.parse(text);
                return { ok: res.ok, status: res.status, data };
            } catch (_) {
                return { ok: false, status: res.status, data: { error: res.status === 413 ? 'Image trop volumineuse' : 'Erreur serveur' } };
            }
        });
    })
    .then(({ ok, status, data }) => {
        if (ok && data.success) {
            const orderIndex = orders.findIndex(o => o.id === currentOrder.id);
            // Ne pas stocker l'image base64 dans localStorage (quota dépassé → QuotaExceededError)
            if (orderIndex !== -1) {
                orders[orderIndex].proof = true;
                orders[orderIndex].status = 'proof_sent';
            } else {
                orders.push({
                    id: currentOrder.id,
                    operator: currentOrder.operator,
                    amount: currentOrder.amount,
                    amountTotal: currentOrder.amountTotal,
                    phone: currentOrder.phone,
                    proof: true,
                    status: 'proof_sent',
                    createdAt: currentOrder.createdAt
                });
            }
            saveOrders();
            const successInfo = document.getElementById('success-order-info');
            if (successInfo) {
                successInfo.innerHTML = `
                    <p><strong>Commande:</strong> #${currentOrder.id}</p>
                    <p><strong>Montant:</strong> ${formatNumber(currentOrder.amountTotal)} FCFA</p>
                    <p><strong>Numéro:</strong> +225 ${currentOrder.phone}</p>
                    <p><strong>Statut:</strong> ⏳ En attente de validation</p>
                `;
            }
            showToast('Preuve envoyée avec succès !', 'success');
            if (typeof window.__bipbipHaptic === 'function') window.__bipbipHaptic('notification', 'success');
            if (typeof window.__bipbipTgPromptHomeScreen === 'function') window.__bipbipTgPromptHomeScreen();
            navigateTo('success');
        } else {
            const msg = (data && data.error) ? data.error : ('Erreur serveur (' + status + ')');
            showToast(msg, 'error');
            if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 Envoyer la preuve'; }
        }
    })
    .catch(err => {
        console.error('Erreur API preuve:', err);
        showToast('Erreur réseau. Vérifiez votre connexion ou réessayez.', 'error');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 Envoyer la preuve'; }
    })
    .catch(function () {
        showToast('Erreur lors de la préparation de l\'image.', 'error');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 Envoyer la preuve'; }
    });
}

// ==================== ORDERS LIST ====================
function renderOrdersList() {
    const container = document.getElementById('orders-list');
    
    if (orders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <p>Aucune commande pour le moment</p>
            </div>
        `;
        return;
    }
    
    // Trier par date (plus récent en premier)
    const sortedOrders = [...orders].reverse();
    
    container.innerHTML = sortedOrders.map(order => `
        <div class="order-card">
            <div class="order-card-header">
                <span class="order-id">#${order.id}</span>
                <span class="order-status ${order.status === 'validated' ? 'validated' : 'pending'}">
                    ${getStatusLabel(order.status)}
                </span>
            </div>
            <div class="order-details">
                <p>${CONFIG.OPERATORS[order.operator]?.icon || '📱'} ${order.operator} - ${formatNumber(order.amount)} FCFA</p>
                <p>📞 +225 ${order.phone}</p>
                <p>💰 Total: ${formatNumber(order.amountTotal)} FCFA</p>
                <p>📅 ${formatDate(order.createdAt)}</p>
            </div>
        </div>
    `).join('');
}

function getStatusLabel(status) {
    const labels = {
        'pending': '⏳ En attente',
        'proof_sent': '📤 Preuve envoyée',
        'validated': '✅ Validée',
        'rejected': '❌ Rejetée'
    };
    return labels[status] || status;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ==================== ADMIN FUNCTIONS ====================
var adminOrdersFromServer = [];
var currentAdminTab = 'pending';

function getAdminKey() {
    var keyInput = document.getElementById('admin-key-input');
    return (keyInput && keyInput.value) ? keyInput.value.trim() : '';
}

function hasAdminAuth() {
    return !!(getAdminKey() || (tg && tg.initData));
}

function getAdminAuthHeaders(jsonBody) {
    var h = {};
    if (jsonBody) h['Content-Type'] = 'application/json';
    var k = getAdminKey();
    if (k) h['X-Admin-Key'] = k;
    if (tg && tg.initData) h['X-Telegram-Init-Data'] = tg.initData;
    return h;
}

function loadAdminOrders() {
    var headers = {};
    if (tg && tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;
    var key = getAdminKey();
    if (key) headers['X-Admin-Key'] = key;
    if (!headers['X-Telegram-Init-Data'] && !headers['X-Admin-Key']) {
        showToast('Saisis la clé admin ou ouvre l’app depuis le bot Telegram', 'error');
        return;
    }
    var status = currentAdminTab === 'validated' ? 'validated' : '';
    var url = API_BASE + '/api/admin/orders' + (status ? '?status=' + status : '');
    fetch(url, { headers: headers })
        .then(function (res) {
            if (res.status === 401) return res.json().then(function (d) { throw new Error(d && d.error ? d.error : 'Non autorisé'); });
            return res.json();
        })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                adminOrdersFromServer = [];
            } else {
                adminOrdersFromServer = data.orders || [];
                showToast(adminOrdersFromServer.length + ' commande(s) chargée(s)', 'success');
            }
            renderAdminOrders(currentAdminTab);
        })
        .catch(function (err) {
            showToast(err && err.message ? err.message : 'Erreur réseau', 'error');
            adminOrdersFromServer = [];
            renderAdminOrders(currentAdminTab);
        });
}

function switchAdminTab(tab) {
    currentAdminTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) event.target.classList.add('active');
    else document.querySelectorAll('.tab-btn')[tab === 'validated' ? 1 : 0].classList.add('active');
    if (getAdminKey() || (tg && tg.initData)) loadAdminOrders();
    else renderAdminOrders(tab);
}

function renderAdminOrders(filter = 'pending') {
    const container = document.getElementById('admin-orders');
    if (!container) return;

    var listToShow = adminOrdersFromServer.length ? adminOrdersFromServer : orders;
    const filteredOrders = listToShow.filter(function (o) {
        if (filter === 'pending') {
            return o.status === 'pending' || o.status === 'proof_sent';
        }
        return o.status === 'validated';
    });

    if (adminOrdersFromServer.length === 0 && !orders.length) {
        container.innerHTML = '<div class="empty-state mb-4"><span class="empty-icon">🔑</span><p class="text-slate-400 text-sm">Ouvre l’app depuis le bot (menu du bot → Ouvrir l’app) puis clique ci-dessous, ou saisis la clé admin pour charger les commandes.</p></div><button type="button" onclick="loadAdminOrders()" class="w-full py-3 rounded-xl font-semibold bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30">Charger les commandes</button>';
        return;
    }

    if (filteredOrders.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>Aucune commande ' + (filter === 'pending' ? 'en attente' : 'validée') + '</p></div><p class="text-xs text-slate-500 mt-2">Les commandes viennent du serveur. <button type="button" onclick="loadAdminOrders()" class="underline text-amber-400">Actualiser</button></p>';
        return;
    }

    container.innerHTML = filteredOrders.map(function (order) {
        var proofSrc = order.proof ? (order.proof.indexOf('http') === 0 ? order.proof : API_BASE + order.proof) : '';
        var proofHtml = proofSrc ? '<img class="proof-img" src="' + proofSrc + '" alt="Preuve">' : '<p style="color: var(--accent-warning);">⚠️ Pas de preuve</p>';
        var actionsHtml = (filter === 'pending') ? '<div class="admin-actions"><button class="btn-validate" onclick="validateOrderServer(\'' + order.id + '\')">✅ Valider</button><button class="btn-reject" onclick="rejectOrderServer(\'' + order.id + '\')">❌ Rejeter</button></div>' : '';
        return '<div class="admin-order-card">' +
            '<div class="order-card-header"><span class="order-id">#' + order.id + '</span><span class="order-status ' + (order.status === 'validated' ? 'validated' : 'pending') + '">' + getStatusLabel(order.status) + '</span></div>' +
            '<div class="order-details">' +
            '<p><strong>👤 User ID:</strong> ' + (order.userId || 'N/A') + '</p>' +
            '<p><strong>' + (CONFIG.OPERATORS[order.operator] ? CONFIG.OPERATORS[order.operator].icon : '📱') + ' Opérateur:</strong> ' + (order.operator || '') + '</p>' +
            '<p><strong>💰 Montant:</strong> ' + formatNumber(order.amountTotal) + ' FCFA</p>' +
            '<p><strong>📞 Numéro:</strong> +225 ' + (order.phone || '') + '</p>' +
            '<p><strong>📅 Date:</strong> ' + formatDate(order.createdAt) + '</p>' +
            (order.paymentMethod ? '<p><strong>💳 Mode paiement:</strong> ' + escapeHtml(({ djamo: 'Djamo', usdt: 'USDT', usdc: 'USDC', ton: 'TON', momo: 'MTN MoMo', wave: 'Wave' }[order.paymentMethod] || order.paymentMethod)) + '</p>' : '') +
            '</div>' +
            proofHtml + actionsHtml + '</div>';
    }).join('');
}

function validateOrder(orderId) {
    var orderIndex = orders.findIndex(function (o) { return o.id === orderId; });
    if (orderIndex !== -1) {
        orders[orderIndex].status = 'validated';
        saveOrders();
        if (tg) tg.sendData(JSON.stringify({ action: 'order_validated', orderId: orderId }));
        showToast('Commande validée !', 'success');
        renderAdminOrders('pending');
    }
}

function rejectOrder(orderId) {
    var orderIndex = orders.findIndex(function (o) { return o.id === orderId; });
    if (orderIndex !== -1) {
        orders[orderIndex].status = 'rejected';
        saveOrders();
        showToast('Commande rejetée', 'error');
        renderAdminOrders('pending');
    }
}

function validateOrderServer(orderId) {
    var url = API_BASE + '/api/admin/orders/' + encodeURIComponent(orderId) + '/validate';
    var headers = { 'Content-Type': 'application/json' };
    if (tg && tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;
    var key = getAdminKey();
    if (key) headers['X-Admin-Key'] = key;
    if (!headers['X-Telegram-Init-Data'] && !headers['X-Admin-Key']) {
        showToast('Saisis la clé admin ou ouvre l’app depuis le bot Telegram', 'error');
        return;
    }
    fetch(url, { method: 'POST', headers: headers })
        .then(function (res) {
            if (res.status === 401) {
                return res.json().then(function (data) {
                    var msg = data && data.error ? data.error : 'Non autorisé. Ouvre l’app depuis le bot (compte admin) ou vérifie la clé.';
                    showToast(msg, 'error');
                });
            }
            return res.json();
        })
        .then(function (data) {
            if (!data) return;
            if (data.error) { showToast(data.error, 'error'); return; }
            showToast('Commande validée !', 'success');
            loadAdminOrders();
        })
        .catch(function () { showToast('Erreur réseau', 'error'); });
}

function rejectOrderServer(orderId) {
    var url = API_BASE + '/api/admin/orders/' + encodeURIComponent(orderId) + '/reject';
    var headers = { 'Content-Type': 'application/json' };
    if (tg && tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;
    var key = getAdminKey();
    if (key) headers['X-Admin-Key'] = key;
    if (!headers['X-Telegram-Init-Data'] && !headers['X-Admin-Key']) {
        showToast('Saisis la clé admin ou ouvre l’app depuis le bot Telegram', 'error');
        return;
    }
    fetch(url, { method: 'POST', headers: headers, body: JSON.stringify({ reason: 'Preuve invalide' }) })
        .then(function (res) {
            if (res.status === 401) {
                return res.json().then(function (data) {
                    var msg = data && data.error ? data.error : 'Non autorisé. Ouvre l’app depuis le bot (compte admin) ou vérifie la clé.';
                    showToast(msg, 'error');
                });
            }
            return res.json();
        })
        .then(function (data) {
            if (!data) return;
            if (data.error) { showToast(data.error, 'error'); return; }
            showToast('Commande rejetée', 'error');
            loadAdminOrders();
        })
        .catch(function () { showToast('Erreur réseau', 'error'); });
}

function renderAdminPubBanners() {
    var wrap = document.getElementById('admin-pub-banners-rows');
    if (!wrap) return;
    wrap.innerHTML = '';
    var map = {};
    var list = Array.isArray(serverConfig.pubBanners) && serverConfig.pubBanners.length ? serverConfig.pubBanners : DEFAULT_PUB_BANNERS.slice();
    list.forEach(function (b) {
        var pl = b.placement || 'actualites';
        map[pl] = b;
    });
    ['home1', 'home2', 'actualites'].forEach(function (place) {
        addAdminPubBannerRowFixed(place, map[place] || { text: '', image: '', url: '', scrollSpeed: 5 });
    });
}

function addAdminPubBannerRowFixed(place, b) {
    var wrap = document.getElementById('admin-pub-banners-rows');
    if (!wrap) return;
    b = b || { text: '', image: '', url: '', scrollSpeed: 5 };
    var label = PUB_PLACEMENT_LABELS[place] || place;
    var speedVal = adminBannerScrollSpeedUi(b);
    var row = document.createElement('div');
    row.className = 'admin-pub-row glass-panel rounded-lg p-3 border border-white/10 space-y-2';
    row.setAttribute('data-placement', place);
    row.innerHTML =
        '<p class="text-xs font-semibold text-rose-300">' + escapeHtml(label) + '</p>' +
        '<p class="text-[11px] text-slate-500">Image conseillée : <strong class="text-slate-300">1200 × 200 px</strong> (bannière large, ratio ~6:1). Fichier JPG, WebP ou PNG.</p>' +
        '<label class="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">Vitesse de défilement :' +
        '  <input type="number" class="pub-scroll w-16 px-2 py-1 rounded-lg bg-slate-800 border border-white/15 text-white text-sm" min="1" max="10" value="' + speedVal + '">' +
        '  <span class="text-slate-500">1 = très lent · 10 = très rapide</span></label>' +
        '<input type="text" class="pub-text w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/15 text-white text-sm" placeholder="Texte sous la bannière (optionnel)" value="' + escapeHtml(b.text || '') + '">' +
        '<input type="text" class="pub-image w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/15 text-white text-sm" placeholder="Image : /uploads/... ou https://..." value="' + escapeHtml(b.image || '') + '">' +
        '<div class="flex flex-wrap gap-2 items-center">' +
        '  <input type="file" accept="image/*" class="pub-file text-xs text-slate-400 max-w-[200px]">' +
        '  <button type="button" class="pub-upload-btn px-3 py-1.5 rounded-lg bg-slate-700 border border-white/15 text-slate-200 text-xs">Uploader image</button>' +
        '</div>' +
        '<input type="text" class="pub-url w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/15 text-white text-sm" placeholder="Lien au clic (https://...)" value="' + escapeHtml(b.url || '') + '">';
    row.querySelector('.pub-upload-btn').addEventListener('click', function () {
        uploadAdminPubBannerForRow(row);
    });
    wrap.appendChild(row);
}

function uploadAdminPubBannerForRow(row) {
    var fileInput = row.querySelector('.pub-file');
    var imgInput = row.querySelector('.pub-image');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        showToast('Choisis une image', 'error');
        return;
    }
    if (!hasAdminAuth()) {
        showToast('Saisis la clé admin ou ouvre l’app depuis le bot (compte admin)', 'error');
        return;
    }
    var fd = new FormData();
    fd.append('image', fileInput.files[0]);
    fetch(API_BASE + '/api/admin/pub-banner-image', {
        method: 'POST',
        headers: getAdminAuthHeaders(false),
        body: fd
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            if (data.url && imgInput) imgInput.value = data.url;
            showToast('Image enregistrée : ' + (data.url || ''), 'success');
            fileInput.value = '';
        })
        .catch(function () { showToast('Erreur réseau (upload)', 'error'); });
}

function collectAdminPubBannersFromForm() {
    var rows = document.querySelectorAll('#admin-pub-banners-rows .admin-pub-row');
    var arr = [];
    rows.forEach(function (row) {
        var place = row.getAttribute('data-placement') || 'actualites';
        var text = (row.querySelector('.pub-text') && row.querySelector('.pub-text').value) || '';
        var image = (row.querySelector('.pub-image') && row.querySelector('.pub-image').value) || '';
        var url = (row.querySelector('.pub-url') && row.querySelector('.pub-url').value) || '';
        var sc = parseInt(row.querySelector('.pub-scroll') && row.querySelector('.pub-scroll').value, 10);
        if (String(image).trim()) {
            arr.push({
                text: String(text).trim(),
                image: String(image).trim(),
                url: String(url).trim(),
                placement: place,
                scrollSpeed: Math.min(10, Math.max(1, Number.isFinite(sc) ? sc : 5))
            });
        }
    });
    return arr;
}

function savePubBanners() {
    if (!hasAdminAuth()) {
        showToast('Saisis la clé admin ou ouvre l’app depuis le bot Telegram (compte admin)', 'error');
        return;
    }
    var arr = collectAdminPubBannersFromForm();
    fetch(API_BASE + '/api/admin/config', {
        method: 'PUT',
        headers: getAdminAuthHeaders(true),
        body: JSON.stringify({ pubBanners: arr })
    })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            if (data.config && Array.isArray(data.config.pubBanners)) {
                serverConfig.pubBanners = data.config.pubBanners;
            } else {
                serverConfig.pubBanners = arr;
            }
            initPubBanner();
            initHomePubBanners();
            renderAdminPubBanners();
            showToast(arr.length ? arr.length + ' bannière(s) enregistrée(s)' : 'Bannières désactivées (liste vide)', 'success');
        })
        .catch(function () { showToast('Erreur réseau', 'error'); });
}

function saveLedSpeed() {
    var input = document.getElementById('admin-led-speed');
    var seconds = parseInt(input && input.value ? input.value : 60, 10);
    if (seconds < 15 || seconds > 300) {
        showToast('Entre 15 et 300 secondes', 'error');
        return;
    }
    if (!hasAdminAuth()) {
        showToast('Saisis la clé admin ou ouvre l’app depuis le bot Telegram (compte admin)', 'error');
        return;
    }
    fetch(API_BASE + '/api/admin/config', {
        method: 'PUT',
        headers: getAdminAuthHeaders(true),
        body: JSON.stringify({ ledScrollSeconds: seconds })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (data.error) {
            showToast(data.error, 'error');
            return;
        }
        serverConfig.ledScrollSeconds = seconds;
        applyLedAnimation();
        var valEl = document.getElementById('admin-led-speed-value');
        if (valEl) valEl.textContent = seconds;
        showToast('Vitesse bandeau enregistrée : ' + seconds + ' s', 'success');
    })
    .catch(function () {
        showToast('Erreur réseau', 'error');
    });
}

// ==================== ADMIN ACCESS ====================
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        navigateTo('admin');
    }
});

(function () {
    if (window.location.search.indexOf('admin') !== -1) {
        setTimeout(function () { navigateTo('admin'); }, 300);
    }

    var logoEl = document.getElementById('app-logo-admin-trigger');
    if (!logoEl) return;
    var pressTimer = null;
    var tapCount = 0;
    var tapTimer = null;
    logoEl.addEventListener('touchstart', function (e) {
        pressTimer = setTimeout(function () {
            navigateTo('admin');
            tapCount = 0;
        }, 2000);
    }, { passive: true });
    logoEl.addEventListener('touchend', function () { clearTimeout(pressTimer); });
    logoEl.addEventListener('touchcancel', function () { clearTimeout(pressTimer); });
    logoEl.addEventListener('click', function () {
        tapCount++;
        clearTimeout(tapTimer);
        if (tapCount >= 5) {
            tapCount = 0;
            navigateTo('admin');
        }
        tapTimer = setTimeout(function () { tapCount = 0; }, 1500);
    });
})();

// ==================== INIT ====================
function loadServerConfig() {
    fetch(API_BASE + '/api/config', { cache: 'no-store' })
        .then(res => res.json())
        .then(function (data) {
            serverConfig.momoEnabled = !!data.momoEnabled;
            serverConfig.mtnMerchantPhone = data.mtnMerchantPhone || null;
            serverConfig.ledScrollSeconds = Math.min(300, Math.max(15, parseInt(data.ledScrollSeconds, 10) || 60));
            serverConfig.pubBanners = Array.isArray(data.pubBanners) ? data.pubBanners : null;
            serverConfig.djamoPayUrl = data.djamoPayUrl || null;
            serverConfig.telegramWalletUrl = data.telegramWalletUrl || null;
            serverConfig.cryptoDepositAddress = data.cryptoDepositAddress || null;
            serverConfig.cryptoDepositNetwork = data.cryptoDepositNetwork || null;
            serverConfig.cryptoFcfaPerUsdt = data.cryptoFcfaPerUsdt != null ? Number(data.cryptoFcfaPerUsdt) : null;
            serverConfig.telegramBotUsername = data.telegramBotUsername || null;
            serverConfig.twaReturnUrl = data.twaReturnUrl || null;
            serverConfig.tonConnectManifestUrl = data.tonConnectManifestUrl || null;
            if (serverConfig.djamoPayUrl) {
                DJAMO_PAY_URL = serverConfig.djamoPayUrl;
            }
            var el = document.querySelector('.payment-method.mtn-money .payment-number');
            if (el && serverConfig.mtnMerchantPhone) {
                el.textContent = serverConfig.mtnMerchantPhone.replace(/(\d{2})(?=\d)/g, '$1 ');
            }
            applyPaymentMethodScreenFromConfig();
            applyLedAnimation();
            initPubBanner();
            initHomePubBanners();
            loadLedMessages();
        })
        .catch(function () {
            loadLedMessages();
        });
}

function initApp() {
    initTelegram();
    // Initialiser la session Google si elle existe (utilisateurs navigateur)
    if (!isInsideTelegram()) initGoogleAuth();
    applyLedAnimation();
    loadServerConfig();
    updateHeaderPoints();
    updateHeaderUserInfo();
    loadOrderDraft();
    navigateTo(getRestorableScreen());

    // Boutons opérateurs : event delegation (plus fiable que onclick inline dans certains navigateurs mobiles)
    var buyScreen = document.getElementById('screen-buy');
    if (buyScreen) {
        buyScreen.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('[data-operator]') : null;
            if (!btn) {
                var el = e.target;
                while (el && el !== buyScreen) {
                    if (el.dataset && el.dataset.operator) { btn = el; break; }
                    el = el.parentNode;
                }
            }
            if (!btn || !btn.dataset || !btn.dataset.operator) return;
            e.preventDefault();
            e.stopPropagation();
            selectOperator(btn.dataset.operator);
        });
    }

    // Boutons montant : event delegation
    var amountScreen = document.getElementById('screen-amount');
    if (amountScreen) {
        amountScreen.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('[data-amount]') : null;
            if (!btn) {
                var el = e.target;
                while (el && el !== amountScreen) {
                    if (el.dataset && el.dataset.amount) { btn = el; break; }
                    el = el.parentNode;
                }
            }
            if (!btn || !btn.dataset || !btn.dataset.amount) return;
            e.preventDefault();
            e.stopPropagation();
            selectAmount(parseInt(btn.dataset.amount, 10));
        });
    }

    // Boutons Profil : liaison par addEventListener (obligatoire car script en fin de body, DOMContentLoaded deja passe)
    var btnSaveLink = document.getElementById('btn-save-social-link');
    if (btnSaveLink) btnSaveLink.addEventListener('click', function (e) { e.preventDefault(); saveSocialLink(); });
    var btnPromoLikes = document.getElementById('btn-request-promo-likes');
    if (btnPromoLikes) btnPromoLikes.addEventListener('click', function (e) { e.preventDefault(); requestPromoLikes(); });
    var btnPublier = document.getElementById('btn-publier-annonce');
    if (btnPublier) btnPublier.addEventListener('click', function (e) { e.preventDefault(); publierAnnonceLed(); });
    var btnAnnonceMomo = document.getElementById('btn-annonce-momo-request');
    if (btnAnnonceMomo) btnAnnonceMomo.addEventListener('click', function (e) { e.preventDefault(); requestAnnonceMomoPayment(); });
    var btnAnnonceMomoCheck = document.getElementById('btn-annonce-momo-check');
    if (btnAnnonceMomoCheck) btnAnnonceMomoCheck.addEventListener('click', function (e) { e.preventDefault(); checkAnnonceMomoStatus(); });
    var btnConvertPoints = document.getElementById('btn-convert-points');
    if (btnConvertPoints) btnConvertPoints.addEventListener('click', function (e) { e.preventDefault(); showConvertBbrWipBlock(); });

    var btnDailyClaim = document.getElementById('btn-daily-claim');
    if (btnDailyClaim) btnDailyClaim.addEventListener('click', function (e) { e.preventDefault(); claimDailyCheckin(); });

    var weatherSelect = document.getElementById('profil-weather-city');
    if (weatherSelect && typeof localStorage !== 'undefined') {
        weatherSelect.addEventListener('change', function () {
            var city = this.value || '';
            localStorage.setItem('bipbip_weather_city', city);
            loadHomeWeather();
            showToast('Ville météo mise à jour', 'success');
        });
    }

    var btnCopyReferral = document.getElementById('btn-copy-referral');
    if (btnCopyReferral) btnCopyReferral.addEventListener('click', function (e) {
        e.preventDefault();
        var input = document.getElementById('profil-referral-link');
        if (!input || !input.value) { showToast('Lien non disponible', 'error'); return; }
        input.select();
        input.setSelectionRange(0, 99999);
        try {
            navigator.clipboard.writeText(input.value);
            showToast('Lien copié !', 'success');
        } catch (err) {
            showToast('Copie manuelle du lien', 'info');
        }
    });
    var btnShareReferral = document.getElementById('btn-share-referral');
    if (btnShareReferral) btnShareReferral.addEventListener('click', function (e) {
        e.preventDefault();
        var input = document.getElementById('profil-referral-link');
        var link = input && input.value ? input.value : '';
        if (!link) { showToast('Lien non disponible', 'error'); return; }
        if (tg && tg.openTelegramLink) {
            tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('Rejoins Bipbip Recharge CI et gagne des points !'));
        } else {
            try { navigator.clipboard.writeText(link); showToast('Lien copié ! Partage-le à tes amis.', 'success'); } catch (err) { showToast('Copie le lien manuellement', 'info'); }
        }
    });

    console.log('Bipbip Recharge CI - WebApp initialisee');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
