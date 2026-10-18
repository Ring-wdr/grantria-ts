// Map tab 0x22 (ui-tabs.md §0.10, leftovers-ui.md §2). World view: region table d.dat 0x4016D2 + r*6 =
// {ax, ay, up, down, left, right} (0x0F = none, FUN_000494c4). Floor view ('5' on a visited region):
// grid FUN_00049abc, drawing FUN_00057b88, keys FUN_00056a60 — a port of tools/grantria_mapfloor.py,
// which matches the original draw calls in all 296 emulated cases.
// State and keys; the host draws it (web/game/mapTab.ts).
import type { FieldGame } from '../field/fieldGame';
import { AVK } from '../keys';
import { Popup, openPopup } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';
import type { Host } from '../host';

/** d.dat tables of the floor view: room shapes, rooms, corridors, per-floor counts, floors per region, door arrows */
export const SHAPE = 0x255a6, ROOM = 0x255c0, CORR = 0x2603a, FLOOR = 0x26766, NFLOOR = 0x26808, ARROW = 0x269b7;

export interface FloorView { f: number; grid: number[]; cell: number; sel: number; }

export class MapTabLogic {
  protected cur: number;
  protected t = 0;
  /** popups over the tab */
  protected readonly overlays = new OverlayStack();
  /** depth1 = 1: the floor view of region cur */
  protected floor: FloorView | null = null;

  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {
    this.cur = Math.min(13, fs.field.map.header.zone);
  }

  get busy(): boolean { return this.overlays.size > 0; }

  protected row(r: number, i: number): number { return this.ctx.assets.dd(0x4016d2, r * 6 + i); }
  protected d8(o: number): number { return this.ctx.assets.d8(o); }

  /** the player's region (zone 4 on map 0x9b counts as 5, on 0x8b as 3) */
  protected get here(): number {
    const z = this.fs.field.map.header.zone, m = this.fs.field.mapId;
    return z === 4 && m === 0x9b ? 5 : z === 4 && m === 0x8b ? 3 : Math.min(13, z);
  }
  protected get curFloor(): number { return this.fs.field.map.header.h8; }

  /** FUN_000492e0: first floor of a region (regions 0..2 are the class home towers) */
  private firstFloor(r: number): number {
    const c = this.fs.model.cls;
    if (r === 0) return c === 0 ? 0 : 6;
    if (r === 1) return c === 1 ? 7 : 12;
    if (r === 2) return c === 2 ? 13 : 19;
    return [0, 0, 0, 20, 22, 23, 26, 27, 31, 32, 33, 34, 36, 44][r] ?? 0;
  }
  protected counts(f: number): [number, number, number] {
    let r = 0, c = 0, a = 0;
    for (let i = 0; i < f; i++) { r += this.d8(FLOOR + i * 3); c += this.d8(FLOOR + i * 3 + 1); a += this.d8(FLOOR + i * 3 + 2); }
    return [r, c, a];
  }
  protected room(i: number): number[] { return Array.from({ length: 6 }, (_, k) => this.d8(ROOM + i * 6 + k)); }
  protected shape(s: number): [number, number] { return [this.d8(SHAPE + s * 2), this.d8(SHAPE + s * 2 + 1)]; }
  protected visited(m: number): boolean { return this.fs.story.maps.has(m); }

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
    if (this.overlays.update(presses)) return true;
    if (this.floor) { for (const k of presses) this.floorKey(k); return true; }
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      const i = k === AVK.UP ? 2 : k === AVK.DOWN ? 3 : k === AVK.LEFT ? 4 : k === AVK.RIGHT ? 5 : -1;
      if (i >= 0) { const n = this.row(this.cur, i); if (n !== 0x0f && n < 14) { this.cur = n; this.ctx.audio.playSfx(0x2f); } continue; }
      if (k === AVK.OK) {
        if (!this.fs.story.zones.has(this.cur)) { openPopup(this.overlays, new Popup(this.ctx, 0x5b)); continue; }
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
  protected questMaps(): number[] {
    const a = this.ctx.assets, st = this.fs.story;
    return st.active.map((s) => s.q).filter((q) => a.d8(0x2170c + 16 * q) === 3 && st.qs[q] === 3)
      .map((q) => a.d16(0x221a2 + 2 * q)).filter((m) => m !== 1000);
  }

  /** 편의 설정 퀘스트 위치 (not in the original): the same destination table for every other active quest */
  protected otherQuestMaps(): number[] {
    if (!this.ctx.options.mapQuests) return [];
    const a = this.ctx.assets, st = this.fs.story;
    return st.active.map((s) => s.q).filter((q) => !(a.d8(0x2170c + 16 * q) === 3 && st.qs[q] === 3))
      .map((q) => a.d16(0x221a2 + 2 * q)).filter((m) => m !== 1000);
  }
}
