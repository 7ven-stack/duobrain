const CACHE_NAME = 'duobrain-cache-v2'; // Bumped version to force update
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/script.js',
    '/happy.png',
    '/click.mp3',
    '/tick.mp3',
    '/win.mp3',
    '/lose.mp3',
    '/bgm.mp3',
    '/calm-space-constellations-moewalls-com.mp4'
];

// Install the new service worker and force it to take over immediately
self.addEventListener('install', event => {
    self.skipWaiting(); 
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

// Clean up the old, broken caches so they don't get stuck
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// NEW: Network-First Strategy
self.addEventListener('fetch', event => {
    // Ignore socket.io requests so we don't accidentally cache live multiplayer data
    if (event.request.url.includes('socket.io')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // If the network succeeds, save a fresh copy to the cache and return the response
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // If the network completely fails, THEN pull from the cache
                return caches.match(event.request);
            })
    );
});