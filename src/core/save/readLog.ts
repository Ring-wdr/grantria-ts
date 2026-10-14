// 읽은 대사 (not in the original): game text ids of dialogue pages already dismissed, shared by every slot like the
// options. Read lines can be fast-forwarded (편의 설정 빨리 넘기기) and are marked in the dialogue box.
// Stored as a bitset in base64 under its own key; the slot saves and option.dat are not touched.
import { loadJson, saveJson } from '../platform';
import { base64, unbase64 } from '../runtime';

const KEY = 'grantria.read';
/** text ids are 16-bit */
const BITS = 0x10000;

export class ReadLog {
  private bits = new Uint8Array(BITS >> 3);
  private dirty = false;

  static load(): ReadLog {
    const r = new ReadLog();
    const s = loadJson<string>(KEY);
    if (typeof s === 'string') {
      try { const b = unbase64(s); r.bits.set(b.subarray(0, r.bits.length)); } catch { /* corrupt: start empty */ }
    }
    return r;
  }

  has(id: number): boolean {
    return id >= 0 && id < BITS && (this.bits[id >> 3] & (1 << (id & 7))) !== 0;
  }

  mark(id: number): void {
    if (id < 0 || id >= BITS || this.has(id)) return;
    this.bits[id >> 3] |= 1 << (id & 7);
    this.dirty = true;
  }

  get count(): number {
    let n = 0;
    for (const b of this.bits) for (let v = b; v; v &= v - 1) n++;
    return n;
  }

  /** write when something new was read (called when a dialogue closes, not per page) */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let end = this.bits.length;
    while (end > 0 && this.bits[end - 1] === 0) end--;
    saveJson(KEY, base64(this.bits.subarray(0, end)));
  }
}

let shared: ReadLog | null = null;
/** the account-wide read log, loaded on first use */
export function readLog(): ReadLog { return (shared ??= ReadLog.load()); }
/** drop the loaded copy (tests, a backup import) so the next use reads storage again */
export function resetReadLogCache(): void { shared = null; }
