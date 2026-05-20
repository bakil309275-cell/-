const CACHE_NAME = 'maktabat-alaysaei-cache-vfinal';
const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(r => r || fetch(req).then(resp => {
      return caches.open(CACHE_NAME).then(cache => { cache.put(req, resp.clone()); return resp; });
    }).catch(()=> caches.match('./index.html')))
  );
});