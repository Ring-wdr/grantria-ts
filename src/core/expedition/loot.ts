// 원정(가제): this mode's own loot (web/docs/expedition-balance.md §4.3, §6, §7, §9): the run-only relics that apply to
// the whole party, the four chests and what they hold, the rare creature's drop and the dark merchant's stock and
// prices. Its own tables: the main game's drop rolls and the 개발자 모드 grade multipliers (core/rules) are never read.
import type { Rng } from './rng';

/** 일반 · 고급 · 희귀 · 영웅 · 전설 */
export type Grade = 0 | 1 | 2 | 3 | 4;
export const GRADE_NAME = ['일반', '고급', '희귀', '영웅', '전설'] as const;

/** a relic: for the run, on every member (also those who join later). No effect touches parry (2026-10-28). */
export interface Relic {
  id: string;
  name: string;
  grade: Grade;
  atk?: number;
  spd?: number;
  /** max HP ×(1 + hpPct) */
  hpPct?: number;
  /** damage the party takes ×(1 − guard) */
  guard?: number;
}

/** the effect line of a relic */
export function relicDesc(r: Relic): string {
  const out: string[] = [];
  if (r.atk) out.push(`공격 +${r.atk}`);
  if (r.spd) out.push(`속도 +${r.spd}`);
  if (r.hpPct) out.push(`최대 HP +${Math.round(r.hpPct * 100)}%`);
  if (r.guard) out.push(`받는 피해 −${Math.round(r.guard * 100)}%`);
  return `파티 전원 ${out.join(', ')}`;
}

/** budget per grade in eLv (§4.3): 0.3 · 0.6 · 1.0 · 1.6 · 2.5 */
export const RELICS: Relic[] = [
  { id: 'herb', name: '초원의 약초 주머니', grade: 0, hpPct: 0.1 },
  { id: 'hide', name: '질긴 가죽 조각', grade: 0, guard: 0.1 },
  { id: 'whet', name: '무딘 숫돌', grade: 0, atk: 1 },
  { id: 'wind', name: '바람새 깃털', grade: 1, spd: 1 },
  { id: 'heart', name: '사냥꾼의 심장', grade: 1, hpPct: 0.2 },
  { id: 'scale', name: '물가의 비늘', grade: 1, guard: 0.15, hpPct: 0.05 },
  { id: 'fang', name: '흑표의 송곳니', grade: 2, atk: 2, hpPct: 0.1 },
  { id: 'dew', name: '새벽 이슬 병', grade: 2, atk: 1, spd: 1 },
  { id: 'shell', name: '호수 거북 등딱지', grade: 2, hpPct: 0.2, guard: 0.15 },
  { id: 'banner', name: '초원 기사단의 깃발', grade: 3, atk: 3, spd: 1 },
  { id: 'moon', name: '달빛 호수의 가호', grade: 3, atk: 2, hpPct: 0.25 },
  { id: 'crown', name: '초원의 왕관', grade: 4, atk: 4, spd: 1 },
  { id: 'storm', name: '폭풍을 부르는 뿔피리', grade: 4, atk: 3, spd: 1, hpPct: 0.2 },
];

/** a relic of this grade; 영웅 and 전설 never come twice in a run (owned ones are left out, then the grade below) */
export function pickRelic(grade: Grade, rng: Rng, owned: readonly Relic[], exclude: readonly Relic[] = []): Relic {
  for (let g = grade; g >= 0; g--) {
    const pool = RELICS.filter((r) => r.grade === g && !exclude.includes(r) && !(g >= 3 && owned.includes(r)));
    if (pool.length) return rng.pick(pool);
  }
  return RELICS[0];
}

// --- chests ---------------------------------------------------------------------------------------------------------

/** 나무 · 녹슨 · 은 · 황금 */
export type ChestKind = 0 | 1 | 2 | 3;
export const CHEST_NAME = ['나무 상자', '녹슨 상자', '은 상자', '황금 상자'] as const;
/** cmf_oc frames of the original chests: brown, teal (rusty key), blue (silver key), gold (gimmicks.md §1.2) */
export const CHEST_FRAME = [14, 15, 16, 17] as const;
/** off-path walk distance (tiles) a chest of the kind wants: the better the deeper */
export const CHEST_DEPTH = [10, 20, 30, 30] as const;

/** the chests of battle zone n (1..3): two wooden plus one at 50%, the others by chance */
export function chestRoll(n: number, rng: Rng): ChestKind[] {
  const i = Math.max(0, Math.min(2, n - 1)), out: ChestKind[] = [];
  if (rng.chance([0.05, 0.1, 0.15][i])) out.push(3);
  if (rng.chance([0.2, 0.25, 0.3][i])) out.push(2);
  if (rng.chance(0.5)) out.push(1);
  out.push(0, 0);
  if (rng.chance(0.5)) out.push(0);
  return out;
}

/** grade weights 일반..전설 of the item a chest holds */
export const CHEST_GRADES: Record<ChestKind, readonly number[]> = {
  0: [80, 20, 0, 0, 0],
  1: [40, 45, 15, 0, 0],
  2: [0, 35, 50, 15, 0],
  3: [0, 0, 0, 50, 50],
};

export type Loot = { kind: 'gold'; gold: number } | { kind: 'potion'; n: number } | { kind: 'relic'; relic: Relic };

/** what a chest of battle zone n holds: a wooden one gold 50%, a potion 25%, an item 25%; the others an item */
export function openChest(kind: ChestKind, n: number, rng: Rng, owned: readonly Relic[]): Loot {
  if (kind === 0) {
    const r = rng.next();
    if (r < 0.5) return { kind: 'gold', gold: 15 + 10 * Math.max(1, Math.min(3, n)) };
    if (r < 0.75) return { kind: 'potion', n: 1 };
  }
  return { kind: 'relic', relic: pickRelic(rng.weighted(CHEST_GRADES[kind]) as Grade, rng, owned) };
}

// --- the rare creature ----------------------------------------------------------------------------------------------

/** a rare creature appears in a battle zone this often (at most one) */
export const RARE_CHANCE = 0.25;
/** its drop: 희귀 80 / 영웅 17 / 전설 3 */
export const RARE_GRADES = [0, 0, 80, 17, 3] as const;
export const RARE_GOLD = 5;

// --- the dark merchant ----------------------------------------------------------------------------------------------

export const POTION_PRICE = 30;
/** relic prices by grade (500G per eLv); 전설 is not sold */
export const PRICE = [150, 300, 500, 800] as const;
/** grade weights 일반..영웅 of the merchant's relics in battle zone 1..3 */
export const MERCHANT_GRADES = [[60, 35, 5, 0], [40, 40, 17, 3], [25, 40, 28, 7]] as const;

export interface Ware { relic: Relic | null; /** potions left (the potion slot) */ n: number; price: number; sold: boolean }

/** four slots: the potions (3..5), then three different relics by the zone's weights */
export function merchantStock(n: number, rng: Rng, owned: readonly Relic[]): Ware[] {
  const ws = MERCHANT_GRADES[Math.max(0, Math.min(2, n - 1))], out: Ware[] = [{ relic: null, n: rng.int(3, 5), price: POTION_PRICE, sold: false }];
  const picked: Relic[] = [];
  for (let i = 0; i < 3; i++) {
    const r = pickRelic(rng.weighted(ws) as Grade, rng, owned, picked);
    picked.push(r);
    out.push({ relic: r, n: 1, price: PRICE[Math.min(3, r.grade)], sold: false });
  }
  return out;
}
