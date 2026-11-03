// 원정(가제): this mode's own loot (web/docs/expedition-balance.md §4.3, §6, §7, §9): the main game's equipment worn for
// the run (four slots, each piece on the whole party), what creatures drop, the four chests and what they hold, the rare
// creature's drop and the dark merchant's stock and prices. Its own tables: the main game's drop rolls, item records,
// level limits and the 개발자 모드 grade multipliers (core/rules) are never read. Only the names come from the main
// game's data (d.dat and text.json through Assets), and the icon sheet position is the main game's formula.
import type { Assets } from '../data/assets';
import type { Rng } from './rng';
import { SKILLBOOK } from './skillbook';

/** 일반 · 고급 · 희귀 · 영웅 · 전설: the main game's grade 0..4 (white, green, yellow, orange, purple) */
export type Grade = 0 | 1 | 2 | 3 | 4;
export const GRADE_NAME = ['일반', '고급', '희귀', '영웅', '전설'] as const;

/** 무기 · 투구 · 갑옷 · 목걸이 */
export type Slot = 0 | 1 | 2 | 3;
export const SLOTS = 4;
export const SLOT_NAME = ['무기', '투구', '갑옷', '목걸이'] as const;
/** the main game's equipment types of the 검사 (class 0) a slot is filled from: 양손검; 투구; 갑옷, 그리브 and 건틀렛;
 *  목걸이 (analysis/features/items.md §0.5) */
export const SLOT_TYPES: readonly (readonly number[])[] = [[0], [3], [6, 9, 12], [15]];
/** tiers 1..4 = the main game's item sub 0..3 (worn from Lv 1, 9, 17, 25 there; no level limit here) */
export const TIERS = 4;

/** what a piece does for the run, on every member (also those who join later). No effect touches parry (2026-10-28). */
export interface Stats {
  atk?: number;
  spd?: number;
  /** max HP ×(1 + hpPct) */
  hpPct?: number;
  /** damage the party takes ×(1 − guard) */
  guard?: number;
}

export interface Gear extends Stats {
  slot: Slot;
  /** the main game's item type and sub (= tier − 1): its name and icon */
  type: number;
  sub: number;
  grade: Grade;
  /** its item level: the run's battle zone it was made for (1..9); its effects grow with it (§19) */
  ilv: number;
  name: string;
}

/** a tier's multiplier on a piece's main effect (tier 1..4) */
export const TIER_MUL = [1, 1.3, 1.65, 2] as const;

const pct = (v: number) => Math.round(v * 100) / 100;

/** a slot's main effect at item level ilv and tier (0..3) (web/docs/expedition-balance.md §19): it grows with the zone
 *  it drops in, so each zone's finds beat the last zone's of the same tier */
export function mainStats(slot: Slot, tier: number, ilv: number): Stats {
  const k = TIER_MUL[Math.max(0, Math.min(TIERS - 1, tier))];
  switch (slot) {
    case 0: return { atk: Math.max(1, Math.round((1.5 + 0.9 * ilv) * k)) };
    case 1: return { hpPct: pct((0.05 + 0.015 * ilv) * k) };
    case 2: return { guard: pct((0.04 + 0.008 * ilv) * k) };
    default: return { spd: Math.max(1, Math.round((0.6 + 0.25 * ilv) * k)), hpPct: pct((0.02 + 0.004 * ilv) * k) };
  }
}

/** one extra line per grade step (고급 1 .. 전설 4) at item level ilv, by weight; the same line twice adds up */
export function lineStats(ilv: number): [Stats, number][] {
  return [[{ atk: Math.round(1 + 0.45 * ilv) }, 30], [{ hpPct: pct(0.04 + 0.005 * ilv) }, 30], [{ guard: pct(0.03 + 0.002 * ilv) }, 30],
    [{ spd: ilv >= 6 ? 2 : 1 }, 10]];
}

const KEYS = ['atk', 'spd', 'hpPct', 'guard'] as const;

/** a + b, stat by stat (hpPct and guard kept to whole percents) */
export function addStats(a: Stats, b: Stats): Stats {
  const out: Stats = {};
  for (const k of KEYS) {
    const v = (a[k] ?? 0) + (b[k] ?? 0);
    if (v) out[k] = k === 'atk' || k === 'spd' ? v : Math.round(v * 100) / 100;
  }
  return out;
}

/** the effect lines of a piece (or of a whole set) */
export function statText(s: Stats): string[] {
  const out: string[] = [];
  if (s.atk) out.push(`공격 +${s.atk}`);
  if (s.spd) out.push(`속도 +${s.spd}`);
  if (s.hpPct) out.push(`최대 HP +${Math.round(s.hpPct * 100)}%`);
  if (s.guard) out.push(`받는 피해 −${Math.round(s.guard * 100)}%`);
  return out;
}

/** the effect line of a piece (with its item level) */
export function gearDesc(g: Stats & { ilv?: number }): string { return `${g.ilv ? `Lv.${g.ilv} · ` : ''}파티 전원 ${statText(g).join(', ')}`; }

/** the display name of a main-game item (type, sub): text 0x7fc + model, model = 21·type + d8(0x245ff + 5·sub)
 *  (FUN_00036458; for sub 0..3 every grade shares the grade-0 model) */
export type Namer = (type: number, sub: number) => string;
export function gearNamer(a: Pick<Assets, 'd8' | 'text'>): Namer {
  return (type, sub) => a.text[0x7fc + 21 * type + a.d8(0x245ff + sub * 5)] ?? '?';
}

/** the main game's item icon id of (type, sub) (FUN_000365ac: 11·type + sub for equipment) */
export function gearIcon(g: Pick<Gear, 'type' | 'sub'>): number { return 11 * g.type + g.sub; }

/** a piece of the slot, tier (0..3), grade and item level: the main effect and one random line per grade step */
export function makeGear(slot: Slot, tier: number, grade: Grade, rng: Rng, name: Namer, ilv = 1): Gear {
  const type = rng.pick(SLOT_TYPES[slot]), sub = Math.max(0, Math.min(TIERS - 1, tier)), lines = lineStats(ilv);
  let st: Stats = mainStats(slot, sub, ilv);
  for (let i = 0; i < grade; i++) st = addStats(st, lines[rng.weighted(lines.map((l) => l[1]))][0]);
  return { ...st, slot, type, sub, grade, ilv, name: name(type, sub) };
}

/** a piece tempered at a rest zone's camp (§20.3): its item level up by `by` (to TEMPER_MAX), its main effect grown to
 *  match; its grade lines stay as rolled */
export const TEMPER_MAX = 10;
export function temper(g: Gear, by: number): Gear {
  const ilv = Math.min(TEMPER_MAX, g.ilv + by), was = mainStats(g.slot, g.sub, g.ilv), now = mainStats(g.slot, g.sub, ilv);
  const neg: Stats = {};
  for (const k of KEYS) if (was[k]) neg[k] = -was[k]!;
  const { slot, type, sub, grade, name } = g;
  return { ...addStats(addStats(g, neg), now), slot, type, sub, grade, ilv, name };
}

/** a piece of any slot: the tier by weight (moved up `tierUp` steps), the grade by weight, at item level ilv */
export function rollGear(tiers: readonly number[], grades: readonly number[], rng: Rng, name: Namer, tierUp = 0, ilv = 1): Gear {
  const slot = rng.int(0, SLOTS - 1) as Slot;
  return makeGear(slot, rng.weighted(tiers) + tierUp, rng.weighted(grades) as Grade, rng, name, ilv);
}

/** the run's battle zones (three stages of three): loot tables have a row for each (§17) */
export const LOOT_ZONES = 9;
const zi = (n: number) => Math.max(0, Math.min(LOOT_ZONES - 1, n - 1));

// --- creatures ------------------------------------------------------------------------------------------------------

/** a won battle drops a piece this often (one roll however many fell); a field kill half as often (like its EXP) */
export const DROP_CHANCE = 0.3, FIELD_DROP_CHANCE = 0.15;
/** tier weights 1..4 of a creature's drop in battle zone 1..9 of the run (stage 1: 1..3) */
export const DROP_TIERS = [[75, 22, 3, 0], [40, 42, 15, 3], [20, 40, 30, 10],
  [10, 35, 40, 15], [5, 25, 45, 25], [0, 20, 45, 35], [0, 10, 45, 45], [0, 5, 40, 55], [0, 0, 35, 65]] as const;
/** grade weights 일반..전설 of a creature's drop in battle zone 1..9 */
export const DROP_GRADES = [[75, 20, 5, 0, 0], [62, 27, 9, 2, 0], [50, 32, 14, 4, 0],
  [45, 33, 16, 6, 0], [40, 34, 18, 7, 1], [35, 35, 20, 8, 2], [30, 35, 22, 10, 3], [26, 35, 24, 12, 3], [22, 35, 26, 13, 4]] as const;

/** what a creature of battle zone n drops */
export function creatureDrop(n: number, rng: Rng, name: Namer): Gear {
  return rollGear(DROP_TIERS[zi(n)], DROP_GRADES[zi(n)], rng, name, 0, zi(n) + 1);
}

// --- skills (§16) ---------------------------------------------------------------------------------------------------

/** a won battle teaches a skill this often (rolled apart from its piece), a field kill half as often */
export const SKILL_DROP = 0.08, FIELD_SKILL_DROP = 0.04;
/** tier weights (1·2·3단계) of a skill found in battle zone 1..9 */
export const SKILL_TIERS = [[80, 20, 0], [50, 40, 10], [30, 40, 30], [25, 40, 35], [20, 40, 40], [15, 40, 45], [15, 35, 50], [10, 35, 55], [10, 30, 60]] as const;
/** the share of chests holding a skill instead (나무, 녹슨, 은, 황금), and of rare creatures dropping one instead of a piece */
export const CHEST_SKILL: Record<ChestKind, number> = { 0: 0.05, 1: 0.15, 2: 0.25, 3: 0.3 };
export const RARE_SKILL = 0.3;

/** a skill of battle zone n (an original skill number), its tier moved up `tierUp` steps */
export function rollSkill(n: number, rng: Rng, tierUp = 0): number {
  const tier = Math.min(2, rng.weighted(SKILL_TIERS[zi(n)]) + tierUp);
  return rng.pick(SKILLBOOK.filter((d) => d.tier === tier)).id;
}

// --- chests ---------------------------------------------------------------------------------------------------------

/** 나무 · 녹슨 · 은 · 황금 */
export type ChestKind = 0 | 1 | 2 | 3;
export const CHEST_NAME = ['나무 상자', '녹슨 상자', '은 상자', '황금 상자'] as const;
/** cmf_oc frames of the original chests: brown, teal (rusty key), blue (silver key), gold (gimmicks.md §1.2) */
export const CHEST_FRAME = [14, 15, 16, 17] as const;
/** off-path walk distance (tiles) a chest of the kind wants: the better the deeper */
export const CHEST_DEPTH = [10, 20, 30, 30] as const;

/** the chests of battle zone n (1..9): two wooden plus one at 50%, the others by chance (gold 5% more, silver 5% more
 *  a zone, to 30% and 50%) */
export function chestRoll(n: number, rng: Rng): ChestKind[] {
  const i = zi(n), out: ChestKind[] = [];
  if (rng.chance(Math.min(0.3, 0.05 * (i + 1)))) out.push(3);
  if (rng.chance(Math.min(0.5, 0.2 + 0.05 * i))) out.push(2);
  if (rng.chance(0.5)) out.push(1);
  out.push(0, 0);
  if (rng.chance(0.5)) out.push(0);
  return out;
}

/** grade weights 일반..전설 of the piece a chest holds */
export const CHEST_GRADES: Record<ChestKind, readonly number[]> = {
  0: [80, 20, 0, 0, 0],
  1: [40, 45, 15, 0, 0],
  2: [0, 35, 50, 15, 0],
  3: [0, 0, 0, 50, 50],
};
/** a chest's piece is this many tiers above the zone's creature drop (silver and gold: one) */
export const CHEST_TIER_UP: Record<ChestKind, number> = { 0: 0, 1: 0, 2: 1, 3: 1 };

export type Loot = { kind: 'gold'; gold: number } | { kind: 'potion'; n: number } | { kind: 'gear'; gear: Gear } | { kind: 'skill'; id: number };

/** what a chest of battle zone n holds: a wooden one gold 50% (15 + 10·n), a potion 25%, a piece 25%; the others a piece */
export function openChest(kind: ChestKind, n: number, rng: Rng, name: Namer): Loot {
  if (rng.chance(CHEST_SKILL[kind])) return { kind: 'skill', id: rollSkill(n, rng, CHEST_TIER_UP[kind]) };
  if (kind === 0) {
    const r = rng.next();
    if (r < 0.5) return { kind: 'gold', gold: 15 + 10 * (zi(n) + 1) };
    if (r < 0.75) return { kind: 'potion', n: 1 };
  }
  return { kind: 'gear', gear: rollGear(DROP_TIERS[zi(n)], CHEST_GRADES[kind], rng, name, CHEST_TIER_UP[kind], zi(n) + 1) };
}

// --- the rare creature ----------------------------------------------------------------------------------------------

/** a rare creature appears in a battle zone this often (at most one) */
export const RARE_CHANCE = 0.25;
/** its drop: 희귀 80 / 영웅 17 / 전설 3, one tier above the zone's */
export const RARE_GRADES = [0, 0, 80, 17, 3] as const;
export const RARE_GOLD = 5;

export function rareDrop(n: number, rng: Rng, name: Namer): Gear {
  return rollGear(DROP_TIERS[zi(n)], RARE_GRADES, rng, name, 1, zi(n) + 1);
}

// --- the dark merchant ----------------------------------------------------------------------------------------------

export const POTION_PRICE = 30;
/** a piece's price: 120G, +100G a tier step, +100G a grade step, +20G an item level past the first (전설 is not sold) */
export function gearPrice(g: Pick<Gear, 'sub' | 'grade'> & { ilv?: number }): number { return 120 + 100 * g.sub + 100 * g.grade + 20 * ((g.ilv ?? 1) - 1); }
/** grade weights 일반..영웅 of the merchant's pieces in battle zone 1..9 (one tier above the zone's creature drop) */
export const MERCHANT_GRADES = [[60, 35, 5, 0], [40, 40, 17, 3], [25, 40, 28, 7],
  [20, 40, 30, 10], [15, 40, 33, 12], [10, 38, 37, 15], [10, 35, 38, 17], [8, 32, 40, 20], [5, 30, 42, 23]] as const;

export interface Ware { gear: Gear | null; /** potions left (the potion slot) */ n: number; price: number; sold: boolean }

/** four slots: the potions (3..5), then three pieces for different slots by the zone's weights */
export function merchantStock(n: number, rng: Rng, name: Namer): Ware[] {
  const out: Ware[] = [{ gear: null, n: rng.int(3, 5), price: POTION_PRICE, sold: false }];
  const slots = rng.shuffle([0, 1, 2, 3] as Slot[]).slice(0, 3);
  for (const slot of slots) {
    const g = makeGear(slot, rng.weighted(DROP_TIERS[zi(n)]) + 1, rng.weighted(MERCHANT_GRADES[zi(n)]) as Grade, rng, name, zi(n) + 1);
    out.push({ gear: g, n: 1, price: gearPrice(g), sold: false });
  }
  return out;
}
