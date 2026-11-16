// Service worker of the public web build (GitHub Pages): the game page works offline once it has been opened, and the
// browser can install it as an app. Network first, the last good copy when offline. The game data never goes through
// here: it lives in IndexedDB (src/web/assetStore.ts), made from the player's own APK.
const CACHE = 'grantria-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    // only the page's own files (the assets/ probe answers 404 and is never kept)
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? Response.error())));
});
