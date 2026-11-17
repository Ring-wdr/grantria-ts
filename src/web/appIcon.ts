// The installed web app's icon from the player's own APK: its launcher icon (72x72 in the known release) is made
// into the PWA icon sizes here and kept in IndexedDB with the rest of the build. Without an APK the placeholder icons
// shipped in pwa/icons stay. Nothing leaves the device, and the public build still carries no game art.
// - Chrome's install ("앱 설치", the WebAPK) reads the manifest's icons itself and keeps them per manifest URL for the
//   page, so the page's manifest link is moved to manifest.webmanifest?apk=<icon hash>: pwa/sw.js answers that with
//   the shipped manifest whose icons are icons/icon-*.png?apk=<hash>, and those with the stored icon. The new URLs
//   make Chrome read both again. They stay http(s) on purpose: Chrome makes a WebAPK only when the manifest's and
//   icons' URLs are http(s) (with a blob: manifest and data: icons it only offered a home screen shortcut). The link
//   is moved once the service worker controls the page (on a first visit it takes over just after loading); without
//   one, the query is ignored by the server and the placeholders answer.
// - "홈 화면에 추가" shortcuts and Safari read the page's icon / apple-touch-icon links, pointed at the icon (data: URLs).
import { apkIcon, isIconPath } from '../extract/build';
import { readZip } from '../extract/zip';
import { readIcons, writeIcons, type AppIcons } from './assetStore';

/** file name under icons/ -> size; apple-touch-icon gets an opaque background (iOS paints transparency black) */
const SIZES: [name: string, size: number, opaque: boolean][] = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['apple-touch-icon.png', 180, true],
];

/** Pixel art: nearest-neighbour up by a whole factor to at least the size, then one smooth step down to it */
async function makeIcons(png: Uint8Array): Promise<AppIcons> {
  const img = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
  const icons: AppIcons = {};
  for (const [name, size, opaque] of SIZES) {
    const k = Math.ceil(size / Math.max(img.width, img.height));
    const big = document.createElement('canvas');
    big.width = img.width * k;
    big.height = img.height * k;
    const bg = big.getContext('2d')!;
    bg.imageSmoothingEnabled = false;
    bg.drawImage(img, 0, 0, big.width, big.height);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    if (opaque) { g.fillStyle = '#000'; g.fillRect(0, 0, size, size); }
    g.imageSmoothingQuality = 'high';
    const s = size / Math.max(big.width, big.height);
    const w = big.width * s, h = big.height * s;
    g.drawImage(big, (size - w) / 2, (size - h) / 2, w, h);
    icons[name] = await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => b ? resolve(b) : reject(new Error('icon encode')), 'image/png'));
  }
  img.close();
  return icons;
}

const dataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

/** The service worker that answers the icons, waited for a few seconds on a first visit; false without one */
async function controlled(): Promise<boolean> {
  const sw = navigator.serviceWorker;
  if (!sw) return false;
  if (sw.controller) return true;
  if (!(await sw.getRegistration())) return false;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 10000);
    sw.addEventListener('controllerchange', () => { clearTimeout(t); resolve(true); }, { once: true });
  });
}

/** Move the page's manifest link (the public build's only) to the service worker's copy with the stored icons */
async function useStoredManifest(icons: AppIcons): Promise<void> {
  const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const b = icons['icon-512.png'];
  if (!link || !b || !(await controlled())) return;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()));
  const v = [...h.subarray(0, 6)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const url = new URL(link.href);
  url.search = `?apk=${v}`;
  if (link.href !== url.href) link.href = url.href;
}

/** Point the page's apple-touch-icon and favicon at the icon (data: URLs), and its manifest at the stored icons */
async function showIcons(icons: AppIcons): Promise<void> {
  const urls: Record<string, string> = {};
  for (const [name, b] of Object.entries(icons)) urls[name] = await dataUrl(b);
  for (const [rel, name] of [['apple-touch-icon', 'apple-touch-icon.png'], ['icon', 'icon-192.png']] as const) {
    if (!urls[name]) continue;
    let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      document.head.append(link);
    }
    link.type = 'image/png';
    link.href = urls[name];
  }
  // not awaited: a first visit waits for the service worker, the game does not
  void useStoredManifest(icons).catch((e) => console.warn('app icon manifest:', e));
}

/** Use the APK's icon for the app: `png` = the launcher icon of an APK just extracted (made and stored again);
 *  otherwise the stored icons, or, for a build stored before icons were kept, the icon read from the stored `apk`.
 *  Never throws: the game runs the same without it. */
export async function useAppIcon(db: IDBDatabase | null, png?: Uint8Array, apk?: Blob): Promise<void> {
  try {
    let icons = db && !png ? await readIcons(db) : undefined;
    if (!icons) {
      png ??= apk ? apkIcon(await readZip(new Uint8Array(await apk.arrayBuffer()), isIconPath)) : undefined;
      if (!png) return;
      icons = await makeIcons(png);
      if (db) await writeIcons(db, icons);
    }
    await showIcons(icons);
  } catch (e) {
    console.warn('app icon:', e);
  }
}
