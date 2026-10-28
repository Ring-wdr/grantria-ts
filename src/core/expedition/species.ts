// 원정(가제): the creatures of stage 1, this mode's own table. The sprites are the original monsters seen on t3 maps
// (cmf_cN); stats, field behaviour, battle moves and temperament are this mode's and owe nothing to the main game's
// monster records.

export type Personality = 'timid' | 'childish' | 'proud' | 'curious' | 'honorable';
export type Tier = 'weak' | 'normal' | 'boss';

/** a battle move: hits land at these seconds after the windup ends (a ring closes on each), power × attack */
export interface Move {
  name: string;
  /** windup before the first hit, seconds (the sprite holds its first attack frame) */
  windup: number;
  hits: number[];
  power: number;
  /** fired from where it stands (the species' field shot flies at the target for each hit) */
  shot?: boolean;
  /** hits the whole party and cannot be parried or dodged (the boss's 왕의 포효) */
  roar?: boolean;
}

/** a boss's growth check (web/docs/expedition-balance.md §10): an unblockable roar on every roarEvery-th turn it acts,
 *  and after enrageAt such turns attack ×enrageAtk and the roar (at enragePow) every turn */
export interface BossPattern {
  roar: Move;
  roarEvery: number;
  enrageAt: number;
  enrageAtk: number;
  enragePow: number;
}

/** a creature's ranged attack in the field: the projectile frames of its own sprite (as the original fires them) */
export interface Shot {
  /** frame flying sideways (drawn facing left, mirrored to the right) and up / down */
  side: number;
  vert: number;
  /** px / s, and how far it flies */
  speed: number;
  range: number;
  /** drawn this high over the ground it flies along */
  lift: number;
}

export interface Species {
  name: string;
  cmf: number;
  /** four facing rows (down, side, up) or two (front, back) */
  fourDir: boolean;
  /** anim records: idle, move and attack bases (the facing row is added) */
  anim: { idle: number; move: number; attack: number };
  tier: Tier;
  personality: Personality;
  /** 'locked': cannot be talked to (fixed bosses); data, so it can be opened later */
  talk?: 'locked';
  /** reason shown on the greyed 대화 command */
  talkReason?: string;
  field: {
    speed: number;
    detect: number;
    windup: number;
    breakMax: number;
    /** 0: any hit flinches, 1: only heavy hits, 2: never */
    poise: 0 | 1 | 2;
    radius: number;
    /** no field kill (bosses) */
    noKill?: boolean;
    /** shoots from afar (it still lunges at a hero who comes close) */
    shot?: Shot;
  };
  stats: { hp: number; atk: number; def: number; spd: number; exp: number; lv: number; gold: number };
  moves: Move[];
  boss?: BossPattern;
  desc: string;
}

/** a creature's stats in a deeper battle zone: power 0 in the first, +1 per zone after (bosses are tuned as they are);
 *  gold grows like EXP */
export function zoneStats(s: Species['stats'], power: number): Species['stats'] {
  if (power <= 0) return s;
  return { hp: Math.round(s.hp * (1 + 0.3 * power)), atk: Math.round(s.atk * (1 + 0.2 * power)), def: s.def + power,
    spd: s.spd + power, exp: Math.round(s.exp * (1 + 0.4 * power)), lv: s.lv + 2 * power, gold: Math.round(s.gold * (1 + 0.4 * power)) };
}

/** a normal creature's hits on the party ×this in battle zone 1..3 (power 0..2); the boss is tuned as it is
 *  (web/docs/expedition-balance.md §15: a hit takes 10–15% of a member) */
export const ENEMY_HIT = [2.5, 3.5, 4] as const;
/** every hit, either side: this chance of ×CRIT_MUL (§15) */
export const CRIT_RATE = 0.1, CRIT_MUL = 1.8;

/** a rare creature (§7) in battle: HP ×0.7, defense ×1.5; it may run on its turn, and its field break gauge is half */
export const RARE = { hp: 0.7, def: 1.5, flee: 0.35, brk: 0.5 } as const;
export function rareStats(s: Species['stats']): Species['stats'] {
  return { ...s, hp: Math.round(s.hp * RARE.hp), def: Math.round(s.def * RARE.def) };
}

export const SPECIES: Species[] = [
  {
    name: '가시덩굴', cmf: 12, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'weak', personality: 'timid',
    field: { speed: 38, detect: 90, windup: 0.75, breakMax: 30, poise: 0, radius: 9 },
    stats: { hp: 34, atk: 7, def: 2, spd: 8, exp: 10, lv: 1, gold: 5 },
    moves: [{ name: '덩굴 채찍', windup: 0.9, hits: [0], power: 1 }],
    desc: '풀숲에 숨어 지나가는 것을 덥석 무는 덩굴. 겁이 많다.',
  },
  {
    name: '초원 사냥꾼', cmf: 13, fourDir: true, anim: { idle: 0, move: 3, attack: 6 }, tier: 'normal', personality: 'honorable',
    field: { speed: 72, detect: 150, windup: 0.6, breakMax: 55, poise: 1, radius: 10,
      shot: { side: 0x49, vert: 0x48, speed: 190, range: 150, lift: 22 } },
    stats: { hp: 70, atk: 11, def: 4, spd: 12, exp: 24, lv: 2, gold: 12 },
    moves: [
      { name: '할퀴기', windup: 0.8, hits: [0], power: 1 },
      { name: '연속 할퀴기', windup: 1.0, hits: [0, 0.5], power: 0.75 },
      { name: '사격', windup: 0.9, hits: [0], power: 1.0, shot: true },
    ],
    desc: '초원을 떠돌며 사냥감을 쫓는 짐승. 정면으로 맞서는 자를 인정한다.',
  },
  {
    name: '물가의 노래꾼', cmf: 27, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'normal', personality: 'curious',
    field: { speed: 55, detect: 150, windup: 0.7, breakMax: 45, poise: 0, radius: 9,
      shot: { side: 0x24, vert: 0x24, speed: 150, range: 210, lift: 24 } },
    stats: { hp: 58, atk: 10, def: 3, spd: 14, exp: 20, lv: 2, gold: 10 },
    moves: [
      { name: '물보라', windup: 0.9, hits: [0], power: 1.1, shot: true },
      { name: '물결 노래', windup: 1.2, hits: [0, 0.45, 0.9], power: 0.55, shot: true },
    ],
    desc: '호숫가에서 노래하는 반인반어. 모르는 것을 보면 못 참는다.',
  },
  {
    name: '물방울 정령', cmf: 28, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'weak', personality: 'childish',
    field: { speed: 48, detect: 100, windup: 0.8, breakMax: 28, poise: 0, radius: 8 },
    stats: { hp: 30, atk: 8, def: 2, spd: 11, exp: 9, lv: 1, gold: 5 },
    moves: [{ name: '물방울 튀기기', windup: 0.8, hits: [0, 0.5], power: 0.6 }],
    desc: '맑은 물에서 태어난 작은 정령. 노는 것을 좋아한다.',
  },
  {
    name: '초원의 왕 흑표', cmf: 14, fourDir: true, anim: { idle: 0, move: 3, attack: 6 }, tier: 'boss', personality: 'proud',
    talk: 'locked', talkReason: '초원의 왕은 말로 꺾이지 않는다',
    field: { speed: 90, detect: 260, windup: 0.55, breakMax: 160, poise: 2, radius: 16, noKill: true },
    stats: { hp: 950, atk: 32, def: 14, spd: 16, exp: 120, lv: 10, gold: 0 },
    moves: [
      { name: '발톱', windup: 0.75, hits: [0], power: 1.1 },
      { name: '삼연격', windup: 1.0, hits: [0, 0.45, 0.9], power: 0.7 },
      { name: '포효 돌진', windup: 1.4, hits: [0], power: 1.8 },
    ],
    boss: { roar: { name: '왕의 포효', windup: 1.2, hits: [0], power: 1.0, roar: true }, roarEvery: 3, enrageAt: 12, enrageAtk: 1.3, enragePow: 1.6 },
    desc: '깊은 초원의 주인. 쓰러뜨려야만 지나갈 수 있다.',
  },
];

/** the species of the battle zones and the boss */
export const FIELD_SPECIES = [0, 1, 2, 3];
export const BOSS_SPECIES = 4;

/** facing row of a sprite direction (left / right / up / down): four-way down 0, side 1, up 2; two-way front 0, back 1 */
export function animRec(sp: Species, base: number, dir: number, lastV: 2 | 3): number {
  if (sp.fourDir) return base + [1, 1, 2, 0][dir];
  return base + (dir === 2 || (dir < 2 && lastV === 2) ? 1 : 0);
}
