// Platform ports: everything core and the shared UI need from the host, so the same game runs in a
// browser (src/web/platform.ts), in a Tauri webview (src/tauri/platform.ts) or headless (tests).
// Core code only talks to these interfaces; it never touches window, localStorage or fetch.

/** Synchronous key-value store (save slots, options, account data). Hosts with async storage
 *  preload everything into memory at boot and write through in the background. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

/** a file the player picked */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

/** Save / open dialogs (original save import / export, JSON backup). */
export interface FilePort {
  save(name: string, data: string | Uint8Array, mime: string): Promise<void>;
  /** accept: comma-separated extensions or MIME types like an <input accept>; [] when cancelled */
  open(accept: string, multiple: boolean): Promise<PickedFile[]>;
}

/** Game data under assets/ (d.dat, text.json, cmf/*.json, maps/*.json, images/*.png). */
export interface AssetSource {
  bytes(path: string): Promise<Uint8Array>;
  json<T>(path: string): Promise<T>;
  /** URL the renderer can load (images, sounds) */
  url(path: string): string;
}

export interface Platform {
  readonly name: string;
  storage: KeyValueStore;
  files: FilePort;
  assets: AssetSource;
  /** monotonic milliseconds */
  now(): number;
  /** phone / pad rumble, ms */
  vibrate(ms: number): void;
  /** one-line text input; null when cancelled */
  prompt(message: string, initial: string): Promise<string | null>;
}

/** In-memory store (headless runs, or a host whose storage is blocked). */
export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  get(key: string): string | null { return this.m.get(key) ?? null; }
  set(key: string, value: string): void { this.m.set(key, value); }
  remove(key: string): void { this.m.delete(key); }
  keys(): string[] { return [...this.m.keys()]; }
}

const headless: Platform = {
  name: 'headless',
  storage: new MemoryStore(),
  files: { save: async () => {}, open: async () => [] },
  assets: {
    bytes: () => Promise.reject(new Error('no asset source')),
    json: () => Promise.reject(new Error('no asset source')),
    url: (p) => p,
  },
  now: () => Date.now(),
  vibrate: () => {},
  prompt: async () => null,
};

let current: Platform = headless;

/** Install the host platform once at boot, before the game starts. */
export function setPlatform(p: Platform): void { current = p; }
export function platform(): Platform { return current; }

/** JSON helpers over the store; storage errors read as missing and writes are dropped. */
export function loadJson<T>(key: string): T | null {
  try { const r = current.storage.get(key); return r ? JSON.parse(r) as T : null; } catch { return null; }
}
export function saveJson(key: string, value: unknown): void {
  try { current.storage.set(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
