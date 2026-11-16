// Assets made from the player's own APK, kept in this browser / webview (IndexedDB) and served as blob URLs.
// Nothing leaves the device: the page only reads the APK the player picks.
import type { AssetSource } from '../core/platform';

const DB = 'grantria-assets', FILES = 'files', META = 'meta';

export interface StoredBuild {
  /** EXTRACT_VERSION the files were made with */
  version: number;
  /** the APK matched the known release */
  known: boolean;
  count: number;
  date: number;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 저장 실패'));
  });
}

export function openStore(): Promise<IDBDatabase> {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore(FILES);
    r.result.createObjectStore(META);
  };
  return req(r);
}

export async function readMeta(db: IDBDatabase): Promise<{ build?: StoredBuild; apk?: Blob }> {
  const tx = db.transaction(META, 'readonly'), st = tx.objectStore(META);
  const [build, apk] = await Promise.all([req(st.get('build')), req(st.get('apk'))]);
  return { build: build as StoredBuild | undefined, apk: apk as Blob | undefined };
}

/** Replace every stored file at once (one transaction: a cut-off write leaves the previous build) */
export async function writeBuild(db: IDBDatabase, files: Map<string, Blob>, build: StoredBuild, apk: Blob | null): Promise<void> {
  const tx = db.transaction([FILES, META], 'readwrite');
  const fs = tx.objectStore(FILES), meta = tx.objectStore(META);
  fs.clear();
  for (const [path, blob] of files) fs.put(blob, path);
  meta.put(build, 'build');
  if (apk) meta.put(apk, 'apk');
  await done(tx);
}

export async function clearStore(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([FILES, META], 'readwrite');
  tx.objectStore(FILES).clear();
  tx.objectStore(META).clear();
  await done(tx);
}

/** The stored files as an AssetSource; url() makes one blob URL per file on first use. */
export async function storedAssetSource(db: IDBDatabase): Promise<AssetSource> {
  const tx = db.transaction(FILES, 'readonly'), st = tx.objectStore(FILES);
  const [keys, blobs] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]);
  return memoryAssetSource(new Map(keys.map((k, i) => [String(k), blobs[i] as Blob])));
}

export function memoryAssetSource(files: Map<string, Blob>): AssetSource {
  const urls = new Map<string, string>();
  const get = (path: string) => {
    const b = files.get(path);
    if (!b) return Promise.reject(new Error(`${path}: 추출된 에셋에 없습니다`));
    return Promise.resolve(b);
  };
  return {
    bytes: async (path) => new Uint8Array(await (await get(path)).arrayBuffer()),
    json: async <T>(path: string) => JSON.parse(await (await get(path)).text()) as T,
    url(path) {
      let u = urls.get(path);
      if (!u) {
        const b = files.get(path);
        u = b ? URL.createObjectURL(b) : `about:blank#missing/${path}`;
        urls.set(path, u);
      }
      return u;
    },
  };
}
