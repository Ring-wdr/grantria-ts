// Tauri platform: what the native side can do, it does, reached only through Tauri (invoke, events, plugins).
// - saves: Rust saves_* commands, one file per key in the app data folder, written atomically (saves.rs)
// - files: native open / save dialogs; a picked file's name from the native plugin (Android: content:// URI)
// - vibration: native plugin (Android vibrator) plus the webview's pad rumble
// - background: the 'host-pause' event (window minimised, Android onPause / onResume) and page visibility
// - back key (Android): Tauri's 'back-button' event; when the game does not use it, a native question, then exit
// Rendering, audio and input stay the webview's: Tauri runs the same web app in the OS webview.
import { exit, onBackButtonPress } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import type { FilePort, KeyValueStore, Platform } from '../core/platform';
import { PageLifecycle, padRumble, promptDialog, webAssetSource } from '../web/platform';

/** Every save read into memory at boot; writes update memory at once and go to the files in order, one
 *  batch in flight at a time (the latest value of a key wins). */
async function appDataStore(): Promise<KeyValueStore> {
  const mem = new Map(Object.entries(await invoke<Record<string, string>>('saves_load')));
  const pending = new Map<string, string | null>();
  let draining: Promise<void> | null = null;
  const drain = async () => {
    while (pending.size) {
      const entries = [...pending];
      pending.clear();
      try { await invoke('saves_write', { entries }); } catch (e) { console.error('save store:', e); }
    }
    draining = null;
  };
  const write = (k: string, v: string | null) => { pending.set(k, v); draining ??= drain(); };
  // first run: carry over what an early build kept in the webview's localStorage (the plugin-store file of the
  // builds after it is moved over by saves_load)
  if (!mem.size) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (!k.startsWith('grantria.')) continue;
        mem.set(k, localStorage.getItem(k)!);
        write(k, mem.get(k)!);
      }
    } catch { /* storage unavailable */ }
  }
  return {
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => { mem.set(k, v); write(k, v); },
    remove: (k) => { mem.delete(k); write(k, null); },
    keys: () => [...mem.keys()],
  };
}

/** '.json,application/json' -> dialog filter extensions ['json']; '*' -> no filter */
function extensions(accept: string): string[] {
  return accept.split(',').map((s) => s.trim()).filter((s) => s.startsWith('.')).map((s) => s.slice(1));
}

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
    return Promise.all(paths.map(async (p) => ({
      name: await invoke<string>('plugin:native|display_name', { path: p }),
      bytes: await readFile(p),
    })));
  },
};

export async function createTauriPlatform(): Promise<Platform> {
  const [storage, touchFirst] = await Promise.all([appDataStore(), invoke<boolean>('touch_first')]);
  const lifecycle = new PageLifecycle();
  await listen<boolean>('host-pause', (e) => lifecycle.setPaused(e.payload));
  // only mobile has the event; desktop refuses the listener, which is fine
  onBackButtonPress(async () => {
    if (lifecycle.back?.()) return;
    if (await ask('게임을 종료하시겠습니까?', { okLabel: '예', cancelLabel: '아니오' })) await exit(0);
  }).catch(() => {});
  return {
    name: 'tauri',
    storage,
    saveLocation: '세이브는 앱 데이터 폴더에 저장됩니다.',
    files: tauriFiles,
    // the game data ships in the frontend bundle for now (public/assets); an APK import into the
    // app data folder would swap this source
    assets: webAssetSource(),
    now: () => performance.now(),
    vibrate(ms) {
      invoke('plugin:native|vibrate', { ms }).catch(() => {});
      padRumble(ms);
    },
    refreshCap(on) {
      invoke('plugin:native|refresh_cap', { on }).catch(() => {});
    },
    prompt: promptDialog,                    // window.prompt is not available in every webview
    lifecycle,
    touchFirst: () => touchFirst,            // fixed by the build target (Rust cfg(mobile))
    onTouchFirstChange: () => {},
  };
}
