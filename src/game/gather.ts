// Gathering (analysis/features/gimmicks.md §2): nodes spawned on hunting maps (FUN_00019734) on walk layer 3,
// the node / gauge state machine (FUN_000731a4, FUN_000618f4, gauge FUN_0002eae8, '5' and cancel in FUN_00045570),
// gather exp and levels (FUN_00072f18), pickaxes. c60 / c62 / c65 / c66 / c68 / c69 keep the original globals' names.
import type { Assets, Cmf } from '../assets';
import type { Drawable, Field } from './field';
import type { Rng } from './rules';
import type { Ui } from './ui';

export class GatherNode {
  /** frames {idle start, len, gather start, len, deplete start, len} (d+0x26ba0) */
  readonly rec: number[];
  /** +0x77 depleting, +0x24 its mode (0 the gauge ran out, 1 success) */
  depleting = false;
  depMode = 0;
  constructor(a: Assets, readonly x: number, readonly y: number, readonly type: number, readonly sub: number,
    readonly row: number, readonly rare: boolean) {
    const o = 0x26ba0 + row * 12 + (rare ? 6 : 0);
    this.rec = Array.from({ length: 6 }, (_, i) => a.d8(o + i));
  }
  /** standing on the node: [x-20, x+20] × [y-20, y+20] */
  near(px: number, py: number): boolean { return Math.abs(px - this.x) <= 20 && Math.abs(py - this.y) <= 20; }
  /** FUN_0002f184 kind 4. While gathering, the player handler (FUN_000618f4, updated after the node) rewrites the
   *  base to rec[2] every frame, so the depletion is drawn from rec[2] as well: rec[2] + rec[5] - (c69 >> 1 | c60). */
  frame(tick: number, run: GatherRun | null): number {
    const r = this.rec;
    if (run?.node === this) {
      if (this.depleting) return r[2] + r[5] - (this.depMode === 1 ? run.c69 >> 1 : run.c60);
      return r[2] + ((tick >> 1) % Math.max(1, r[3]));
    }
    return r[0] + ((tick >> 1) % Math.max(1, r[1]));
  }
  /** the node, then its sparkle FUN_00024a5c(0x5d + (tick >> 1) % 7) at (x - 8, y), whatever the effects option */
  drawables(field: Field, status: Cmf, tick: number, run: GatherRun | null): Drawable[] {
    const [name, cmf] = this.row === 0 || this.row === 11 ? ['cmf_oc', field.oc] as [string, Cmf] : field.objSet;
    return [
      { cmfName: name, cmf, frame: this.frame(tick, run), x: this.x - 8, y: this.y, depth: this.y },
      { cmfName: 'cmf_status', cmf: status, frame: 0x5d + ((tick >> 1) % 7), x: this.x - 8, y: this.y, depth: this.y },
    ];
  }
}

/** FUN_00049660 / FUN_00049628: integer square-root approximation <= 50, which holds exactly for d² <= 2595 */
function near50(dx: number, dy: number): boolean {
  let n = Math.trunc(((dx * dx + dy * dy) * 100) / 2);
  if (n <= 0) return true;
  let k = 0;
  do { n -= k; k++; } while (k < n);
  return Math.trunc(k / 10) <= 50;
}

/** FUN_00019734: 1 (50 %) or 2 nodes in random 10×10 blocks, on walk layer 3, away from the player's entry point */
export function spawnNodes(a: Assets, field: Field, rng: Rng, zone: number, night: boolean, px: number, py: number): GatherNode[] {
  const W = field.map.header.width, H = field.map.header.height;
  for (let tries = 0; tries < 10; tries++) {
    const count = rng.rand(10000) <= 5000 ? 1 : 2;
    const cells = [rng.rand(100)];
    if (count === 2) { let c = rng.rand(100); while (c === cells[0]) c = rng.rand(100); cells.push(c); }
    const bw = Math.trunc(W / 10), bh = Math.trunc(H / 10), out: GatherNode[] = [];
    for (const cell of cells) {
      const bx = cell % 10, by = Math.trunc(cell / 10);
      for (let j = 0; j < bw * bh; j += 2) {
        const cx = (j % bw) + bx * bw, cy = Math.trunc(j / bw) + by * bw;   // y also uses bw (original)
        if (!field.walkLayer(3, cx, cy)) continue;
        const x = cx * 16, y = cy * 16;
        if (near50(x - px, y - py)) continue;
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

/** FUN_00072f18: exp of one gather and the level up; returns [exp, levelled]. With 천상의 곡괭이 (perm) a zone
 *  above the level's cap gives 3 instead of 0 (gimmicks.md §2.4). */
export function gatherExp(g: { lv: number; exp: number }, zone: number, perm = false): [number, boolean] {
  const lv = g.lv;
  const e = perm ? (lv === 0 ? 3 : lv === 5 ? 0 : zone < [0, 4, 7, 9, 11][lv] ? 2 : 3)
    : lv === 5 || zone > [3, 6, 8, 10, 12][lv] ? 0 : (lv > 0 && zone < [0, 4, 7, 9, 11][lv]) ? 2 : 3;
  g.exp += e;
  if (lv < 5 && g.exp >= GATHER_NEED[lv]) { g.lv++; g.exp = 0; return [e, true]; }
  return [e, false];
}

/**
 * One gathering (gimmicks.md §2.3). Frame order of the original: keys (scene) -> update() (the node is updated
 * before the player) -> the player's pose and playerTick() -> effect 0xa7 (fxFire) -> judge() (the gauge draw
 * sets c62). The gauge c60 runs 50 -> 0; inside the window cur ∈ (c66+18, c66+20] it stops for c69 = 10 frames.
 */
export class GatherRun {
  c60 = 50;
  c62 = 0;
  c68 = 0;
  c69 = 10;
  readonly c66: number;
  private flash = 0;
  private shake = 0;
  private alpha = 26;
  constructor(readonly node: GatherNode, rng: Rng) { this.c66 = rng.rand(20); }
  get cur(): number { return Math.trunc(((50 - (this.c60 % 50)) * 61) / 50); }
  /** FUN_000731a4 after its trait roll; true when the gathering finishes this frame */
  update(): boolean {
    const dep = this.node.rec[5];
    if (this.c60 === 0 && this.c69 === 0) return true;
    const tick = () => {
      if (this.c60) { if (--this.c60 === dep) this.deplete(0); }
      else this.c69 = (this.c69 - 1) & 0xff;
    };
    if (this.c69 === 0 && this.c60 !== 4) { this.c62 = 1; tick(); }
    else if (this.c62 !== 4 && this.c62 !== 2) tick();
    else { this.c69 = (this.c69 - 1) & 0xff; if (this.c62 === 4 && this.c69 === dep * 2) this.deplete(1); }
    return false;
  }
  private deplete(mode: number): void { this.node.depleting = true; this.node.depMode = mode; }
  /** FUN_000618f4 inside the player handler */
  playerTick(): void { if (this.c62 === 0) this.c62 = 1; }
  /** swing offset s added to the pose frame (FUN_00063ab4 / 63948 / 637dc) */
  swing(tick: number): number { return this.c60 < 48 && (this.c60 > 1 || this.c69 > 1) ? 2 + ((tick >> 2) % 3) : 0; }
  /** FUN_0002c99c case 0x10: the 12th update of effect 0xa7 ends the gauge (unless cancelled) */
  fxFire(): void { if (this.c62 !== 0) { this.c60 = 0; this.c69 = 20; this.c62 = 4; } }
  /** '5' (FUN_00045570) with c62 ∈ {2, 3}: success */
  press(): boolean {
    if (this.c62 !== 2 && this.c62 !== 3) return false;
    this.c62 = 4; this.c68 = 1; this.c69 = this.node.rec[5] + 2;
    return true;
  }
  /** a non-'5' key press with c62 ∈ {1, 2} cancels the gathering (the key is then handled as usual) */
  get cancellable(): boolean { return this.c62 === 1 || this.c62 === 2; }
  /** the state half of FUN_0002eae8, once per frame while c62 != 0 */
  judge(): void {
    if (this.c62 === 0) return;
    const cur = this.cur, w = this.c66;
    this.flash = 0; this.shake = 0; this.alpha = 26;
    if (cur > w + 20) {
      if (this.c62 !== 4) this.c62 = 1;
      else { this.flash = 10; this.alpha = this.c69 < 16 ? this.c69 >> 1 : 32; this.shake = 30; }
    } else if (cur > w + 18) {
      if (this.c62 < 3) this.c62 = 2;
      this.flash = this.c69 & 2; this.shake = this.flash * 3;
    }
  }

  /** FUN_0002eae8 gauge above the node (screen coordinates of the node origin); white bar while flashing */
  draw(u: Ui, nx: number, ny: number): void {
    if (this.c62 === 0) return;
    const x = nx, y = ny - 46, cur = Math.min(this.c62 === 4 ? 61 : this.cur, 61);
    const bar = this.flash ? 0xffffff : 0xffdd00, done = this.flash ? 0xffffff : 0xff6600;
    u.alpha = this.alpha;
    u.fill(x - 28, y, 73, 15, 0xffffff);
    u.fill(x - 26, y + 2, 69, 11, 0);
    u.fill(x - 24, y + 4, 64, 7, 0x666666);
    u.fill(x - 23, y + 5, cur, 5, bar);
    u.fill(x - 23, y + 5, Math.min(cur, this.c66 + 20), 5, done);
    const sh = this.shake ? 6 : 0;
    u.fill(x - 23 + this.c66 + 18, y + 2 - sh, 3, 11 + 2 * sh, 0xffffff);   // timing window; arrows shake ∓6
    u.alpha = 16; u.fill(x - 23, y + 6, cur, 2, 0xffffff);
    u.alpha = 32;
  }
}
