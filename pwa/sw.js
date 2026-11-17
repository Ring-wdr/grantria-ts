// Service worker of the public web build (GitHub Pages): the game page works offline once it has been opened, and the
// browser can install it as an app. Network first, the last good copy when offline. The game data never goes through
// here: it lives in IndexedDB (src/web/assetStore.ts), made from the player's own APK.
// The one exception is the app icon: once the player has imported their APK, icons/*.png answer with the icon made from
// its launcher icon (src/web/appIcon.ts, the 'icons' record of the 'meta' store), so the browser installs and updates
// the app with the original icon while the manifest and its URLs stay fixed. Without it, the placeholders in pwa/icons.
const CACHE = 'grantria-shell-v1';
const ICON_NAMES = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

/** The stored icon of that name, or undefined (no APK imported yet, storage blocked). Never creates the database. */
function storedIcon(name) {
  return new Promise((resolve) => {
    let open;
    try { open = indexedDB.open('grantria-assets'); } catch { resolve(undefined); return; }
    // no database yet: do not make an empty one (the page creates it with its stores)
    open.onupgradeneeded = () => open.transaction.abort();
    open.onerror = open.onblocked = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const get = db.transaction('meta', 'readonly').objectStore('meta').get('icons');
        get.onsuccess = () => { db.close(); resolve(get.result?.[name]); };
        get.onerror = () => { db.close(); resolve(undefined); };
      } catch {
        db.close();
        resolve(undefined);
      }
    };
  });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const icon = url.href.startsWith(`${self.registration.scope}icons/`) && url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  if (icon && ICON_NAMES.includes(icon)) {
    e.respondWith(storedIcon(icon).then((b) => b
      ? new Response(b, { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } })
      : shell(e, req)));
    return;
  }
  e.respondWith(shell(e, req));
});

/** network first, the last good copy when offline */
function shell(e, req) {
  return fetch(req).then((res) => {
    // only the page's own files (the assets/ probe answers 404 and is never kept)
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? Response.error()));
}
