/*
 * Saptaloka service worker — offline cache for the TWA / installable PWA.
 *
 * Strategy: precache the handful of static assets on install, then serve them
 * stale-while-revalidate (instant offline load, self-updates on the next visit).
 *
 * IMPORTANT: bump CACHE (v1 -> v2 -> ...) whenever you change any cached asset,
 * or returning players keep the old build until revalidation catches up. For a
 * guaranteed-fresh push, a version bump force-drops every old cache on activate.
 */
const CACHE = 'saptaloka-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './cards.js',
  './game.js',
  './manifest.webmanifest',
  './privacy.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GETs; let everything else hit the network untouched.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached); // offline: fall back to whatever we cached
        return cached || network; // cache-first for speed, network fills/refreshes
      })
    )
  );
});
