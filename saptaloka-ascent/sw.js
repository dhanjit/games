/*
 * Saptaloka Ascent service worker — offline cache for the installable PWA.
 * Cache-first + stale-while-revalidate (instant offline, self-updates next visit).
 *
 * IMPORTANT: bump CACHE (v1 → v2 → …) whenever you change any cached asset, or
 * returning players keep the old build until revalidation catches up. A version
 * bump force-drops every old cache on activate. Add new files to ASSETS too.
 */
const CACHE = 'saptaloka-ascent-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './realms.js',
  './game.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
