// Map rules shared by the viewer and the game: walk layer 0 with object stamping, and the
// mid-layer depth key (analysis/features/locomotion.md §3, §7; assets-data.md).
import type { Cmf, GameMap, MapObject } from '../data/assets';

const TILE = 16;

/** Body box {x, y, w, h} of a cmf frame (first half of its 8-byte box entry). */
export function bodyBox(cmf: Cmf, frame: number): [number, number, number, number] {
  const b = cmf.frames[frame]?.body_box;
  return b ? [b[0], b[1], b[2], b[3]] : [0, 0, 0, 0];
}

/**
 * Walk layer 0 = file bits with every map object's body box stamped out (FUN_0001da78):
 * a cell is cleared when the box covers more than 0x53 px^2 of it. Box bytes are sign-extended.
 * Quirks kept: a single-row box measures only up to the row's bottom edge, and a box whose
 * bottom lies exactly on a cell boundary stops before that row.
 */
export function buildWalk(map: GameMap, objCmf: (id: number) => [Cmf, number], open: (o: MapObject) => boolean = () => false): Uint8Array {
  const W = map.header.width, H = map.header.height;
  const walk = new Uint8Array(W * H);
  map.walk.forEach((row, r) => row.forEach((v, c) => { walk[r * W + c] = v; }));
  const s8 = (v: number) => (v << 24) >> 24;
  for (const o of [...map.objBg, ...map.objMid, ...map.objTop, ...map.objLow]) {
    if (open(o)) continue;
    const [cmf, f] = objCmf(o.obj);
    const [bx, by, bw, bh] = bodyBox(cmf, f).map(s8);
    if (bx + by + bw + bh <= 0) continue;
    const left = o.x + bx, right = left + bw, top = o.y + by, bottom = top + bh;
    const c0 = left >> 4, c1 = right >> 4, r0 = top >> 4, r1 = bottom >> 4;
    for (let r = r0; r <= r1; r++) {
      let rowH: number;
      if (r === r0) rowH = (r0 + 1) * TILE - top;
      else if (r === r1) { if (bottom === r1 * TILE) break; rowH = bottom - r1 * TILE; }
      else rowH = TILE;
      for (let c = c0; c <= c1; c++) {
        const cellLeft = c === c0 ? left : c * TILE;
        const colW = c === c1 ? right - cellLeft : (c + 1) * TILE - cellLeft;
        if (colW * rowH > 0x53 && r >= 0 && c >= 0 && r < H && c < W) walk[r * W + c] = 0;
      }
    }
  }
  return walk;
}

const ORTH: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const HORZ: [number, number][] = [[1, 0], [-1, 0]];

/** Walk layers 0..3 of the map loader (FUN_0001dd48, gimmicks.md §2.1): FUN_000195b0 mode 0 erodes the file bits
 *  three times (a cell stays when it and its 4 neighbours are passable), FUN_0001da78 then clears object stamps
 *  from layers 0..2 only, and mode 1 ORs in cells whose left and right neighbours are passable. Neighbours use the
 *  flat index y*W + x, so x ± 1 wraps onto the next / previous row (original); outside the bitmap is 0. */
export function buildWalkLayers(map: GameMap, stamped: Uint8Array): Uint8Array[] {
  const W = map.header.width, H = map.header.height, N = W * H;
  const file = new Uint8Array(N);
  map.walk.forEach((row, r) => row.forEach((v, c) => { if (r < H && c < W) file[r * W + c] = v ? 1 : 0; }));
  const at = (a: Uint8Array, i: number) => (i >= 0 && i < N ? a[i] : 0);
  const erode = (src: Uint8Array, dst: Uint8Array, ks: [number, number][]) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (src[i] && ks.every(([dx, dy]) => at(src, (y + dy) * W + x + dx))) dst[i] = 1;
    }
  };
  const L = [stamped, new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)];
  erode(file, L[1], ORTH); erode(L[1], L[2], ORTH); erode(L[2], L[3], ORTH);
  for (let i = 0; i < N; i++) { L[1][i] &= stamped[i]; L[2][i] &= stamped[i]; }
  erode(stamped, L[1], HORZ); erode(L[1], L[2], HORZ); erode(L[2], L[3], HORZ);
  return L;
}

/** objMid depth key (FUN_00063640): y + box.y (unsigned byte) + box.h / 2. */
export function objDepth(o: MapObject, cmf: Cmf, frame: number): number {
  const [, by, , bh] = bodyBox(cmf, frame);
  return o.y + (by & 0xff) + ((bh & 0xff) >> 1);
}

/** Actor depth key: y + body box dy (player body box dy = -8). */
export function actorDepth(y: number, cmf: Cmf, frame: number): number {
  return y + bodyBox(cmf, frame)[1];
}

export interface DepthItem {
  key: number;
  /** 0 = actor, 1 = objMid: on equal keys actors draw first */
  kind: 0 | 1;
  draw: () => void;
}

/** Stable ascending sort, actors before objects on ties (insertion order otherwise kept). */
export function depthSort<T extends DepthItem>(items: T[]): T[] {
  return items.sort((a, b) => a.key - b.key || a.kind - b.kind);
}
