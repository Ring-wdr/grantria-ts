// The installed web app's icon from the player's own APK: its launcher icon (72x72 in the known release) is made
// into the PWA icon sizes here and kept in IndexedDB with the rest of the build. pwa/sw.js answers the manifest's
// icons/*.png from there, so the manifest and its URLs stay fixed and the browser installs (or later updates) the app
// with the original icon; without an APK it falls back to the placeholder icons shipped in pwa/icons. Safari reads
// apple-touch-icon from the page when it is added to the home screen, so the page's links point at the icon too.
// Nothing leaves the device, and the public build still carries no game art.
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

/** Point the page's apple-touch-icon and favicon at the icon (data: URLs, which Safari's home screen can read) */
async function showIcons(icons: AppIcons): Promise<void> {
  for (const [rel, name] of [['apple-touch-icon', 'apple-touch-icon.png'], ['icon', 'icon-192.png']] as const) {
    const b = icons[name];
    if (!b) continue;
    let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      document.head.append(link);
    }
    link.type = 'image/png';
    link.href = await dataUrl(b);
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
