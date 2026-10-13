// Monster drops and ground items (game-rules.md §3.6 FUN_00037e04 / FUN_0003b9c8,
// items.md §0.8 FUN_00063360 update, FUN_0002f184 draw, pickup with '5').
// Gems / recipes / coupons and boss drops follow gimmicks.md §3 (emulator-checked formulas).
// The second drop roll (account trait 9) is made by the caller (fieldScene.grantKill). There is no fly-to-player
// pickup animation in the original: '5' plays the player's interaction action and the item is gained on its frame.
import type { Cmf } from '../data/assets';
import type { Drawable } from '../render';
import type { Item, ItemDb } from './items';
import { idiv, rdiv, type Rng } from './rules';

const BOUNCE: Record<number, number> = { 1: -12, 2: 2, 3: 3, 4: 3, 5: 4, 7: -2, 9: 1 };
const DESPAWN = 550;

export interface GroundItem {
  x: number;
  y: number;
  item: Item | null;      // null = gold
  gold: number;
  phase: number;
  failed: boolean;
}

/** FUN_00037ec8(t, L): sub (tier) of a dropped item (gimmicks.md §3.2, checked in the emulator) */
export function dropSub(rng: Rng, t: number, L: number, hard: boolean, cap10 = false): number {
  if (L === 0) L = 1;
  if (t === 0x10) {                                                     // gem: kind × 5 + level tier
    let s = idiv(rng.rand(25), 5) * 5;
    if (L > 14) s += rng.rand(100) < 80 ? (L >= 75 ? 4 : idiv(L, 15)) : (L >= 60 ? 4 : idiv(L, 15) + 1);
    if (hard) s = idiv(rng.rand(25), 5) * 5 + 4;                       // hard: top tier
    return s;
  }
  if (t === 0x19) { const inner = dropBand(rng, rng.rand(49), 0); return inner * 16 + dropSub(rng, inner, L, hard, cap10); }
  if (t === 0x1b) return 0x1b;                                          // coupon
  if (t === 0x1a || t === 0x1c || t === 0x1d) return 0;
  let s = L <= 10 ? 0 : L <= 15 ? 1 : idiv(L - 1, 10) + 1;
  if (rng.rand(100) > 80) s++;
  return Math.min(s, cap10 ? 10 : 9);
}

/** FUN_00037b60(t, L, sub): grade; MF = luck (gimmicks.md §3.3) */
export function dropGrade(rng: Rng, db: ItemDb, t: number, sub: number, mf: number): number {
  if (t === 0x11 || t === 0x12 || (t >= 0x1a && t <= 0x1d)) return 0;
  const r = rng.rand(10000), max = (s: number) => db.a.d8(0x24636 + s);
  if (t === 0x19) {
    const g = r <= 1999 - 3 * mf ? 0 : r < 4000 - mf ? 1 : r <= 7999 - idiv(mf, 2) ? 2 : 3;
    return g < max(sub & 15) ? g : max(sub & 15) - 1;
  }
  if (t === 0x10) {
    const tier = sub % 5;
    const g = r <= 8499 - 5 * mf ? 0 : r < 9200 - mf ? 1
      : (tier < 2 || r <= 9799 - idiv(mf, 2)) ? 2 : (tier > 3 && r > 9989 + idiv(mf, -50)) ? 4 : 3;
    return Math.min(g, tier < 2 ? 2 : tier < 4 ? 3 : 4);
  }
  const g = r <= 7999 - 5 * mf ? 0 : r < 9000 - mf ? 1 : r <= 9699 - idiv(mf, 2) ? 2 : r <= 9998 + idiv(mf, -250) ? 3 : 4;
  return Math.min(g, max(sub));
}

/** FUN_00037e04 band -> item type (0xff none, 0x1c gold) */
function dropBand(rng: Rng, r: number, cls: number, hard = false): number {
  if (r > (hard ? 400 : 350)) return 0xff;
  if (r > 175) return 0x1c;
  if (r < 15) return rng.rand(100) > 29 ? rng.rand(3) : cls;
  if (r < 45) return rng.rand(100) > 29 ? 3 + rng.rand(12) : (rng.rand(4) + 1) * 3 + cls;
  if (r < 49) return 0x0f;
  if (r < 52) return 0x10;
  if (r < 60) return 0x19;
  if (r < 104) return 0x11;
  if (r === 104) return rng.rand(1000) <= 332 ? 0x1b : 0xff;
  return 0x12;
}

/** a recipe (0x19) named and levelled after its content */
function recipe(db: ItemDb, rng: Rng, sub: number, grade: number): Item {
  const it = db.create(0x19, sub, grade, rng), inner = db.create(sub >> 4, sub & 15, 0, rng, true);
  it.name = inner.name; it.level = it.reqLevel = inner.level;
  return it;
}

/** dropped item of type t (FUN_0003b9c8 default path: sub / grade from L = mLv − 80 in hard mode) */
function makeDrop(rng: Rng, db: ItemDb, t: number, m: { type: number; level: number }, player: { cls: number; luck: number; hard?: boolean }, cap10: boolean): Item | null {
  const hard = !!player.hard, L = hard ? Math.max(1, m.level - 80) : m.level;
  if (t === 0x11) {
    const w = [0, 1, 2].map((i) => db.a.d8(0x23f22 + m.type * 3 + i));
    const p = rng.rand(100);
    let sub: number;
    if (p < w[0]) sub = 0;                                              // return scroll
    else if (p < w[0] + w[1]) {
      const q = rng.rand(10), tier = hard || m.level >= 80 ? 3 : idiv(m.level, 20);
      sub = (q < 6 ? 1 : q < 9 ? 5 : 9) + tier;
    } else if (p < w[0] + w[1] + w[2]) sub = 13;                      // angel feather
    else return null;
    return db.create(0x11, sub, 0, rng);
  }
  if (t === 0x12) {
    const sub = db.a.d8(0x23e38 + m.type);
    return sub === 255 ? null : db.create(0x12, sub, 0, rng);
  }
  const sub = dropSub(rng, t, L, hard, cap10);
  const grade = dropGrade(rng, db, t, sub, player.luck);
  return t === 0x19 ? recipe(db, rng, sub, grade) : db.create(t, sub, grade, rng);
}

/** One drop roll for a killed (non-boss) monster (gimmicks.md §3.1). */
export function rollDrop(rng: Rng, db: ItemDb, m: { type: number; level: number; x: number; y: number }, player: { cls: number; luck: number; goldPct: number; hard?: boolean; pLevel?: number; cap10?: boolean }): GroundItem | null {
  let t = dropBand(rng, rng.rand(500), player.cls, !!player.hard);
  if (t === 0x1b && player.pLevel !== undefined && m.level < player.pLevel - 9) t = 0xff;   // coupon: level gap
  const base = { x: m.x, y: m.y - 5, phase: 0, failed: false };
  if (t === 0xff) return null;
  if (t === 0x1c) {
    const gold = idiv((3 * m.level + 7 + rdiv(rng.rand(m.level), 3)) * (100 + player.goldPct), 100);
    return { ...base, item: null, gold };
  }
  const item = makeDrop(rng, db, t, m, player, !!player.cap10);
  return item ? { ...base, item, gold: 0 } : null;
}

/** FUN_00037fe4 boss drop (gimmicks.md §3.4): 4 free slots + 2 guaranteed equipment on a 5×5 grid */
export function rollBossDrops(rng: Rng, db: ItemDb, boss: { type: number; level: number; x: number; y: number }, player: { cls: number; luck: number; goldPct: number; hard?: boolean; cap10?: boolean }): GroundItem[] {
  const hard = !!player.hard, L = hard ? Math.max(1, boss.level - 80) : boss.level, cls = player.cls;
  const n1 = 4, n = 6, types: number[] = [];
  for (let i = 0; i < n1; i++) {
    const a = rng.rand(650) + 350, b = rng.rand(1000);
    types.push(a >= 999 ? 0x1b : a >= 971 ? 0x10 : a >= 901 ? 0x19 : a >= 801 ? 0x0f
      : a >= 651 ? (b < 501 ? (rng.rand(4) + 1) * 3 + cls : rng.rand(12) + 3)
      : a >= 551 ? (b < 501 ? cls : rng.rand(3)) : a > 350 ? 0x1c : 0xff);
  }
  for (let i = n1; i < n; i++) {
    const a = rng.rand(1000), b = rng.rand(1000);
    types.push(a < 301 ? 0x0f : a < 701 ? (b < 501 ? (rng.rand(4) + 1) * 3 + cls : rng.rand(12) + 3) : (b < 501 ? cls : rng.rand(3)));
  }
  const cells: number[] = [];
  while (cells.length < n) { const c = rng.rand(25); if (!cells.includes(c)) cells.push(c); }
  const out: GroundItem[] = [];
  types.forEach((t, i) => {
    if (t === 0xff) return;
    const base = { x: boss.x - 40 + (cells[i] % 5) * 15, y: boss.y - 45 + idiv(cells[i], 5) * 15, phase: 0, failed: false };
    if (t === 0x1c) {
      out.push({ ...base, item: null, gold: idiv((rng.rand(boss.level) + rdiv(boss.level, 2) + 10) * (100 + player.goldPct), 100) });
      return;
    }
    if (t === 0x1b) { out.push({ ...base, item: db.create(0x1b, 0x1b, 0, rng), gold: 0 }); return; }
    const sub = dropSub(rng, t, L, hard, !!player.cap10);
    let grade = dropGrade(rng, db, t, sub, player.luck);
    if (i >= n1 && t < 0x10) {                                          // guaranteed slots: forced grades
      const u = rng.rand(1000) >= 801 ? 1 : 0, mx = db.a.d8(0x24636 + sub);
      grade = i === n1 ? (mx <= u ? mx : u + 1) : (mx <= u + 1 ? mx : u + 2);
    }
    out.push({ ...base, item: t === 0x19 ? recipe(db, rng, sub, grade) : db.create(t, sub, grade, rng), gold: 0 });
  });
  return out;
}

/** FUN_00063360: bounce by the phase before it is incremented, gone on the 551st update. Returns false when gone. */
export function updateGround(g: GroundItem): boolean {
  const p = g.phase;
  if (p > DESPAWN - 1) return false;
  g.y += BOUNCE[p] ?? 0;
  g.phase++;
  return true;
}

/** Pickup box around the item [-30,-30,60,60]. */
export function groundBox(g: GroundItem): [number, number, number, number] {
  return [g.x - 30, g.y - 30, g.x + 30, g.y + 30];
}

/** FUN_0002f184 kind 0: multiply shadow (shadow.pxl 120,0 36×20 at x-16, y-2), the icon at (x-6, y-6) flashing white
 *  (tint strength 32) on phase % 20 ∈ 5..7, and with the effects option the sparkle cmf_status 0x5d + (phase >> 1) % 7
 *  at (x, y). While the player is dead the phase counts as 0 (no flash, fixed sparkle). */
export function groundDrawables(g: GroundItem, db: ItemDb, status: Cmf, effects: boolean, playerDead: boolean): Drawable[] {
  const p = playerDead ? 0 : g.phase;
  const r = db.iconRect(g.item ? g.item.icon : 324);                  // gold icon 324
  const flash = p % 20 >= 5 && p % 20 <= 7;
  const out: Drawable[] = [
    { cmfName: '', frame: 0, x: g.x - 16, y: g.y - 2, depth: g.y, img: { name: 'shadow', sx: 120, sy: 0, w: 36, h: 20, blend: 14 } },
    { cmfName: '', frame: 0, x: g.x - 6, y: g.y - 6, depth: g.y, img: { name: r.image, sx: r.sx, sy: r.sy, w: 16, h: 16 },
      fx: flash ? { tint: [255, 255, 255], amount: 32 } : undefined },
  ];
  if (effects) out.push({ cmfName: 'cmf_status', cmf: status, frame: 0x5d + ((p >> 1) % 7), x: g.x, y: g.y, depth: g.y });
  return out;
}
