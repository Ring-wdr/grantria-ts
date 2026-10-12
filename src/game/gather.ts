// Gathering (analysis/features/gimmicks.md §2): nodes spawned on hunting maps (FUN_00019734), the
// timing gauge (FUN_000731a4 / FUN_0002eae8), gather exp and levels (FUN_00072f18), pickaxes.
// Approximations: spawn cells use "walkable 3 cells around" instead of the eroded walk layer 3 [근사];
// the player keeps standing (the swing pose of action 0xd/0xf is not drawn) [근사].
import type { Assets, Cmf } from '../assets';
import type { Drawable, Field } from './field';
import type { Rng } from './rules';
import type { Ui } from './ui';

export class GatherNode {
  /** frames {idle start, len, gather start, len, deplete start, len} (d+0x26ba0) */
  readonly rec: number[];
  t = 0;
  state: 'idle' | 'gather' | 'deplete' = 'idle';
  stateT = 0;
  constructor(a: Assets, readonly x: number, readonly y: number, readonly type: number, readonly sub: number,
    readonly row: number, readonly rare: boolean) {
    const o = 0x26ba0 + row * 12 + (rare ? 6 : 0);
    this.rec = Array.from({ length: 6 }, (_, i) => a.d8(o + i));
  }
  /** standing on the node: [x-20, x+20] × [y-20, y+20] */
  near(px: number, py: number): boolean { return Math.abs(px - this.x) <= 20 && Math.abs(py - this.y) <= 20; }
  frame(): number {
    const r = this.rec;
    if (this.state === 'gather') return r[2] + ((this.t >> 1) % Math.max(1, r[3]));
    if (this.state === 'deplete') return r[4] + Math.min(r[5] - 1, this.stateT >> 1);
    return r[0] + ((this.t >> 1) % Math.max(1, r[1]));
  }
  drawable(field: Field): Drawable {
    const [name, cmf] = this.row === 0 || this.row === 11 ? ['cmf_oc', field.oc] as [string, Cmf] : field.objSet;
    return { cmfName: name, cmf, frame: this.frame(), x: this.x - 8, y: this.y, depth: this.y };
  }
}

/** FUN_00019734: 1 (50 %) or 2 nodes in random 10×10 blocks, away from walls and > 50 px from the player */
export function spawnNodes(a: Assets, field: Field, rng: Rng, zone: number, night: boolean, px: number, py: number): GatherNode[] {
  const W = field.map.header.width, H = field.map.header.height;
  const open = (cx: number, cy: number) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!field.walkCell(cx + dx, cy + dy)) return false;
    return true;
  };
  for (let tries = 0; tries < 10; tries++) {
    const count = rng.rand(10000) <= 5000 ? 1 : 2;
    const cells = [rng.rand(100)];
    if (count === 2) { let c = rng.rand(100); while (c === cells[0]) c = rng.rand(100); cells.push(c); }
    const bw = Math.trunc(W / 10), bh = Math.trunc(H / 10), out: GatherNode[] = [];
    for (const cell of cells) {
      const bx = cell % 10, by = Math.trunc(cell / 10);
      for (let j = 0; j < bw * bh; j += 2) {
        const cx = (j % bw) + bx * bw, cy = Math.trunc(j / bw) + by * bw;   // y also uses bw (original)
        if (!open(cx, cy)) continue;
        const x = cx * 16, y = cy * 16;
        if (Math.hypot(x - px, y - py) <= 50) continue;
        const rare = night && rng.rand(100) < 50;
        let type = rng.rand(2) ? 0x14 : 0x13;
        if (rare && zone < 7) type = 0x14;
        const row = zone < 3 ? 0 : zone - 2;
        if (a.d8(0x26ba0 + row * 12 + (rare ? 6 : 0)) === 0) return [];   // zone 5: no gathering
        out.push(new GatherNode(a, x, y, type, a.d8(0x24b7b + zone * 2) + (rare ? 1 : 0), row, rare));
        break;
      }
    }
    if (out.length) return out;
  }
  return [];
}

/** zone cap per gather level and the exp needed (gimmicks.md §2.2 / §2.4) */
export const GATHER_CAP = [3, 6, 8, 10, 12, 13];
const GATHER_NEED = [60, 120, 240, 360, 600];

/** FUN_00072f18: exp of one gather and the level up; returns [exp, levelled] */
export function gatherExp(g: { lv: number; exp: number }, zone: number): [number, boolean] {
  const lv = g.lv;
  const e = lv === 5 || zone > [3, 6, 8, 10, 12][lv] ? 0 : (lv > 0 && zone < [0, 4, 7, 9, 11][lv]) ? 2 : 3;
  g.exp += e;
  if (lv < 5 && g.exp >= GATHER_NEED[lv]) { g.lv++; g.exp = 0; return [e, true]; }
  return [e, false];
}

/** the gauge run: c60 50 -> 0 (49 frames per pass), target c66 = rand(20), window cur ∈ (c66+18, c66+20] */
export class GatherRun {
  c60 = 50;
  readonly c66: number;
  success = false;
  /** frames left after the gauge (success: 20, otherwise 10) */
  tail = -1;
  constructor(readonly node: GatherNode, rng: Rng) { this.c66 = rng.rand(20); }
  get cur(): number { return Math.trunc(((50 - (this.c60 % 50)) * 61) / 50); }
  get inWindow(): boolean { return !this.success && this.cur > this.c66 + 18 && this.cur <= this.c66 + 20; }
  /** one frame; returns true when finished */
  tick(): boolean {
    if (this.tail >= 0) { this.node.stateT++; return --this.tail <= 0; }
    if (this.c60 > 0) { this.c60--; if (this.c60 === 0) { this.tail = 10; this.node.state = 'deplete'; this.node.stateT = 0; } }
    return false;
  }
  hit(): void { this.success = true; this.tail = 20; this.node.state = 'deplete'; this.node.stateT = 0; }

  /** FUN_0002eae8 gauge above the node (screen coordinates of the node origin) */
  draw(u: Ui, nx: number, ny: number): void {
    const x = nx, y = ny - 46, cur = this.success ? 61 : this.cur;
    u.alpha = this.success ? (this.tail < 16 ? this.tail >> 1 : 32) : 26;
    u.fill(x - 28, y, 73, 15, 0xffffff);
    u.fill(x - 26, y + 2, 69, 11, 0);
    u.fill(x - 24, y + 4, 64, 7, 0x666666);
    u.fill(x - 23, y + 5, Math.min(cur, 61), 5, 0xffdd00);
    u.fill(x - 23, y + 5, Math.min(cur, this.c66 + 20), 5, 0xff6600);
    u.fill(x - 23 + this.c66 + 18, y + 2, 3, 11, 0xffffff);                // timing window
    u.alpha = 16; u.fill(x - 23, y + 6, cur, 2, 0xffffff);
    u.alpha = 32;
  }
}
