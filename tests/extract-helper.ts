// Extractor tests: the player's decoded APK (apk/, as in the README) read as ApkFiles, and the Python build's
// output (public/assets, npm run assets) as the reference. Both are local only, never committed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ApkFiles } from '../src/extract/zip.ts';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const APK_DIR = join(ROOT, 'apk');
export const REF_DIR = join(ROOT, 'public', 'assets');

export const skipExtract: string | false =
  existsSync(join(APK_DIR, 'assets', 'd.dat')) && existsSync(join(REF_DIR, 'tables.json')) ? false
    : 'needs apk/ (your own decoded APK) and public/assets (npm run assets)';

/** apk/ as ApkFiles, paths relative to it like inside the zip */
export function apkDir(dir = APK_DIR): ApkFiles {
  const names: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f), r = rel ? `${rel}/${f}` : f;
      if (statSync(p).isDirectory()) walk(p, r); else names.push(r);
    }
  };
  if (existsSync(dir)) walk(dir, '');
  names.sort();
  const set = new Set(names);
  return {
    get: (path) => set.has(path) ? new Uint8Array(readFileSync(join(dir, path))) : undefined,
    list: (prefix) => names.filter((n) => n.startsWith(prefix)),
  };
}

export const refJson = (path: string): unknown => JSON.parse(readFileSync(join(REF_DIR, path), 'utf-8'));
export const refBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(join(REF_DIR, path)));
