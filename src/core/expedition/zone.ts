// 원정(가제): the zones of a run, built in the original GameMap format on tileset t3 (초원·호수).
// A battle or rest zone is an original t3 field map (the template) grown by reverse seam carving: a seam is a
// top-to-bottom (or left-to-right) path of k-wide strips, one per row, and each row repeats its strip in place. Every
// tile meeting in the result occurs in the t3 maps (PAIR_SOURCES): a strip keeps clear of what objects stand on, a tile
// in it other than grass must sit in a run that repeats every k (so an edge crossed square gets longer, never doubled),
// and where the seam steps sideways between rows only grass, or a row that repeats every k there, is sheared. Seams
// prefer plain grass and land not repeated yet and lean towards a random line, so cliffs, shores, paths and objects
// keep their neighbours and the open land between them grows. The t3 maps are dense, so a template mostly grows along
// one axis (the templates here widen to ~180 columns; their height stays). The opened land then gets copies of small
// islands of the t3 maps (a tree, a rock, a rise with a grass rim) and fresh grass variants. The way through runs from
// the west end to the exit stone at the east end of the largest walkable region. The boss zone is 초원 - 깊숙한곳 (m124)
// as it is.
import type { Assets, Cmf, GameMap, MapObject } from '../data/assets';
import { bodyBox, buildWalk } from '../world/world';
import { Rng } from './rng';

export const TILE = 16;
/** battle zone templates: the big t3 field maps (zone 3, 초원·호수) */
export const BATTLE_TEMPLATES = [116, 119, 120];
/** rest zone templates: small t3 clearings */
export const REST_TEMPLATES = [112, 113];
/** the maps whose tile meetings a grown zone may use (the templates and the other t3 field maps) */
export const PAIR_SOURCES = [112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 125, 377, 378, 379, 380, 381, 382, 383, 384, 385];
/** 초원 - 깊숙한곳, the boss room */
export const BOSS_MAP = 124;
/** warp stone of cmf_oc (35 unlit, 36 lit): the zone exit */
export const EXIT_OBJ = -35, EXIT_LIT = -36;
/** a template grows to at most this many times its size each way */
const MAX_GROW = 2.2;

export type ZoneKind = 'battle' | 'rest' | 'boss';

export interface Spawn {
  x: number;
  y: number;
  /** stage-1 species index (species.ts) */
  species: number;
}

export interface Zone {
  kind: ZoneKind;
  map: GameMap;
  /** walk layer 0 with the objects stamped (1 = passable), width × height */
  walk: Uint8Array;
  start: { x: number; y: number };
  exit: { x: number; y: number };
  spawns: Spawn[];
  /** the template map the zone was grown from (0 for the boss room) */
  template?: number;
}

/** the zone objects (cmf_o3) and the common ones (cmf_oc) for the walk stamping and the drawing */
export interface ZoneSets { obj: Cmf; oc: Cmf }

export async function zoneSets(a: Assets): Promise<ZoneSets> {
  const [obj, oc] = await Promise.all([a.cmf('cmf_o3'), a.cmf('cmf_oc')]);
  return { obj, oc };
}

export function objCmf(sets: ZoneSets, id: number): [Cmf, number] {
  return id < 0 ? [sets.oc, -id] : [sets.obj, id];
}

/** walk layer 0 of a map (file bits with the object boxes stamped out) */
export function zoneWalk(map: GameMap, sets: ZoneSets): Uint8Array {
  return buildWalk(map, (id) => objCmf(sets, id));
}

/** what an object covers in map pixels (its drawn parts and its body box): x0, y0, x1, y1 */
export function objBox(sets: ZoneSets, o: MapObject): [number, number, number, number] {
  const [cmf, f] = objCmf(sets, o.obj), fr = cmf.frames[f];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    x0 = Math.min(x0, ax); y0 = Math.min(y0, ay); x1 = Math.max(x1, bx); y1 = Math.max(y1, by);
  };
  for (const p of fr?.parts ?? []) {
    const c = cmf.clips[p.clip];
    if (!c) continue;
    const w = ((p.rot & 1) ? c[3] : c[2]) * p.scale, h = ((p.rot & 1) ? c[2] : c[3]) * p.scale;
    add(o.x + p.dx, o.y + p.dy, o.x + p.dx + w, o.y + p.dy + h);
  }
  const s8 = (v: number) => (v << 24) >> 24;
  const [bx, by, bw, bh] = bodyBox(cmf, f).map(s8);
  if (bw > 0 && bh > 0) add(o.x + bx, o.y + by, o.x + bx + bw, o.y + by + bh);
  return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : [o.x, o.y, o.x + 1, o.y + 1];
}

/** the cells a pixel box touches: c0, r0, c1, r1 (inclusive) */
export function boxCells(b: readonly number[]): [number, number, number, number] {
  return [Math.floor(b[0] / TILE), Math.floor(b[1] / TILE), Math.ceil(b[2] / TILE) - 1, Math.ceil(b[3] / TILE) - 1];
}

/**
 * The cells an object is pinned to (c0, r0, c1, r1 inclusive): the smallest block holding its anchor cell, its body box
 * and every cell of its foot that is not plain grass. The foot is all it is drawn over for a small object (foam, a
 * lily pad, a rock), the two bottom rows for a tall one (a tree, a ruin): where it stands on the ground. Seams never
 * cut through the block, so those tiles stay under the object as they were; what a canopy hides may change under it.
 */
export function objFootprint(sets: ZoneSets, o: MapObject, tiles: number[][], grass: Set<number>): [number, number, number, number] {
  const H = tiles.length, W = tiles[0]?.length ?? 0;
  let c0 = Math.floor(o.x / TILE), r0 = Math.floor(o.y / TILE), c1 = c0, r1 = r0;
  const take = (c: number, r: number) => { c0 = Math.min(c0, c); r0 = Math.min(r0, r); c1 = Math.max(c1, c); r1 = Math.max(r1, r); };
  const [cmf, f] = objCmf(sets, o.obj), s8 = (v: number) => (v << 24) >> 24;
  const [bx, by, bw, bh] = bodyBox(cmf, f).map(s8);
  if (bw > 0 && bh > 0) {
    const [a, b, c, d] = boxCells([o.x + bx, o.y + by, o.x + bx + bw, o.y + by + bh]);
    take(a, b); take(c, d);
  }
  const box = objBox(sets, o), [a, b, c, d] = boxCells(box);
  const foot = box[3] - box[1] <= 3 * TILE ? b : d - 1;
  for (let r = Math.max(0, foot); r <= Math.min(H - 1, d); r++)
    for (let x = Math.max(0, a); x <= Math.min(W - 1, c); x++) if (!grass.has(tiles[r][x])) take(x, r);
  return [c0, r0, c1, r1];
}

/** a left-right (h) or top-bottom (v) meeting of two tiles */
export const pairKey = (a: number, b: number): number => a * 0x10000 + b;

export interface Pairs { h: Set<number>; v: Set<number> }

/** every tile meeting in the maps */
export function tilePairs(maps: GameMap[]): Pairs {
  const h = new Set<number>(), v = new Set<number>();
  for (const m of maps) {
    const t = m.tiles, W = m.header.width, H = m.header.height;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (c + 1 < W) h.add(pairKey(t[r][c], t[r][c + 1]));
      if (r + 1 < H) v.add(pairKey(t[r][c], t[r + 1][c]));
    }
  }
  return { h, v };
}

/** the plain grass: tiles used often and walkable most of the times they are used, with how often */
export function grassOf(maps: GameMap[]): { tiles: number[]; weights: number[] } {
  const used = new Map<number, number>(), walkable = new Map<number, number>();
  for (const m of maps) m.tiles.forEach((row, r) => row.forEach((v, c) => {
    used.set(v, (used.get(v) ?? 0) + 1);
    if (m.walk[r]?.[c]) walkable.set(v, (walkable.get(v) ?? 0) + 1);
  }));
  const g = [...walkable.entries()].filter(([v, n]) => v > 0 && n > 400 && n / used.get(v)! > 0.55).sort((p, q) => q[1] - p[1]);
  return { tiles: g.map(([v]) => v), weights: g.map(([, n]) => n) };
}

interface Source {
  pairs: Pairs;
  grass: Set<number>;
  grassList: number[];
  grassWeights: number[];
  /** per source map: the map as a grid and its islands */
  isles: { t: Grid; list: Island[] }[];
}

let sourceCache: { a: Assets; p: Promise<Source> } | null = null;

async function source(a: Assets, sets: ZoneSets): Promise<Source> {
  if (sourceCache?.a !== a) {
    sourceCache = {
      a, p: Promise.all(PAIR_SOURCES.map((id) => a.map(id))).then((maps) => {
        const g = grassOf(maps), grass = new Set(g.tiles);
        const isles = maps.map((m) => { const t = gridOf(m, sets, grass); return { t, list: islandsOf(t, grass) }; }).filter((x) => x.list.length);
        return { pairs: tilePairs(maps), grass, grassList: g.tiles, grassWeights: g.weights, isles };
      }),
    };
  }
  return sourceCache.p;
}

const LAYERS = ['objBg', 'objLow', 'objMid', 'objTop'] as const;
type Layer = (typeof LAYERS)[number];

/** an object with what it is drawn over (pixels) and the cells it is pinned to (objFootprint); a free one stands on
 *  bare grass (its pin is just its anchor cell then): it never stops a seam and is never repeated, only moved */
interface Placed { layer: Layer; o: MapObject; box: [number, number, number, number]; pin: [number, number, number, number]; free: boolean }

function placed(sets: ZoneSets, layer: Layer, o: MapObject, tiles: number[][], grass: Set<number>): Placed {
  const pin = objFootprint(sets, o, tiles, grass), H = tiles.length, W = tiles[0]?.length ?? 0;
  let free = true;
  for (let r = Math.max(0, pin[1]); r <= Math.min(H - 1, pin[3]); r++)
    for (let c = Math.max(0, pin[0]); c <= Math.min(W - 1, pin[2]); c++) if (!grass.has(tiles[r][c])) free = false;
  const ac = Math.floor(o.x / TILE), ar = Math.floor(o.y / TILE);
  return { layer, o: { ...o }, box: objBox(sets, o), pin: free ? [ac, ar, ac, ar] : pin, free };
}

/** a map being grown: tiles, walk bits, how many times each cell was repeated, the objects with what they cover */
interface Grid { W: number; H: number; tiles: number[][]; walk: number[][]; copy: number[][]; objs: Placed[] }

function gridOf(m: GameMap, sets: ZoneSets, grass: Set<number>): Grid {
  const W = m.header.width, H = m.header.height;
  const tiles = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => m.tiles[r]?.[c] ?? 0));
  return {
    W, H, tiles,
    walk: Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (m.walk[r]?.[c] ? 1 : 0))),
    copy: Array.from({ length: H }, () => new Array<number>(W).fill(0)),
    objs: LAYERS.flatMap((layer) => m[layer].map((o) => placed(sets, layer, o, tiles, grass))),
  };
}

function transpose(g: Grid): Grid {
  const T = (a: number[][]) => Array.from({ length: g.W }, (_, c) => Array.from({ length: g.H }, (_, r) => a[r][c]));
  return {
    W: g.H, H: g.W, tiles: T(g.tiles), walk: T(g.walk), copy: T(g.copy),
    objs: g.objs.map((p) => ({ layer: p.layer, o: { obj: p.o.obj, x: p.o.y, y: p.o.x }, box: [p.box[1], p.box[0], p.box[3], p.box[2]], pin: [p.pin[1], p.pin[0], p.pin[3], p.pin[2]], free: p.free })),
  };
}

/** cells drawn over by an object, with ring their neighbours too */
function covered(g: Grid, ring = 0): Uint8Array {
  const { W, H } = g, out = new Uint8Array(W * H);
  for (const p of g.objs) {
    const [c0, r0, c1, r1] = boxCells(p.box);
    for (let r = Math.max(0, r0 - ring); r <= Math.min(H - 1, r1 + ring); r++)
      for (let c = Math.max(0, c0 - ring); c <= Math.min(W - 1, c1 + ring); c++) out[r * W + c] = 1;
  }
  return out;
}

/** the largest sideways step a seam takes between two rows */
const STEP = 16;

/**
 * Repeat one top-to-bottom seam of k-wide strips (row r repeats columns s[r] .. s[r] + k - 1 right after themselves).
 * A strip holds no part of an object's pinned cells unless it holds all of them; such an object is repeated with it
 * (a free one is not: it stays where it is, on grass).
 * h / v: the left-right and top-bottom tile meetings allowed. False when no seam fits.
 */
function insertSeam(g: Grid, k: number, h: Set<number>, v: Set<number>, grass: Set<number>, rng: Rng): boolean {
  const { W, H, tiles } = g;
  const lo = 1, hi = W - k - 1;                                     // the outer columns stay put
  if (hi < lo) return false;
  // per cell: the leftmost and rightmost pinned column of the objects pinned there (lo > hi where none is)
  const spanLo = new Int32Array(W * H).fill(1 << 30), spanHi = new Int32Array(W * H).fill(-(1 << 30));
  for (const p of g.objs) {
    if (p.free) continue;
    const [c0, r0, c1, r1] = p.pin;
    for (let r = Math.max(0, r0); r <= Math.min(H - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(W - 1, c1); c++) {
      const i = r * W + c;
      spanLo[i] = Math.min(spanLo[i], c0); spanHi[i] = Math.max(spanHi[i], c1);
    }
  }
  const blocked = (i: number): boolean => spanLo[i] <= spanHi[i];
  // what a strip cell costs: grass next to nothing, anything else (an edge, a cliff, a shore, flowers, pebbles) a lot,
  // so a seam crosses borders square (stretching them along) instead of running along them (doubling them);
  // repeated land again and away from this seam's line more
  const target = rng.range(lo, hi), lean = rng.range(0.03, 0.08);
  const cell = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const t = tiles[r][c], w = g.walk[r][c];
    cell[r * W + c] = (grass.has(t) ? (w ? 0 : 0.4) : 5) + g.copy[r][c] * 1.5 + (blocked(r * W + c) ? 8 : 0) + rng.next() * 0.8 + lean * Math.abs(c - target);
  }
  /** a strip in row r at s: no object cut, the repeat meets the strip's start in the sources, and every tile but grass
   *  is in a run that repeats every k (an edge crossed square: the strip lengthens it, never doubles it) */
  const fits = (r: number, s: number): boolean => {
    const row = tiles[r];
    for (let c = s, i = r * W + s; c < s + k; c++, i++) {
      if (blocked(i) && (spanLo[i] < s || spanHi[i] >= s + k)) return false;
      if (!grass.has(row[c]) && row[c] !== row[c + k] && row[c] !== row[c - k]) return false;
    }
    return h.has(pairKey(row[s + k - 1], row[s]));
  };
  const strip = (r: number, s: number): number => {
    let n = 0;
    for (let c = s; c < s + k; c++) n += cell[r * W + c];
    return n;
  };
  // prefix counts per row (W + 1 each): pinned cells; for rows r - 1 / r, the columns y where a shear does not fit:
  // T[r-1][y] over T[r][y + k] (down) or T[r-1][y + k] over T[r][y] (up) unless one of the rows repeats every k
  // there (then the shear changes nothing) or both are grass that meets in the sources
  const W1 = W + 1, pin = new Int32Array(W1 * H), down = new Int32Array(W1 * H), up = new Int32Array(W1 * H);
  const meets = (t: number, u: number): boolean => grass.has(t) && grass.has(u) && v.has(pairKey(t, u));
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W1 + c;
    pin[i + 1] = pin[i] + (blocked(r * W + c) ? 1 : 0);
    if (r === 0) continue;
    const T0 = tiles[r - 1], T1 = tiles[r];
    const flat = c + k < W && (T0[c] === T0[c + k] || T1[c] === T1[c + k]);
    down[i + 1] = down[i] + (c + k < W && (flat || meets(T0[c], T1[c + k])) ? 0 : 1);
    up[i + 1] = up[i] + (c + k < W && (flat || meets(T0[c + k], T1[c])) ? 0 : 1);
  }
  const count = (a: Int32Array, r: number, c0: number, c1: number): number => (c1 > c0 ? a[r * W1 + c1] - a[r * W1 + c0] : 0);
  /** row r - 1 repeating at a, row r at b: the columns x0 + k .. x1 + k - 1 come from x - k in one row and x in the
   *  other; nothing pinned may lie in what moves apart, and what it brings together must fit (see down / up) */
  const step = (r: number, a: number, b: number): boolean => {
    if (a === b) return true;
    const x0 = Math.min(a, b), x1 = Math.max(a, b);
    for (const y of [r - 1, r]) if (count(pin, y, x0, x1) || count(pin, y, x0 + k, x1 + k)) return false;
    return count(a < b ? down : up, r, x0, x1) === 0;
  };
  let prev = new Float64Array(W).fill(Infinity), cur = new Float64Array(W);
  const from = new Int32Array(W * H).fill(-1);
  for (let s = lo; s <= hi; s++) if (fits(0, s)) prev[s] = strip(0, s);
  for (let r = 1; r < H; r++) {
    cur.fill(Infinity);
    let any = false;
    for (let s = lo; s <= hi; s++) {
      if (!fits(r, s)) continue;
      let best = Infinity, arg = -1;
      for (let d = -STEP; d <= STEP; d++) {
        const a = s + d;
        if (a < lo || a > hi || prev[a] === Infinity) continue;
        const c = prev[a] + Math.abs(d) * 0.15;
        if (c < best && step(r, a, s)) { best = c; arg = a; }
      }
      if (arg < 0) continue;
      cur[s] = best + strip(r, s);
      from[r * W + s] = arg;
      any = true;
    }
    if (!any) return false;
    [prev, cur] = [cur, prev];
  }
  let s = -1;
  for (let c = lo; c <= hi; c++) if (prev[c] < Infinity && (s < 0 || prev[c] < prev[s])) s = c;
  if (s < 0) return false;
  const seam = new Int32Array(H);
  for (let r = H - 1; r >= 0; r--) { seam[r] = s; s = from[r * W + s]; }
  for (let r = 0; r < H; r++) {
    const at = seam[r] + k;
    g.tiles[r].splice(at, 0, ...g.tiles[r].slice(seam[r], at));
    g.walk[r].splice(at, 0, ...g.walk[r].slice(seam[r], at));
    for (let c = seam[r]; c < at; c++) g.copy[r][c]++;
    g.copy[r].splice(at, 0, ...g.copy[r].slice(seam[r], at));
  }
  const objs: Placed[] = [];
  const moved = (p: Placed): Placed => ({
    layer: p.layer, o: { obj: p.o.obj, x: p.o.x + k * TILE, y: p.o.y },
    box: [p.box[0] + k * TILE, p.box[1], p.box[2] + k * TILE, p.box[3]], pin: [p.pin[0] + k, p.pin[1], p.pin[2] + k, p.pin[3]], free: p.free,
  });
  for (const p of g.objs) {                // right of its row's strip: moves with it; in the strip: repeated with it
    const s0 = seam[Math.max(0, Math.min(H - 1, p.pin[1]))];
    if (p.pin[0] >= s0 + k) objs.push(moved(p));
    else if (p.pin[0] >= s0 && !p.free) objs.push(p, moved(p));
    else objs.push(p);
  }
  g.objs = objs;
  g.W += k;
  return true;
}

/** grow a grid by seams towards tw × th (it stops short on an axis where no more seams fit) */
function grow(g0: Grid, tw: number, th: number, src: Source, rng: Rng): Grid {
  let g = g0;
  const done = [false, false];
  for (;;) {
    const col = g.W < tw && !done[0], row = g.H < th && !done[1];
    if (!col && !row) return g;
    const across = col && (!row || (tw - g.W) / tw >= (th - g.H) / th), left = across ? tw - g.W : th - g.H;
    let ok = false;
    for (const k of new Set([Math.min([2, 2, 2, 4, 4, 6][rng.int(0, 5)], left), Math.min(2, left)])) {
      if (across) ok = insertSeam(g, k, src.pairs.h, src.pairs.v, src.grass, rng);
      else {
        const t = transpose(g);
        ok = insertSeam(t, k, src.pairs.v, src.pairs.h, src.grass, rng);
        if (ok) g = transpose(t);
      }
      if (ok) break;
    }
    if (!ok) done[across ? 0 : 1] = true;
  }
}

/** a block of a template: its rim is bare walkable grass and every object drawn in it stays inside the rim */
interface Island { c: number; r: number; w: number; h: number }

/** bare walkable grass no object is drawn over */
function bareGrass(g: Grid, grass: Set<number>): Uint8Array {
  const { W, H } = g, cov = covered(g), out = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) out[r * W + c] = g.walk[r][c] && grass.has(g.tiles[r][c]) && !cov[r * W + c] ? 1 : 0;
  return out;
}

/** the islands of a map worth copying: something on them (a rise, a tree, a rock) and a bare grass rim */
function islandsOf(t: Grid, grass: Set<number>): Island[] {
  const { W, H } = t, bare = bareGrass(t, grass), W1 = W + 1;
  const rowP = new Int32Array(W1 * H), colP = new Int32Array((H + 1) * W), feat = new Int32Array(W1 * (H + 1));
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    rowP[r * W1 + c + 1] = rowP[r * W1 + c] + bare[r * W + c];
    colP[c * (H + 1) + r + 1] = colP[c * (H + 1) + r] + bare[r * W + c];
    feat[(r + 1) * W1 + c + 1] = feat[r * W1 + c + 1] + feat[(r + 1) * W1 + c] - feat[r * W1 + c] + (bare[r * W + c] ? 0 : 1);
  }
  const rowOk = (r: number, c0: number, c1: number) => rowP[r * W1 + c1 + 1] - rowP[r * W1 + c0] === c1 - c0 + 1;
  const colOk = (c: number, r0: number, r1: number) => colP[c * (H + 1) + r1 + 1] - colP[c * (H + 1) + r0] === r1 - r0 + 1;
  const boxes = t.objs.map((p) => boxCells(p.box));
  const out: Island[] = [];
  for (let h = 6; h <= 16; h++) for (let w = 6; w <= 18; w++) for (let r = 0; r + h <= H; r++) for (let c = 0; c + w <= W; c++) {
    const r1 = r + h - 1, c1 = c + w - 1;
    if (!rowOk(r, c, c1) || !rowOk(r1, c, c1) || !colOk(c, r, r1) || !colOk(c1, r, r1)) continue;
    const n = feat[(r1 + 1) * W1 + c1 + 1] - feat[r * W1 + c1 + 1] - feat[(r1 + 1) * W1 + c] + feat[r * W1 + c];
    if (n < Math.max(14, w * h * 0.3)) continue;
    if (boxes.some(([a, b, x, y]) => a <= c1 && x >= c && b <= r1 && y >= r && (a <= c || x >= c1 || b <= r || y >= r1))) continue;
    out.push({ c, r, w, h });
  }
  return out;
}

/**
 * Fill the land the seams opened with copies of islands of the t3 maps, each on repeated bare grass with a free margin
 * around it, where its grass rim meets the grass around in the sources.
 */
function scatter(g: Grid, src: Source, rng: Rng): void {
  if (!src.isles.length) return;
  const { W, H } = g, { h, v } = src.pairs, M = 2;
  let bare = bareGrass(g, src.grass);
  const free = (c0: number, r0: number, w: number, hh: number): boolean => {
    for (let r = r0 - M; r < r0 + hh + M; r++) for (let c = c0 - M; c < c0 + w + M; c++) {
      if (r < 1 || c < 1 || r >= H - 1 || c >= W - 1 || !bare[r * W + c] || !g.copy[r][c]) return false;
    }
    return true;
  };
  let open = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g.copy[r][c] && bare[r * W + c]) open++;
  for (let tries = Math.round(open / 12), n = 0; tries > 0 && n < open / 260; tries--) {
    const { t, list } = rng.pick(src.isles), is = rng.pick(list), dc = rng.int(M + 1, W - is.w - M - 1), dr = rng.int(M + 1, H - is.h - M - 1);
    if (dc < 1 || dr < 1 || !free(dc, dr, is.w, is.h)) continue;
    let joins = true;
    for (let i = 0; i < is.w && joins; i++) {
      joins = v.has(pairKey(g.tiles[dr - 1][dc + i], t.tiles[is.r][is.c + i])) && v.has(pairKey(t.tiles[is.r + is.h - 1][is.c + i], g.tiles[dr + is.h][dc + i]));
    }
    for (let j = 0; j < is.h && joins; j++) {
      joins = h.has(pairKey(g.tiles[dr + j][dc - 1], t.tiles[is.r + j][is.c])) && h.has(pairKey(t.tiles[is.r + j][is.c + is.w - 1], g.tiles[dr + j][dc + is.w]));
    }
    if (!joins) continue;
    for (let j = 0; j < is.h; j++) for (let i = 0; i < is.w; i++) {
      g.tiles[dr + j][dc + i] = t.tiles[is.r + j][is.c + i];
      g.walk[dr + j][dc + i] = t.walk[is.r + j][is.c + i];
      g.copy[dr + j][dc + i] = 0;
    }
    const dx = (dc - is.c) * TILE, dy = (dr - is.r) * TILE;
    for (const p of t.objs) {
      const [a, b] = boxCells(p.box);
      if (a < is.c || b < is.r || a >= is.c + is.w || b >= is.r + is.h) continue;
      g.objs.push({
        layer: p.layer, o: { obj: p.o.obj, x: p.o.x + dx, y: p.o.y + dy },
        box: [p.box[0] + dx, p.box[1] + dy, p.box[2] + dx, p.box[3] + dy], pin: [p.pin[0] + dc - is.c, p.pin[1] + dr - is.r, p.pin[2] + dc - is.c, p.pin[3] + dr - is.r], free: p.free,
      });
    }
    bare = bareGrass(g, src.grass);
    n++;
  }
}

/** repeated grass away from objects gets other grass variants where all four meetings still occur in the sources */
function vary(g: Grid, src: Source, rng: Rng): void {
  const { W, H, tiles } = g, near = covered(g, 1), { h, v } = src.pairs;
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    if (!g.copy[r][c] || near[r * W + c] || !src.grass.has(tiles[r][c])) continue;
    for (let i = 0; i < 4; i++) {
      const t = src.grassList[rng.weighted(src.grassWeights)];
      if (h.has(pairKey(tiles[r][c - 1], t)) && h.has(pairKey(t, tiles[r][c + 1]))
        && v.has(pairKey(tiles[r - 1][c], t)) && v.has(pairKey(t, tiles[r + 1][c]))) { tiles[r][c] = t; break; }
    }
  }
}

function mapOf(g: Grid, tpl: GameMap): GameMap {
  const pick = (L: Layer) => g.objs.filter((p) => p.layer === L).map((p) => p.o);
  return {
    header: { ...tpl.header, width: g.W, height: g.H, mapType: 0 },
    objBg: pick('objBg'), objLow: pick('objLow'), objMid: pick('objMid'), objTop: pick('objTop'),
    actors: [], portals: [], gimmicks: [],
    tiles: g.tiles, walk: g.walk,
  };
}

/** walkable cells reachable from (c, r) (4-neighbour flood) */
export function reachable(walk: Uint8Array, W: number, H: number, c: number, r: number): Uint8Array {
  const seen = new Uint8Array(W * H), stack = [r * W + c];
  if (!walk[r * W + c]) return seen;
  seen[r * W + c] = 1;
  while (stack.length) {
    const i = stack.pop()!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j] || !walk[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

/** the largest 4-connected walkable region */
function largestRegion(walk: Uint8Array, W: number, H: number): Uint8Array {
  const done = new Uint8Array(W * H);
  let best = new Uint8Array(W * H), bestN = 0;
  for (let i = 0; i < W * H; i++) {
    if (!walk[i] || done[i]) continue;
    const seen = reachable(walk, W, H, i % W, (i / W) | 0);
    let n = 0;
    for (let j = 0; j < W * H; j++) if (seen[j]) { done[j] = 1; n++; }
    if (n > bestN) { bestN = n; best = seen; }
  }
  return best;
}

/** a cell whose block from (c - a, r - b) to (c + a2, r + b2) is open and reached */
function openBlock(seen: Uint8Array, W: number, H: number, c: number, r: number, a = 1, b = 1, a2 = a, b2 = b): boolean {
  for (let y = r - b; y <= r + b2; y++) for (let x = c - a; x <= c + a2; x++) if (x < 0 || y < 0 || x >= W || y >= H || !seen[y * W + x]) return false;
  return true;
}

/** a cell whose whole 3×3 block is open and reached */
function openCell(seen: Uint8Array, W: number, H: number, c: number, r: number): boolean {
  return openBlock(seen, W, H, c, r);
}

export interface BattleZoneOpts {
  /** the largest size wanted (the zone is its template grown towards it, at most MAX_GROW times each way) */
  w: number;
  h: number;
  /** enemy groups placed */
  groups: number;
  /** species indices the groups are drawn from */
  species: number[];
  /** a template map to grow (one of the kind's templates by the seed otherwise) */
  template?: number;
}

/** a battle zone (or a rest clearing with groups = 0) */
export async function buildField(a: Assets, sets: ZoneSets, seed: number, kind: 'battle' | 'rest', o: BattleZoneOpts): Promise<Zone> {
  const rng = new Rng(seed), src = await source(a, sets);
  const id = o.template ?? rng.pick(kind === 'rest' ? REST_TEMPLATES : BATTLE_TEMPLATES), tpl = await a.map(id);
  const tw = Math.min(o.w, Math.round(tpl.header.width * MAX_GROW)), th = Math.min(o.h, Math.round(tpl.header.height * MAX_GROW));
  const g = grow(gridOf(tpl, sets, src.grass), tw, th, src, rng);
  scatter(g, src, rng);
  vary(g, src, rng);
  const map = mapOf(g, tpl), W = g.W, H = g.H;
  // the way through: the largest walkable region, entered at its west end, left by the stone at its east end
  const region = largestRegion(zoneWalk(map, sets), W, H);
  const ends = (east: boolean): [number, number] => {
    const cells: [number, number][] = [];
    for (let c = east ? W - 1 : 0; east ? c >= 0 : c < W; c += east ? -1 : 1) {
      for (let r = 0; r < H; r++) {
        if (east ? openBlock(region, W, H, c, r, 1, 1, 4, 3) : openBlock(region, W, H, c, r, 2, 2)) cells.push([c, r]);
      }
      if (cells.length && Math.abs(cells[0][0] - c) >= 3) break;
    }
    return cells.length ? rng.pick(cells) : [W >> 1, H >> 1];
  };
  const start = ends(false), exit = ends(true);
  map.objLow.push({ obj: EXIT_OBJ, x: exit[0] * TILE + 8, y: exit[1] * TILE + 8 });
  const walk = zoneWalk(map, sets);
  const seen = reachable(walk, W, H, start[0], start[1]);
  // enemy groups: open reached cells away from the start and from each other
  const spawns: Spawn[] = [];
  const taken: [number, number][] = [start, exit];
  for (let g2 = 0, tries = 0; g2 < o.groups && tries < 6000; tries++) {
    const c = rng.int(2, W - 3), r = rng.int(2, H - 3), gap = tries < 3000 ? 22 : 16;
    if (!openCell(seen, W, H, c, r) || taken.some(([tc, tr]) => (tc - c) ** 2 + (tr - r) ** 2 < gap * gap)) continue;
    taken.push([c, r]);
    spawns.push({ x: c * TILE + 8, y: r * TILE + 8, species: rng.pick(o.species) });
    g2++;
  }
  return { kind, map, walk, start: { x: start[0] * TILE + 8, y: start[1] * TILE + 8 }, exit: { x: exit[0] * TILE + 8, y: exit[1] * TILE + 8 }, spawns, template: id };
}

/** the boss room: m124 as it is, entered from its south passage, the boss where the original places it */
export async function buildBoss(a: Assets, sets: ZoneSets, bossSpecies: number): Promise<Zone> {
  const src = await a.map(BOSS_MAP);
  const map: GameMap = { ...src, actors: [], portals: [], objBg: [...src.objBg], objLow: [...src.objLow], objMid: [...src.objMid], objTop: [...src.objTop] };
  const boss = src.actors[0];
  return {
    kind: 'boss', map, walk: zoneWalk(map, sets),
    start: { x: 16.5 * TILE, y: 34 * TILE }, exit: { x: 15 * TILE, y: 4 * TILE },
    spawns: [{ x: boss?.x ?? 256, y: boss?.y ?? 224, species: bossSpecies }],
  };
}
