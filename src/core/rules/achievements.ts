// Titles (칭호, 56, FUN_0004aa9c) and challenges (도전과제, 50, FUN_0004aa48), slot data
// (analysis/features/account.md §3). Counters live in the story save; conditions follow
// data/account/titles.json and challenges.json (titles 24 / 25 come from the daily fortune, fortune.ts);
// challenge 45..47 use "all six equipped at least grade g".
import { cfmt } from '../data/skillDetail';

/** event kinds reported by the game */
export type AchEvent =
  | { k: 'kill'; type: number; garden: boolean }
  | { k: 'death' } | { k: 'enhanceTry' } | { k: 'enhanceOk'; enh: number }
  | { k: 'craft' } | { k: 'combine' } | { k: 'dismantle' } | { k: 'gem' } | { k: 'inn' } | { k: 'potion' }
  | { k: 'dimClear' }
  | { k: 'basicKill' } | { k: 'quickKill' } | { k: 'bigHit' } | { k: 'oneHitKill' } | { k: 'evade' }
  | { k: 'lowHpReturn' } | { k: 'cure' } | { k: 'skillChain' } | { k: 'peacefulRoom' };

export interface AchState {
  level: number;
  gold: number;
  gatherLv: number;
  traitsSpent: number;
  /** book species with at least one kill */
  bookKinds: number;
  subquests: number;
  questDone: (q: number) => boolean;
  /** grades of equipped items (6, -1 empty) and the best grade owned among equipment */
  equipped: number[];
  bestGrade: number;
  /** highest gem tier socketed in the equipment (-1 none), accessory subs (type 15) held, regions visited */
  gemTier: number;
  necklaces: number;
  regions: number;
  /** frames without moving, frames played at the slowest game speed */
  idleFrames: number;
  slowFrames: number;
}

const BOSS_CHALLENGE: Record<number, number> = { 5: 13, 8: 13, 11: 13, 14: 14, 17: 15, 20: 16, 26: 17, 29: 18, 32: 19, 39: 20, 35: 21, 23: 22, 38: 23 };

/** counter thresholds -> (title | challenge) */
const STEPS: Record<string, [number, 't' | 'c', number][]> = {
  kills: [[500, 'c', 7], [5000, 'c', 8], [50000, 'c', 9]],
  deaths: [[10, 't', 15], [100, 't', 16], [1000, 't', 17]],
  enhanceTry: [[30, 't', 9], [100, 't', 10], [1000, 't', 11]],
  enhanceOk: [[1, 'c', 25]],
  combine: [[1, 'c', 34], [30, 't', 18], [50, 'c', 35], [100, 'c', 36], [100, 't', 19], [1000, 't', 20]],
  craft: [[1, 'c', 31], [50, 'c', 32], [50, 't', 53], [100, 'c', 33], [500, 't', 54]],
  dismantle: [[1, 'c', 28], [50, 'c', 29], [100, 'c', 30]],
  gem: [[1, 'c', 5], [100, 'c', 6]],
  inn: [[70, 't', 33], [130, 't', 34]],
  basicKill: [[100, 't', 30], [1000, 't', 31]],
  quickKill: [[30, 't', 6], [90, 't', 7], [300, 't', 8]],
  bigHit: [[100, 't', 42], [1000, 't', 43]],
  oneHitKill: [[10, 't', 44]],
  evade: [[200, 't', 46]],
  lowHpReturn: [[100, 't', 45]],
  cure: [[500, 't', 37]],
  skillChain: [[10, 't', 21], [100, 't', 22]],
  peacefulRoom: [[2000, 't', 35]],
  potion: [[1000, 't', 51], [10000, 't', 52]],
  gardenKills: [[1000, 't', 47], [10000, 't', 48], [100000, 't', 49]],
};

export interface Awards { titles: number[]; challenges: number[] }

/** apply one event to the counters; returns what it unlocks (already owned ones are filtered by the caller) */
export function achEvent(c: Record<string, number>, e: AchEvent): Awards {
  const out: Awards = { titles: [], challenges: [] };
  const bump = (key: string) => {
    const v = c[key] = (c[key] ?? 0) + 1;
    for (const [n, kind, id] of STEPS[key] ?? []) if (v >= n) (kind === 't' ? out.titles : out.challenges).push(id);
  };
  switch (e.k) {
    case 'kill':
      bump('kills');
      if (e.garden) bump('gardenKills');
      if (BOSS_CHALLENGE[e.type] !== undefined) out.challenges.push(BOSS_CHALLENGE[e.type]);
      if (e.type === 0x2a) { c.vermutKills = Math.min(65000, (c.vermutKills ?? 0) + 1); out.titles.push(23); if (e.garden) out.challenges.push(24, 40); }
      break;
    case 'death': bump('deaths'); break;
    case 'enhanceTry': bump('enhanceTry'); break;
    case 'enhanceOk': bump('enhanceOk'); if (e.enh >= 10) out.challenges.push(26); if (e.enh >= 20) out.challenges.push(27); break;
    case 'craft': bump('craft'); break;
    case 'combine': bump('combine'); break;
    case 'dismantle': bump('dismantle'); break;
    case 'gem': bump('gem'); break;
    case 'inn': bump('inn'); break;
    case 'potion': bump('potion'); break;
    case 'dimClear': out.challenges.push(41); break;
    default: bump(e.k); break;
  }
  return out;
}

/** state checks (polled): levels, gold, gather level, traits, book, quests, equipment grades */
export function achCheck(s: AchState): Awards {
  const t: number[] = [], ch: number[] = [];
  if (s.level >= 50) t.push(0);
  if (s.level >= 100) t.push(1);
  [20, 70, 120, 170, 200].forEach((L, i) => { if (s.level >= L) ch.push(i); });
  if (s.gold === 777777) t.push(29);
  [100000, 1000000, 10000000].forEach((g, i) => { if (s.gold >= g) ch.push(37 + i); });
  if (s.gatherLv >= 1) t.push(27);
  if (s.gatherLv >= 5) t.push(28);
  [1, 10, 20].forEach((n, i) => { if (s.traitsSpent >= n) ch.push(10 + i); });
  if (s.bookKinds >= 40) t.push(41);
  if (s.subquests >= 20) t.push(39);
  if (s.subquests >= 52) { t.push(40); ch.push(49); }
  if (s.questDone(0x97)) ch.push(48);
  [2, 3, 4].forEach((g, i) => { if (s.bestGrade >= g) ch.push(42 + i); });
  [2, 3, 4].forEach((g, i) => { if (s.equipped.length === 6 && s.equipped.every((x) => x >= g)) ch.push(45 + i); });
  [1, 3, 4].forEach((g, i) => { if (s.equipped.length === 6 && s.equipped.every((x) => x >= g)) t.push(3 + i); });   // 고급 / 영웅 / 전설
  [0, 2, 4].forEach((g, i) => { if (s.gemTier >= g) t.push(12 + i); });                                            // 하급 / 중급 / 최상급 보석 (gem tier = sub % 5)
  if (s.necklaces >= 11) t.push(38);
  if (s.regions >= 14) t.push(32);
  if (s.idleFrames >= 5 * 60 * 20) t.push(50);
  if (s.slowFrames >= 10 * 60 * 20) t.push(36);
  return { titles: t, challenges: ch };
}

/** title effect records d+0x25473 + 5n = [stat, ?, worn value, owned value, ?] (FUN_00036a1c / FUN_0002b868) */
export function titleBonus(a: { d8(o: number): number }, owned: Iterable<number>, worn: number): { stat: number; v: number }[] {
  const out: { stat: number; v: number }[] = [];
  for (const n of owned) {
    const o = 0x25473 + 5 * n, v = n === worn ? a.d8(o + 2) : a.d8(o + 3);
    if (v) out.push({ stat: a.d8(o), v });
  }
  return out;
}

/** MENUPOP 10 (FUN_0004f6a8 case 10): the option text 0x7B4 + rec[1] inside text 0x1B12, filled with the worn value
 *  rec[2] (장착효과, 0x19DE) and the owned value rec[3] (기본효과, 0x19DF) */
export function titleEffectText(a: { d8(o: number): number; text: string[] }, n: number): { worn: string; owned: string } {
  const o = 0x25473 + 5 * n, f = cfmt(a.text[0x1b12] ?? '%s', a.text[0x7b4 + a.d8(o + 1)] ?? '');
  return { worn: cfmt(f, a.d8(o + 2)), owned: cfmt(f, a.d8(o + 3)) };
}

/** FUN_0001f17c: challenge reward gold = d16[0x20c72 + 2n] × 100 */
export function challengeGold(a: { d16(o: number): number }, n: number): number { return a.d16(0x20c72 + 2 * n) * 100; }
