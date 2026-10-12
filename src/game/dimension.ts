// 차원의 문 (dungeon mode 2, maps 357..446) with the server replaced by local generation
// (analysis/features/dimension.md §4). The consumers follow the original: per-floor records with alive
// bits (no respawn), the header stat formulas of FUN_0001bb8c 5499, the dedicated drop table
// FUN_00037d34, exp ×2 into a bonus pool, the boss clear timer and the result popup 100.
import type { Field } from './field';
import type { GroundItem } from './drops';
import { dropGrade, dropSub } from './drops';
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import type { ItemDb } from './items';
import { Popup } from './popup';
import { idiv, rdiv, type Rng } from './rules';
import type { GameContext } from './scene';
import { consume, countOf } from './shopRules';
import type { Ui } from './ui';

/** per dungeon: normal monster pool, boss type, density (monsters per walkable cell of the zone's maps),
 *  recommended level (FUN_0007390c) — tools/grantria_dimension.py */
const DUNGEONS: { pool: number[]; boss: number; density: number; rec: [number, number] }[] = [
  { pool: [4, 3], boss: 5, density: 0.016, rec: [30, 40] },
  { pool: [10, 9], boss: 11, density: 0.0097, rec: [50, 60] },
  { pool: [12, 13], boss: 14, density: 0.0066, rec: [80, 100] },
  { pool: [15, 16], boss: 17, density: 0.014, rec: [130, 150] },
  { pool: [22, 21], boss: 23, density: 0.0182, rec: [160, 180] },
  { pool: [24, 25], boss: 26, density: 0.0205, rec: [180, 200] },
  { pool: [31, 30], boss: 32, density: 0.0134, rec: [200, 200] },
  { pool: [33, 34], boss: 35, density: 0.0099, rec: [200, 200] },
  { pool: [37, 36], boss: 38, density: 0.0162, rec: [200, 200] },
];
/** drop table (×10 ‰, pairs normal/boss for buckets nothing / equipment / gem / gold / unused, [11] reward item) */
const DROP = [60, 0, 8, 60, 2, 10, 25, 25, 0, 0, 0, 10];
const MAX_PER_FLOOR = 32;

export interface DimRecord { type: number; x: number; y: number; }
export interface DimRun {
  d: number;
  first: number;
  boss: number;
  header: number[];
  floors: (DimRecord[] | null)[];
  alive: boolean[][];
  /** exp bonus pool DAT_003d2200 */
  pool: number;
  entry: number;
  equips: number;
  kills: number;
  cleared: boolean;
  /** boss clear timer (200 frames) */
  clearT: number;
}

/** d.dat+0x2208c {first map, x, y} */
export function dungeonStart(a: { d16(o: number): number }, d: number): [number, number, number] {
  return [a.d16(0x2208c + 6 * d), a.d16(0x2208c + 6 * d + 2), a.d16(0x2208c + 6 * d + 4)];
}

/** 'C' response replaced: the header from the recommended level, empty floors filled on first visit */
export function newRun(a: { d16(o: number): number }, d: number): DimRun {
  const [lo, hi] = DUNGEONS[d].rec, mid = (lo + hi) >> 1;
  const header = d === 0 ? [mid - 2, Math.min(255, hi + 5), 0, 0, 0, 0, 0, 0] : [idiv(mid, 10), 0, 0, 0, Math.min(25, idiv(hi + 10, 10)), 0, 0, 0];
  return { d, first: dungeonStart(a, d)[0], boss: DUNGEONS[d].boss, header, floors: new Array(10).fill(null), alive: Array.from({ length: 10 }, () => []),
    pool: 0, entry: Date.now(), equips: 0, kills: 0, cleared: false, clearT: 0 };
}

/** floor records: 3x3-walkable cells away from portals (3 cells) and arrival points (8 cells); floor 10 = the boss alone */
export function generateFloor(run: DimRun, f: number, field: Field, arrivals: [number, number][], rng: Rng): DimRecord[] {
  const W = field.map.header.width, H = field.map.header.height, cfg = DUNGEONS[run.d];
  const near = (cx: number, cy: number, pts: [number, number][], r: number) => pts.some(([px, py]) => Math.abs(px - cx) < r && Math.abs(py - cy) < r);
  const portal: [number, number][] = [];
  for (const p of field.map.portals) for (const r of p.rects) for (let y = r.cy0; y <= r.cy1; y++) for (let x = r.cx0; x <= r.cx1; x++) portal.push([x, y]);
  const cells: [number, number][] = [];
  let walk = 0;
  for (let cy = 1; cy < H - 1; cy++) for (let cx = 1; cx < W - 1; cx++) {
    if (!field.walkCell(cx, cy)) continue;
    walk++;
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!field.walkCell(cx + dx, cy + dy)) { ok = false; break; }
    if (ok && !near(cx, cy, portal, 3) && !near(cx, cy, arrivals, 8)) cells.push([cx, cy]);
  }
  if (!cells.length) return [];
  if (f === 9) {                                                     // the cell farthest from the arrivals
    let best = cells[0], bd = -1;
    for (const c of cells) { const dd = Math.min(...arrivals.map(([x, y]) => Math.hypot(x - c[0], y - c[1])), 1e9); if (dd > bd) { bd = dd; best = c; } }
    return [{ type: run.boss, x: best[0] * 16 + 8, y: best[1] * 16 + 8 }];
  }
  const n = Math.min(MAX_PER_FLOOR, Math.max(4, Math.round(walk * cfg.density)), cells.length), out: DimRecord[] = [];
  for (let i = 0; i < n; i++) {
    const k = rng.rand(cells.length), [cx, cy] = cells.splice(k, 1)[0];
    out.push({ type: cfg.pool[rng.rand(cfg.pool.length)], x: cx * 16 + 8, y: cy * 16 + 8 });
  }
  return out;
}

const hp0 = (L: number) => 10 * L + 140 + Math.trunc((400 * L * L) / 300);
const atk0 = (L: number) => Math.trunc((L * L) / 600) + Math.trunc((7 * L) / 6) + 2;

/** FUN_0001bb8c 5499: level / HP / ATK from the run header (dungeon 0 in units with ×1.5, 1..8 in tens) */
export function dimStats(run: DimRun, boss: boolean, rng: Rng): { level: number; hp: number; atk: number } {
  const h = run.header;
  if (run.d === 0) {
    const L = boss ? h[1] : (h[0] + rng.rand(5)) & 0xff;
    let hp = hp0(L) + (hp0(L) >> 1), a = atk0(L) + (atk0(L) >> 1);
    hp += rdiv(hp * h[3], 100); a += rdiv(a * h[2], 100);
    return { level: L, hp, atk: a };
  }
  if (boss) { const L = (h[4] * 10) & 0xff; return { level: L, hp: hp0(L) + rdiv(h[7] * 10 * hp0(L), 100), atk: atk0(L) + rdiv(h[5] * 10 * atk0(L), 100) }; }
  const L = (h[0] * 10 + rng.rand(5)) & 0xff;
  return { level: L, hp: hp0(L) + rdiv(h[3] * 10 * hp0(L), 100), atk: atk0(L) + rdiv(h[1] * 10 * atk0(L), 100) };
}

/** FUN_00037d34 bucket: nothing / equipment / gem / gold */
function dropType(rng: Rng, boss: boolean): number {
  const r = rng.rand(1000);
  let t = 1000;
  for (let k = 0; k < 4; k++) {
    const next = t - 10 * DROP[2 * k + (boss ? 1 : 0)];
    if (next < r && r <= t) {
      if (k === 0) return 0xff;
      if (k === 1) { const e = rng.rand(100); return e < 15 ? rng.rand(3) : e > 24 ? 3 + rng.rand(12) : 0x0f; }
      return k === 2 ? 0x10 : 0x1c;
    }
    t = next;
  }
  return 0x1c;
}

/** FUN_0006ca90 mode 2 drops: 1 (boss 5); the boss's 5th drop is grade 3, its last a reward item or weapon/armour */
export function rollDimDrops(rng: Rng, db: ItemDb, m: { type: number; level: number; x: number; y: number }, boss: boolean, goldPct: number, tier2: boolean): GroundItem[] {
  const n = boss ? 5 : 1, out: GroundItem[] = [];
  for (let i = 0; i < n; i++) {
    let t: number;
    if (boss && i > 3) { rng.rand(1000); t = rng.rand(15); }        // the server reward items are not generated: weapon / armour
    else t = dropType(rng, boss);
    if (t === 0xff) continue;
    const base = { x: m.x - 30 + rng.rand(61), y: m.y - 25 + rng.rand(41), phase: 0, failed: false };
    if (t === 0x1c) { out.push({ ...base, item: null, gold: idiv((2 * m.level + 3 + rdiv(rng.rand(m.level), 3)) * (100 + goldPct), 100) }); continue; }
    const L = t < 0x10 && tier2 ? Math.max(1, m.level - 80) : m.level;
    const sub = dropSub(rng, t, L, false, true);
    const grade = i === 4 && t < 0x10 ? Math.min(3, db.a.d8(0x24636 + sub)) : dropGrade(rng, db, t, sub, 0);
    out.push({ ...base, item: db.create(t, sub, grade, rng), gold: 0 });
  }
  return out;
}

/** result popup 100 values: elapsed h / m, equipment gained, kills, bonus exp, achievement points */
export function resultValues(run: DimRun): number[] {
  const min = Math.floor((Date.now() - run.entry) / 60000);
  return [Math.floor(min / 60), min % 60, run.equips, run.kills, run.cleared ? run.pool : 0, run.cleared ? 3 : 0];
}

/** local daily free entry (net 0x2E replaced) */
const FREE = 'grantria.dimfree';
function freeUsedToday(): boolean { try { return localStorage.getItem(FREE) === new Date().toDateString(); } catch { return false; } }
function useFree(): void { try { localStorage.setItem(FREE, new Date().toDateString()); } catch { /* storage unavailable */ } }

/** States 0x2D (3x3 dungeon select, FUN_00026850 / FUN_00026740) and 0x2E (entry, FUN_00059984 / FUN_000528e4). */
export class DimensionScreen {
  private cur = 0;
  private confirm = false;
  private btn = 1;                                                    // 0 입 장, 1 취 소 (DAT_003b3acc = 0 → 취소 first)
  private t = 0;
  popup: Popup | null = null;
  /** the chosen dungeon once paid for */
  enter: number | null = null;
  constructor(private ctx: GameContext, private fs: FieldScene) {}

  private recText(i: number): string {
    const t = this.ctx.assets.text, [lo, hi] = DUNGEONS[i].rec;
    return i >= 6 ? (t[0x1c28] ?? '') : (t[0x1c27] ?? '%d ~ %d').replace('%d', String(lo)).replace('%d', String(hi));
  }

  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.popup) { if (this.popup.handle(presses)) this.popup = null; return null; }
    for (const k of presses) {
      if (!this.confirm) {
        if (k === AVK.LEFT) this.cur = (this.cur + 8) % 9;
        else if (k === AVK.RIGHT) this.cur = (this.cur + 1) % 9;
        else if (k === AVK.UP) this.cur = (this.cur + 6) % 9;
        else if (k === AVK.DOWN) this.cur = (this.cur + 3) % 9;
        else if (k === AVK.OK) { this.confirm = true; this.btn = 1; }   // all dungeons unlocked locally
        else if (k === AVK.CLR) return 'close';
      } else {
        if (k === AVK.UP || k === AVK.LEFT) this.btn = 0;
        else if (k === AVK.DOWN || k === AVK.RIGHT) this.btn = 1;
        else if (k === AVK.CLR || (k === AVK.OK && this.btn === 1)) this.confirm = false;
        else if (k === AVK.OK) this.pay();
      }
    }
    return null;
  }

  /** free entry once a day / a ticket (0x1b, 0x1c) / 3 coupons, else popup 0x7D */
  private pay(): void {
    const inv = this.fs.inv;
    if (!freeUsedToday()) useFree();
    else if (countOf(inv, 0x1b, 0x1c) > 0) consume(inv, 0x1b, 0x1c, 1);
    else if (countOf(inv, 0x1b, 0x1b) >= 3) consume(inv, 0x1b, 0x1b, 3);
    else { this.popup = new Popup(this.ctx, 0x7d); return; }
    this.enter = this.cur;
  }

  draw(u: Ui): void {
    const t = this.ctx.assets.text, i = this.cur;
    u.roundFill(8, 30, 204, 160, 0, 1);
    if (!this.confirm) {
      u.string(t[0x4d8 + i] ?? '', 110, 36, 'center', { pen: 0xffe0 });
      for (let k = 0; k < 9; k++) {
        const x = 45 * (k % 3) + 49, y = 45 * Math.floor(k / 3) + 52;
        u.image('dungeon', (k & 3) * 30, (k >> 2) * 30, 30, 30, x, y);
        if (k === i) u.slotGlow(x - 3, y - 3, 36, 36, this.t);
        u.hit(x, y, 30, 30, () => { if (this.cur === k) return [AVK.OK]; this.cur = k; });
      }
      u.string(this.recText(i), 110, 186, 'center');
      return;
    }
    u.image('dungeon', (i & 3) * 30, (i >> 2) * 30, 30, 30, 20, 38);
    u.string(t[0x4d8 + i] ?? '', 60, 46, 'left', { pen: 0xffe0 });
    u.fill(16, 74, 188, 1, 0x666666);
    u.string(this.recText(i), 110, 82, 'center');
    const tickets = countOf(this.fs.inv, 0x1b, 0x1c);
    const msg = tickets > 0 ? (t[0x1b19] ?? '').replace('%d', String(tickets))
      : !freeUsedToday() ? '하루 한 번 무료로 입장할 수 있습니다.' : (t[0x1c10] ?? '');
    msg.split('|@').slice(0, 4).forEach((ln, k) => u.string(ln.replace(/%d/g, '0'), 110, 102 + 15 * k, 'center'));
    for (const [b, x, id] of [[0, 30, 0x1a39], [1, 120, 0x1a2b]] as const) {
      u.button(x, 160, 70, 22, 3, this.btn === b ? 1 : 0);
      u.textId(id, x + 35, 164, 'center');
      u.hit(x, 160, 70, 22, () => { if (this.btn === b) return [AVK.OK]; this.btn = b; });
    }
  }
  drawPopups(): void { this.popup?.draw(); }
}
