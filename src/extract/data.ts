// Non-image game data from the player's APK, as tools/build_web_assets.py (build_maps / build_text / build_tables)
// and tools/grantria_data.py make it: maps/mNNN.json, text.json and tables.json. d.dat is the game DB loaded
// verbatim (Ghidra DAT_X -> offset X-0x3dc324); libGrantria.so .rodata sits at file offset = address - 0x10000.
import type { ApkFiles, Emit } from './zip';
import { jsonText } from './zip';

export const DDAT = 'assets/d.dat';
export const LIB_SO = 'lib/armeabi/libGrantria.so';

/** a file of the APK, or an error naming it */
export function need(files: ApkFiles, path: string): Uint8Array {
  const b = files.get(path);
  if (!b) throw new Error(`APK에 ${path} 파일이 없습니다`);
  return b;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** n little-endian s16 at off */
export function s16s(b: Uint8Array, off: number, n: number): number[] {
  const dv = view(b), out: number[] = [];
  for (let i = 0; i < n; i++) out.push(dv.getInt16(off + i * 2, true));
  return out;
}

// ---------------------------------------------------------------- text

const TEXT_FILES = 7;

export interface TextLine { id: number; file: number; line: number; text: string; comment: string }

const cp949 = new TextDecoder('euc-kr');   // WHATWG euc-kr is windows-949 (UHC), the codec of cp949

/** text0..6.dat: one string per LF-separated line, global id = d.dat s16[0x1a0 + 2*file] + line; a trailing
 *  "//comment" is an author note (FUN_000797b8). grantria_data.load_texts */
export function loadTexts(files: ApkFiles): TextLine[] {
  const starts = s16s(need(files, DDAT), 0x1a0, 8);
  const out: TextLine[] = [];
  for (let fi = 0; fi < TEXT_FILES; fi++) {
    const raw = need(files, `assets/text${fi}.dat`);
    const nl: number[] = [];
    raw.forEach((b, i) => { if (b === 0x0a) nl.push(i); });
    for (let j = 0; j < nl.length - 1; j++) {
      const seg = raw.subarray(nl[j] + 1, nl[j + 1]);
      let cut = -1;
      for (let i = 0; i + 1 < seg.length; i++) if (seg[i] === 0x2f && seg[i + 1] === 0x2f) { cut = i; break; }
      const body = cut < 0 ? seg : seg.subarray(0, cut), comment = cut < 0 ? seg.subarray(0, 0) : seg.subarray(cut + 2);
      out.push({ id: starts[fi] + j, file: fi, line: j, text: cp949.decode(body), comment: cp949.decode(comment) });
    }
  }
  return out;
}

// Python str.rstrip(): the characters str.isspace() accepts (wider than String.prototype.trimEnd)
const PY_SPACE = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
const pyRstrip = (s: string) => {
  let e = s.length;
  while (e > 0 && PY_SPACE.includes(s.charCodeAt(e - 1))) e--;
  return s.slice(0, e);
};

/** text.json: [text by global id], right-stripped, control codes kept */
export async function buildText(files: ApkFiles, emit: Emit): Promise<number> {
  const texts = loadTexts(files);
  const byId: string[] = new Array<string>(Math.max(...texts.map((t) => t.id)) + 1).fill('');
  for (const t of texts) byId[t.id] = pyRstrip(t.text);
  await emit('text.json', jsonText(byId));
  return texts.length;
}

// ---------------------------------------------------------------- maps

const HEADER_FIELDS = [
  'zone', 'width', 'height', 'tileset', 'objset', 'bgm', 'mapType',
  'monLevel', 'h8', 'nObjBg', 'nObjLow', 'nObjMid', 'nObjTop',
  'nGimmick', 'nActor', 'portalBytes'] as const;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** mNNN.dat (loader FUN_00018a74, setup FUN_0001dd48): 16-byte header, 6 object/entity lists, portal blob,
 *  W*H tile bytes, (W*H>>3)+1 bytes walk bitmap (MSB first, 1 = walkable). grantria_data.parse_map */
export function parseMap(data: Uint8Array): Record<string, unknown> {
  const dv = view(data);
  const hdr: Record<string, number> = {};
  HEADER_FIELDS.forEach((k, i) => { hdr[k] = data[i]; });
  const W = hdr.width, H = hdr.height;
  let p = 16;
  const objs = (n: number, keys: readonly string[]) => {
    const recs: Record<string, number>[] = [];
    for (let r = 0; r < n; r++) {
      const o: Record<string, number> = {};
      keys.forEach((k, i) => { o[k] = dv.getInt16(p + i * 2, true); });
      recs.push(o);
      p += keys.length * 2;
    }
    return recs;
  };
  const OBJ = ['obj', 'x', 'y'];
  const m: Record<string, unknown> = { header: hdr };
  m.objBg = objs(hdr.nObjBg, OBJ);
  m.objLow = objs(hdr.nObjLow, OBJ);
  m.objMid = objs(hdr.nObjMid, OBJ);
  m.objTop = objs(hdr.nObjTop, OBJ);
  // E list (8B) -> FUN_000176d8, actor slots 0x65.., kind from d.dat 0x2692b[type*4]
  m.gimmicks = objs(hdr.nGimmick, ['type', 'x', 'y', 'param']);
  // F list (8B) -> FUN_0001bb8c, actor slots 0.., id<43 monster, >=43 NPC; name text 993+id
  m.actors = objs(hdr.nActor, ['actor', 'x', 'y', 'param']);
  const blob = data.subarray(p, p + hdr.portalBytes);
  const bv = view(blob);
  p += hdr.portalBytes;
  const portals: unknown[] = [];
  let q = 0;
  while (q + 8 <= blob.length) {
    const tgt = bv.getUint16(q, true), dx = bv.getUint16(q + 2, true), dy = bv.getUint16(q + 4, true), n = bv.getUint16(q + 6, true);
    q += 8;
    const rects: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const a = bv.getUint16(q, true), b = bv.getUint16(q + 2, true);
      q += 4;
      rects.push({ cx0: a >> 8, cy0: a & 0xff, cx1: b >> 8, cy1: b & 0xff });
    }
    portals.push({ target: tgt, destX: dx, destY: dy, rects });
  }
  m.portals = portals;
  m.portalTail = hex(blob.subarray(q));
  const tiles = data.subarray(p, p + W * H);
  p += W * H;
  const nb = ((W * H) >> 3) + 1;
  const bits = data.subarray(p, p + nb);
  p += nb;
  const rows: number[][] = [], walk: number[][] = [];
  for (let r = 0; r < H; r++) {
    rows.push(Array.from(tiles.subarray(r * W, (r + 1) * W)));
    const row: number[] = [];
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      row.push(((bits[i >> 3] ?? 0) >> (7 - (i & 7))) & 1);
    }
    walk.push(row);
  }
  m.tiles = rows;
  m.walk = walk;
  m.size_ok = p === data.length;
  return m;
}

/** maps/mNNN.json for every assets/mNNN.dat */
export async function buildMaps(files: ApkFiles, emit: Emit): Promise<number> {
  let n = 0;
  for (const path of files.list('assets/')) {
    const f = path.slice('assets/'.length);
    if (!/^m\d{3}\.dat$/.test(f)) continue;
    await emit(`maps/${f.slice(0, 4)}.json`, jsonText(parseMap(need(files, path))));
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- tables (grantria_gfx constants)

const DDAT_SHARED_CLIPS = 0x235db;   // DAT_003ff8ff  u8[cmfId]: clips < n come from c.pxl (img 0)
const DDAT_OBJ_SPLIT = 0x25465;      // DAT_00401789  u8[zone]: clip <= v -> o%d_0, else o%d_1
const DDAT_ACTOR_TYPE = 0x22d3d;     // 8B per actor id, +0 = graphics set (cmf_c id)
const DDAT_PORTAL_MARKER = 0x26f11;  // u8[targetMap] -> marker kind (FUN_00018e6c)
const PORTAL_MARKER_IDS = { 0: -112, 1: -120, 2: -128, 3: -136 };   // 0xff90/88/80/78 -> cmf_oc frame -id

const PLAYER_ACTIONS = [0x186ac, 0x18ed4, 0x1958c];   // d.dat action tables for classes 0/1/2
const ACTION_MULT = 0x24b3a;                          // FACING multipliers, 0xFF before each class

/** action records {frame, step, event, sound, n} (s16) per class (combat.md section 0) */
function playerActions(d: Uint8Array) {
  const mult: number[][] = [];
  let cur: number[] | null = null;
  for (const b of d.subarray(ACTION_MULT, ACTION_MULT + 128)) {
    if (b === 0xff) {
      if (mult.length === 3) break;
      cur = [];
      mult.push(cur);
    } else if (cur) cur.push(b);
  }
  const dv = view(d);
  const actions = PLAYER_ACTIONS.map((start, cls) => {
    const recs: Record<string, unknown>[] = [];
    let off = start;
    for (let k = 0; k < mult[cls].length; k++) {
      const n = dv.getInt16(off, true);
      if (!(n > 0 && n < 64)) break;
      const [frame, step, event, sound] = [0, 1, 2, 3].map((i) => s16s(d, off + 2 + i * 2 * n, n));
      recs.push({ frame, step, event, sound, n });
      off += 2 + 8 * n;
    }
    return recs;
  });
  return { playerActions: actions, actionMult: mult };
}

// class guide arrows (FUN_0001788c / 17980 / 17a78): per-map rows [map, (x, y, variant) x quest column] in
// the native library's .rodata (s16); src/core/rules/guide.ts
const GUIDE_TABLES: [string, number, number, number][] = [['c0', 0xfffec, 0x30c, 13], ['c1', 0x1002f8, 0x280, 16], ['c2', 0x100578, 0x270, 13]];

function guideMarkers(lib: Uint8Array) {
  const out: Record<string, number[][]> = {};
  for (const [name, addr, size, stride] of GUIDE_TABLES) {
    const v = s16s(lib, addr - 0x10000, size >> 1), rows: number[][] = [];
    for (let i = 0; i < v.length; i += stride) rows.push(v.slice(i, i + stride));
    out[name] = rows;
  }
  return out;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const s8 = (b: number) => (b > 127 ? b - 256 : b);

/** tables.json: d.dat lookup tables used at runtime */
export async function buildTables(files: ApkFiles, emit: Emit): Promise<void> {
  const d = need(files, DDAT);
  const bytes = (o: number, n: number) => Array.from(d.subarray(o, o + n));
  const tables = {
    sharedClips: bytes(DDAT_SHARED_CLIPS, 80),
    objSplit: bytes(DDAT_OBJ_SPLIT, 32),
    actorCmf: range(260).map((i) => d[DDAT_ACTOR_TYPE + i * 8]),
    portalMarker: bytes(DDAT_PORTAL_MARKER, 256),
    portalMarkerIds: PORTAL_MARKER_IDS,
    // actor type records d+0x22d3d (8 B): [0] cmf, [1] behaviour, [2] box kind, [4] exp bonus,
    // [5] direction mode (2/4), [7] sight range x8 px  (game-rules.md §3.5)
    actorTypes: range(260).map((i) => bytes(DDAT_ACTOR_TYPE + i * 8, 8)),
    // d+0x251a3 (12 B per type): [0] element, [4..7] status attack  (game-rules.md §3.2/3.3)
    actorElements: range(64).map((i) => bytes(0x251a3 + i * 12, 12)),
    ...playerActions(d),
    // font: ASCII byte -> glyph class (d+0x22482, s8) and '|q' blink colours (d+0x22d27, 11 x (b1, b2))
    fontClass: bytes(0x22482, 128).map(s8),
    blinkColors: range(11).map((i) => bytes(0x22d27 + i * 2, 2)),
    guideMarkers: guideMarkers(need(files, LIB_SO)),
  };
  await emit('tables.json', jsonText(tables));
}
