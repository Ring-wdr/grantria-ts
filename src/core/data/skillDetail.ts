// Skill detail MENUPOP 2 texts (FUN_0004f6a8(2), drawn by FUN_0002daec). Checked line by line against
// the original code run in the emulator: analysis/features/data/skills/detail.json
// (tools/grantria_skilldetail.py, tests/skilldetail.test.ts).
//
// footer (drawn under text 0x1A3F while below max level): the point cost, then for actives past the
// first tier the prerequisite (the skill above in the branch at 5) and the character level, red (|c)
// while unmet. body: the values at the effective level, then "다음 레벨" and the next level's values;
// before learning, the level-1 values only; at max effective level, the current values only.

/** d.dat / text access (Assets satisfies it) */
export interface DetailData {
  d8(off: number): number;
  d16(off: number): number;
  text: string[];
}

export interface SkillDetailState {
  cls: number;
  /** 0 active, 1 passive, 2 trait */
  sub: number;
  /** cell index, 0-based */
  idx: number;
  learned: number;
  /** effective level (actives: + all-active / element bonuses, passives: + passive bonus) */
  eff: number;
  /** skill points (actives / passives) */
  points: number;
  level: number;
  /** learned level of active cell i (prerequisites) */
  learnedOf(i: number): number;
}

export interface SkillDetail {
  desc: string;
  footer: string[];
  body: string[];
  /** max level reached: the footer is not drawn */
  maxed: boolean;
}

/** passive per-level amounts (shared table d+0x210ac, rules.ts PASSIVES): value = level * amount */
const PASSIVE_PER = [2, 2, 2, 1, 1, 1, 0.5];
/** trait per-level amounts (account.ts TRAIT_PER) and their item-option texts (1972 + option id) */
const TRAIT_PER = [100, 100, 4, 4, 4, 1, 1, 4, 1, 1, 1, 4];
const TRAIT_TEXT = [0x7be, 0x7bf, 0x7e8, 0x7f5, 0x7f6, 0x7f7, 0x7f8, 0x7f9, 0x7fa, 0x7fb, 0x7e1, 0x7e7];

/**
 * Character level an active skill cell requires (tier 0 / 1 / 2 = 0 / 20 / 50): the u16 at
 * d.dat 0x2115C + class*234 + idx*26, i.e. 4 bytes before the cell's record (FUN_00056e4c popup 0x2A,
 * FUN_0004f6a8(2) "%d레벨 이상 필요."). Not rec[11] of the cell's own record, which is the next cell's.
 */
export function skillReqLevel(a: Pick<DetailData, 'd16'>, cls: number, idx: number): number {
  return a.d16(0x2115c + cls * 234 + idx * 26);
}

/** the original's sprintf for the few conversions these texts use (%d %s %% %.1f) */
export function cfmt(f: string, ...args: (number | string)[]): string {
  let i = 0;
  return f.replace(/%(%|d|s|\.1f)/g, (_m, c: string) => {
    if (c === '%') return '%';
    const v = args[i++];
    return c === '.1f' ? (v as number).toFixed(1) : String(v ?? '');
  });
}

export function skillDetail(a: DetailData, s: SkillDetailState): SkillDetail {
  const t = a.text, { cls, sub, idx, learned } = s;
  const max = sub === 2 ? 5 : 10;
  const rec = (i: number) => a.d16(0x21160 + cls * 234 + idx * 26 + i * 2);

  let desc: number, cost = 1;
  if (sub === 0) { desc = 0xcca + cls * 9 + idx; cost = a.d8(0x24695 + Math.trunc(idx / 3) * 10 + learned); }
  else if (sub === 1) desc = 0xcc3 + idx;
  else desc = 0xce5 + idx;

  const footer = [cfmt(t[sub === 0 && s.points < cost ? 0x1b03 : 0x1b04] ?? '', cost)];   // red for actives only
  if (sub === 0 && idx >= 3) {
    const pre = idx - 3;
    footer.push(cfmt(t[0xcf1] ?? '', s.learnedOf(pre) >= 5 ? '|b' : '|c', t[0xc9c + cls * 9 + pre] ?? '', 5));
    const req = skillReqLevel(a, cls, idx);
    footer.push(cfmt(t[0xcf2] ?? '', s.level >= req ? '|b' : '|c', req));
  }

  /** lines for level L; next = the "다음 레벨" variant (a few passives colour it differently) */
  const values = (L: number, next: boolean): string[] => {
    if (sub === 0) return [cfmt(t[0xcf3] ?? '', rec(0) + (L - 1) * rec(3), ''), cfmt(t[0xcf4] ?? '', rec(1) + (L - 1) * rec(4))];
    if (sub === 2) return [cfmt(t[TRAIT_TEXT[idx]] ?? '', L * TRAIT_PER[idx])];
    const v = L * PASSIVE_PER[idx];
    switch (idx) {
      case 0: return [`공격력 +${v}%`];
      case 1: return [`${next ? '|j' : ''}HP +${v}%`];
      case 2: return [`${next ? '|j' : ''}MP +${v}%`];
      case 3: return [`크리티컬 +${v}%`];
      case 4: return [`방어력 +${v}%`];
      case 5: return [`적중률 +${v}%`];
      default: return [cfmt(t[next ? 0x1b08 : 0x1b05] ?? '', v)];
    }
  };
  const body = learned === 0 ? values(1, false)
    : s.eff >= max ? values(s.eff, false)                        // no next level once the effective level is at max
      : [...values(s.eff, false), '', t[0xcf5] ?? '', '', ...values(s.eff + 1, true)];
  return { desc: t[desc] ?? '', footer, body, maxed: learned >= max };
}
