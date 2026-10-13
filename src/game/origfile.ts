// Original save files <-> web data (analysis/features/account.md §1, §5; tools/grantria_account.py):
// save.dat (3 slots × 0x3378), gamedata.dat (0x3d8), XTEA ECB with the game key, slot checksum
// +0x3370 = Σ[0, 0x3370) after the member number at +0x3340, gamedata checksum +0x3a8 = Σ[0, 0x3a8).
// Also the plain JSON backup of everything the web port keeps in localStorage.
import type { AccountData } from './account';
import type { Item, QuickSlot } from './items';
import type { SaveData } from './save';

export const SLOT_SIZE = 0x3378, SAVE_SIZE = SLOT_SIZE * 3, GD_SIZE = 0x3d8, OPT_SIZE = 0x90;
const ITEM = 0x5c, MEMBER_OFF = 0x3340, SUM_OFF = 0x3370;
const KEY = [0xa1a82989, 0x81840585, 0xd2d416c6, 0x63080125], DELTA = 0x9e3779b9;

/** XTEA 32 rounds, ECB, little endian; a trailing partial block is left as is */
export function xtea(buf: Uint8Array, enc: boolean): Uint8Array {
  const out = buf.slice(), dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let o = 0; o + 8 <= out.length; o += 8) {
    let v0 = dv.getUint32(o, true), v1 = dv.getUint32(o + 4, true), s = enc ? 0 : Math.imul(DELTA, 32) >>> 0;
    for (let i = 0; i < 32; i++) {
      if (enc) {
        v0 = (v0 + ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (s + KEY[s & 3]))) >>> 0;
        s = (s + DELTA) >>> 0;
        v1 = (v1 + ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (s + KEY[(s >>> 11) & 3]))) >>> 0;
      } else {
        v1 = (v1 - ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (s + KEY[(s >>> 11) & 3]))) >>> 0;
        s = (s - DELTA) >>> 0;
        v0 = (v0 - ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (s + KEY[s & 3]))) >>> 0;
      }
    }
    dv.setUint32(o, v0, true); dv.setUint32(o + 4, v1, true);
  }
  return out;
}
const sum8 = (b: Uint8Array, end: number) => { let s = 0; for (let i = 0; i < end; i++) s += b[i]; return s & 0xff; };
export function memberFromName(name: string): bigint { const m = /\.(\d+)$/.exec(name); return m ? BigInt(m[1]) : 0n; }

const b64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---- CP949 item names
let cp949: Map<string, number> | null = null;
function encodeCp949(s: string): number[] {
  if (!cp949) {
    cp949 = new Map();
    const dec = new TextDecoder('euc-kr');
    for (let a = 0x81; a <= 0xfe; a++) for (let b = 0x41; b <= 0xfe; b++) {
      const ch = dec.decode(new Uint8Array([a, b]));
      if (ch.length === 1 && ch !== '�' && !cp949.has(ch)) cp949.set(ch, (a << 8) | b);
    }
  }
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) out.push(c);
    else { const v = cp949.get(ch); if (v !== undefined) out.push(v >> 8, v & 0xff); else out.push(0x3f); }
  }
  return out;
}

// ---- bitsets (FUN_0007b240, MSB first)
function bitsGet(b: Uint8Array, off: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if ((b[off + (i >> 3)] >> (7 - (i & 7))) & 1) out.push(i);
  return out;
}
function bitsPut(b: Uint8Array, off: number, n: number, idx: Iterable<number>): void {
  for (let i = 0; i < n; i++) b[off + (i >> 3)] &= ~(0x80 >> (i & 7)) & 0xff;
  for (const i of idx) if (i >= 0 && i < n) b[off + (i >> 3)] |= 0x80 >> (i & 7);
}

// ---- items (0x5c records)
function parseItem(b: Uint8Array, o: number): Item | null {
  const dv = new DataView(b.buffer, b.byteOffset), t = b[o + 0x10];
  if (t === 0xff) return null;
  const options: [number, number][] = [];
  for (let k = 0; k < 12; k++) if (b[o + 0x1b + 2 * k] !== 0xff) options.push([b[o + 0x1b + 2 * k], b[o + 0x1c + 2 * k]]);
  const raw = b.subarray(o + 0x33, o + 0x5c), end = raw.indexOf(0);
  return {
    type: t, sub: b[o + 0x11], grade: b[o + 0x12], base: dv.getUint16(o + 4, true), icon: dv.getUint16(o + 6, true),
    count: ~dv.getUint16(o + 8, true) & 0xffff, price: dv.getUint16(o + 0x0a, true), enh: dv.getUint16(o + 0x0c, true),
    level: b[o + 0x0e], reqLevel: b[o + 0x0f], aux: b[o + 0x14], sockets: [...b.subarray(o + 0x15, o + 0x1b)], options,
    name: new TextDecoder('euc-kr').decode(raw.subarray(0, end < 0 ? raw.length : end)), uid: dv.getUint32(o, true),
  } as Item;
}
function putItem(b: Uint8Array, o: number, it: Item | null | undefined, ticks: number): void {
  const dv = new DataView(b.buffer, b.byteOffset);
  b.fill(0, o, o + ITEM);
  if (!it) { b[o + 8] = b[o + 9] = 0xff; b[o + 0x10] = 0xff; b.fill(0xff, o + 0x15, o + 0x1b); for (let k = 0; k < 12; k++) b[o + 0x1b + 2 * k] = 0xff; return; }
  const uid = (it as Item & { uid?: number }).uid ?? (((ticks << 8) | (o & 0xff)) >>> 0);
  dv.setUint32(o, uid >>> 0, true); dv.setUint16(o + 4, it.base & 0xffff, true); dv.setUint16(o + 6, it.icon & 0xffff, true);
  dv.setUint16(o + 8, ~it.count & 0xffff, true); dv.setUint16(o + 0x0a, (it.price ?? 0) & 0xffff, true); dv.setUint16(o + 0x0c, it.enh & 0xffff, true);
  b[o + 0x0e] = it.level; b[o + 0x0f] = it.reqLevel; b[o + 0x10] = it.type; b[o + 0x11] = it.sub; b[o + 0x12] = it.grade; b[o + 0x14] = it.aux ?? 0;
  const s = [...(it.sockets ?? []), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff].slice(0, 6);
  b.set(s, o + 0x15);
  const opts = [...(it.options ?? [])].slice(0, 12);
  for (let k = 0; k < 12; k++) { const p = opts[k]; b[o + 0x1b + 2 * k] = p ? p[0] : 0xff; b[o + 0x1c + 2 * k] = p ? p[1] & 0xff : 0; }
  b.set(encodeCp949(it.name ?? '').slice(0, 40), o + 0x33);
}

/** fields of the original slot the web SaveData has no place for, kept for export */
export interface SlotOrig { raw?: string; questItems?: (Item | null)[]; memberNo?: string; checksumOk?: boolean }

/** one plaintext slot -> web SaveData (book and day come from gamedata) */
export function parseSlot(b: Uint8Array, gd: Partial<OrigAccount> | null, slot: number): (SaveData & { orig?: SlotOrig }) | null {
  const dv = new DataView(b.buffer, b.byteOffset), u16 = (o: number) => dv.getUint16(o, true), s16 = (o: number) => dv.getInt16(o, true), u32 = (o: number) => dv.getUint32(o, true);
  const ticks = u32(0x2fe8);
  if (!ticks) return null;
  const raw: (Item | null)[] = Array.from({ length: 100 }, (_, i) => parseItem(b, i * ITEM));
  const remap = new Map<number, number>(), items: Item[] = [];
  raw.forEach((it, i) => { if (it) { remap.set(i, items.length); items.push(it); } });
  const quick: QuickSlot[] = Array.from({ length: 6 }, (_, q) => {
    const o = 0x2c34 + 8 * q, kind = b[o + 6];
    let id = s16(o + 4);
    if (kind === 2) id = remap.get(id) ?? -1;
    const it = kind === 2 && id >= 0 ? items[id] : undefined;
    return { kind: kind === 1 || kind === 2 ? kind : 0, id, cd: s16(o), maxCd: s16(o + 2), itemType: b[o + 7], itemSub: it?.sub ?? 0 };
  });
  const active: { q: number; cnt: number; pct: number }[] = [];
  for (let k = 0; k < 6; k++) if (b[0x327e + k] !== 0xff) active.push({ q: b[0x327e + k], cnt: u16(0x3284 + 2 * k), pct: 0 });
  const gold = ~u32(0x2fe4) >>> 0;
  const titles: number[] = [];
  for (let k = 0; k < 56; k++) if (b[0x2e80 + k]) titles.push(k);
  const challenges: number[] = [];
  for (let k = 0; k < 50; k++) if (b[0x2c68 + 8 * k]) challenges.push(k);
  return {
    version: 1, cls: b[0x31c9] as 0 | 1 | 2, level: ~b[0x31cd] & 0xff, exp: u32(0x2fdc), gold,
    stats: [u16(0x30f2), u16(0x30f4), u16(0x30f6), u16(0x30f8)], statPoints: ~u16(0x30fa) & 0xffff,
    map: s16(0x30dc), zone: b[0x3104], x: s16(0x30e0), y: s16(0x30e2), dir: (b[0x31ce] & 3) as 0 | 1 | 2 | 3,
    hp: s16(0x30d8), mp: s16(0x30da), playTicks: ticks, savedAt: Date.now(),
    skills: [...b.subarray(0x3141, 0x3151)], skillPoints: ~b[0x31cb] & 0xff,
    buffs: Array.from({ length: 35 }, (_, i) => [u32(0x2ec4 + 8 * i), b[0x2ec9 + 8 * i]] as [number, number]),
    day: gd?.day?.[slot] ?? 0, returnZone: b[0x3290],
    story: {
      done: bitsGet(b, 0x31ad, 164), qs: [...b.subarray(0x31e1, 0x3279)], active, zones: [], maps: bitsGet(b, 0x3175, 0x38 * 8),
      book: gd?.book ?? undefined, collect: bitsGet(b, 0x3171, 32), chests: bitsGet(b, 0x3292, 15 * 8), doors: bitsGet(b, 0x32a1, 16),
      stones: bitsGet(b, 0x31d5, 12 * 8), gather: { lv: u32(0x2ec0), exp: u32(0x2ebc) }, dimClears: u16(0x3100),
      titles, title: b[0x2eb8], challenges, counters: { vermutKills: u16(0x30fe) },
    } as SaveData['story'],
    packs: [Math.min(10, b[0x32a7]), Math.min(10, b[0x32a8])],
    inv: { items, equip: Array.from({ length: 6 }, (_, k) => parseItem(b, 0x23f0 + k * ITEM)), quick, gold, bags: Math.min(2, b[0x327c]), unlocks: b[0x32a5] & 0x0f,
      keys: Array.from({ length: 17 }, (_, k) => parseItem(b, 0x2618 + k * ITEM)).filter((x): x is Item => !!x) },
    orig: { raw: b64(b), questItems: Array.from({ length: 17 }, (_, k) => parseItem(b, 0x2618 + k * ITEM)), memberNo: dv.getBigInt64(MEMBER_OFF, true).toString(),
      checksumOk: b[SUM_OFF] === sum8(b, SUM_OFF) },
  };
}

/** web SaveData -> plaintext slot (over the imported bytes when present), member number and checksum */
export function buildSlot(d: SaveData & { orig?: SlotOrig }, member: bigint): Uint8Array {
  const b = d.orig?.raw ? unb64(d.orig.raw) : new Uint8Array(SLOT_SIZE), dv = new DataView(b.buffer);
  const inv = d.inv ?? { items: [], equip: [null, null, null, null, null, null], quick: [], gold: d.gold, bags: 0 };
  const t = d.playTicks || 1;
  for (let i = 0; i < 100; i++) putItem(b, i * ITEM, inv.items[i], t);
  for (let k = 0; k < 6; k++) putItem(b, 0x23f0 + k * ITEM, inv.equip[k], t);
  for (let k = 0; k < 17; k++) putItem(b, 0x2618 + k * ITEM, inv.keys ? inv.keys[k] ?? null : d.orig?.questItems?.[k] ?? null, t);   // key store
  for (let k = 0; k < 6; k++) {
    const q = inv.quick[k] ?? { kind: 0, id: 0, cd: 0, maxCd: 0, itemType: 0, itemSub: 0 }, o = 0x2c34 + 8 * k;
    dv.setInt16(o, q.cd, true); dv.setInt16(o + 2, q.maxCd, true); dv.setInt16(o + 4, q.id, true); b[o + 6] = q.kind; b[o + 7] = q.itemType ?? 0;
  }
  const s = d.story;
  if (s) {
    for (let k = 0; k < 50; k++) b[0x2c68 + 8 * k] = s.challenges?.includes(k) ? 1 : 0;
    b.fill(0, 0x2e80, 0x2eb8);
    for (const k of s.titles ?? []) if (k < 56) b[0x2e80 + k] = 1;
    b[0x2eb8] = s.title ?? 0xff;
    dv.setUint32(0x2ebc, s.gather?.exp ?? 0, true); dv.setUint32(0x2ec0, s.gather?.lv ?? 0, true);
    bitsPut(b, 0x31ad, 164, s.done);
    b.set([...s.qs, ...new Array(152).fill(5)].slice(0, 152), 0x31e1);
    b.fill(0xff, 0x327e, 0x3284); b.fill(0, 0x3284, 0x3290);
    s.active.slice(0, 6).forEach((a, k) => { b[0x327e + k] = a.q; dv.setUint16(0x3284 + 2 * k, a.cnt, true); });
    bitsPut(b, 0x3175, 0x38 * 8, s.maps ?? []);
    bitsPut(b, 0x3171, 32, s.collect ?? []);
    bitsPut(b, 0x3292, 15 * 8, s.chests ?? []);
    bitsPut(b, 0x32a1, 16, s.doors ?? []);
    bitsPut(b, 0x31d5, 12 * 8, s.stones ?? []);
    dv.setUint16(0x3100, Math.min(65000, s.dimClears ?? 0), true);
    dv.setUint16(0x30fe, Math.min(65000, s.counters?.vermutKills ?? 0), true);
  }
  (d.buffs ?? []).slice(0, 35).forEach(([bt, on], i) => { dv.setUint32(0x2ec4 + 8 * i, bt >>> 0, true); b[0x2ec9 + 8 * i] = on; });
  dv.setUint32(0x2fdc, d.exp >>> 0, true); dv.setUint32(0x2fe4, ~(inv.gold ?? d.gold) >>> 0, true); dv.setUint32(0x2fe8, t >>> 0, true);
  dv.setInt16(0x30d8, d.hp, true); dv.setInt16(0x30da, d.mp, true); dv.setInt16(0x30dc, d.map, true);
  dv.setInt16(0x30e0, d.x, true); dv.setInt16(0x30e2, d.y, true);
  d.stats.forEach((v, k) => dv.setUint16(0x30f2 + 2 * k, v, true));
  dv.setUint16(0x30fa, ~d.statPoints & 0xffff, true);
  b[0x3104] = d.zone ?? 0;
  b.set([...(d.skills ?? []), ...new Array(16).fill(0)].slice(0, 16), 0x3141);
  b[0x31c9] = d.cls; b[0x31cb] = ~(d.skillPoints ?? 0) & 0xff; b[0x31cd] = ~d.level & 0xff;
  b[0x31ce] = (b[0x31ce] & 0xfc) | (d.dir & 3);
  b[0x3279] = inv.items.length; b[0x3290] = d.returnZone ?? 0;
  const bags = inv.bags ?? 0;
  b[0x327c] = bags; b[0x31cc] = (bags + 3) * 16;
  b[0x32a5] = (b[0x32a5] & 0xf0) | ((inv.unlocks ?? 0) & 0x0f);                // permanent unlock bits
  b[0x32a7] = d.packs?.[0] ?? 0; b[0x32a8] = d.packs?.[1] ?? 0;               // AP / SP packs
  dv.setBigInt64(MEMBER_OFF, member, true);
  b[SUM_OFF] = sum8(b, SUM_OFF);
  return b;
}

// ---- gamedata
export interface OrigAccount {
  book: ({ k: number; d: number; z: number } | null)[];
  traitPoints: number; traits: number[]; traitBought: number; memberNo: string; checksumOk: boolean;
  day: number[]; unsavedUse: number[][]; lap: number[]; raw: string;
}
export function parseGamedata(b: Uint8Array): OrigAccount {
  const dv = new DataView(b.buffer, b.byteOffset);
  const book = Array.from({ length: 40 }, (_, i) => (b[i * 20 + 0x0f] ? { k: dv.getUint32(i * 20, true), d: dv.getInt32(i * 20 + 4, true), z: dv.getInt16(i * 20 + 8, true) } : null));
  return {
    book, traitPoints: b[0x35c], traits: [...b.subarray(0x35d, 0x369)], traitBought: b[0x371], memberNo: dv.getBigInt64(0x378, true).toString(),
    checksumOk: b[0x3a8] === sum8(b, 0x3a8), day: [0, 1, 2].map((s) => dv.getUint16(0x3b0 + 2 * s, true)),
    unsavedUse: [0, 1, 2].map((s) => [0, 1, 2, 3, 4].map((j) => dv.getUint16(0x3b6 + 10 * s + 2 * j, true))), lap: [...b.subarray(0x3d4, 0x3d7)], raw: b64(b),
  };
}
/** gamedata from the account, the books / days of the slots; trait caches, member number, checksum */
export function buildGamedata(a: AccountData, d8: (o: number) => number, book: ({ k: number; d: number; z: number } | null)[], day: number[], member: bigint): Uint8Array {
  const b = a.raw ? unb64(a.raw) : new Uint8Array(GD_SIZE), dv = new DataView(b.buffer);
  book.forEach((e, i) => {
    const o = i * 20;
    b.fill(0, o, o + 20);
    if (!e) return;
    dv.setUint32(o, e.k >>> 0, true); dv.setInt32(o + 4, e.d, true); dv.setInt16(o + 8, e.z, true);
    b[o + 0x0a] = d8(0x23e3b + i); b[o + 0x0f] = 1; b[o + 0x10] = i; b[o + 0x11] = d8(0x251a3 + (i + 3) * 12);
  });
  b[0x35c] = a.traitPoints; b.set(a.traits.slice(0, 12), 0x35d);
  for (let k = 4; k < 12; k++) b[0x365 + k] = (a.traits[k - 1] * d8(0x2543b + (k - 1) * 3)) & 0xff;
  b[0x371] = a.traitBought;
  dv.setBigInt64(0x378, member, true);
  day.forEach((v, s) => dv.setUint16(0x3b0 + 2 * s, v & 0xffff, true));
  (a.unsavedUse ?? []).forEach((u, s) => u.forEach((v, j) => dv.setUint16(0x3b6 + 10 * s + 2 * j, v & 0xffff, true)));
  b.set(a.lap.slice(0, 3), 0x3d4);
  b[0x3a8] = sum8(b, 0x3a8);
  return b;
}

/** option.dat 0x90 (account.md §4): values +0x45..+0x49, menu working copy +0x3c..+0x40, checksum +0x30 */
const OPT_ORDER = ['volume', 'vibration', 'speed', 'effects', 'minimap'] as const;
export function parseOption(b: Uint8Array): Record<(typeof OPT_ORDER)[number], number> & { raw: string } {
  const o = Object.fromEntries(OPT_ORDER.map((k, i) => [k, b[0x45 + i]])) as Record<(typeof OPT_ORDER)[number], number>;
  return { ...o, raw: b64(b) };
}
export function buildOption(o: Record<(typeof OPT_ORDER)[number], number>, raw?: string): Uint8Array {
  const b = raw ? unb64(raw) : new Uint8Array(OPT_SIZE);
  OPT_ORDER.forEach((k, i) => { b[0x45 + i] = o[k]; b[0x3c + [0, 1, 2, 4, 3][i]] = o[k]; });   // working copy order: volume, vibration, speed, minimap, effects
  b[0x30] = sum8(b, 0x30);
  return b;
}

/** identify by size: 0x9a68 save, 0x3d8 gamedata, 0x90 option */
export function fileKind(size: number): 'save' | 'gamedata' | 'option' | null {
  return size === SAVE_SIZE ? 'save' : size === GD_SIZE ? 'gamedata' : size === OPT_SIZE ? 'option' : null;
}

// ---- JSON backup of the web data
export function backupJson(): string {
  const out: Record<string, string> = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith('grantria.')) out[k] = localStorage.getItem(k)!; } } catch { /* storage unavailable */ }
  return JSON.stringify({ app: 'grantria-ts', version: 1, at: new Date().toISOString(), data: out }, null, 1);
}
export function restoreJson(text: string): number {
  const j = JSON.parse(text) as { app?: string; data?: Record<string, string> };
  if (j.app !== 'grantria-ts' || !j.data) throw new Error('not a grantria-ts backup');
  let n = 0;
  for (const [k, v] of Object.entries(j.data)) if (k.startsWith('grantria.')) { localStorage.setItem(k, v); n++; }
  return n;
}
