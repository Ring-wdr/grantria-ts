// The player's own grantria.apk, read in the browser (or a Tauri webview, or node for tests): an APK is a zip,
// and the game files sit in it as they are (assets/*.dat|pal|pxl, lib/armeabi/libGrantria.so, res/raw/sN.ogg),
// so no apktool is needed. Only stored (0) and deflated (8) entries occur.

/** The files of an APK by their path in the zip ('assets/d.dat', 'res/raw/s0.ogg'). */
export interface ApkFiles {
  /** a file's bytes, undefined when the APK has none */
  get(path: string): Uint8Array | undefined;
  /** paths starting with prefix, sorted */
  list(prefix: string): string[];
}

/** One output file of the asset build: path under assets/ ('images/x.png', 'maps/m000.json') and its bytes,
 *  or JSON text. Builders await it, so a sink can store as it goes and report progress. */
export type Emit = (path: string, data: Uint8Array | string) => void | Promise<void>;

/** JSON as tools/build_web_assets.py dump writes it (compact; the key order of the object) */
export const jsonText = (obj: unknown): string => JSON.stringify(obj);

/** Raw-deflate decode through the platform's DecompressionStream (browsers, webviews, node). */
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read every entry whose path passes keep (all by default). Throws on a file that is not a zip. */
export async function readZip(bytes: Uint8Array, keep: (path: string) => boolean = () => true): Promise<ApkFiles> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // end of central directory: the last 'PK\5\6' within the trailing comment window
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('APK(zip) 파일이 아닙니다');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  const jobs: Promise<void>[] = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('APK 중앙 디렉터리가 손상되었습니다');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || !keep(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) jobs.push(inflateRaw(raw).then((b) => { files.set(name, b); }));
    else throw new Error(`${name}: 지원하지 않는 압축 방식 ${method}`);
  }
  await Promise.all(jobs);
  const names = [...files.keys()].sort();
  return {
    get: (path) => files.get(path),
    list: (prefix) => names.filter((n) => n.startsWith(prefix)),
  };
}
