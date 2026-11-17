// The installed web app's icon from the player's own APK: its launcher icon (72x72 in the known release) is made
// into the PWA icon sizes here and kept in IndexedDB with the rest of the build. Without an APK the placeholder icons
// shipped in pwa/icons stay. Nothing leaves the device, and the public build still carries no game art.
// - Chrome's install ("앱 설치", the WebAPK) takes the manifest's icons, downloaded by the browser itself and kept per
//   manifest URL for the page: answering icons/*.png from the service worker was not enough (the page's first visit
//   is not controlled yet, and the browser's download need not go through it). So the page's manifest link is swapped
//   for a blob: copy of pwa/manifest.webmanifest whose icons are data: URLs. The new URL makes Chrome read it again,
//   and the icons need no request at all. `id` stays as written, so the installed app is the same app.
// - "홈 화면에 추가" shortcuts and Safari read the page's icon / apple-touch-icon links, pointed at the icon too.
// pwa/sw.js still answers icons/*.png from the store for anything that requests those URLs.
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

/** Swap the page's manifest (the public build's only) for a copy with the icons inline */
async function inlineManifest(urls: Record<string, string>): Promise<void> {
  const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return;
  // the shipped manifest, kept so a later call does not read the blob copy
  const src = link.dataset.src ??= link.href;
  const m = await (await fetch(src)).json() as Record<string, unknown>;
  // a blob: URL is no base for relative URLs: make them absolute against the shipped manifest (id is resolved
  // against start_url's origin by the browser, so it stays as written and the app keeps its identity)
  for (const k of ['start_url', 'scope'] as const) if (typeof m[k] === 'string') m[k] = new URL(m[k] as string, src).href;
  m.icons = [['icon-192.png', 192], ['icon-512.png', 512]].filter(([n]) => urls[n])
    .map(([n, s]) => ({ src: urls[n], sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' }));
  const old = link.href;
  link.href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' }));
  if (old.startsWith('blob:')) URL.revokeObjectURL(old);
}

/** Point the page's manifest, apple-touch-icon and favicon at the icon (data: URLs) */
async function showIcons(icons: AppIcons): Promise<void> {
  const urls: Record<string, string> = {};
  for (const [name, b] of Object.entries(icons)) urls[name] = await dataUrl(b);
  if (urls['icon-192.png'] || urls['icon-512.png']) await inlineManifest(urls);
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
