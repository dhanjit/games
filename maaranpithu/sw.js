/* Maaran Pithu service worker — precache the static build, serve it
 * stale-while-revalidate. Bump CACHE whenever a cached asset changes. */
const CACHE = 'maaranpithu-v5';
const ASSETS = ['./', './index.html', './style.css', './game.js', './rules.js', './audio.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    const network = fetch(event.request).then((res) => { if (res && res.ok) cache.put(event.request, res.clone()); return res; }).catch(() => cached);
    return cached || network;
  }));
});
