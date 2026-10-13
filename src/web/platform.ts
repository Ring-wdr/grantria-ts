// Browser platform: localStorage, file input / download, fetch from the Vite base, navigator.vibrate.
import { MemoryStore, type AssetSource, type FilePort, type KeyValueStore, type Platform } from '../core/platform';

/** localStorage, or memory when it is blocked (private mode, disabled site data) */
function webStorage(): KeyValueStore {
  try {
    const ls = window.localStorage, probe = 'grantria.probe';
    ls.setItem(probe, '1'); ls.removeItem(probe);
    return {
      get: (k) => { try { return ls.getItem(k); } catch { return null; } },
      set: (k, v) => ls.setItem(k, v),
      remove: (k) => { try { ls.removeItem(k); } catch { /* storage unavailable */ } },
      keys: () => { const out: string[] = []; for (let i = 0; i < ls.length; i++) out.push(ls.key(i)!); return out; },
    };
  } catch {
    return new MemoryStore();
  }
}

export const webFiles: FilePort = {
  async save(name, data, mime) {
    const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  open(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept; input.multiple = multiple; input.style.display = 'none';
      let done = false;
      const finish = async (files: File[]) => {
        if (done) return;
        done = true;
        input.remove();
        resolve(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      };
      input.onchange = () => void finish([...(input.files ?? [])]);
      input.addEventListener('cancel', () => void finish([]));       // closing the picker without a file
      // older browsers have no 'cancel': the window gets the focus back without a change
      addEventListener('focus', () => setTimeout(() => { if (!input.files?.length) void finish([]); }, 1000), { once: true });
      document.body.appendChild(input); input.click();
    });
  },
};

/** assets/ next to the page (Vite base URL) */
export function webAssetSource(base = `${import.meta.env.BASE_URL}assets/`): AssetSource {
  const get = async (path: string) => {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res;
  };
  return {
    bytes: async (path) => new Uint8Array(await (await get(path)).arrayBuffer()),
    json: async <T>(path: string) => (await get(path)).json() as Promise<T>,
    url: (path) => base + path,
  };
}

/** phone vibration and the rumble motor of every connected gamepad */
export function webVibrate(ms: number): void {
  try { navigator.vibrate?.(ms); } catch { /* not allowed (no user gesture yet, or blocked) */ }
  let pads: (Gamepad | null)[] = [];
  try { pads = navigator.getGamepads?.() ?? []; } catch { return; }
  for (const gp of pads) {
    const act = (gp as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    if (act?.playEffect) void act.playEffect('dual-rumble', { duration: ms, strongMagnitude: 1, weakMagnitude: 1 }).catch(() => {});
  }
}

export function createWebPlatform(): Platform {
  return {
    name: 'web',
    storage: webStorage(),
    files: webFiles,
    assets: webAssetSource(),
    now: () => performance.now(),
    vibrate: webVibrate,
    prompt: async (message, initial) => window.prompt(message, initial),
  };
}
