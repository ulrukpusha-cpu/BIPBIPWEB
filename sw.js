/**
 * Service Worker — Bipbip Recharge CI
 * Stratégie : cache-first pour les assets statiques, network-first pour les API.
 * Fallback offline pour la page principale.
 */
var CACHE_NAME = 'bipbip-v13';

var PRECACHE_URLS = [
    '/',
    '/index.html',
    '/assets/bipbip_logo.png',
    '/assets/bipbip_logo1.png',
    '/assets/logo-minia.png',
    '/assets/logo-minia.webp',
    '/styles.css',
    '/bipbip-dynamic-scene.css',
    '/app.js',
    '/bipbip-dynamic-scene.js',
    '/bipbip-ton-loader.js',
    '/bipbip-telegram.js',
    '/manifest.json'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(PRECACHE_URLS).catch(function (err) {
                console.warn('[SW] precache partiel:', err);
            });
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names.filter(function (name) { return name !== CACHE_NAME; })
                     .map(function (name) { return caches.delete(name); })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function (event) {
    var url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    if (url.origin !== self.location.origin) return;

    event.respondWith(cacheFirst(event.request));
});

function cacheFirst(request) {
    return caches.match(request).then(function (cached) {
        if (cached) {
            fetchAndUpdate(request);
            return cached;
        }
        return fetch(request).then(function (response) {
            if (response && response.status === 200 && response.type === 'basic') {
                var clone = response.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(request, clone);
                });
            }
            return response;
        }).catch(function () {
            if (request.destination === 'document') {
                return caches.match('/index.html');
            }
            return new Response('', { status: 503, statusText: 'Offline' });
        });
    });
}

function networkFirst(request) {
    return fetch(request).then(function (response) {
        return response;
    }).catch(function () {
        return caches.match(request).then(function (cached) {
            return cached || new Response(JSON.stringify({ error: 'offline' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        });
    });
}

function fetchAndUpdate(request) {
    fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
            caches.open(CACHE_NAME).then(function (cache) {
                cache.put(request, response);
            });
        }
    }).catch(function () {});
}
