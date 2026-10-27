// 원정(가제): new land for the open middle of a grown zone, made tile by tile from what the t3 maps show.
// A cell's state is its tile and its walk bit. The adjacency counts, over the source maps, which state sits next to
// which on each side; only meetings seen a few times count (a rare one is mostly a junction with an object or the
// map's edge), and walkable grass never meets unwalkable grass directly (a rise's top needs an edge around it). The
// fill is wave-function collapse: every masked cell keeps the states still possible, neighbours (fixed or not) cut
// each other down by support counts, and the most constrained cell is settled next, by its weight times how often its
// settled neighbours sit next to each state in the sources (so an edge goes on straight). A contradiction starts over.
import type { GameMap } from '../data/assets';
import type { Rng } from './rng';

const S = 512;                                              // states: tile * 2 + walk, tiles < 256

export const stateOf = (tile: number, walk: number): number => tile * 2 + (walk ? 1 : 0);

/** state-level adjacency for the propagating fill: the states, their weights and, per state and side, the states
 *  seen next to it there (bitsets of `words` words) */
export interface Adjacency {
  states: Int32Array;
  weight: Float64Array;
  words: number;
  /** [side][a * words + w]: side 0 right, 1 down, 2 left, 3 up */
  next: Uint32Array[];
  /** state → index, -1 when unused */
  index: Int32Array;
  /** [side][a * n + b]: how often b was seen on that side of a */
  pairs: Float32Array[];
}

export function buildAdjacency(maps: GameMap[], grass: Set<number>, minCount = 2, minPair = 3): Adjacency {
  const count = new Map<number, number>();
  for (const m of maps) for (let r = 0; r < m.header.height; r++) for (let c = 0; c < m.header.width; c++) {
    const s = stateOf(m.tiles[r][c], m.walk[r]?.[c] ?? 0);
    count.set(s, (count.get(s) ?? 0) + 1);
  }
  const states = Int32Array.from([...count].filter(([, n]) => n >= minCount).map(([s]) => s).sort((a, b) => a - b));
  const index = new Int32Array(S).fill(-1);
  states.forEach((s, i) => { index[s] = i; });
  const n = states.length, words = (n + 31) >> 5, next = [0, 1, 2, 3].map(() => new Uint32Array(n * words));
  const pairs = [0, 1, 2, 3].map(() => new Float32Array(n * n));
  // grass that can be walked on never touches grass that cannot (a rise's top) without an edge between, though the
  // sources show it under objects and at map edges
  const split = (a: number, b: number) => grass.has(states[a] >> 1) && grass.has(states[b] >> 1) && (states[a] & 1) !== (states[b] & 1);
  const set = (side: number, a: number, b: number) => { if (!split(a, b)) pairs[side][a * n + b]++; };
  for (const m of maps) {
    const W = m.header.width, H = m.header.height, at = (r: number, c: number) => index[stateOf(m.tiles[r][c], m.walk[r]?.[c] ?? 0)];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const a = at(r, c);
      if (a < 0) continue;
      if (c + 1 < W) { const b = at(r, c + 1); if (b >= 0) { set(0, a, b); set(2, b, a); } }
      if (r + 1 < H) { const b = at(r + 1, c); if (b >= 0) { set(1, a, b); set(3, b, a); } }
    }
  }
  // only meetings seen often: a rare one is usually a junction (an edge ending at an object or the map's edge)
  for (let side = 0; side < 4; side++) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (pairs[side][a * n + b] >= minPair) next[side][a * words + (b >> 5)] |= 1 << (b & 31);
    else pairs[side][a * n + b] = 0;
  }
  return { states, weight: Float64Array.from(states, (s) => count.get(s)!), words, next, index, pairs };
}

export interface FillOpts {
  /** what a cell may become */
  allow: (i: number, state: number) => boolean;
  /** a state's weight for a cell (the source count by default) */
  weigh?: (i: number, state: number, base: number) => number;
  /** fresh starts after a contradiction */
  tries: number;
}

/**
 * Wave-function-collapse style fill of the masked cells of tiles / walk: every cell keeps the states still possible,
 * neighbours (fixed or not) cut each other down to states seen next to each other in the sources (support counts per
 * cell, state and side), and the most constrained cell is settled next by weight. True when the whole mask settled
 * (written in place); a contradiction starts over, up to tries times.
 */
export function fill(tiles: number[][], walk: number[][], W: number, H: number, mask: Uint8Array, adj: Adjacency, rng: Rng, o: FillOpts): boolean {
  const { words, next, states, index } = adj, n = states.length;
  const lists = adjLists(adj);
  const cells: number[] = [];
  for (let i = 0; i < W * H; i++) if (mask[i]) cells.push(i);
  const m = cells.length;
  if (!m) return false;
  const slot = new Int32Array(W * H).fill(-1);
  cells.forEach((i, k) => { slot[i] = k; });
  const D = [1, W, -1, -W];
  const nb = new Int32Array(m * 4);                                  // neighbour slot per side, -1 when fixed
  for (let k = 0; k < m; k++) for (let d = 0; d < 4; d++) nb[k * 4 + d] = slot[cells[k] + D[d]];
  const base = new Uint8Array(m * n);                                // allowed and accepted by the fixed neighbours
  for (let k = 0; k < m; k++) {
    const i = cells[k];
    for (let a = 0; a < n; a++) {
      if (!o.allow(i, states[a])) continue;
      let ok = true;
      for (let d = 0; d < 4 && ok; d++) {
        if (nb[k * 4 + d] >= 0) continue;
        const j = i + D[d], f = index[stateOf(tiles[(j / W) | 0][j % W], walk[(j / W) | 0][j % W])];
        ok = f >= 0 && (next[d][a * words + (f >> 5)] & (1 << (f & 31))) !== 0;
      }
      if (ok) base[k * n + a] = 1;
    }
  }
  const wt = new Float64Array(m * n);
  for (let k = 0; k < m; k++) for (let a = 0; a < n; a++) if (base[k * n + a]) wt[k * n + a] = o.weigh ? o.weigh(cells[k], states[a], adj.weight[a]) : adj.weight[a];
  // the start, settled once: allowed states with support on every side (the attempts below copy it)
  const dom = base.slice(), size = new Int32Array(m), count = new Int32Array(m * n * 4);
  for (let k = 0; k < m; k++) for (let a = 0; a < n; a++) size[k] += dom[k * n + a];
  for (let k = 0; k < m; k++) for (let d = 0; d < 4; d++) {
    const kj = nb[k * 4 + d];
    if (kj < 0) continue;
    for (let a = 0; a < n; a++) {
      if (!dom[k * n + a]) continue;
      let c = 0;
      for (const b of lists[d][a]) c += dom[kj * n + b];
      count[(k * n + a) * 4 + d] = c;
    }
  }
  const stack: number[] = [];
  const remove = (k: number, a: number) => { dom[k * n + a] = 0; size[k]--; stack.push(k, a); };
  const propagate = (): boolean => {
    while (stack.length) {
      const b = stack.pop()!, j = stack.pop()!;
      if (size[j] <= 0) { stack.length = 0; return false; }
      for (let d = 0; d < 4; d++) {
        const k = nb[j * 4 + d];
        if (k < 0) continue;
        const e = (d + 2) & 3;                                       // j lies on side e of k
        for (const a of lists[d][b]) {
          if (!dom[k * n + a]) continue;
          if (--count[(k * n + a) * 4 + e] === 0) { remove(k, a); if (size[k] <= 0) { stack.length = 0; return false; } }
        }
      }
    }
    return true;
  };
  for (let k = 0; k < m; k++) for (let d = 0; d < 4; d++) {
    if (nb[k * 4 + d] < 0) continue;
    for (let a = 0; a < n; a++) if (dom[k * n + a] && count[(k * n + a) * 4 + d] === 0) remove(k, a);
  }
  if (!propagate()) return false;
  const dom0 = dom.slice(), size0 = size.slice(), count0 = count.slice();
  for (let attempt = 0; attempt < o.tries; attempt++) {
    if (attempt) { dom.set(dom0); size.set(size0); count.set(count0); }
    let ok = true;
    while (ok) {
      let best = -1, bestN = Infinity;
      for (let k = 0; k < m; k++) if (size[k] > 1) { const v = size[k] + rng.next(); if (v < bestN) { bestN = v; best = k; } }
      if (best < 0) break;
      // by weight, times how often each settled neighbour sits next to it in the sources (straight edges go on)
      const sides: [number, number][] = [];
      for (let d = 0; d < 4; d++) {
        const kj = nb[best * 4 + d];
        if (kj >= 0 ? size[kj] === 1 : true) {
          let b = -1;
          if (kj >= 0) { b = 0; while (!dom[kj * n + b]) b++; }
          else { const j = cells[best] + D[d]; b = index[stateOf(tiles[(j / W) | 0][j % W], walk[(j / W) | 0][j % W])]; }
          if (b >= 0) sides.push([d, b]);
        }
      }
      const cw = new Float64Array(n);
      let total = 0;
      for (let a = 0; a < n; a++) if (dom[best * n + a]) {
        let w = wt[best * n + a];
        for (const [d, b] of sides) w *= adj.pairs[d][a * n + b] / adj.weight[a];
        total += cw[a] = w;
      }
      let x = rng.next() * total, pick = -1;
      for (let a = 0; a < n; a++) if (dom[best * n + a]) { pick = a; if ((x -= cw[a]) < 0) break; }
      for (let a = 0; a < n; a++) if (a !== pick && dom[best * n + a]) remove(best, a);
      ok = propagate();
    }
    if (!ok) continue;
    for (let k = 0; k < m; k++) {
      let a = 0;
      while (!dom[k * n + a]) a++;
      const s0 = states[a], i = cells[k];
      tiles[(i / W) | 0][i % W] = s0 >> 1; walk[(i / W) | 0][i % W] = s0 & 1;
    }
    return true;
  }
  return false;
}

const listCache = new WeakMap<Adjacency, Int16Array[][]>();
/** per side and state, the states seen on that side of it */
function adjLists(adj: Adjacency): Int16Array[][] {
  let l = listCache.get(adj);
  if (!l) {
    const { words, next, states } = adj, n = states.length;
    l = [0, 1, 2, 3].map((d) => Array.from({ length: n }, (_, a) => {
      const out: number[] = [];
      for (let b = 0; b < n; b++) if (next[d][a * words + (b >> 5)] & (1 << (b & 31))) out.push(b);
      return Int16Array.from(out);
    }));
    listCache.set(adj, l);
  }
  return l;
}
