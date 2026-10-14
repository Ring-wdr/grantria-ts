// Elixir buffs, day/night clock and return points (analysis/features/misc-systems.md §1, §2, §4).
import type { Assets } from '../data/assets';

export const BUFF_COUNT = 35;
/** aura base frames of the effect bank per slot (.rodata 0x101484): 179 red, 190 orange, 201 blue, 212 white */
const AURA = [179, 179, 179, 179, 190, 190, 190, 190, 190, 190, 212, 190, 212, 212, 179, 179, 201, 212, 179, 179, 212, 212, 212, 179, 201, 201, 212, 212, 179, 201, 212, 201, 212, 179, 212];

export interface BuffSlot { t: number; on: boolean; }

/** d+0x2513b + 4i: (k, v, duration/10). k 1 ATK %, 3 DEF %, 255 hard-coded effect, else D[k] += v */
export function buffDef(a: Assets, i: number): { k: number; v: number; dur: number } {
  const d3 = a.d8(0x2513d + 4 * i);
  let v = a.s8(0x2513c + 4 * i);
  if (i === 34) v = a.d8(0x251c4) * 10;                     // 부자의 비약(특): gold +200 %
  return { k: a.d8(0x2513b + 4 * i), v, dur: d3 === 0xff ? 20000 : a.s8(0x2513d + 4 * i) * 10 };
}

/** the item that starts buff slot i (FieldScene use): elixirs 0x11 sub i + 14, 차원의 문 elixirs 0x1b sub i - 7,
 *  special elixirs 0x1b sub i + 4 */
export function buffItem(i: number): [number, number] {
  if (i < 28) return [0x11, i + 14];
  if (i < 31) return [0x1b, i - 7];
  return [0x1b, i + 4];
}

export class Buffs {
  slots: BuffSlot[] = Array.from({ length: BUFF_COUNT }, () => ({ t: 0, on: false }));
  /** slot drawn as the aura (last used), -1 = pick the highest active */
  aura = -1;

  isOn(i: number): boolean { return this.slots[i]?.on ?? false; }
  start(i: number): void { this.slots[i] = { t: 0, on: true }; this.aura = i; }
  clear(): void { for (const s of this.slots) { s.on = false; s.t = 0; } this.aura = -1; }
  /** 0x1b sub 0x15..0x17: only the active flags of slots 0..31 go off (timers stay); 32..34 (특) keep running */
  clearNormal(): void {
    this.slots.forEach((s, i) => { if (i < 32 && s) s.on = false; });
    if (this.aura >= 0 && this.aura < 32) this.aura = -1;
  }

  /** FUN_0002c99c: one field frame; returns true when a buff ran out (stats must be rebuilt) */
  tick(a: Assets): boolean {
    let changed = false;
    this.slots.forEach((s, i) => {
      if (!s.on) return;
      if (s.t < buffDef(a, i).dur) { s.t++; return; }
      s.on = false; s.t = 0;
      if (this.aura === i) this.aura = -1;
      changed = true;
    });
    return changed;
  }

  /** active (k, v) pairs for the stat rebuild (FUN_000373cc) */
  effects(a: Assets): { k: number; v: number }[] {
    const out: { k: number; v: number }[] = [];
    this.slots.forEach((s, i) => { if (s.on) { const d = buffDef(a, i); if (d.k !== 255) out.push({ k: d.k, v: d.v }); } });
    return out;
  }

  /** FUN_000250e8 aura frame, or -1 */
  auraFrame(): number {
    let i = this.aura;
    if (i < 0) this.slots.forEach((s, j) => { if (s.on) i = j; });
    if (i < 0) return -1;
    const base = AURA[i] ?? 212, t = this.slots[i].t;
    return t <= 11 ? base + ((t >> 2) % 12) : base + 5 + ((t >> 2) % 5);
  }

  /** active buffs with the ticks left (dur 20000 = until cleared: -1), for the HUD buff icons (not in the original) */
  active(a: Assets): { slot: number; left: number }[] {
    const out: { slot: number; left: number }[] = [];
    this.slots.forEach((s, i) => {
      if (!s.on) return;
      const d = buffDef(a, i).dur;
      out.push({ slot: i, left: d >= 20000 ? -1 : Math.max(0, d - s.t) });
    });
    return out;
  }

  toJSON(): [number, number][] { return this.slots.map((s) => [s.t, s.on ? 1 : 0]); }
  static from(d?: [number, number][]): Buffs {
    const b = new Buffs();
    d?.forEach(([t, on], i) => { if (i < BUFF_COUNT) b.slots[i] = { t, on: !!on }; });
    return b;
  }
}

// ---- day / night ----
/** phase from the counter: 0 day (< 9600), 1 dusk (< 10000), 2 night */
export function dayPhase(c: number): 0 | 1 | 2 { return c < 9600 ? 0 : c < 10000 ? 1 : 2; }
/** palette shift row (dr, dg, db) subtracted from every RGB565 colour (d+0x26e0c, 40 rows) */
export function tintRow(a: Assets, row: number): [number, number, number] {
  return [a.s8(0x26e0c + 3 * row), a.s8(0x26e0c + 3 * row + 1), a.s8(0x26e0c + 3 * row + 2)];
}
/** day/night transitions (FUN_00025990): counter value, fade steps, target phase, log text */
export const DAY_EVENTS: [number, number, 0 | 1 | 2, number][] = [[9600, 15, 1, 0x11], [10000, 14, 2, 0x12], [14800, 11, 0, 0x14]];
export const TINT_BASE = [0, 11, 26];

/** FUN_0002f7b8: HUD clock frame of cmf_status */
export function clockFrame(c: number, phase: number): number {
  if (c <= 11 && phase !== 0) return 0x57 + ((c >> 1) % 6);
  if (c <= 9999) return 0x51;
  if (c <= 10011) return 0x52 + (((c - 10000) >> 1) % 6);
  return 0x57;
}

// ---- return stone ----
/** FUN_000175f0: maps where returnZone is updated (towns, rooms) */
export function isSafeMap(m: number): boolean {
  return (m >= 1 && m <= 29) || (m >= 43 && m <= 62) || (m >= 88 && m <= 111) || m === 121 || (m >= 140 && m <= 162);
}
/** FUN_00062bb0 destination: returnZone row d+0x2699f {map, x/16, y/16}, 100 = class start field */
export function returnPoint(a: Assets, zone: number, cls: number): [number, number, number] {
  if (zone === 100) return ([[0x71, 0x70, 0x50], [0x73, 0xd0, 0x166], [0x70, 0x50, 0x70]] as [number, number, number][])[cls];
  const o = 0x2699f + zone * 3;
  return [a.d8(o), a.d8(o + 1) * 16, a.d8(o + 2) * 16];
}
