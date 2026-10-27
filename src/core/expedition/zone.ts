// 원정(가제): the zones of a run, built in the original GameMap format on tileset t3 (초원·호수).
// A battle zone is a big field (~190×160 tiles): a floor of the walkable tiles the t3 field maps use, weighted by how
// often they use them, with rectangles of those maps (tiles, walk bits and the objects standing in them) stamped over
// it so it looks like the original land, a band of blocking chunks around the edge, and a winding path carved from
// the start (west) to the exit stone (east) so the way through is always open. A rest zone is a small clearing; the
// boss zone is the original 초원 - 깊숙한곳 (m124) as it is.
import type { Assets, Cmf, GameMap, MapObject } from '../data/assets';
import { bodyBox, buildWalk } from '../world/world';
import { Rng } from './rng';

export const TILE = 16;
/** the t3 field maps the chunks and the floor mix come from (zone 3, 초원·호수) */
const SOURCES = [116, 118, 119, 120, 122, 123, 125];
/** 초원 - 깊숙한곳, the boss room */
export const BOSS_MAP = 124;
/** warp stone of cmf_oc (35 unlit, 36 lit): the zone exit */
export const EXIT_OBJ = -35, EXIT_LIT = -36;

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


/** the source maps and the floor mix: walkable tiles that are walkable most of the times they are used */
async function sources(a: Assets): Promise<{ maps: GameMap[]; floor: number[]; weights: number[] }> {
  const maps = await Promise.all(SOURCES.map((id) => a.map(id)));
  const used = new Map<number, number>(), walkable = new Map<number, number>();
  for (const m of maps) m.tiles.forEach((row, r) => row.forEach((v, c) => {
    used.set(v, (used.get(v) ?? 0) + 1);
    if (m.walk[r]?.[c]) walkable.set(v, (walkable.get(v) ?? 0) + 1);
  }));
  const floor = [...walkable.entries()].filter(([v, n]) => v > 0 && n > 500 && n / used.get(v)! > 0.6).sort((p, q) => q[1] - p[1]);
  return { maps, floor: floor.map(([v]) => v), weights: floor.map(([, n]) => n) };
}

function blankMap(w: number, h: number, floor: number[], weights: number[], rng: Rng): GameMap {
  return {
    header: { zone: 3, width: w, height: h, tileset: 3, objset: 3, bgm: 4, mapType: 0, monLevel: 0, h8: 0 },
    objBg: [], objLow: [], objMid: [], objTop: [], actors: [], portals: [],
    tiles: Array.from({ length: h }, () => Array.from({ length: w }, () => floor[rng.weighted(weights)])),
    walk: Array.from({ length: h }, () => new Array<number>(w).fill(1)),
  };
}

const LAYERS = ['objBg', 'objLow', 'objMid', 'objTop'] as const;

/** a w × h rectangle of a source map at (sc, sr) copied onto map at (dc, dr): tiles, walk bits and the objects whose
 *  anchor lies inside it */
function stamp(map: GameMap, src: GameMap, sc: number, sr: number, w: number, h: number, dc: number, dr: number): void {
  const W = map.header.width, H = map.header.height;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const tr = dr + r, tc = dc + c;
    if (tr < 0 || tc < 0 || tr >= H || tc >= W) continue;
    map.tiles[tr][tc] = src.tiles[sr + r][sc + c];
    map.walk[tr][tc] = src.walk[sr + r][sc + c] ? 1 : 0;
  }
  const x0 = sc * TILE, y0 = sr * TILE, x1 = x0 + w * TILE, y1 = y0 + h * TILE, dx = (dc - sc) * TILE, dy = (dr - sr) * TILE;
  for (const L of LAYERS) for (const o of src[L]) {
    if (o.x < x0 || o.x >= x1 || o.y < y0 || o.y >= y1) continue;
    map[L].push({ obj: o.obj, x: o.x + dx, y: o.y + dy });
  }
}

/** how much of a source rectangle is walkable (0..1) */
function openness(src: GameMap, sc: number, sr: number, w: number, h: number): number {
  let n = 0;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) n += src.walk[sr + r][sc + c] ? 1 : 0;
  return n / (w * h);
}

/** a source rectangle of about w × h whose openness is within [lo, hi] (the closest found when none is) */
function pickChunk(maps: GameMap[], rng: Rng, w: number, h: number, lo: number, hi: number): [GameMap, number, number] {
  let best: [GameMap, number, number] | null = null, bestErr = Infinity;
  for (let i = 0; i < 40; i++) {
    const m = rng.pick(maps), W = m.header.width, H = m.header.height;
    if (W <= w || H <= h) continue;
    const sc = rng.int(0, W - w - 1), sr = rng.int(0, H - h - 1), o = openness(m, sc, sr, w, h);
    const err = o < lo ? lo - o : o > hi ? o - hi : 0;
    if (err === 0) return [m, sc, sr];
    if (err < bestErr) { bestErr = err; best = [m, sc, sr]; }
  }
  return best!;
}

/** cells of a winding path from a to b (tile coordinates) through a few random waypoints */
function windingPath(rng: Rng, a: [number, number], b: [number, number], W: number, H: number): [number, number][] {
  const pts: [number, number][] = [a];
  const n = 4;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push([Math.round(a[0] + (b[0] - a[0]) * t), Math.max(8, Math.min(H - 9, Math.round(a[1] + (b[1] - a[1]) * t + rng.range(-H * 0.3, H * 0.3))))]);
  }
  pts.push(b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    let [c, r] = pts[i];
    const [c1, r1] = pts[i + 1];
    while (c !== c1 || r !== r1) {
      out.push([c, r]);
      if (c !== c1 && (r === r1 || rng.chance(0.6))) c += Math.sign(c1 - c); else r += Math.sign(r1 - r);
    }
  }
  out.push(b);
  return out.filter(([c, r]) => c > 0 && r > 0 && c < W - 1 && r < H - 1);
}

/** clear a disc of floor (walk on, objects anchored or standing there removed) around each path cell */
function carve(map: GameMap, sets: ZoneSets, cells: [number, number][], rad: number, floor: number[], weights: number[], rng: Rng): void {
  const W = map.header.width, H = map.header.height, open = new Uint8Array(W * H);
  for (const [c0, r0] of cells) for (let r = r0 - rad; r <= r0 + rad; r++) for (let c = c0 - rad; c <= c0 + rad; c++) {
    if (r < 1 || c < 1 || r >= H - 1 || c >= W - 1 || (c - c0) ** 2 + (r - r0) ** 2 > rad * rad + 1) continue;
    if (!open[r * W + c] && !map.walk[r][c]) map.tiles[r][c] = floor[rng.weighted(weights)];
    open[r * W + c] = 1;
    map.walk[r][c] = 1;
  }
  const inside = (o: MapObject) => {
    const [cmf, f] = objCmf(sets, o.obj), s8 = (v: number) => (v << 24) >> 24;
    const [bx, by, bw, bh] = bodyBox(cmf, f).map(s8);
    const c0 = Math.floor((o.x + Math.min(0, bx)) / TILE), c1 = Math.floor((o.x + Math.max(0, bx + bw)) / TILE);
    const r0 = Math.floor((o.y + Math.min(0, by)) / TILE), r1 = Math.floor((o.y + Math.max(0, by + bh)) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && c >= 0 && r < H && c < W && open[r * W + c]) return true;
    return false;
  };
  for (const L of LAYERS) map[L] = map[L].filter((o) => !inside(o));
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

/** a cell whose whole 3×3 block is open and reached */
function openCell(seen: Uint8Array, W: number, H: number, c: number, r: number): boolean {
  for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if (x < 0 || y < 0 || x >= W || y >= H || !seen[y * W + x]) return false;
  return true;
}

export interface BattleZoneOpts {
  w: number;
  h: number;
  /** enemy groups placed */
  groups: number;
  /** species indices the groups are drawn from */
  species: number[];
}

/** a battle zone (or a rest clearing with groups = 0) */
export async function buildField(a: Assets, sets: ZoneSets, seed: number, kind: 'battle' | 'rest', o: BattleZoneOpts): Promise<Zone> {
  const rng = new Rng(seed), { maps, floor, weights } = await sources(a);
  const { w: W, h: H } = o;
  const map = blankMap(W, H, floor, weights, rng);
  // the edge: blocking chunks all around
  const BAND = 6;
  for (const side of [0, 1, 2, 3]) {
    const along = side < 2 ? W : H;
    for (let p = -4; p < along; p += rng.int(10, 16)) {
      const cw = side < 2 ? rng.int(12, 18) : BAND + rng.int(1, 3), ch = side < 2 ? BAND + rng.int(1, 3) : rng.int(12, 18);
      const [m, sc, sr] = pickChunk(maps, rng, cw, ch, 0, 0.15);
      const dc = side < 2 ? p : side === 2 ? -rng.int(0, 2) : W - cw + rng.int(0, 2);
      const dr = side >= 2 ? p : side === 0 ? -rng.int(0, 2) : H - ch + rng.int(0, 2);
      stamp(map, m, sc, sr, cw, ch, dc, dr);
    }
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (r < 2 || c < 2 || r >= H - 2 || c >= W - 2) map.walk[r][c] = 0;
  // the land: mixed chunks over the inside
  const n = Math.round((W * H) / (kind === 'rest' ? 700 : 230));
  for (let i = 0; i < n; i++) {
    const cw = rng.int(10, 22), ch = rng.int(8, 18);
    const [m, sc, sr] = i % 3 === 0 ? pickChunk(maps, rng, cw, ch, 0.45, 0.85) : pickChunk(maps, rng, cw, ch, 0.1, 0.5);
    stamp(map, m, sc, sr, cw, ch, rng.int(BAND, W - BAND - cw), rng.int(BAND, H - BAND - ch));
  }
  // the way through: start west, exit east, a winding path between, open clearings at both ends
  const start: [number, number] = [BAND + 3, rng.int(Math.floor(H * 0.3), Math.floor(H * 0.7))];
  const exit: [number, number] = [W - BAND - 4, rng.int(Math.floor(H * 0.3), Math.floor(H * 0.7))];
  const path = windingPath(rng, start, exit, W, H);
  carve(map, sets, path, kind === 'rest' ? 3 : 2, floor, weights, rng);
  carve(map, sets, [start, exit], 4, floor, weights, rng);
  for (let i = 0; i < Math.round(n / 4); i++) {                    // side clearings off the path, where groups wait
    const [c, r] = rng.pick(path);
    const side = windingPath(rng, [c, r], [Math.max(BAND + 2, Math.min(W - BAND - 3, c + rng.int(-24, 24))), Math.max(BAND + 2, Math.min(H - BAND - 3, r + rng.int(-24, 24)))], W, H);
    carve(map, sets, side, 2, floor, weights, rng);
    carve(map, sets, [side[side.length - 1]], 4, floor, weights, rng);
  }
  map.objLow.push({ obj: EXIT_OBJ, x: exit[0] * TILE + 8, y: exit[1] * TILE + 8 });
  const walk = zoneWalk(map, sets);
  const seen = reachable(walk, W, H, start[0], start[1]);
  // enemy groups: open reached cells away from the start and from each other
  const spawns: Spawn[] = [];
  const taken: [number, number][] = [start, exit];
  for (let g = 0, tries = 0; g < o.groups && tries < 4000; tries++) {
    const c = rng.int(BAND, W - BAND - 1), r = rng.int(BAND, H - BAND - 1);
    if (!openCell(seen, W, H, c, r) || taken.some(([tc, tr]) => (tc - c) ** 2 + (tr - r) ** 2 < 22 * 22)) continue;
    taken.push([c, r]);
    spawns.push({ x: c * TILE + 8, y: r * TILE + 8, species: rng.pick(o.species) });
    g++;
  }
  return { kind, map, walk, start: { x: start[0] * TILE + 8, y: start[1] * TILE + 8 }, exit: { x: exit[0] * TILE + 8, y: exit[1] * TILE + 8 }, spawns };
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
