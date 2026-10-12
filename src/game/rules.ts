// Game rules ported from analysis/features/game-rules.md (integer arithmetic kept as in the
// original: `/` truncates toward zero, rdiv/cdiv are the engine's rounding helpers).

/** C integer division (truncates toward zero). */
export const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** FUN_0007b1f0: rounded division ((a*16/b)+8)>>4. */
export const rdiv = (a: number, b: number): number => (idiv(a * 16, b) + 8) >> 4;

/** FUN_0007b218: nearly-ceiling division ((a*16/b)+15)>>4. */
export const cdiv = (a: number, b: number): number => (idiv(a * 16, b) + 15) >> 4;

/**
 * FUN_000f8490: seed = seed * 0x5851F42D4C957F2D + now_ms + 1 (64-bit),
 * rand(n) = |seed mod n| with seed read as signed 64-bit. The original mixes in the clock on
 * every call; pass a fixed clock for reproducible tests.
 */
export class Rng {
  private seed: bigint;
  private clock: () => number;
  constructor(seed = BigInt(Date.now()), clock: () => number = () => Math.floor(performance.now())) {
    this.seed = BigInt.asUintN(64, seed);
    this.clock = clock;
  }

  rand(n: number): number {
    this.seed = BigInt.asUintN(64, this.seed * 0x5851F42D4C957F2Dn + BigInt(this.clock()) + 1n);
    if (n < 1) return 0;
    const s = BigInt.asIntN(64, this.seed);
    let r = Number((s < 0n ? -s : s) % BigInt(n));
    if (r === n) r = n - 1;
    return r;
  }
}

/** Experience step to go from level i (FUN_0004936c). */
export function expStep(i: number): number {
  if (i <= 49) return idiv(8 * i * (i + 1) * (i + 2) + 800, 10);
  if (i <= 99) return idiv(((i >> 1) * 9 + 180) * (i + 1) * (i + 2) + 900, 10);
  return (idiv(i, 3) + 30) * (i + 1) * (i + 2) + 100;
}

/** Cumulative experience needed to leave level L (need(1) = 84). */
export function expNeed(level: number): number {
  let s = 0;
  for (let i = 1; i <= level; i++) s += expStep(i);
  return s;
}

export const MAX_LEVEL = 200;

/** Normal monster stats from the room monster level (FUN_0001bb8c), before boss multipliers. */
export function monsterStats(level: number, type: number, hard = false): { level: number; hp: number; atk: number } {
  const L = level + (hard ? 80 : 0);
  const T = L <= 24 ? 70 : L <= 49 ? 100 : L <= 74 ? 110 : L <= 99 ? 120 : L <= 124 ? 130 : L <= 149 ? 140 : L <= 174 ? 150 : L <= 199 ? 160 : 170;
  const hp = idiv(T * (10 * L + 140), 100) + idiv(400 * L * L, 300);
  let atk = idiv(L * L, 600) + idiv(7 * L, 6) + 2;
  if (hard) atk = rdiv(atk * 120, 100);
  if (type === 27 || type === 31) atk = rdiv(atk * 60, 100);
  return { level: L, hp, atk };
}

/** Class base values (FUN_0001a8d8): base stats S0..S3 = STR/AGI/VIT/INT and per-class factors. */
export const CLASSES = [
  { name: '러스티', stats: [5, 5, 3, 3], mainStat: 0, hpPerVit: 10, regenDiv: 20, critDiv: 14, accDiv: 20 },
  { name: '엘', stats: [3, 3, 3, 7], mainStat: 3, hpPerVit: 8, regenDiv: 20, critDiv: 20, accDiv: 14 },
  { name: '알피', stats: [7, 1, 5, 3], mainStat: 0, hpPerVit: 12, regenDiv: 14, critDiv: 33, accDiv: 33 },
] as const;

/** Enhancement step table (.rodata 0x103834) and FUN_00037238. */
const ENH_T = [4, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 9, 11, 13, 16, 20, 25, 32, 41, 53, 68];
export function enhBonus(base: number, enh: number): number {
  let e = 0;
  for (let k = 0; k < enh; k++) e += ENH_T[k];
  return Math.max(enh, rdiv(e * base, 100));
}

export interface Derived {
  atk: number;
  def: number;
  maxHp: number;
  maxMp: number;
  crit: number;
  acc: number;
  evade: number;
  critDmg: number;
  hpRegen: number;
  mpRegen: number;
  expPct: number;
  goldPct: number;
  luck: number;
  potionPct: number;
  potionCdReduction: number;
  /** the full derived block g+0x2ff4 (57 ints, game-rules.md §1.3) */
  D: number[];
}

/** Equipment as seen by the stat rebuild (items.ts Item satisfies this). */
export interface EquipLike {
  type: number;
  sub: number;
  grade: number;
  base: number;
  enh: number;
  count: number;          // socket count
  reqLevel: number;
  sockets: number[];
  options: [number, number][];
}

/** d.dat tables used by the rebuild (passed in so the rules stay testable without assets). */
export interface EquipTables {
  /** option id -> derived index, d+0x22a6a (s8, -1 = none) */
  optionIndex: number[];
  /** set record list for (grade, sub, pieces): [optionId, value][] (d+0x244d1 / 0x244fd / 0x2453f / 0x245af) */
  setBonus(grade: number, sub: number, pieces: number): [number, number][];
  /** gem value d+0x26912 + tier*5 + grade */
  gemValue(tier: number, grade: number): number;
}

export interface PlayerModel {
  cls: 0 | 1 | 2;
  level: number;
  stats: number[];          // S0..S3 including distributed points
  /** learned skill levels: 0..8 actives (tab order), 9..15 passives */
  skills?: number[];
  /** legacy shortcut used by tests: a weapon without options */
  weapon?: { base: number; enh: number } | null;
  equip?: (EquipLike | null)[];
  /** title bonuses {stat, value}: worn title [2], other owned titles [3] (account.md §3.1) */
  titles?: { stat: number; v: number }[];
  /** account trait bonus (tracks 1, 2, 3, 11, 12; account.md §2.1) */
  traits?: { hp: number; mp: number; cd: number; resist: number; potion: number };
  /** active elixir buffs (k, v) from buffs.ts (FUN_000373cc) */
  buffs?: { k: number; v: number }[];
}

/** Passive table (class-shared): target derived index and value per level num/den. */
const PASSIVES = [
  { k: 1, num: 2, den: 1 }, { k: 10, num: 2, den: 1 }, { k: 11, num: 2, den: 1 }, { k: 4, num: 1, den: 1 },
  { k: 3, num: 1, den: 1 }, { k: 5, num: 1, den: 1 }, { k: 26, num: 1, den: 2 },
];

/** Effective active skill level (+0x3111): learned + all-active + element-column bonus (skills.md §5.1). */
export function effectiveSkillLevel(learned: number, s: number, D: number[]): number {
  return learned + D[52] + D[49 + (s % 3)];
}

/**
 * FUN_00069de4 skill damage before hit/crit/variance: ATK x (r0 + (lv-1) r3)/100, skill damage %,
 * then the element multiplier grouped by tier s/3 as the original code does (skills.md §3.3).
 */
export function skillBaseDamage(atk: number, r0: number, r3: number, lv: number, skillDmgPct: number, s: number, elem: number): number {
  let d = idiv(atk * (r0 + (lv - 1) * r3), 100);
  d = idiv(d * (100 + skillDmgPct), 100);
  const g = Math.trunc(s / 3);
  const half = (x: number) => rdiv(x * 7, 10), oneHalf = (x: number) => rdiv(x * 15, 10);
  if (g === 0) d = elem === 2 ? half(d) : elem === 3 ? oneHalf(d) : d;
  else if (g === 1) d = elem === 1 ? oneHalf(d) : elem === 3 ? half(d) : d;
  else d = elem === 1 ? half(d) : elem === 2 ? oneHalf(d) : d;
  return d < 0 ? 1 : d;
}

const usable = (it: EquipLike, level: number, cls: number) =>
  it.type >= 16 || (level >= it.reqLevel && (it.type === 15 || it.type % 3 === cls));

/**
 * FUN_0003bdfc stat rebuild with FUN_0003750c (ATK / class formulas), equipment options, armour %,
 * set bonuses, gems and enhancement side bonuses (items.md §0.5). Not included yet: titles,
 * passives, buffs and account bonuses.
 */
export function derive(p: PlayerModel, tables?: EquipTables): Derived {
  const c = CLASSES[p.cls];
  const D = new Array<number>(57).fill(0);
  [D[6], D[7], D[8], D[9]] = p.stats;
  for (const { stat, v } of p.titles ?? []) {                       // FUN_00036a1c: titles on STR / AGI / VIT / INT first
    if (stat >= 6 && stat <= 9) D[stat] += v;
    else if (stat === 0xff) for (let k = 6; k <= 9; k++) D[k] += v;
  }
  const equip = p.equip ?? [p.weapon ? { type: p.cls, sub: 0, grade: 0, base: p.weapon.base, enh: p.weapon.enh, count: 0, reqLevel: 1, sockets: [], options: [] } : null];
  const setCode = [0, 0, 0, 0, 0, 0];
  for (let slot = 0; slot < 6; slot++) {
    const it = equip[slot];
    if (!it || !usable(it, p.level, p.cls)) continue;
    if (slot === 5) { D[12] += it.base; D[13] += it.base; D[14] += it.base; }
    else if (slot >= 1) setCode[slot] = it.grade * 50 + it.sub * 4;
    let armorPct = 100;
    for (const [id, v] of it.options) {
      if (id === 0xff) continue;
      const k = tables?.optionIndex[id] ?? -1;
      if (k >= 0) D[k] += id <= 55 ? v : -v;
      switch (id) {
        case 2: case 33: armorPct += v; break;
        case 36: D[13] += v; D[14] += v; break;
        case 37: D[7] += v; D[8] += v; D[9] += v; break;
        case 45: D[32] += v; D[33] += v; D[34] += v; break;
        case 54: D[53] += v; break;
        case 61: D[13] -= v; D[14] -= v; break;      // text says "increase", the original subtracts
      }
    }
    if (slot >= 1 && slot <= 4) D[2] += (it.enh ? enhBonus(it.base, it.enh) : 0) + rdiv(it.base * armorPct, 100);
  }
  if (tables) {
    const seen = new Set<number>();
    for (let i = 1; i <= 5; i++) {
      const code = setCode[i];
      if (!code || seen.has(code)) continue;
      seen.add(code);
      let n = 0;
      for (let j = 1; j <= 5; j++) if (equip[j] && setCode[j] === code) n++;
      if (n < 2) continue;
      for (const [id, v] of tables.setBonus(Math.trunc(code / 50), equip[i]!.sub, n)) {
        if (id !== 0xff) D[tables.optionIndex[id]] += id === 34 ? 10 * v : v;
      }
    }
    for (const it of equip) {
      if (!it) continue;
      for (let s = 0; s < it.count; s++) {
        const b = it.sockets[s];
        if (b === undefined || b === 0xff) continue;
        const g = Math.trunc(b / 50), sub = b - g * 50, kind = Math.trunc(sub / 5);
        if (kind <= 5) D[[6, 8, 9, 7, 17, 15][kind]] += tables.gemValue(sub % 5, g);
      }
    }
  }
  const e3 = (it: EquipLike | null | undefined) => (it && it.enh ? it.enh ** 3 : -1);
  if (e3(equip[1]) >= 0) D[4] += rdiv(e3(equip[1]), 580) + 1;
  if (e3(equip[2]) >= 0) for (const k of [6, 7, 8, 9]) D[k] += rdiv(e3(equip[2]), 200) + 5;
  if (e3(equip[4]) >= 0) D[44] += rdiv(e3(equip[4]), 200) + 1;
  if (e3(equip[3]) >= 0) D[17] += rdiv(e3(equip[3]), 40) + 5;
  D[10] += 100 + 10 * p.level;
  D[11] += 5 * p.level;
  // FUN_0003750c: ATK and class formulas
  const w = equip[0];
  let atk = w && usable(w, p.level, p.cls) ? w.base + (w.enh ? enhBonus(w.base, w.enh) : 0) : 1;
  atk = rdiv(atk * (100 + D[1]), 100) + p.level;
  const main = c.mainStat === 0 ? D[6] : D[9];
  D[11] += D[9] * 5;
  D[10] += D[8] * c.hpPerVit;
  D[19] += idiv(D[8], c.regenDiv);
  D[4] += idiv(D[7], c.critDiv);
  D[5] += idiv(D[7], c.accDiv);
  if (p.cls !== 1) D[46] += idiv(D[9], 10);
  D[0] = rdiv(atk * (100 + idiv(main * 100, 256)), 100);
  // passives (skills.md §5.2, shared table d+0x210ac, targets d+0x2545e)
  if (p.skills) {
    for (let j = 0; j < 7; j++) {
      const lv = (p.skills[9 + j] ?? 0) + D[53];
      if (lv <= 0) continue;
      const { k, num, den } = PASSIVES[j];
      if (k === 1) D[0] = rdiv((100 + lv * idiv(num, den)) * D[0], 100);
      else if (k === 10 || k === 11) D[k] += idiv(lv * D[k] * idiv(num, den), 100);
      else if (j === 6) D[k] += idiv(lv * num, den);
      else D[k] += lv * idiv(num, den);
    }
  }
  D[2] = rdiv((D[3] + 100) * D[2], 100);
  // FUN_0002b868: the other title bonuses before the buffs (1 ATK %, 3 DEF %, 0xFE all resistances)
  if (p.titles?.length) {
    let ap = 100, dp = 100;
    for (const { stat, v } of p.titles) {
      if (stat === 1) ap += v; else if (stat === 3) dp += v;
      else if (stat === 0xfe) for (let k = 32; k <= 35; k++) D[k] += v;
      else if (stat !== 0xff && (stat < 6 || stat > 9) && stat < 57) D[stat] += v;
    }
    D[0] = rdiv(D[0] * ap, 100); D[2] = rdiv(D[2] * dp, 100);
  }
  // elixir buffs right after the final ATK / DEF (misc-systems.md §1.3): ATK % and DEF % multiply once
  if (p.buffs?.length) {
    let atkPct = 100, defPct = 100;
    for (const { k, v } of p.buffs) {
      if (k === 1) atkPct += v;
      else if (k === 3) defPct += v;
      else if (k === 19 || k === 20) D[k] += v * 10;
      else if (k < 57) D[k] += v;
    }
    D[0] = rdiv(D[0] * atkPct, 100);
    D[2] = rdiv(D[2] * defPct, 100);
  }
  if (p.traits) {                                                    // FUN_0003bdfc: account traits after the buffs, before the caps
    D[10] += p.traits.hp; D[11] += p.traits.mp; D[45] += p.traits.cd; D[24] += p.traits.potion;
    for (let k = 32; k <= 35; k++) D[k] += p.traits.resist;
  }
  D[36] = Math.min(D[36], 75); D[45] = Math.min(D[45], 75); D[48] = Math.min(D[48], 75);
  D[19] += cdiv(D[8], 4);
  D[20] += 1 + cdiv(D[9], 10);
  if (D[2] < 0) D[2] = 0;
  for (const k of [12, 13, 14]) D[k] = Math.max(0, Math.min(200, D[k]));
  return {
    atk: D[0], def: D[2], maxHp: Math.max(1, D[10]), maxMp: Math.max(1, D[11]), crit: D[4], acc: D[5], evade: D[26],
    critDmg: D[44], hpRegen: D[19], mpRegen: D[20], expPct: D[15], goldPct: D[16], luck: D[17], potionPct: D[24],
    potionCdReduction: D[48], D,
  };
}

export interface HitResult {
  miss: boolean;
  crit: boolean;
  dmg: number;
}

/**
 * Player basic attack on a monster (FUN_0006d2f8, game-rules.md §3.1). The basic attack uses
 * ATK x (100 + basic attack %)/100; status-effect and drain options are not applied here.
 */
export function playerHit(rng: Rng, p: { level: number; atk: number; acc: number; crit: number; critDmg: number; basicPct?: number },
  m: { level: number; stunned?: boolean }, skillBase?: number): HitResult {
  const diff = p.level - m.level;
  const acc = diff > 49 ? Math.min(p.acc, 70) : p.acc;
  const base = 50 - 5 * diff;
  const extra = m.stunned ? 0 : -5 * diff + 2 * m.level;
  const roll = rng.rand(10000) + 95 * acc - 10 * (base + extra);
  if (roll <= 0) return { miss: true, crit: false, dmg: 0 };
  const crit = roll < 50 * diff + 100 * p.crit;
  let dmg = skillBase ?? idiv(p.atk * (100 + (p.basicPct ?? 0)), 100);
  if (crit) dmg = rdiv(dmg * (200 + p.critDmg), 100);
  const sq = m.level * m.level;
  dmg = rdiv(dmg * (sq > 51000 ? 30 : 80 - idiv(sq, 1000)), 100);
  dmg = rdiv(dmg * 90 + rng.rand(dmg * 20), 100);
  return { miss: false, crit, dmg };
}

/** Monster attack on the player (FUN_0006f370, game-rules.md §3.3), normal monsters only. */
export function monsterHit(rng: Rng, m: { level: number; atk: number },
  p: { level: number; def: number; evade: number; stunned?: boolean }): HitResult {
  const diff = m.level - p.level;
  const r = p.stunned ? 0 : rng.rand(10000) - Math.max(0, -50 * diff + 100 * p.evade);
  if (r < 0) return { miss: true, crit: false, dmg: 0 };
  const reduce = Math.min(75, idiv(p.def * 75000, (p.level + 30) ** 2 * (p.level + 79)));
  let dmg = rdiv(m.atk * (100 - reduce), 100);
  dmg = rdiv(dmg * 90 + rng.rand(dmg * 20), 100);
  let crit = false;
  if (!(rng.rand(1000) < 5 * diff) && !(rng.rand(1000) < 5 * diff) && r <= 50 * diff + 999) {
    dmg *= 2;
    crit = true;
  }
  return { miss: false, crit, dmg };
}

/** Experience for a kill (FUN_0006ca90): expBonus = actor type byte [4]. */
export function killExp(rng: Rng, mLevel: number, pLevel: number, expBonus: number, expPct = 0, hard = false): number {
  let exp = mLevel * 5 + 8 + expBonus + rng.rand(idiv(mLevel, 3) + 1);
  if (hard) exp = rdiv(exp * 120, 100);                              // before the level-difference term
  exp += (mLevel - pLevel) * (mLevel < 50 ? 1 : mLevel < 80 ? 2 : 3);
  exp = Math.max(1, exp);
  return rdiv(exp * (100 + expPct), 100);
}

/** Gold dropped (FUN_0003b9c8): only when the drop roll lands in the gold band. */
export function dropGold(rng: Rng, mLevel: number, goldPct = 0): number {
  const r = rng.rand(500);
  if (r < 176 || r > 350) return 0;
  return idiv((3 * mLevel + 7 + rdiv(rng.rand(mLevel), 3)) * (100 + goldPct), 100);
}
