const CACHE_NAME = 'cashier-cache-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/cashier.html',
    '/subscriptions.html',
    '/css/style.css',
    '/js/cashier.js',
    '/js/subscriptions.js',
    '/logo.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // return cache.addAll(ASSETS); // تعطيل الـ cache حالياً لتجنب مشاكل التحديثات لو طلب اليوزر
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

