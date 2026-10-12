// Map tab 0x22 (ui-tabs.md §0.10, leftovers-ui.md §2). World view: region table d.dat 0x4016D2 + r*6 =
// {ax, ay, up, down, left, right} (0x0F = none, FUN_000494c4). Floor view ('5' on a visited region):
// grid FUN_00049abc, drawing FUN_00057b88, keys FUN_00056a60 — a port of tools/grantria_mapfloor.py,
// which matches the original draw calls in all 296 emulated cases.
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import { Popup } from './popup';
import type { GameContext } from './scene';
import { tri, type Ui } from './ui';

const SHAPE = 0x255a6, ROOM = 0x255c0, CORR = 0x2603a, FLOOR = 0x26766, NFLOOR = 0x26808, ARROW = 0x269b7;
const C_OUT = 0x678ca0, C_IN = 0x3b516c;

interface FloorView { f: number; grid: number[]; cell: number; sel: number; }

export class MapTab {
  private cur: number;
  private t = 0;
  private popup: Popup | null = null;
  /** depth1 = 1: the floor view of region cur */
  private floor: FloorView | null = null;

  constructor(private ctx: GameContext, private fs: FieldScene) {
    this.cur = Math.min(13, fs.field.map.header.zone);
  }

  get busy(): boolean { return !!this.popup; }

  private row(r: number, i: number): number { return this.ctx.assets.dd(0x4016d2, r * 6 + i); }
  private d8(o: number): number { return this.ctx.assets.d8(o); }

  /** the player's region (zone 4 on map 0x9b counts as 5, on 0x8b as 3) */
  private get here(): number {
    const z = this.fs.field.map.header.zone, m = this.fs.field.mapId;
    return z === 4 && m === 0x9b ? 5 : z === 4 && m === 0x8b ? 3 : Math.min(13, z);
  }
  private get curFloor(): number { return this.fs.field.map.header.h8; }

  /** FUN_000492e0: first floor of a region (regions 0..2 are the class home towers) */
  private firstFloor(r: number): number {
    const c = this.fs.model.cls;
    if (r === 0) return c === 0 ? 0 : 6;
    if (r === 1) return c === 1 ? 7 : 12;
    if (r === 2) return c === 2 ? 13 : 19;
    return [0, 0, 0, 20, 22, 23, 26, 27, 31, 32, 33, 34, 36, 44][r] ?? 0;
  }
  private counts(f: number): [number, number, number] {
    let r = 0, c = 0, a = 0;
    for (let i = 0; i < f; i++) { r += this.d8(FLOOR + i * 3); c += this.d8(FLOOR + i * 3 + 1); a += this.d8(FLOOR + i * 3 + 2); }
    return [r, c, a];
  }
  private room(i: number): number[] { return Array.from({ length: 6 }, (_, k) => this.d8(ROOM + i * 6 + k)); }
  private shape(s: number): [number, number] { return [this.d8(SHAPE + s * 2), this.d8(SHAPE + s * 2 + 1)]; }
  private visited(m: number): boolean { return this.fs.story.maps.has(m); }

  /** FUN_00049abc: 6-column grid of the floor's rooms, the cursor cell and the selected map */
  private open(f: number, cell = this.floor?.cell ?? 0): FloorView {
    const grid = new Array<number>(36).fill(0xff), [r0] = this.counts(f), n = this.d8(FLOOR + f * 3);
    if (!n) return { f, grid, cell, sel: 0 };
    const base = this.cur > 2 ? 0x70 : 0;
    let sel = 0;
    for (let i = 0; i < n; i++) {
      const r = this.room(r0 + i);
      grid[r[4]] = r[3];
      if (f === this.curFloor) { if (this.fs.field.mapId === base + r[3]) { cell = r[4]; sel = base + r[3]; } }
      else if (sel === 0) { cell = r[4]; sel = base + r[3]; }
    }
    return { f, grid, cell, sel };
  }

  /** leaving the tab resets the floor view (FUN_000425bc) */
  leaveFloor(): void { this.floor = null; }

  update(presses: number[]): boolean {
    this.t++;
    if (this.fs.gardenMode === 2) return presses.every((k) => k !== AVK.UP && k !== AVK.DOWN && k !== AVK.LEFT && k !== AVK.RIGHT && k !== AVK.OK) ? false : true;   // map keys ignored
    if (this.popup) { if (this.popup.handle(presses)) this.popup = null; return true; }
    if (this.floor) { for (const k of presses) this.floorKey(k); return true; }
    for (const k of presses) {
      const i = k === AVK.UP ? 2 : k === AVK.DOWN ? 3 : k === AVK.LEFT ? 4 : k === AVK.RIGHT ? 5 : -1;
      if (i >= 0) { const n = this.row(this.cur, i); if (n !== 0x0f && n < 14) { this.cur = n; this.ctx.audio.playSfx(0x2f); } continue; }
      if (k === AVK.OK) {
        if (!this.fs.story.zones.has(this.cur)) { this.popup = new Popup(this.ctx, 0x5b); continue; }
        const mine = this.cur === this.here;
        if (mine) this.ctx.audio.playSfx(0x2f);
        this.floor = this.open(mine ? this.curFloor : this.firstFloor(this.cur), 0);
        continue;
      }
      return false;
    }
    return true;
  }

  /** FUN_00056a60 floor keys: '1' / '3' floors, arrows between visited rooms, CLR back to the world view */
  private floorKey(k: number): void {
    const v = this.floor!;
    const nf = this.d8(NFLOOR + this.cur), first = this.firstFloor(this.cur);
    // '1' stops at the region's first floor here (the original only stops at floor 0)
    if (k === AVK.K1) { if (v.f > first) { this.floor = this.open(v.f - 1); this.ctx.audio.playSfx(0x2f); } return; }
    if (k === AVK.K3) { if (v.f - first < nf - 1) { this.floor = this.open(v.f + 1); this.ctx.audio.playSfx(0x2f); } return; }
    if (k === AVK.CLR) { this.floor = null; this.ctx.audio.playSfx(0x2f); return; }
    const g = v.grid, old: [number, number] = [v.cell, v.sel], base = this.cur > 2 ? 0x70 : 0;
    const go = (c: number) => { v.cell = c; v.sel = base + g[c]; };
    if (k === AVK.UP) { if (v.cell >= 6 && g[v.cell - 6] !== 0xff) go(v.cell - 6); }
    else if (k === AVK.DOWN) { if (v.cell <= 29 && g[v.cell + 6] !== 0xff) go(v.cell + 6); }
    else if (k === AVK.LEFT) { if (v.cell !== 0) { if (g[v.cell - 1] !== 0xff) go(v.cell - 1); else if (v.cell > 2 && g[v.cell - 2] !== 0xff) go(v.cell - 2); } }
    else if (k === AVK.RIGHT) { if (v.cell <= 34) { if (g[v.cell + 1] !== 0xff) go(v.cell + 1); else if (v.cell !== 34 && g[v.cell + 2] !== 0xff) go(v.cell + 2); } }
    else return;
    if (!this.visited(v.sel)) [v.cell, v.sel] = old;                  // only visited rooms can be selected
  }

  /** quest destinations: active slots whose quest kind is 3 and state 3 (d16 0x221a2 + 2q, 1000 = none) */
  private questMaps(): number[] {
    const a = this.ctx.assets, st = this.fs.story;
    return st.active.map((s) => s.q).filter((q) => a.d8(0x2170c + 16 * q) === 3 && st.qs[q] === 3)
      .map((q) => a.d16(0x221a2 + 2 * q)).filter((m) => m !== 1000);
  }

  draw(u: Ui): void {
    u.roundFill(8, 196, 204, 16, 0, 1);
    if (this.fs.gardenMode === 2) { u.textId(0x1a21, 110, 103, 'center'); return; }   // "지도를 볼수 없는 지역입니다." 
    if (this.floor) { this.drawFloor(u, this.floor); return; }
    const b = tri(this.t % 16, 8);
    u.roundFill(9, 32, 202, 160, 0, 1);
    u.image('map', 0, 0, 202, 162, 9, 32);
    for (let r = 0; r < 14; r++) u.hit(this.row(r, 0) - 5, this.row(r, 1) - 5, 20, 20, () => { if (this.cur === r) return [AVK.OK]; this.cur = r; });
    const here = this.here;
    u.image('c', 90, 17, 7, 8, this.row(here, 0) + 1, this.row(here, 1) + 2);
    u.image('c', 236, 79, 11, 13, this.row(this.cur, 0) - 1, this.row(this.cur, 1) - 15 - (b >> 1));
    const known = this.fs.story.zones.has(this.cur);
    u.textId(known ? 0x1d6 + this.cur : 0x1a22, 110, 200, 'center');
  }

  /** FUN_00057b88 */
  private drawFloor(u: Ui, v: FloorView): void {
    const t = this.t, f = v.f, [a7c, a80, a8a] = this.counts(f);
    const nr = this.d8(FLOOR + f * 3), nc = this.d8(FLOOR + f * 3 + 1), na = this.d8(FLOOR + f * 3 + 2);
    const vbase = f > 0x13 ? 0x70 : 0, cbase = this.cur > 2 ? 0x70 : 0, hbase = this.fs.field.map.header.zone >= 3 ? 0x70 : 0;
    const quest = this.questMaps(), mine = f === this.curFloor;
    let selIdx = -1, drawn = 0;
    for (const p of [0, 2]) {
      const col = p === 0 ? C_OUT : C_IN, grow = p === 0 ? 0 : -4;
      for (let i = a7c; i < a7c + nr; i++) {
        const [x, y, s, mp, , ic] = this.room(i);
        if (v.sel === cbase + mp) selIdx = i;
        if (!this.visited(vbase + mp)) continue;
        const [w, h] = this.shape(s);
        u.fill(x + p, y + p, w + grow, h + grow, col);
        drawn++;
        if (p === 0) continue;
        u.hit(x, y, w, h, () => { v.sel = cbase + mp; });             // touch selects the room (cell unchanged)
        const icon = quest.includes(cbase + mp) ? 1 : ic;
        if (icon === 2) u.image('c', 111, 43, 16, 16, x + ((w - 16) >> 1), y + ((h - 16) >> 1));
        else if (icon === 4) u.image('c', 127, 43, 16, 16, x + ((w - 16) >> 1), y + ((h - 16) >> 1));
        else if (icon === 1) u.image('c', 121, 0, 9, 19, x + ((w - 10) >> 1), y + ((h - 16) >> 1));
        if (mine && this.fs.field.mapId === hbase + mp) {
          u.image('c', 90, 17, 7, 8, x + ((w - 7) >> 1), y + ((h - 8) >> 1), 0, { tint: [255, 255, 255], amount: tri(t, 16) * 2 });
        }
      }
      const [k78, k80, k9] = p === 0 ? [-8, 8, -4] : [-6, 4, -6];
      for (let j = 0; j < nc; j++) {
        const o = CORR + (a80 + j) * 4, cx = this.d8(o), cy = this.d8(o + 1), ct = this.d8(o + 2), cr = this.d8(o + 3);
        if (!this.visited(vbase + this.room(cr + a7c)[3])) continue;
        const [sw, sh] = this.shape(ct), g = p === 0 ? 0 : -4, q = ct - 5;
        if (q === 0 || q === 1) u.fill(cx, cy + p, sw, sh + g, col);
        else if (q === 2 || q === 3) u.fill(cx + p, cy, sw + g, sh, col);
        else if (q === 4 || q === 5) {
          u.fill(q === 4 ? cx + p : cx + sw + k78, cy + 4, k80, sh - 4, col);
          u.fill(cx + (q === 4 ? p : 0), cy + p, sw - p, k80, col);
        } else if (q === 6 || q === 7) {
          u.fill(q === 6 ? cx + p : cx + sw + k78, cy, k80, sh + k9, col);
          u.fill(cx + (q === 6 ? p : 0), cy + sh + k78, sw - p, k80, col);
        }
      }
    }
    // door arrows c(60,0,7,10), quarter-turn flags 0/4/8/12, bobbing tri(t >> 2, 5)
    let tr = 4;
    for (let j = 0; j < na; j++) {
      const ao = ARROW + (a8a + j) * 3;
      const ci = this.d8(ao) + (a80 > 0xff ? 0xff : 0), dr = this.d8(ao + 1), kind = this.d8(ao + 2);
      const o = CORR + ci * 4, cx = this.d8(o), cy = this.d8(o + 1), ct = this.d8(o + 2), cr = this.d8(o + 3);
      if (!this.visited(vbase + this.room(cr + a7c)[3])) continue;
      const at = (b: number): [number, number] => {
        const [sw, sh] = this.shape(ct), q = ct - 5;
        let dx = 0, dy = 0;
        if (q === 0 || q === 1) [dx, dy, tr] = dr === 0 ? [-2 * b - 9, -2, 0] : [2 * b + 2 + sw, -2, 8];
        else if (q === 2 || q === 3) [dx, dy, tr] = dr === 2 ? [-2, -2 * b - 12, 4] : [-2, 2 * b + 2 + sh, 12];
        else if (q === 4) [dx, dy, tr] = dr === 1 ? [2 * b + 20, -2, 8] : [-2, 2 * b + 20, 12];
        else if (q === 5) [dx, dy, tr] = dr === 0 ? [-2 * b - 9, -2, 0] : [13, 2 * b + 20, 12];
        else if (q === 6) [dx, dy, tr] = dr === 1 ? [2 * b + 20, 6, 8] : [-2, -2 * b - 12, 4];
        else if (q === 7) [dx, dy, tr] = dr === 0 ? [-2 * b - 9, 10, 0] : [13, -2 * b - 12, 4];
        return [cx + dx, cy + dy];
      };
      const [ax, ay] = at(0);
      u.hit(ax - 10, ay - 10, 20, 20, () => (kind === 1 ? [AVK.K1] : kind === 3 ? [AVK.K3] : undefined));
      const [x, y] = at(tri(t >> 2, 5));
      u.image('c', 60, 0, 7, 10, x, y, tr);
    }
    if (t & 0x10 && selIdx >= 0) {
      const [x, y, s, mp] = this.room(selIdx);
      if (this.visited(vbase + mp)) { const [w, h] = this.shape(s); u.alpha = 16; u.fill(x, y, w, h, 0xffffff); u.alpha = 32; }
    }
    if (drawn === 0) u.textId(0x1a23, 110, 103, 'center');
    else u.textId(this.visited(v.sel) ? 0x1e4 + v.sel : 0x1a22, 110, 200, 'center');
  }

  drawOverlay(): void { /* no absolute-coordinate overlays */ }
  drawPopups(): void { this.popup?.draw(); }
}
