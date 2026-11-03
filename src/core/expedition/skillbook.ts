// 원정(가제): the 검사's active skills of the original (c0, analysis/features/skills.md §0.3), found as drops in this
// mode (web/docs/expedition-balance.md §16). Names and damage percents (the basic attack is 100) with their per-level
// steps are read from the game data when a run starts (loadSkills: text 0xC9C + s, the record at d.dat 0x21160 + 26·s,
// the one the skill tab reads); what is here is this mode's own: the tier, the action record played, the hit ticks
// (side view), one enemy or all (decided on 2026-10-28 from the original hit boxes: wide or circling ones hit all),
// the projectile drawn and the line under the menu. Passives and traits are left out.
import type { Assets } from '../data/assets';
import type { Skill } from './battle';
import type { AtkType, Effect } from './species';

export interface SkillDef {
  /** the original skill number s (0..8) */
  id: number;
  /** from the game data (loadSkills): the name, and the damage % of attack per hit at Lv 1 with its step per level */
  name: string;
  dmg: [number, number];
  /** the original tier (row: required Lv 0 / 20 / 50) */
  tier: 0 | 1 | 2;
  /** the action's length and its hit ticks (50 ms each) */
  ticks: number;
  hits: number[];
  /** c0 action record the hero plays (the original player action − 1) */
  act: number;
  all: boolean;
  /** a projectile drawn on the target (cmf_c0 frames): skill 5's circling sword, skill 6's sword mark */
  proj?: 'boomerang' | 'slider';
  /** its attack type and what it does besides damage (web/docs/expedition-balance.md §18.5) */
  type: AtkType;
  effect?: Effect;
  desc: string;
}

/** AP by tier (2026-10-28: the original coefficients, balanced by AP) */
export const SKILL_AP = [3, 4, 6] as const;
/** the original's highest learned level */
export const SKILL_MAX = 10;
/** a drop of a skill already at SKILL_MAX turns into this much gold, by tier */
export const SKILL_MAX_GOLD = [60, 120, 200] as const;
const TICK = 0.05;

export const SKILLBOOK: SkillDef[] = [
  { id: 0, name: '', dmg: [100, 0], tier: 0, ticks: 16, hits: [9], act: 3, all: false, type: 'blunt', effect: { delay: true }, desc: '돌진해 어깨로 들이받는다' },
  { id: 1, name: '', dmg: [100, 0], tier: 0, ticks: 22, hits: [15], act: 6, all: true, type: 'slash', effect: { bleed: 1 }, desc: '검을 크게 휘둘러 주위를 벤다' },
  { id: 2, name: '', dmg: [100, 0], tier: 0, ticks: 19, hits: [5, 7, 10, 12, 15, 17], act: 9, all: false, type: 'pierce', desc: '검을 비틀어 여섯 번 찌른다' },
  { id: 3, name: '', dmg: [100, 0], tier: 1, ticks: 16, hits: [8], act: 4, all: false, type: 'pierce', effect: { mark: true }, desc: '빠르게 파고들어 벤다' },
  { id: 4, name: '', dmg: [100, 0], tier: 1, ticks: 18, hits: [11, 12, 13, 14], act: 7, all: true, type: 'magic', effect: { weak: 2 }, desc: '바람의 칼날로 앞을 네 번 가른다' },
  // the boomerang circles for 17 ticks from tick 10 and hits whatever it passes: about three times on one standing foe
  { id: 5, name: '', dmg: [100, 0], tier: 1, ticks: 31, hits: [12, 17, 22], act: 10, all: true, proj: 'boomerang', type: 'slash', desc: '검을 던져 주위를 돌게 한다' },
  { id: 6, name: '', dmg: [100, 0], tier: 2, ticks: 15, hits: [8], act: 5, all: false, proj: 'slider', type: 'pierce', effect: { rupture: true }, desc: '미끄러지듯 베고 지나가 검흔을 남긴다' },
  { id: 7, name: '', dmg: [100, 0], tier: 2, ticks: 27, hits: [7, 11, 15, 19, 23], act: 8, all: true, type: 'magic', effect: { delay: true }, desc: '회오리처럼 돌며 다섯 번 벤다' },
  // seen from the side the hammer's box is redrawn and lands four times (skills.md §2.2)
  { id: 8, name: '', dmg: [100, 0], tier: 2, ticks: 22, hits: [12, 14, 16, 18], act: 11, all: false, type: 'blunt', effect: { brkMul: 1.5 }, desc: '검을 내리찍어 땅을 울린다' },
];

/** the 검사's (class 0) skill records: 13 × u16 each, [0] damage %, [3] its step per level */
const SKILL_REC = 0x21160, SKILL_REC_SIZE = 26, SKILL_NAME = 0xc9c;

/** names and damage from the game data, once per run (the table above holds placeholders until then) */
export function loadSkills(a: Pick<Assets, 'd16' | 'text'>): void {
  for (const d of SKILLBOOK) {
    const o = SKILL_REC + d.id * SKILL_REC_SIZE;
    d.name = a.text[SKILL_NAME + d.id] ?? `스킬 ${d.id + 1}`;
    d.dmg = [a.d16(o), a.d16(o + 6)];
  }
}

/** damage % per hit at level lv */
export function skillPct(d: SkillDef, lv: number): number { return d.dmg[0] + (lv - 1) * d.dmg[1]; }

/** the battle skill of a learned one at its level: power per hit = its % / 100, break 10 per hit of power 1 like the
 *  basic attack */
export function skillAt(d: SkillDef, lv: number): Skill {
  const power = skillPct(d, lv) / 100, n = d.hits.length;
  return {
    name: d.name, ap: SKILL_AP[d.tier], power, brk: Math.round(10 * power), all: d.all, act: d.act, fx: [0, 5],
    desc: `${d.desc} · ${d.all ? '적 전원' : '적 하나'}에 ${n > 1 ? `${n}번 ` : ''}${skillPct(d, lv)}%`,
    hits: d.hits.map((t) => t * TICK), dur: d.ticks * TICK, lv, proj: d.proj, type: d.type, effect: d.effect,
  };
}
