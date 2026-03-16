// ==================== CONFIG ====================
// Base URL de l'API (même origine que la page pour éviter "erreur réseau" en Mini App Telegram)
const API_BASE = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';

const CONFIG = {
    FRAIS_PERCENT: 5,
    ADMIN_ID: '6735995998',
    OPERATORS: {
        MTN: { prefix: '05', icon: '📲', color: '#ffcc00' },
        Orange: { prefix: '07', icon: '📶', color: '#ff6600' },
        Moov: { prefix: '01', icon: '📡', color: '#0066cc' }
    },
    AMOUNTS: [500, 1000, 2000, 5000, 10000, 15000, 20000, 25000]
};

// Config serveur (MoMo activé, numéro marchand)
let serverConfig = { momoEnabled: false, mtnMerchantPhone: null };

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
let currentScreen = 'home';
let momoReferenceId = null;
let userPoints = parseInt(localStorage.getItem('bipbip_points') || '0', 10);
var lastAnnonceId = null;
var lastAnnoncePrix = null;
var annoncePaymentRef = null;

// Bannière pub (Actualités)
// image: chemin relatif depuis la racine du site (ex: /img/recharge-banner.jpg)
// url: lien à ouvrir au clic (optionnel)
var PUB_BANNERS = [
    {
        text: 'Recharge ton crédit en ligne sur Bipbip Recharge CI.',
        image: '/img/recharge-banner.jpg',
        url: 'https://bipbiprecharge.ci'
    },
    {
        text: 'Service 24/7 — MTN, Orange, Moov en quelques secondes.',
        image: '/img/recharge-banner-2.jpg',
        url: 'https://bipbiprecharge.ci'
    },
    {
        text: 'Gagne du temps : recharge directement depuis Bipbip Recharge CI.',
        image: '/img/recharge-banner-3.jpg',
        url: 'https://bipbiprecharge.ci'
    }
];
var pubBannerInterval = null;

// ==================== TELEGRAM WEBAPP ====================
let tg = window.Telegram?.WebApp;

function initTelegram() {
    if (tg) {
        tg.ready();
        tg.expand();
        
        // Appliquer le thème Telegram
        if (tg.colorScheme === 'light') {
            document.body.classList.add('light-theme');
        }
        
        // Configurer le bouton principal
        tg.MainButton.setParams({
            text: 'Fermer',
            color: '#e94560'
        });
        
        console.log('Telegram WebApp initialisé', tg.initDataUnsafe);
        
        // Inscription automatique (photo + nom). fetchTelegramMe uniquement à l'ouverture du Profil pour ne pas écraser la photo.
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
        showToast('Ajoutez d\'abord votre lien YouTube ou X', 'error');
        return;
    }
    if (!tg || !tg.initData) {
        showToast('Connexion Telegram requise', 'error');
        return;
    }
    var select = document.getElementById('profil-promo-formule');
    var amount = 250;
    var durationDays = 1;
    if (select && select.options[select.selectedIndex]) {
        var opt = select.options[select.selectedIndex];
        amount = parseInt(opt.value, 10) || 250;
        durationDays = parseInt(opt.getAttribute('data-days'), 10) || 1;
    }
    fetch(API_BASE + '/api/telegram/promo-likes', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({ social_link: link, amount: amount, duration_days: durationDays })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (data.success && data.order) {
            var orderAmount = data.order.amount || 250;
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
    if (!container || !tg || !tg.initData) {
        if (container) setPlaceholderPhoto(container, isProfil);
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
            var img = document.createElement('img');
            img.alt = isProfil ? 'Photo profil' : '';
            img.className = isProfil ? 'w-full h-full rounded-full object-cover' : 'w-full h-full object-cover';
            img.onload = function () { URL.revokeObjectURL(url); };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                setPlaceholderPhoto(container, isProfil);
            };
            img.src = url;
            container.innerHTML = '';
            container.classList.remove('flex', 'items-center', 'justify-center', 'text-4xl', 'text-slate-400');
            container.classList.add('overflow-hidden');
            container.appendChild(img);
        })
        .catch(function () { setPlaceholderPhoto(container, isProfil); });
}

function updateProfilPhoto() {
    var container = document.getElementById('profil-photo');
    var nameEl = document.getElementById('profil-user-name');
    var hintEl = document.getElementById('profil-telegram-hint');
    var userName = getDisplayUserName();
    if (nameEl) nameEl.textContent = userName;
    if (hintEl) hintEl.style.display = (window.__bipbipRegisteredUser || (tg && tg.initDataUnsafe && tg.initDataUnsafe.user)) ? '' : 'none';
    if (!container) return;
    if (window.__bipbipRegisteredUser && tg && tg.initData) {
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
    if (window.__bipbipRegisteredUser && tg && tg.initData) {
        loadAvatarInto(photoEl, false);
    } else {
        setPlaceholderPhoto(photoEl, false);
    }
}

function convertPointsToBip() {
    if (userPoints < 100) {
        showToast('Minimum 100 points pour convertir en BIP', 'error');
        return;
    }
    var bip = Math.floor(userPoints / 100);
    userPoints -= bip * 100;
    localStorage.setItem('bipbip_points', String(userPoints));
    updateHeaderPoints();
    updateProfilPoints();
    showToast('Conversion effectuée : ' + bip + ' BIP', 'success');
}

var actualitesSort = 'date';

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
    var prix = select ? parseInt(select.value, 10) : 50;
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
        showToast('Annonce créée. Choisissez votre mode de paiement.', 'success');
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
    loadActualites(sort);
}

function initPubBanner() {
    var container = document.getElementById('tendances-list');
    if (!container) return;

    // Créer le markup une seule fois
    if (!container.dataset.initialized) {
        container.dataset.initialized = '1';
        container.innerHTML = '' +
            '<button type="button" id="pub-banner-card" class="relative w-full text-left glass-panel rounded-xl border border-white/15 bg-slate-900/60 overflow-hidden hover:bg-white/5 transition-colors cursor-pointer">' +
            '  <img id="pub-banner-img" src="" alt="Publicité" class="w-full h-24 md:h-28 object-cover block" />' +
            '  <div class="absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent flex items-center justify-between gap-2">' +
            '    <p id="pub-banner-text" class="text-xs sm:text-sm text-slate-50 truncate"></p>' +
            '    <span class="text-[9px] sm:text-[10px] uppercase tracking-wide text-slate-400 flex-shrink-0">Publicité</span>' +
            '  </div>' +
            '</button>';
    }

    if (!PUB_BANNERS.length) return;

    var btnEl = document.getElementById('pub-banner-card');
    var textEl = document.getElementById('pub-banner-text');
    var imgEl = document.getElementById('pub-banner-img');
    if (!textEl || !imgEl) return;

    var index = 0;
    function applyBanner(i) {
        var b = PUB_BANNERS[i] || PUB_BANNERS[0];
        textEl.textContent = b.text || '';
        if (b.image) {
            imgEl.src = b.image;
            imgEl.classList.remove('hidden');
        } else {
            imgEl.classList.add('hidden');
        }
        if (btnEl) {
            if (b.url) {
                btnEl.onclick = function () {
                    try {
                        window.open(b.url, '_blank');
                    } catch (_) {}
                };
            } else {
                btnEl.onclick = null;
            }
        }
    }

    applyBanner(index);

    if (pubBannerInterval) clearInterval(pubBannerInterval);
    pubBannerInterval = setInterval(function () {
        index = (index + 1) % PUB_BANNERS.length;
        applyBanner(index);
    }, 7000);
}

function loadActualites(sort) {
    sort = sort || actualitesSort;
    var actualitesList = document.getElementById('actualites-list');
    var annoncesList = document.getElementById('annonces-list');
    if (!actualitesList) return;

    var sortActualites = (sort === 'premium') ? 'popularite' : sort;
    fetch(API_BASE + '/api/actualites?limit=15&sort=' + encodeURIComponent(sortActualites))
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
                var label = escapeHtml(item.label || 'Lien');
                if (item.already_clicked) {
                    return '<div class="glass-panel rounded-xl p-4 border border-white/15 flex items-center justify-between">' +
                        '<div class="flex items-center gap-3"><span class="text-xl">🔗</span><span class="text-white font-medium">' + label + '</span></div>' +
                        '<span class="text-slate-500 text-sm">Déjà cliqué ✓</span></div>';
                }
                return '<a href="' + escapeHtml(clickUrl) + '" target="_blank" rel="noopener" class="flex items-center justify-between glass-panel rounded-xl p-4 border border-white/15 hover:bg-white/10 transition-colors">' +
                    '<div class="flex items-center gap-3 min-w-0"><span class="text-xl flex-shrink-0">🔗</span><div><span class="font-medium text-white block">' + label + '</span><span class="text-amber-400 text-sm">+' + pointsPerClick + ' pts</span></div></div>' +
                    '<iconify-icon icon="solar:arrow-right-linear" width="20" class="text-slate-400 flex-shrink-0"></iconify-icon></a>';
            }).join('');
        })
        .catch(function () { listEl.innerHTML = ''; });
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
                container.innerHTML = '<div class="glass-panel rounded-xl p-4 border border-white/15 flex items-center justify-between"><div class="flex items-center gap-3"><span class="text-xl">🎬</span><div><span class="font-medium text-white block">Quête Vidéo</span><span class="text-slate-400 text-sm">Missions vidéo</span></div></div><iconify-icon icon="solar:arrow-right-linear" width="20" class="text-slate-400"></iconify-icon></div>' +
                    '<div class="glass-panel rounded-xl p-4 border border-white/15 flex items-center justify-between"><div class="flex items-center gap-3"><span class="text-xl">📱</span><div><span class="font-medium text-white block">ProfitX, YouTube, Telegram</span><span class="text-slate-400 text-sm">Réseaux et plateformes</span></div></div><iconify-icon icon="solar:arrow-right-linear" width="20" class="text-slate-400"></iconify-icon></div>';
                return;
            }
            container.innerHTML = items.map(function (q) {
                var pts = q.points_reward || 0;
                return '<div class="glass-panel rounded-xl p-4 border border-white/15 flex items-center justify-between">' +
                    '<div class="flex items-center gap-3 min-w-0"><span class="text-xl flex-shrink-0">🏆</span><div><span class="font-medium text-white block">' + escapeHtml(q.titre || q.code || '') + '</span><span class="text-slate-400 text-sm">' + escapeHtml((q.description || '').slice(0, 40)) + (q.description && q.description.length > 40 ? '…' : '') + '</span><span class="text-amber-400 text-sm block">+' + pts + ' pts</span></div></div>' +
                    '<iconify-icon icon="solar:arrow-right-linear" width="20" class="text-slate-400 flex-shrink-0"></iconify-icon></div>';
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
    })
    .catch(function () {
        el.textContent = welcome + ' — Rechargez en un clic';
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
function navigateTo(screen) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
    });
    
    var targetScreen = document.getElementById('screen-' + screen);
    if (targetScreen) {
        targetScreen.classList.add('active');
        currentScreen = screen;
        if (screen === 'status') renderOrdersList();
        if (screen === 'home') {
            updateHeaderUserInfo();
            loadHomeWeather();
        }
        if (screen === 'profil') {
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
        if (screen === 'actualites') loadActualites(actualitesSort);
        if (screen === 'quests') loadQuests();
        if (screen === 'payment-method' && currentOrder.id) {
            var pmEl = document.getElementById('payment-method-order-id');
            if (pmEl) pmEl.textContent = 'Commande #' + currentOrder.id + ' — ' + formatNumber((currentOrder.amountTotal != null ? currentOrder.amountTotal : currentOrder.amount) || 0) + ' FCFA';
        }
        if (screen === 'proof' && currentOrder.id) {
            var odEl = document.getElementById('order-id-display');
            if (odEl) odEl.textContent = 'Commande #' + currentOrder.id;
            var hintEl = document.getElementById('proof-selected-method');
            if (hintEl) {
                hintEl.textContent = 'Paiement via Djamo';
                hintEl.classList.remove('hidden');
            }
        }
        if (screen === 'admin') {
            var speedVal = (serverConfig && serverConfig.ledScrollSeconds) ? serverConfig.ledScrollSeconds : 60;
            var speedInput = document.getElementById('admin-led-speed');
            var speedSpan = document.getElementById('admin-led-speed-value');
            if (speedInput) speedInput.value = speedVal;
            if (speedSpan) speedSpan.textContent = speedVal;
        }
    }
    
    document.querySelectorAll('.nav-bottom-btn').forEach(function (btn) {
        var isRecharge = (btn.textContent || '').indexOf('Recharge') !== -1;
        var isActualites = (btn.textContent || '').indexOf('Actualités') !== -1;
        var isQuests = (btn.textContent || '').indexOf('Quêtes') !== -1;
        var active = (screen === 'home' && isRecharge) || (screen === 'actualites' && isActualites) || (screen === 'quests' && isQuests);
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

function verifyNetwork(operator, phone) {
    const prefix = CONFIG.OPERATORS[operator]?.prefix;
    return phone.startsWith(prefix);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show ${type}`;
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
function selectOperator(operator) {
    currentOrder = {
        id: null,
        operator: operator,
        amount: null,
        amountTotal: null,
        phone: null,
        proof: null,
        status: 'pending',
        createdAt: null
    };
    
    // Couleurs des opérateurs
    const operatorColors = {
        MTN: { bg: 'linear-gradient(135deg, #FFCC00, #FFB300)', text: '#000' },
        Orange: { bg: 'linear-gradient(135deg, #FF6600, #E65100)', text: '#fff' },
        Moov: { bg: 'linear-gradient(135deg, #0066CC, #1565C0)', text: '#fff' }
    };
    
    // Afficher l'opérateur sélectionné
    const display = document.getElementById('selected-operator-display');
    const colors = operatorColors[operator];
    display.innerHTML = `
        <span class="operator-badge-display" style="background: ${colors.bg}; color: ${colors.text}; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 14px;">${operator}</span>
        <span style="flex: 1; font-weight: 600;">Opérateur sélectionné</span>
        <span style="color: #4CAF50;">✓</span>
    `;
    
    navigateTo('amount');
}

function selectAmount(amount) {
    const frais = Math.floor(amount * CONFIG.FRAIS_PERCENT / 100);
    const total = amount + frais;
    
    currentOrder.amount = amount;
    currentOrder.amountTotal = total;
    
    // Afficher le résumé
    const summary = document.getElementById('order-summary-phone');
    summary.innerHTML = `
        <p><span>Opérateur</span><span>${currentOrder.operator}</span></p>
        <p><span>Montant</span><span>${formatNumber(amount)} FCFA</span></p>
        <p><span>Frais (${CONFIG.FRAIS_PERCENT}%)</span><span>${formatNumber(frais)} FCFA</span></p>
        <p><span>Total à payer</span><span>${formatNumber(total)} FCFA</span></p>
    `;
    
    // Reset phone input
    document.getElementById('phone-input').value = '';
    document.getElementById('btn-continue-phone').disabled = true;
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
        if (verifyNetwork(currentOrder.operator, value)) {
            btn.disabled = false;
            hint.textContent = '✅ Numéro valide';
            hint.className = 'input-hint success';
        } else {
            btn.disabled = true;
            hint.textContent = `❌ Ce numéro ne correspond pas à ${currentOrder.operator}`;
            hint.className = 'input-hint error';
        }
    } else {
        btn.disabled = true;
        hint.textContent = `Entrez un numéro ${currentOrder.operator} (${CONFIG.OPERATORS[currentOrder.operator].prefix}...)`;
        hint.className = 'input-hint';
    }
}

function validatePhone() {
    const phone = document.getElementById('phone-input').value.trim();
    
    if (phone.length < 10) {
        showToast('Numéro invalide', 'error');
        return;
    }
    
    if (!verifyNetwork(currentOrder.operator, phone)) {
        showToast('Numéro incompatible avec l\'opérateur', 'error');
        return;
    }
    
    currentOrder.phone = phone;
    
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
    const payload = {
        operator: currentOrder.operator,
        amount: currentOrder.amount,
        amountTotal: currentOrder.amountTotal,
        phone: currentOrder.phone,
        userId: tg?.initDataUnsafe?.user?.id?.toString() || null,
        username: tg?.initDataUnsafe?.user?.username || null
    };

    fetch(API_BASE + '/api/orders', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.order) {
            currentOrder.id = data.order.id;
            currentOrder.createdAt = data.order.createdAt || new Date().toISOString();
        } else {
            currentOrder.id = generateOrderId();
            currentOrder.createdAt = new Date().toISOString();
        }
        orders.push({...currentOrder});
        saveOrders();
        userPoints += Math.floor((currentOrder.amountTotal || 0) / 100);
        localStorage.setItem('bipbip_points', String(userPoints));
        updateHeaderPoints();
        showToast('Commande créée ! Choisissez votre mode de paiement.', 'success');
        goToPaymentMethodScreen();
    })
    .catch(err => {
        console.error('Erreur API /api/orders:', err);
        currentOrder.id = generateOrderId();
        currentOrder.createdAt = new Date().toISOString();
        orders.push({...currentOrder});
        saveOrders();
        userPoints += Math.floor((currentOrder.amountTotal || 0) / 100);
        localStorage.setItem('bipbip_points', String(userPoints));
        updateHeaderPoints();
        showToast('Commande créée (hors ligne). Choisissez votre mode de paiement.', 'info');
        goToPaymentMethodScreen();
    });
}

function goToPaymentMethodScreen() {
    var el = document.getElementById('payment-method-order-id');
    if (el && currentOrder.id) {
        var amount = (currentOrder.amountTotal != null ? currentOrder.amountTotal : currentOrder.amount) || 0;
        el.textContent = 'Commande #' + currentOrder.id + ' — ' + formatNumber(amount) + ' FCFA';
    }
    currentOrder.paymentMethod = null;
    navigateTo('payment-method');
}

function choosePaymentMethod(method) {
    currentOrder.paymentMethod = 'djamo';
    var orderEl = document.getElementById('order-id-display');
    if (orderEl) orderEl.textContent = 'Commande #' + currentOrder.id;
    var uploadEl = document.getElementById('upload-area');
    var previewEl = document.getElementById('preview-container');
    var btnEl = document.getElementById('btn-send-proof');
    if (uploadEl) uploadEl.style.display = 'block';
    if (previewEl) previewEl.style.display = 'none';
    if (btnEl) btnEl.disabled = true;
    var hintEl = document.getElementById('proof-selected-method');
    if (hintEl) {
        hintEl.textContent = 'Paiement via Djamo';
        hintEl.classList.remove('hidden');
    }
    if (typeof window !== 'undefined' && window.open) window.open(DJAMO_PAY_URL, '_blank');
    showToast('Ouvrez Djamo pour payer, puis envoyez la preuve.', 'info');
    navigateTo('proof');
}

function djamoPaid() {
    currentOrder.paymentMethod = 'djamo';
    if (typeof window !== 'undefined' && window.open) window.open(DJAMO_PAY_URL, '_blank');
    var orderEl = document.getElementById('order-id-display');
    if (orderEl) orderEl.textContent = 'Commande #' + currentOrder.id;
    var uploadEl = document.getElementById('upload-area');
    var previewEl = document.getElementById('preview-container');
    var btnEl = document.getElementById('btn-send-proof');
    if (uploadEl) uploadEl.style.display = 'block';
    if (previewEl) previewEl.style.display = 'none';
    if (btnEl) btnEl.disabled = true;
    showToast('Envoyez la preuve de votre paiement Djamo', 'info');
    navigateTo('proof');
}

function requestMomoPayment(orderId) {
    const telegramChatId = tg?.initDataUnsafe?.user?.id?.toString() || null;
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
            body: JSON.stringify({ image: imageData })
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
            '<p><strong>📅 Date:</strong> ' + formatDate(order.createdAt) + '</p></div>' +
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

function saveLedSpeed() {
    var input = document.getElementById('admin-led-speed');
    var keyInput = document.getElementById('admin-key-input');
    var seconds = parseInt(input && input.value ? input.value : 60, 10);
    if (seconds < 15 || seconds > 300) {
        showToast('Entre 15 et 300 secondes', 'error');
        return;
    }
    var adminKey = (keyInput && keyInput.value) ? keyInput.value.trim() : '';
    if (!adminKey) {
        showToast('Saisis la clé admin (ADMIN_SECRET_KEY du .env) pour enregistrer', 'error');
        return;
    }
    fetch(API_BASE + '/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
        body: JSON.stringify({ ledScrollSeconds: seconds })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
        if (data.error) {
            showToast(data.error, 'error');
            return;
        }
        serverConfig.ledScrollSeconds = seconds;
        var ledEl = document.getElementById('led-text');
        if (ledEl) ledEl.style.animation = 'led-scroll ' + seconds + 's linear infinite';
        var valEl = document.getElementById('admin-led-speed-value');
        if (valEl) valEl.textContent = seconds;
        showToast('Vitesse bandeau enregistrée : ' + seconds + ' s', 'success');
    })
    .catch(function () {
        showToast('Erreur réseau', 'error');
    });
}

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
    // Admin access: Ctrl + Shift + A
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        navigateTo('admin');
    }
});

// ==================== INIT ====================
function loadServerConfig() {
    fetch(API_BASE + '/api/config')
        .then(res => res.json())
        .then(function (data) {
            serverConfig.momoEnabled = !!data.momoEnabled;
            serverConfig.mtnMerchantPhone = data.mtnMerchantPhone || null;
            serverConfig.ledScrollSeconds = Math.min(300, Math.max(15, parseInt(data.ledScrollSeconds, 10) || 60));
            var el = document.querySelector('.payment-method.mtn-money .payment-number');
            if (el && serverConfig.mtnMerchantPhone) {
                el.textContent = serverConfig.mtnMerchantPhone.replace(/(\d{2})(?=\d)/g, '$1 ');
            }
            var ledEl = document.getElementById('led-text');
            if (ledEl) {
                ledEl.style.animation = 'led-scroll ' + serverConfig.ledScrollSeconds + 's linear infinite';
            }
        })
        .catch(function () {});
}

function initApp() {
    initTelegram();
    loadServerConfig();
    loadLedMessages();
    updateHeaderPoints();
    updateHeaderUserInfo();
    navigateTo('home');

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
    if (btnConvertPoints) btnConvertPoints.addEventListener('click', function (e) { e.preventDefault(); convertPointsToBip(); });

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
