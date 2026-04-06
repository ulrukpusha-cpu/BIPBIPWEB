/**
 * Bipbip Telegram Mini App Integration
 * Toutes les intégrations Telegram WebApp API (Bot API 8.0+/9.0+)
 * Guard: les modifications UI (thème, safe areas, back button, swipes)
 * ne s'appliquent QUE dans Telegram (initData présent).
 */
(function () {
    'use strict';

    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;

    // Le SDK Telegram crée window.Telegram.WebApp même dans un navigateur classique.
    // On distingue le vrai contexte Telegram par la présence de initData.
    var isInsideTelegram = !!(tg.initData && String(tg.initData).trim());

    var BIPBIP_BG = '#0f172a';
    var BIPBIP_HEADER = '#0e1726';

    // ═══════════════════════════════════════════════════════
    // 1. BASE : ready + expand + couleurs (Telegram uniquement)
    // ═══════════════════════════════════════════════════════

    if (isInsideTelegram) {
        try { tg.ready(); } catch (e) {}
        try { tg.expand(); } catch (e) {}

        try { tg.setHeaderColor(BIPBIP_HEADER); } catch (e) {}
        try { tg.setBackgroundColor(BIPBIP_BG); } catch (e) {}
        try {
            if (typeof tg.setBottomBarColor === 'function') {
                tg.setBottomBarColor(BIPBIP_BG);
            }
        } catch (e) {}
    }

    // ═══════════════════════════════════════════════════════
    // 2. SAFE AREAS : adapter les marges au device (Telegram uniquement)
    // ═══════════════════════════════════════════════════════

    function applySafeAreas() {
        var root = document.documentElement;
        var topbar = document.getElementById('bipbip-topbar');
        var nav = document.querySelector('nav.fixed');
        var mainEl = document.querySelector('main');
        var bottomNav = document.querySelector('nav.fixed[class*="bottom-0"]');

        var csaTop = 0;
        try {
            if (tg.contentSafeAreaInset) csaTop = tg.contentSafeAreaInset.top || 0;
        } catch (e) {}
        var saBottom = 0;
        try {
            if (tg.safeAreaInset) saBottom = tg.safeAreaInset.bottom || 0;
        } catch (e) {}

        root.style.setProperty('--tg-csa-top', csaTop + 'px');
        root.style.setProperty('--tg-sa-bottom', saBottom + 'px');

        if (topbar && csaTop > 0) {
            topbar.style.top = csaTop + 'px';
        }
        if (nav) {
            var topbarH = topbar ? 26 : 0;
            nav.style.top = (csaTop + topbarH) + 'px';
        }
        if (mainEl) {
            mainEl.style.paddingTop = 'calc(3.5rem + 26px + 1rem + ' + csaTop + 'px)';
        }
        if (bottomNav && saBottom > 0) {
            bottomNav.style.paddingBottom = saBottom + 'px';
        }
    }

    if (isInsideTelegram) {
        try { applySafeAreas(); } catch (e) {}
        try {
            tg.onEvent('contentSafeAreaChanged', applySafeAreas);
            tg.onEvent('safeAreaChanged', applySafeAreas);
        } catch (e) {}
    }

    // ═══════════════════════════════════════════════════════
    // 3. BACK BUTTON natif Telegram
    // ═══════════════════════════════════════════════════════

    var homeScreens = { home: true, '': true };

    function updateTgBackButton(screen) {
        try {
            if (!isInsideTelegram || !tg.BackButton) return;
            if (homeScreens[screen]) {
                tg.BackButton.hide();
            } else {
                tg.BackButton.show();
            }
        } catch (e) {}
    }

    var backMap = {
        buy: 'home',
        amount: 'buy',
        phone: 'amount',
        confirm: 'phone',
        'payment-method': 'home',
        'crypto-pay': 'payment-method',
        proof: 'payment-method',
        momo: 'home',
        success: 'home',
        prices: 'home',
        status: 'home',
        help: 'home',
        profil: 'home',
        actualites: 'home',
        quests: 'home',
        cartes: 'home',
        admin: 'home'
    };

    if (isInsideTelegram) {
        try {
            tg.BackButton.onClick(function () {
                var current = window.currentScreen || 'home';
                var overlay = document.getElementById('article-overlay');
                if (overlay && !overlay.classList.contains('hidden')) {
                    if (typeof window.closeArticleOverlay === 'function') {
                        window.closeArticleOverlay();
                    } else {
                        overlay.classList.add('hidden');
                    }
                    return;
                }
                var target = backMap[current] || 'home';
                if (typeof window.navigateTo === 'function') {
                    window.navigateTo(target);
                }
            });
        } catch (e) {}
    }

    window.__bipbipTgUpdateBackButton = updateTgBackButton;

    // ═══════════════════════════════════════════════════════
    // 4. HAPTIC FEEDBACK
    // ═══════════════════════════════════════════════════════

    window.__bipbipHaptic = function (type, style) {
        try {
            if (!isInsideTelegram || !tg.HapticFeedback) return;
            if (type === 'impact') {
                tg.HapticFeedback.impactOccurred(style || 'light');
            } else if (type === 'notification') {
                tg.HapticFeedback.notificationOccurred(style || 'success');
            } else if (type === 'selection') {
                tg.HapticFeedback.selectionChanged();
            }
        } catch (e) {}
    };

    // ═══════════════════════════════════════════════════════
    // 5. THEME ADAPTATIF (Telegram uniquement)
    // ═══════════════════════════════════════════════════════

    function applyTgTheme() {
        var root = document.documentElement;
        var tp = tg.themeParams || {};

        if (tp.bg_color) root.style.setProperty('--tg-bg', tp.bg_color);
        if (tp.text_color) root.style.setProperty('--tg-text', tp.text_color);
        if (tp.hint_color) root.style.setProperty('--tg-hint', tp.hint_color);
        if (tp.button_color) root.style.setProperty('--tg-button', tp.button_color);
        if (tp.button_text_color) root.style.setProperty('--tg-button-text', tp.button_text_color);
        if (tp.secondary_bg_color) root.style.setProperty('--tg-secondary-bg', tp.secondary_bg_color);
        if (tp.accent_text_color) root.style.setProperty('--tg-accent', tp.accent_text_color);

        if (tg.colorScheme === 'light') {
            root.classList.add('tg-light');
            root.classList.remove('tg-dark');
        } else {
            root.classList.add('tg-dark');
            root.classList.remove('tg-light');
        }
    }

    if (isInsideTelegram) {
        try { applyTgTheme(); } catch (e) {}
        try { tg.onEvent('themeChanged', applyTgTheme); } catch (e) {}
    }

    // ═══════════════════════════════════════════════════════
    // 6. CLOSING CONFIRMATION (pendant les paiements)
    // ═══════════════════════════════════════════════════════

    var paymentScreens = {
        confirm: true, 'payment-method': true, 'crypto-pay': true,
        proof: true, momo: true
    };

    window.__bipbipTgClosingGuard = function (screen) {
        try {
            if (!isInsideTelegram) return;
            if (paymentScreens[screen]) {
                tg.enableClosingConfirmation();
            } else {
                tg.disableClosingConfirmation();
            }
        } catch (e) {}
    };

    // ═══════════════════════════════════════════════════════
    // 7. ADD TO HOME SCREEN (après première recharge)
    // ═══════════════════════════════════════════════════════

    window.__bipbipTgPromptHomeScreen = function () {
        try {
            if (!isInsideTelegram) return;
            if (typeof tg.addToHomeScreen !== 'function') return;
            var prompted = false;
            try { prompted = sessionStorage.getItem('bipbip_hs_prompted') === '1'; } catch (e) {}
            if (prompted) return;

            tg.checkHomeScreenStatus(function (status) {
                if (status === 'missed' || status === 'unknown') {
                    setTimeout(function () {
                        tg.addToHomeScreen();
                        try { sessionStorage.setItem('bipbip_hs_prompted', '1'); } catch (e) {}
                    }, 1500);
                }
            });
        } catch (e) {}
    };

    // ═══════════════════════════════════════════════════════
    // 8. DETECTION PERFORMANCE ANDROID (Telegram uniquement)
    // ═══════════════════════════════════════════════════════

    if (isInsideTelegram) {
        (function detectAndroidPerformance() {
            try {
                var ua = navigator.userAgent || '';
                var match = ua.match(/Telegram-Android\/[\d.]+ \([^)]*;\s*(LOW|AVERAGE|HIGH)\)/i);
                if (match) {
                    var perfClass = match[1].toUpperCase();
                    document.documentElement.dataset.tgPerf = perfClass;
                    if (perfClass === 'LOW' && !document.documentElement.classList.contains('bipbip-lite')) {
                        document.documentElement.classList.add('bipbip-lite');
                    }
                }
            } catch (e) {}
        })();
    }

    // ═══════════════════════════════════════════════════════
    // 9. FULLSCREEN (optionnel, activé par le user)
    // ═══════════════════════════════════════════════════════

    window.__bipbipTgFullscreen = function (enable) {
        try {
            if (!isInsideTelegram) return;
            if (enable && typeof tg.requestFullscreen === 'function') {
                tg.requestFullscreen();
            } else if (!enable && typeof tg.exitFullscreen === 'function') {
                tg.exitFullscreen();
            }
        } catch (e) {}
    };

    // ═══════════════════════════════════════════════════════
    // 10. DEVICE STORAGE (préférences utilisateur — fonctionne aussi en navigateur via localStorage)
    // ═══════════════════════════════════════════════════════

    var ds = (isInsideTelegram && tg.DeviceStorage) ? tg.DeviceStorage : null;

    window.__bipbipDeviceStorage = {
        set: function (key, value, cb) {
            if (ds && typeof ds.setItem === 'function') {
                ds.setItem(key, value, function (err) {
                    if (cb) cb(err);
                });
            } else {
                try { localStorage.setItem('bipbip_tg_' + key, value); } catch (e) {}
                if (cb) cb(null);
            }
        },
        get: function (key, cb) {
            if (ds && typeof ds.getItem === 'function') {
                ds.getItem(key, function (err, val) {
                    if (cb) cb(err, val);
                });
            } else {
                var val = null;
                try { val = localStorage.getItem('bipbip_tg_' + key); } catch (e) {}
                if (cb) cb(null, val);
            }
        }
    };

    // Restaurer les préférences au démarrage
    window.__bipbipDeviceStorage.get('last_operator', function (err, val) {
        if (val) window.__bipbipLastOperator = val;
    });
    window.__bipbipDeviceStorage.get('last_phone', function (err, val) {
        if (val) window.__bipbipLastPhone = val;
    });

    // ═══════════════════════════════════════════════════════
    // DISABLE VERTICAL SWIPES (Telegram uniquement)
    // ═══════════════════════════════════════════════════════

    window.__bipbipTgSwipes = function (enable) {
        try {
            if (!isInsideTelegram) return;
            if (enable) tg.enableVerticalSwipes();
            else tg.disableVerticalSwipes();
        } catch (e) {}
    };

    if (isInsideTelegram) {
        try {
            if (typeof tg.disableVerticalSwipes === 'function') {
                tg.disableVerticalSwipes();
            }
        } catch (e) {}
    }

})();
