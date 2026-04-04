/**
 * Lazy-loader pour TON Connect UI SDK.
 * Chargé uniquement quand l'utilisateur ouvre l'onglet paiement TON,
 * au lieu de bloquer le <head> avec ~400 KB inutilisé à 95% des sessions.
 */
(function () {
    var loaded = false;
    var loading = false;
    var callbacks = [];

    window.__loadTonConnect = function (cb) {
        if (loaded) { if (cb) cb(); return; }
        if (cb) callbacks.push(cb);
        if (loading) return;
        loading = true;
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@tonconnect/ui@2.4.2/dist/tonconnect-ui.min.js';
        s.onload = function () {
            loaded = true;
            loading = false;
            for (var i = 0; i < callbacks.length; i++) {
                try { callbacks[i](); } catch (e) { console.warn('[TON loader]', e); }
            }
            callbacks = [];
        };
        s.onerror = function () {
            loading = false;
            console.warn('[TON loader] Echec du chargement du SDK');
            for (var i = 0; i < callbacks.length; i++) {
                try { callbacks[i](new Error('TON Connect SDK load failed')); } catch (e) {}
            }
            callbacks = [];
        };
        document.head.appendChild(s);
    };

    window.__isTonConnectLoaded = function () { return loaded; };
})();
