// Service worker: lets the app open offline once it has been loaded.
// Network first, so edits show up right away; cache is the fallback.
const CACHE = 'money-v1';
const ASSETS = ['./', 'index.html', 'app.js', 'i18n.js', 'parser.js', 'config.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only our own files and the Supabase library; API calls go straight to the network.
  if (url.origin !== location.origin && url.hostname !== 'cdn.jsdelivr.net') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});