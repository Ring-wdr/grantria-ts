// Map rules shared by the viewer and the game: walk layer 0 with object stamping, and the
// mid-layer depth key (analysis/features/locomotion.md §3, §7; assets-data.md).
import type { Cmf, GameMap, MapObject } from './assets';

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
export function buildWalk(map: GameMap, objCmf: (id: number) => [Cmf, number]): Uint8Array {
  const W = map.header.width, H = map.header.height;
  const walk = new Uint8Array(W * H);
  map.walk.forEach((row, r) => row.forEach((v, c) => { walk[r * W + c] = v; }));
  const s8 = (v: number) => (v << 24) >> 24;
  for (const o of [...map.objBg, ...map.objMid, ...map.objTop, ...map.objLow]) {
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
