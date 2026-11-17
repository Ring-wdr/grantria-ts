// Service worker of the public web build (GitHub Pages): the game page works offline once it has been opened, and the
// browser can install it as an app. Network first, the last good copy when offline. The game data never goes through
// here: it lives in IndexedDB (src/web/assetStore.ts), made from the player's own APK.
// The one exception is the app icon: once the player has imported their APK, icons/*.png answer with the icon made from
// its launcher icon (src/web/appIcon.ts, the 'icons' record of the 'meta' store), and the page moves its manifest link
// to manifest.webmanifest?apk=<hash>, answered here with icon URLs carrying the same query, so the browser reads the
// manifest and the icons again and installs the app with the original icon. Without it, the placeholders in pwa/icons.
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
  if (url.href.startsWith(`${self.registration.scope}manifest.webmanifest`) && url.searchParams.has('apk')) {
    e.respondWith(apkManifest(e, url));
    return;
  }
  e.respondWith(shell(e, req));
});

/** The shipped manifest with its icons/icon-*.png moved to ?apk=<hash>, when an icon is stored */
async function apkManifest(e, url) {
  const res = await shell(e, new Request(`${self.registration.scope}manifest.webmanifest`));
  if (!res.ok || !(await storedIcon('icon-512.png'))) return res;
  const m = await res.json();
  const v = encodeURIComponent(url.searchParams.get('apk'));
  m.icons = (m.icons ?? []).map((i) => ({ ...i, src: `${i.src}?apk=${v}` }));
  return new Response(JSON.stringify(m), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' } });
}

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
