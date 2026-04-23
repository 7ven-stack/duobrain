const CACHE_NAME = 'duobrain-cache-v1';
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

// Install the service worker and cache the assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

// Serve cached files for instant loading
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return the cached file if found, otherwise fetch it from the network
                return response || fetch(event.request);
            })
    );
});