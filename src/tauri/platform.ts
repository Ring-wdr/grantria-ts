// Tauri platform: saves live in the app data folder (plugin-store file, not the webview's localStorage,
// which a webview reset could wipe), files go through native open / save dialogs. Rendering, audio and
// input are the browser ones: Tauri runs the same web app in the OS webview.
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { load } from '@tauri-apps/plugin-store';
import type { FilePort, KeyValueStore, Platform } from '../core/platform';
import { webAssetSource, webVibrate } from '../web/platform';
import { promptDialog } from '../web/render/promptDialog';

const STORE_FILE = 'grantria.json';

/** The store file read into memory at boot; writes update memory at once and the file in the background. */
async function appDataStore(): Promise<KeyValueStore> {
  const store = await load(STORE_FILE, { autoSave: 200, defaults: {} });
  const mem = new Map<string, string>();
  for (const [k, v] of await store.entries<string>()) if (typeof v === 'string') mem.set(k, v);
  // first run: carry over what an earlier build kept in the webview's localStorage
  if (!mem.size) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (!k.startsWith('grantria.')) continue;
        const v = localStorage.getItem(k)!;
        mem.set(k, v);
        void store.set(k, v);
      }
    } catch { /* storage unavailable */ }
  }
  const fail = (e: unknown) => console.error('save store:', e);
  return {
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => { mem.set(k, v); store.set(k, v).catch(fail); },
    remove: (k) => { mem.delete(k); store.delete(k).catch(fail); },
    keys: () => [...mem.keys()],
  };
}

/** '.json,application/json' -> dialog filter extensions ['json']; '*' -> no filter */
function extensions(accept: string): string[] {
  return accept.split(',').map((s) => s.trim()).filter((s) => s.startsWith('.')).map((s) => s.slice(1));
}
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

const tauriFiles: FilePort = {
  async save(name, data, _mime) {
    const ext = name.includes('.') ? [name.slice(name.lastIndexOf('.') + 1)] : [];
    const path = await save({ defaultPath: name, filters: ext.length ? [{ name: ext[0].toUpperCase(), extensions: ext }] : undefined });
    if (!path) return;
    await writeFile(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  },
  async open(accept, multiple) {
    const ext = extensions(accept);
    const picked = await open({ multiple, directory: false, filters: ext.length ? [{ name: ext.join(', '), extensions: ext }] : undefined });
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    return Promise.all(paths.map(async (p) => ({ name: baseName(p), bytes: await readFile(p) })));
  },
};

export async function createTauriPlatform(): Promise<Platform> {
  return {
    name: 'tauri',
    storage: await appDataStore(),
    files: tauriFiles,
    // the game data ships in the frontend bundle for now (public/assets); an APK import into the
    // app data folder would swap this source
    assets: webAssetSource(),
    now: () => performance.now(),
    vibrate: webVibrate,                     // desktop webviews: gamepad rumble only
    prompt: promptDialog,                    // window.prompt is not available in every webview
  };
}
