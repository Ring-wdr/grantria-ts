// 원정(가제): the zones of a run, built in the original GameMap format from a stage's tileset (Biome: stage 1 t3 초원·호수,
// stage 2 t4 사막, stage 3 t6 화산; the notes below speak of t3, the others differ only in the Biome values).
// A battle or rest zone is an original t3 field map (the template) grown by reverse seam carving: a seam is a
// top-to-bottom (or left-to-right) path of k-wide strips, one per row, and each row repeats its strip in place. Every
// tile meeting in the result occurs in the t3 maps (PAIR_SOURCES): a strip keeps clear of what objects stand on, a tile
// in it other than grass must sit in a run that repeats every k (so an edge crossed square gets longer, never doubled),
// and where the seam steps sideways between rows only grass, or a row that repeats every k there, is sheared. Seams
// prefer plain grass and land not repeated yet and lean towards a random line, so cliffs, shores, paths and objects
// keep their neighbours and the open land between them grows. The width grows first; then the height, whose seams may
// also run along the top or bottom border (repeating the border rows there) where the land is too dense to cross. The
// t3 maps are dense: all three templates widen to ~180 columns, only m119 also gets taller (~130 rows). In a battle
// zone the open middle then gets new rises and ponds made tile by tile from the sources' tile meetings (synth.ts,
// raise below). The opened land then gets copies of small islands of the t3 maps (trees, rocks, ruins, a well, on a
// walkable grass rim), fresh grass variants, and loses any free-standing object a seam slid something other than
// grass under. The way through runs from the west end to the exit stone at the east end of the largest walkable
// region, each end where the rest of the region reaches it most directly; the zone's only warp stone is the exit. The boss zone is 초원 - 깊숙한곳 (m124) as it is.
import type { Assets, Cmf, GameMap, MapObject } from '../data/assets';
import { bodyBox, buildWalk } from '../world/world';
import { Rng } from './rng';
import { CHEST_DEPTH, chestRoll, type ChestKind } from './loot';
import { SPECIES } from './species';
import { buildAdjacency, fill, type Adjacency } from './synth';

export const TILE = 16;

/** where a stage's zones come from: one tileset / objset of the original and its maps */
export interface Biome {
  /** the objset (cmf_oN) its maps use */
  objset: number;
  /** battle zone templates: the stage's big field maps */
  battle: readonly number[];
  /** rest zone templates: small clearings */
  rest: readonly number[];
  /** the maps whose tile meetings a grown zone may use (the templates and the other field maps of the tileset) */
  sources: readonly number[];
  /** the boss room, as it is: entered at start (tiles), its exit stone at exit */
  boss: { map: number; start: [number, number]; exit: [number, number] };
  /** tiles drawn on the plain ground (pebbles) that a seam may repeat as freely as the ground */
  decals: readonly number[];
  /** the inside of a pond (open water, or a chasm), or null: rises only */
  water: number | null;
  /** a tile is plain ground when walkable this many times (and most of the times it is used) in the sources (400) */
  grassMin?: number;
  /** where a seam steps sideways, any two tiles that meet in the sources may be brought together (not only plain
   *  ground): for tilesets whose walkable land is narrow ways between walls, lava or chasms */
  shearAny?: boolean;
  /** blocked floor that meets walkable floor with nothing drawn between them is opened (openFlat: t4's floor and its
   *  blocked outer band are the same sand, and the seams carry both into the middle; 2026-10-29) */
  openFlat?: boolean;
}

/** stage 1, 셀마 초원 (t3, 초원·호수): the big t3 field maps; the boss room 초원 - 깊숙한곳 (m124) */
export const BIOME_T3: Biome = {
  objset: 3,
  battle: [116, 119, 120],
  rest: [112, 113],
  sources: [112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 125, 377, 378, 379, 380, 381, 382, 383, 384, 385],
  boss: { map: 124, start: [16.5, 34], exit: [15, 4] },
  decals: [22, 23, 24, 30, 31, 32, 37, 38, 39, 40],
  water: 92,
};
export const BATTLE_TEMPLATES = BIOME_T3.battle, REST_TEMPLATES = BIOME_T3.rest, PAIR_SOURCES = BIOME_T3.sources;
/** warp stone of cmf_oc (35 unlit, 36 lit): the zone exit */
export const EXIT_OBJ = -35, EXIT_LIT = -36;
/** the blue light over the exit: cmf_oc frames 128..135, the 8-frame portal marker loop the original shows at the t3
 *  field maps' exits (portal marker kind 2) */
export const EXIT_MARKER = 128;
/** a template grows to at most this many times its size each way */
const MAX_GROW = 2.2;

export type ZoneKind = 'battle' | 'rest' | 'boss';

export interface Spawn {
  x: number;
  y: number;
  /** stage-1 species index (species.ts) */
  species: number;
  /** the zone's rare creature: alone, sparkling, it runs (web/docs/expedition-balance.md §7) */
  rare?: boolean;
  /** how many more of the kind stand with it (a group is 1 + pack; unset: 0..2 by chance) */
  pack?: number;
  /** the beat of the way through it was placed in (a BEATS index), the gatekeeper by the exit, or the best chest's
   *  guard (§20.4) */
  beat?: number | 'gate' | 'guard';
}

/** a treasure chest (center of its cell) */
export interface ZoneChest { x: number; y: number; kind: ChestKind }

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
  /** a battle zone's open middle (the bare ground far from everything once grown): its cells, and how many of them
   *  are now something other than walkable grass (rises, ponds and their edges) */
  middle?: { cells: number; terrain: number };
  /** a battle zone's chests, in tucked-away spots off the way through (§6.2) */
  chests?: ZoneChest[];
  /** a grown zone is crossed from west to east, or (a tall one) from north to south */
  exitSide?: 'east' | 'south';
}

/** the zone objects (cmf_oN of the biome) and the common ones (cmf_oc) for the walk stamping and the drawing */
export interface ZoneSets { obj: Cmf; oc: Cmf; /** cmf_oN */ objName: string }

export async function zoneSets(a: Assets, objset = 3): Promise<ZoneSets> {
  const objName = `cmf_o${objset}`, [obj, oc] = await Promise.all([a.cmf(objName), a.cmf('cmf_oc')]);
  return { obj, oc, objName };
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
export function grassOf(maps: GameMap[], min = 400): { tiles: number[]; weights: number[] } {
  const used = new Map<number, number>(), walkable = new Map<number, number>();
  for (const m of maps) m.tiles.forEach((row, r) => row.forEach((v, c) => {
    used.set(v, (used.get(v) ?? 0) + 1);
    if (m.walk[r]?.[c]) walkable.set(v, (walkable.get(v) ?? 0) + 1);
  }));
  const g = [...walkable.entries()].filter(([v, n]) => v > 0 && n > min && n / used.get(v)! > 0.55).sort((p, q) => q[1] - p[1]);
  return { tiles: g.map(([v]) => v), weights: g.map(([, n]) => n) };
}

interface Source {
  pairs: Pairs;
  grass: Set<number>;
  grassList: number[];
  grassWeights: number[];
  /** grass and the pebble decals drawn on it: what a seam may repeat or shear freely (pairs still checked) */
  soft: Set<number>;
  /** per source map: the map as a grid and its islands */
  isles: { t: Grid; list: Island[] }[];
  /** tile meetings for rises (seen 3 times or more) and for ponds (twice or more: shores are rarer) */
  adj: Adjacency;
  adjPond: Adjacency;
  /** the biome's pond inside (Biome.water) */
  water: number | null;
  shearAny: boolean;
  /** the floor tiles (sand and its decals: used 30 times or more, walkable in 40% of their uses or more; a cliff or a
   *  rim almost never is): what openFlat opens */
  flat: Set<number>;
}

let sourceCache: { a: Assets; b: Biome; p: Promise<Source> }[] = [];

async function source(a: Assets, sets: ZoneSets, b: Biome): Promise<Source> {
  if (sourceCache[0]?.a !== a) sourceCache = [];
  let hit = sourceCache.find((x) => x.b === b);
  if (!hit) {
    hit = {
      a, b, p: Promise.all(b.sources.map((id) => a.map(id))).then((maps) => {
        const g = grassOf(maps, b.grassMin), grass = new Set(g.tiles), soft = new Set([...grass, ...b.decals]);
        const isles = maps.map((m) => { const t = gridOf(m, sets, grass); return { t, list: islandsOf(t, { grass, soft } as Source) }; }).filter((x) => x.list.length);
        return { pairs: tilePairs(maps), grass, grassList: g.tiles, grassWeights: g.weights, soft, isles, adj: buildAdjacency(maps, grass, 2, 3), adjPond: buildAdjacency(maps, grass, 2, 2), water: b.water, shearAny: !!b.shearAny, flat: floorOf(maps) };
      }),
    };
    sourceCache.push(hit);
  }
  return hit.p;
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
    // the warp stones of the t3 clearings are left out: a zone shows only its own exit stone
    objs: LAYERS.flatMap((layer) => m[layer].filter((o) => o.obj !== EXIT_OBJ && o.obj !== EXIT_LIT).map((o) => placed(sets, layer, o, tiles, grass))),
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

/** the largest sideways step a seam takes between two rows (a height seam, which may also run along the border, less) */
const STEP = 16, STEP_ALONG = 10;

/**
 * Repeat one top-to-bottom seam of k-wide strips (row r repeats columns s[r] .. s[r] + k - 1 right after themselves).
 * A strip holds no part of an object's pinned cells unless it holds all of them; such an object is repeated with it
 * (a free one is not: it stays where it is, on grass).
 * h / v: the left-right and top-bottom tile meetings allowed. False when no seam fits.
 */
function insertSeam(g: Grid, k: number, h: Set<number>, v: Set<number>, src: Source, rng: Rng, edges = false): boolean {
  const { grass } = src, step0 = edges ? STEP_ALONG : STEP;
  const { W, H, tiles } = g;
  const lo = edges ? 0 : 1, hi = edges ? W - k : W - k - 1;
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
    cell[r * W + c] = (grass.has(t) ? (w ? 0 : 0.4) : 5) + g.copy[r][c] * 3 + (blocked(r * W + c) ? 8 : 0) + rng.next() * 0.8 + lean * Math.abs(c - target);
  }
  /** a strip in row r at s: no object cut, the repeat meets the strip's start in the sources, and every tile but grass
   *  is in a run that repeats every k (an edge crossed square: the strip lengthens it, never doubles it) */
  const fits = (r: number, s: number): boolean => {
    const row = tiles[r], edge = edges && (s === lo || s === hi);
    for (let c = s, i = r * W + s; c < s + k; c++, i++) {
      if (!edge && blocked(i) && (spanLo[i] < s || spanHi[i] >= s + k)) return false;
      if (!edge && !grass.has(row[c]) && row[c] !== row[c + k] && row[c] !== row[c - k]) return false;
    }
    return h.has(pairKey(row[s + k - 1], row[s]));
  };
  const strip = (r: number, s: number): number => {
    let n = edges && (s === lo || s === hi) ? 3 * k : 0;              // along the border only where nothing else fits
    for (let c = s; c < s + k; c++) n += cell[r * W + c];
    return n;
  };
  // prefix counts per row (W + 1 each): pinned cells; for rows r - 1 / r, the columns y where a shear does not fit:
  // T[r-1][y] over T[r][y + k] (down) or T[r-1][y + k] over T[r][y] (up) unless one of the rows repeats every k
  // there (then the shear changes nothing) or both are grass that meets in the sources
  const W1 = W + 1, pin = new Int32Array(W1 * H), down = new Int32Array(W1 * H), up = new Int32Array(W1 * H);
  const meets = (t: number, u: number): boolean => (src.shearAny || (grass.has(t) && grass.has(u))) && v.has(pairKey(t, u));
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
    const x0 = Math.min(a, b), x1 = Math.max(a, b), border = edges && (x0 === lo || x1 === hi);
    for (const y of [r - 1, r]) {
      if (border ? count(pin, y, x0, x1 + k) : count(pin, y, x0, x1) || count(pin, y, x0 + k, x1 + k)) return false;
    }
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
      const edge = edges && (s === lo || s === hi);
      for (let a = edge ? lo : Math.max(lo, s - step0); a <= (edge ? hi : Math.min(hi, s + step0)); a++) {
        if (prev[a] === Infinity) continue;
        const c = prev[a] + Math.min(3, Math.abs(a - s) * 0.15);
        if (c < best && step(r, a, s)) { best = c; arg = a; }
      }
      if (edges && !edge) for (const a of [lo, hi]) {                // in from the edge, where the seam ran along it
        if (prev[a] === Infinity || Math.abs(a - s) <= step0) continue;
        if (prev[a] + 3 < best && step(r, a, s)) { best = prev[a] + 3; arg = a; }
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
    if (edges && s0 === lo) objs.push(moved(p));                    // the border repeated before it: all of it moves
    else if (edges && s0 === hi) objs.push(p);                      // repeated past the end: nothing moves
    else if (p.pin[0] >= s0 + k) objs.push(moved(p));
    else if (p.pin[0] >= s0 && !p.free) objs.push(p, moved(p));
    else objs.push(p);
  }
  g.objs = objs;
  g.W += k;
  return true;
}

/** grow a grid by seams towards tw × th (it stops short on an axis where no more seams fit): the width first, then
 *  the height, whose seams may run along the top or bottom border where the land is too dense to cross */
function grow(g0: Grid, tw: number, th: number, src: Source, rng: Rng): Grid {
  const widen = (g: Grid, to: number, h: Set<number>, v: Set<number>, edges: boolean) => {
    while (g.W < to) {
      const left = to - g.W;
      let ok = false;
      for (const k of new Set([Math.min([2, 4, 4, 6, 6, 8][rng.int(0, 5)], left), Math.min(2, left)])) if ((ok = insertSeam(g, k, h, v, src, rng, edges))) break;
      if (!ok) return;
    }
  };
  widen(g0, tw, src.pairs.h, src.pairs.v, false);
  if (g0.H >= th) return g0;
  const t = transpose(g0);
  widen(t, th, src.pairs.v, src.pairs.h, true);
  return transpose(t);
}

/** a block of a template: its rim is bare walkable grass and every object drawn in it stays inside the rim */
interface Island { c: number; r: number; w: number; h: number }

/** bare walkable grass no object is drawn over */
function bareGrass(g: Grid, grass: Set<number>): Uint8Array {
  const { W, H } = g, cov = covered(g), out = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) out[r * W + c] = g.walk[r][c] && grass.has(g.tiles[r][c]) && !cov[r * W + c] ? 1 : 0;
  return out;
}

/** the islands of a map worth copying: something on them (a rise, a pond, a tree, a rock) and a rim of walkable grass
 *  (or pebbles) that nothing pinned stands on; an object pinned in it stays inside the rim */
function islandsOf(t: Grid, src: Source): Island[] {
  const { W, H } = t, W1 = W + 1, cov = covered(t), pinned = new Uint8Array(W * H);
  for (const p of t.objs) {
    if (p.free) continue;
    for (let r = Math.max(0, p.pin[1]); r <= Math.min(H - 1, p.pin[3]); r++) for (let c = Math.max(0, p.pin[0]); c <= Math.min(W - 1, p.pin[2]); c++) pinned[r * W + c] = 1;
  }
  const rim = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) rim[r * W + c] = t.walk[r][c] && src.soft.has(t.tiles[r][c]) && !pinned[r * W + c] ? 1 : 0;
  const rowP = new Int32Array(W1 * H), colP = new Int32Array((H + 1) * W), feat = new Int32Array(W1 * (H + 1));
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    rowP[r * W1 + c + 1] = rowP[r * W1 + c] + rim[r * W + c];
    colP[c * (H + 1) + r + 1] = colP[c * (H + 1) + r] + rim[r * W + c];
    const plain = src.grass.has(t.tiles[r][c]) && t.walk[r][c] && !cov[r * W + c];
    feat[(r + 1) * W1 + c + 1] = feat[r * W1 + c + 1] + feat[(r + 1) * W1 + c] - feat[r * W1 + c] + (plain ? 0 : 1);
  }
  const rowOk = (r: number, c0: number, c1: number) => rowP[r * W1 + c1 + 1] - rowP[r * W1 + c0] === c1 - c0 + 1;
  const colOk = (c: number, r0: number, r1: number) => colP[c * (H + 1) + r1 + 1] - colP[c * (H + 1) + r0] === r1 - r0 + 1;
  const boxes = t.objs.filter((p) => !p.free).map((p) => boxCells(p.box));
  const out: Island[] = [];
  // on even cells only (the 2×2 grass grid) and a few hundred at most: plenty to pick from, and quick
  for (let h = 6; h <= 16 && out.length < 400; h += 2) for (let w = 6; w <= 18 && out.length < 400; w += 2) for (let r = 0; r + h <= H; r += 2) for (let c = 0; c + w <= W; c += 2) {
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
  for (let tries = Math.round(open / 8), n = 0; tries > 0 && n < open / 160; tries--) {
    const { t, list } = rng.pick(src.isles);
    let is = rng.pick(list);                                          // the biggest of a few
    for (let i = 0; i < 3; i++) { const o = rng.pick(list); if (o.w * o.h > is.w * is.h) is = o; }
    // on the same 2×2 grass grid as where it came from
    const dc = (rng.int(M + 1, W - is.w - M - 1) & ~1) | (is.c & 1), dr = (rng.int(M + 1, H - is.h - M - 1) & ~1) | (is.r & 1);
    if (dc < 1 || dr < 1 || !free(dc, dr, is.w, is.h)) continue;
    let joins = true;
    for (let i = 0; i < is.w && joins; i++) {
      joins = v.has(pairKey(g.tiles[dr - 1][dc + i], t.tiles[is.r][is.c + i])) && v.has(pairKey(t.tiles[is.r + is.h - 1][is.c + i], g.tiles[dr + is.h][dc + i]));
    }
    for (let j = 0; j < is.h && joins; j++) {
      joins = h.has(pairKey(g.tiles[dr + j][dc - 1], t.tiles[is.r + j][is.c])) && h.has(pairKey(t.tiles[is.r + j][is.c + is.w - 1], g.tiles[dr + j][dc + is.w]));
    }
    if (!joins) continue;
    // its objects (a free one comes along by its anchor), all of them drawn inside the map
    const dx = (dc - is.c) * TILE, dy = (dr - is.r) * TILE;
    const brought = t.objs.filter((p) => {
      const [a, b] = p.free ? p.pin : boxCells(p.box);
      return a >= is.c && b >= is.r && a < is.c + is.w && b < is.r + is.h;
    });
    if (brought.some((p) => { const [a, b, c, d] = boxCells([p.box[0] + dx, p.box[1] + dy, p.box[2] + dx, p.box[3] + dy]); return a < 0 || b < 0 || c >= W || d >= H; })) continue;
    for (let j = 0; j < is.h; j++) for (let i = 0; i < is.w; i++) {
      g.tiles[dr + j][dc + i] = t.tiles[is.r + j][is.c + i];
      g.walk[dr + j][dc + i] = t.walk[is.r + j][is.c + i];
      g.copy[dr + j][dc + i] = 0;
    }
    for (const p of brought) {
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

/** the open middle: bare ground at least this far (Chebyshev) from anything else, so a rim of the old grass stays */
const MIDDLE_MARGIN = 4;

/**
 * New land in the open middle (synth.ts): rises and ponds on the bare ground far from everything (MIDDLE_MARGIN). Each
 * is a random blob of a few rectangles whose inside must come out as an unwalkable grass top (a rise) or open water (a
 * pond); the cells within RING of it are left to the fill, which finds the edges, cliffs and shores around it from the
 * sources' tile meetings (weighted towards plain ground, so the ring is the edge and not more land) and meets the old
 * ground outside. A blob the fill cannot close, or one that would cut the old walkable land apart, is dropped.
 */
function raise(g: Grid, src: Source, rng: Rng): { cells: number; terrain: number } {
  const { W, H } = g, bare = bareGrass(g, src.grass), N = W * H, BIG = 1 << 20;
  const dist = new Int32Array(N);
  for (let i = 0; i < N; i++) dist[i] = bare[i] ? BIG : 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {          // Chebyshev distance to the nearest non-bare cell
    const i = r * W + c;
    if (r === 0 || c === 0 || r === H - 1 || c === W - 1) dist[i] = Math.min(dist[i], 1);
    if (r > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1, c > 0 ? dist[i - W - 1] + 1 : BIG, c < W - 1 ? dist[i - W + 1] + 1 : BIG);
    if (c > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
  }
  for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) {
    const i = r * W + c;
    if (r < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1, c > 0 ? dist[i + W - 1] + 1 : BIG, c < W - 1 ? dist[i + W + 1] + 1 : BIG);
    if (c < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
  }
  const free = new Uint8Array(N);
  let open = 0;
  for (let i = 0; i < N; i++) if (dist[i] >= MIDDLE_MARGIN) { free[i] = 1; open++; }
  const flat = () => { const w = new Uint8Array(N); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) w[r * W + c] = g.walk[r][c]; return w; };
  const ground = (s: number) => (s & 1) === 1 && src.grass.has(s >> 1);
  let before = largestRegion(flat(), W, H);
  let ref = 0;                                                       // a cell of the main land away from the middle
  while (ref < N && !(before[ref] && !free[ref])) ref++;
  let made = 0;
  for (let tries = 300, fills = Math.min(18, Math.max(10, Math.round(open / 500))), want = Math.round(open / 350); tries > 0 && fills > 0 && made < want; tries--) {
    // the blob: a rectangle and one or two more overlapping it
    const core = new Uint8Array(N), rects: [number, number, number, number][] = [];
    const w0 = rng.int(6, 16), h0 = rng.int(4, 10);
    rects.push([0, 0, w0, h0]);
    for (let j = rng.int(0, 2); j > 0; j--) rects.push([rng.int(-3, w0 - 2), rng.int(-2, h0 - 2), rng.int(3, 8), rng.int(3, 6)]);
    const x0 = Math.min(...rects.map((q) => q[0])), y0 = Math.min(...rects.map((q) => q[1]));
    const bw = Math.max(...rects.map((q) => q[0] + q[2])) - x0, bh = Math.max(...rects.map((q) => q[1] + q[3])) - y0;
    const c0 = rng.int(1, W - bw - 2 * RING - 2) + RING, r0 = rng.int(1, H - bh - 2 * RING - 2) + RING;
    if (c0 < RING + 1 || r0 < RING + 1) continue;
    let room = true;
    for (let r = r0 - RING; r < r0 + bh + RING && room; r++) for (let c = c0 - RING; c < c0 + bw + RING; c++) if (!free[r * W + c]) { room = false; break; }
    if (!room) continue;
    for (const [x, y, w, h] of rects) for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) core[(r0 + y - y0 + r) * W + c0 + x - x0 + c] = 1;
    const mask = new Uint8Array(N), inner = new Uint8Array(N);
    for (let r = r0 - RING + 1; r < r0 + bh + RING - 1; r++) for (let c = c0 - RING + 1; c < c0 + bw + RING - 1; c++) {
      const i = r * W + c;
      let near = false, deep = core[i] === 1;
      for (let dy = -RING; dy <= RING; dy++) for (let dx = -RING; dx <= RING; dx++) {
        const j = i + dy * W + dx;
        if (core[j]) near = true;
        if (Math.abs(dy) <= 1 && Math.abs(dx) <= 1 && !core[j]) deep = false;
      }
      if (near) mask[i] = 1;
      if (deep) inner[i] = 1;
    }
    const pond = src.water !== null && rng.chance(POND_SHARE);
    fills--;
    const kept: [number, number, number][] = [];
    for (let i = 0; i < N; i++) if (mask[i]) kept.push([i, g.tiles[(i / W) | 0][i % W], g.walk[(i / W) | 0][i % W]]);
    const ok = fill(g.tiles, g.walk, W, H, mask, pond ? src.adjPond : src.adj, rng, {
      allow: (i, st) => !inner[i] || (pond ? st >> 1 === src.water : (st & 1) === 0 && src.grass.has(st >> 1)),
      weigh: (i, st, n) => (!inner[i] && ground(st) ? n * GROUND_BIAS : n),
      tries: 2,
    });
    if (!ok) continue;
    // the old walkable land must still hang together; otherwise put the ground back
    const w = flat(), seen = reachable(w, W, H, ref % W, (ref / W) | 0);
    let cut = false;
    for (let i = 0; i < N && !cut; i++) if (before[i] && !mask[i] && !seen[i]) cut = true;
    if (cut) {
      for (const [i, t, wk] of kept) { g.tiles[(i / W) | 0][i % W] = t; g.walk[(i / W) | 0][i % W] = wk; }
      continue;
    }
    for (let r = r0 - RING - 2; r < r0 + bh + RING + 2; r++) for (let c = c0 - RING - 2; c < c0 + bw + RING + 2; c++) if (r >= 0 && c >= 0 && r < H && c < W) free[r * W + c] = 0;
    for (let i = 0; i < N; i++) if (mask[i]) g.copy[(i / W) | 0][i % W] = 0;
    before = seen;
    made++;
  }
  let terrain = 0;
  for (let i = 0; i < N; i++) if (dist[i] >= MIDDLE_MARGIN && !(g.walk[(i / W) | 0][i % W] && src.grass.has(g.tiles[(i / W) | 0][i % W]))) terrain++;
  return { cells: open, terrain };
}

/** the share of rises that are ponds instead */
const POND_SHARE = 0.35;
/** the room kept around a rise for its edges and cliffs */
const RING = 4;
/** plain ground weighted up around a rise, so the ring becomes its edge and not more land */
const GROUND_BIAS = 20;

/** a free object whose ground the seams changed (a tile other than grass slid under its anchor or body) is left out */
/** the floor tiles of the maps: used 30 times or more and walkable in 40% of their uses or more (t4's sand is walkable
 *  in 55% of its uses: the rest is the blocked outside, drawn the same) */
function floorOf(maps: GameMap[]): Set<number> {
  const used = new Map<number, number>(), walk = new Map<number, number>();
  for (const m of maps) m.tiles.forEach((row, r) => row.forEach((v, c) => {
    used.set(v, (used.get(v) ?? 0) + 1);
    if (m.walk[r]?.[c]) walk.set(v, (walk.get(v) ?? 0) + 1);
  }));
  return new Set([...used].filter(([v, n]) => v > 0 && n >= 30 && (walk.get(v) ?? 0) / n >= 0.4).map(([v]) => v));
}

/** blocked floor reached from walkable floor with no object drawn over it becomes walkable, spreading on: the seams
 *  repeat lone blocked sand cells into rows of invisible pegs, and stretch the map's blocked outer band (drawn as the
 *  same sand) into the middle. Only floor tiles count (Source.flat), so a cliff, a rim or anything drawn stops the
 *  spread: what looks like the floor is the floor */
function openFlat(g: Grid, flat: Set<number>): void {
  const { W, H } = g, cov = covered(g), stack: number[] = [];
  const floor = (c: number, r: number) => c > 0 && r > 0 && c < W - 1 && r < H - 1 && flat.has(g.tiles[r][c]) && !cov[r * W + c];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g.walk[r][c] && floor(c, r)) stack.push(r * W + c);
  while (stack.length) {
    const i = stack.pop()!, c = i % W, r = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c + dx, y = r + dy;
      if (!floor(x, y) || g.walk[y][x]) continue;
      g.walk[y][x] = 1;
      stack.push(y * W + x);
    }
  }
}

function settle(g: Grid, sets: ZoneSets, grass: Set<number>): void {
  g.objs = g.objs.filter((p) => {
    if (!p.free) return true;
    const [c0, r0, c1, r1] = objFootprint(sets, p.o, g.tiles, grass);
    for (let r = Math.max(0, r0); r <= Math.min(g.H - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(g.W - 1, c1); c++) if (!grass.has(g.tiles[r][c])) return false;
    return true;
  });
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

/** an end of the way through is looked for in this many columns from the region's west / east edge (an eighth of a narrower zone) */
const END_SPAN = 24;

/** how roundabout the walk from the probe cells to (c, r) is: the mean of steps over Manhattan distance (1 = straight) */
export function detour(seen: Uint8Array, W: number, H: number, c: number, r: number, probe: number[]): number {
  const d = new Int32Array(W * H).fill(-1), q = new Int32Array(W * H);
  let head = 0, tail = 0;
  d[r * W + c] = 0; q[tail++] = r * W + c;
  while (head < tail) {
    const i = q[head++], x = i % W;
    for (const j of [x + 1 < W ? i + 1 : -1, x > 0 ? i - 1 : -1, i + W < W * H ? i + W : -1, i - W]) {
      if (j < 0 || !seen[j] || d[j] >= 0) continue;
      d[j] = d[i] + 1;
      q[tail++] = j;
    }
  }
  let sum = 0, n = 0;
  for (const i of probe) {
    const m = Math.abs((i % W) - c) + Math.abs(((i / W) | 0) - r);
    if (m < 8 || d[i] < 0) continue;
    sum += d[i] / m; n++;
  }
  return n ? sum / n : 1;
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
  species: readonly number[];
  /** a template map to grow (one of the kind's templates by the seed otherwise) */
  template?: number;
  /** the battle zone's number (1..3): its chests are rolled for it */
  zoneNo?: number;
  /** the chance of a rare creature */
  rare?: number;
  /** the stage's maps (stage 1's t3 when left out) */
  biome?: Biome;
}

/** walk steps from (c, r) over the reached cells (-1: not reached) */
export function walkDist(seen: Uint8Array, W: number, H: number, c: number, r: number): Int32Array {
  const d = new Int32Array(W * H).fill(-1), q = new Int32Array(W * H);
  let head = 0, tail = 0;
  if (c < 0 || r < 0 || c >= W || r >= H || !seen[r * W + c]) return d;
  d[r * W + c] = 0; q[tail++] = r * W + c;
  while (head < tail) {
    const i = q[head++], x = i % W;
    for (const j of [x + 1 < W ? i + 1 : -1, x > 0 ? i - 1 : -1, i + W < W * H ? i + W : -1, i - W]) {
      if (j < 0 || !seen[j] || d[j] >= 0) continue;
      d[j] = d[i] + 1;
      q[tail++] = j;
    }
  }
  return d;
}

/** the beats of a battle zone's way through (web/docs/expedition-balance.md §20.4): t = walk steps from the start /
 *  those to the exit stone. Each beat takes a share of the groups, gives each `pack` more of the kind (min, max), and
 *  weighs the stage's weak kinds `weak` against its normal ones. The breather holds no group but the first chest */
export const BEATS = [
  { name: '도입', t: [0, 0.2], share: 0.1, pack: [0, 0], weak: 3 },
  { name: '전개', t: [0.2, 0.55], share: 0.45, pack: [0, 1], weak: 1 },
  { name: '숨돌림', t: [0.55, 0.7], share: 0, pack: [0, 0], weak: 1 },
  { name: '정점', t: [0.7, 0.95], share: 0.45, pack: [1, 2], weak: 1 / 3 },
] as const;
/** the gatekeeper: three of a normal kind, this many walk steps from the exit stone on a shortest way to it (at most
 *  `slack` steps longer, the least that has room) */
export const GATE = { from: 12, to: 20, pack: 2, slack: [2, 6, 12] } as const;
/** the best chest's guard stands within this many tiles of it */
export const CHEST_GUARD = 6;

/** chests stay this far (tiles) from the start, the exit, the groups and each other */
const CHEST_GAP = 12, CHEST_APART = 25;

/** the chests of a battle zone (§6.2): each kind wants cells at least CHEST_DEPTH off the shortest way through (half the
 *  extra walk a visit costs), and of those the most tucked-away (fewest open cells around) are preferred */
function placeChests(seen: Uint8Array, W: number, H: number, start: [number, number], exit: [number, number], taken: [number, number][], kinds: ChestKind[], rng: Rng,
  prefer?: (i: number) => boolean): ZoneChest[] {
  const dS = walkDist(seen, W, H, start[0], start[1]), dE = walkDist(seen, W, H, exit[0], exit[1]), L = dS[exit[1] * W + exit[0]];
  const out: ZoneChest[] = [], at: [number, number][] = [];
  if (L < 0) return out;
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < W && r < H && seen[r * W + c] === 1;
  for (const kind of kinds) {
    const cands: [number, number][] = [];
    for (let i = 0; i < W * H; i++) {
      if (dS[i] < 0 || dE[i] < 0 || (dS[i] + dE[i] - L) / 2 < CHEST_DEPTH[kind]) continue;
      const c = i % W, r = (i / W) | 0;
      if (!open(c + 1, r) || !open(c, r + 1)) continue;
      if (taken.some(([tc, tr]) => (tc - c) ** 2 + (tr - r) ** 2 < CHEST_GAP ** 2) || at.some(([tc, tr]) => (tc - c) ** 2 + (tr - r) ** 2 < CHEST_APART ** 2)) continue;
      let n = 0;
      for (let y = r - 3; y <= r + 3; y++) for (let x = c - 3; x <= c + 3; x++) if (open(x, y)) n++;
      cands.push([i, n]);
    }
    if (!cands.length) continue;
    // the first chest goes where `prefer` says if it can (the breather of the way through, §20.4)
    if (prefer && !out.length && cands.some(([i]) => prefer(i))) cands.splice(0, cands.length, ...cands.filter(([i]) => prefer(i)));
    cands.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const [i] = cands[rng.int(0, Math.min(cands.length, Math.max(12, Math.round(cands.length * 0.15))) - 1)];
    const c = i % W, r = (i / W) | 0;
    at.push([c, r]);
    out.push({ x: c * TILE + 8, y: r * TILE + 8, kind });
  }
  return out;
}

/** a battle zone (or a rest clearing with groups = 0) */
export async function buildField(a: Assets, sets: ZoneSets, seed: number, kind: 'battle' | 'rest', o: BattleZoneOpts): Promise<Zone> {
  const b = o.biome ?? BIOME_T3, rng = new Rng(seed), src = await source(a, sets, b);
  const id = o.template ?? rng.pick(kind === 'rest' ? b.rest : b.battle), tpl = await a.map(id);
  const tw = Math.min(o.w, Math.round(tpl.header.width * MAX_GROW)), th = Math.min(o.h, Math.round(tpl.header.height * MAX_GROW));
  const g = grow(gridOf(tpl, sets, src.grass), tw, th, src, rng);
  const middle = kind === 'battle' ? raise(g, src, rng) : undefined;
  scatter(g, src, rng);
  vary(g, src, rng);
  settle(g, sets, src.grass);
  if (b.openFlat) openFlat(g, src.flat);
  const map = mapOf(g, tpl), W = g.W, H = g.H;
  // the way through: the largest walkable region, entered at its west end, left by the stone at its east end; of the
  // open cells near each end, the one the rest of the region reaches most directly (not one behind a long cliff line
  // or down a corridor, which only one route leads to)
  const region = largestRegion(zoneWalk(map, sets), W, H);
  const probe: number[] = [];
  for (let i = 0; i < W * H; i++) if (region[i]) probe.push(i);
  for (let i = probe.length - 1; i > 0; i--) { const j = rng.int(0, i); [probe[i], probe[j]] = [probe[j], probe[i]]; }
  probe.length = Math.min(probe.length, 400);
  // a zone much taller than wide (a narrow volcano gorge grows only that way) is crossed from north to south instead
  const tall = H > W * 1.2, N = tall ? H : W, M = tall ? W : H, along = (cell: [number, number]) => (tall ? cell[1] : cell[0]);
  const ends = (far: boolean): [number, number] => {
    const cells: [number, number][] = [];
    for (let a = far ? N - 1 : 0; far ? a >= 0 : a < N; a += far ? -1 : 1) {
      for (let b = 0; b < M; b++) {
        const [c, r] = tall ? [b, a] : [a, b];
        if (far ? openBlock(region, W, H, c, r, 1, 1, 4, 3) : openBlock(region, W, H, c, r, 2, 2)) cells.push([c, r]);
      }
      if (cells.length && Math.abs(along(cells[0]) - a) >= Math.min(END_SPAN, Math.round(N / 8))) break;
    }
    if (!cells.length) return [W >> 1, H >> 1];
    for (let i = cells.length - 1; i > 0; i--) { const j = rng.int(0, i); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    let best = cells[0], bestS = Infinity;
    for (const cell of cells.slice(0, 40)) {
      const s = detour(region, W, H, cell[0], cell[1], probe) + Math.abs(along(cell) - along(cells[0])) * 0.004;
      if (s < bestS) { bestS = s; best = cell; }
    }
    return best;
  };
  const start = ends(false), exit = ends(true);
  map.objLow.push({ obj: EXIT_LIT, x: exit[0] * TILE + 8, y: exit[1] * TILE + 8 });
  const walk = zoneWalk(map, sets);
  const seen = reachable(walk, W, H, start[0], start[1]);
  const spawns: Spawn[] = [];
  const taken: [number, number][] = [start, exit];
  // the chests first, the first of them in the breather of the way through (§20.4)
  const dS = walkDist(seen, W, H, start[0], start[1]), dE = walkDist(seen, W, H, exit[0], exit[1]);
  let L = dS[exit[1] * W + exit[0]];
  if (L <= 0) for (let i = 0; i < W * H; i++) L = Math.max(L, dS[i]);
  const tOf = (i: number) => Math.min(1, dS[i] / Math.max(1, L));
  const beatOf = (i: number) => BEATS.findIndex((bt) => tOf(i) >= bt.t[0] && tOf(i) < bt.t[1]);
  const chests = kind === 'battle' && o.zoneNo
    ? placeChests(seen, W, H, start, exit, taken, chestRoll(o.zoneNo, rng), rng, (i) => BEATS[beatOf(i)]?.share === 0) : undefined;
  const chestAt = (chests ?? []).map((c): [number, number] => [Math.floor(c.x / TILE), Math.floor(c.y / TILE)]);
  // enemy groups (§20.4), paced along the way through by t: a quiet way in, a building middle, a breather, a peak
  // before the exit; then the gatekeeper on a shortest way to the exit stone and a guard by the best chest. Each keeps
  // away from the start, the exit, the other groups and the chests.
  const free = (c: number, r: number, gap: number) => !taken.some(([tc, tr]) => (tc - c) ** 2 + (tr - r) ** 2 < gap * gap)
    && !chestAt.some(([tc, tr]) => (tc - c) ** 2 + (tr - r) ** 2 < CHEST_GAP * CHEST_GAP);
  const kindOf = (weak: number) => o.species[rng.weighted(o.species.map((s) => (SPECIES[s]?.tier === 'weak' ? weak : 1)))];
  const put = (i: number, species: number, pack: number, beat: Spawn['beat']) => {
    const c = i % W, r = (i / W) | 0;
    taken.push([c, r]);
    spawns.push({ x: c * TILE + 8, y: r * TILE + 8, species, pack, beat });
  };
  const pick = (cells: number[], gap: (tries: number) => number, tries = 2000): number => {
    for (let k = 0; k < tries && cells.length; k++) {
      const i = cells[rng.int(0, cells.length - 1)];
      if (free(i % W, (i / W) | 0, gap(k))) return i;
    }
    return -1;
  };
  if (o.groups > 0 && o.species.length) {
    const cells: number[][] = BEATS.map(() => []), gateCells: number[][] = GATE.slack.map(() => []);
    for (let i = 0; i < W * H; i++) {
      if (dS[i] < 0 || !openCell(seen, W, H, i % W, (i / W) | 0)) continue;
      const k = beatOf(i);
      if (k >= 0) cells[k].push(i);
      const off = GATE.slack.findIndex((sl) => dS[i] + dE[i] <= L + sl);
      if (dE[i] >= GATE.from && dE[i] <= GATE.to && off >= 0) gateCells[off].push(i);
    }
    // the gatekeeper: on a shortest way if it has room there (a narrow way may not), else a little off it
    for (const list of gateCells) {
      const gate = pick(list, () => 0, 400);
      if (gate >= 0) { put(gate, kindOf(0), GATE.pack, 'gate'); break; }
    }
    let guarded = 0;
    const best = (chests ?? []).reduce<ZoneChest | null>((m, c) => (!m || c.kind > m.kind ? c : m), null);
    if (best) {
      const bc = Math.floor(best.x / TILE), br = Math.floor(best.y / TILE), near: number[] = [];
      for (let r = br - CHEST_GUARD; r <= br + CHEST_GUARD; r++) for (let c = bc - CHEST_GUARD; c <= bc + CHEST_GUARD; c++) {
        const d2 = (c - bc) ** 2 + (r - br) ** 2;
        if (d2 < 9 || d2 > CHEST_GUARD ** 2 || !openCell(seen, W, H, c, r) || dS[r * W + c] < 0) continue;
        if (!taken.some(([tc, tr]) => (tc - c) ** 2 + (tr - r) ** 2 < 16 * 16)) near.push(r * W + c);
      }
      if (near.length) { put(near[rng.int(0, near.length - 1)], kindOf(1 / 3), rng.int(1, 2), 'guard'); guarded = 1; }
    }
    const want = BEATS.map((bt) => Math.round(o.groups * bt.share));
    want[want.length - 1] = Math.max(0, o.groups - want.slice(0, -1).reduce((x, n) => x + n, 0) - guarded);
    BEATS.forEach((bt, k) => {
      for (let n = 0; n < want[k]; n++) {
        const i = pick(cells[k], (t) => (t < 800 ? 22 : t < 1400 ? 16 : 12));
        if (i < 0) break;
        put(i, kindOf(bt.weak), rng.int(bt.pack[0], bt.pack[1]), k);
      }
    });
  }
  // the rare creature: one more spot, well away from the start
  if (kind === 'battle' && o.species.length && rng.chance(o.rare ?? 0)) {
    for (let tries = 0; tries < 4000; tries++) {
      const c = rng.int(2, W - 3), r = rng.int(2, H - 3);
      if (!openCell(seen, W, H, c, r) || (c - start[0]) ** 2 + (r - start[1]) ** 2 < 40 * 40 || !free(c, r, 16)) continue;
      taken.push([c, r]);
      spawns.push({ x: c * TILE + 8, y: r * TILE + 8, species: rng.pick(o.species), rare: true });
      break;
    }
  }
  return { kind, map, walk, start: { x: start[0] * TILE + 8, y: start[1] * TILE + 8 }, exit: { x: exit[0] * TILE + 8, y: exit[1] * TILE + 8 }, spawns, template: id, middle, chests, exitSide: tall ? 'south' : 'east' };
}

/** the boss room as it is (stage 1: m124, entered from its south passage), the boss where the original places it */
export async function buildBoss(a: Assets, sets: ZoneSets, bossSpecies: number, biome: Biome = BIOME_T3): Promise<Zone> {
  const src = await a.map(biome.boss.map), [sx, sy] = biome.boss.start, [ex, ey] = biome.boss.exit;
  const map: GameMap = { ...src, actors: [], portals: [], objBg: [...src.objBg], objLow: [...src.objLow], objMid: [...src.objMid], objTop: [...src.objTop] };
  const boss = src.actors[0];
  return {
    kind: 'boss', map, walk: zoneWalk(map, sets),
    start: { x: sx * TILE, y: sy * TILE }, exit: { x: ex * TILE, y: ey * TILE },
    spawns: [{ x: boss?.x ?? 256, y: boss?.y ?? 224, species: bossSpecies }],
  };
}
