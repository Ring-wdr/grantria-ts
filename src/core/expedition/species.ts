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
  stats: { hp: number; atk: number; def: number; spd: number; exp: number; lv: number };
  moves: Move[];
  desc: string;
}

/** a creature's stats in a deeper battle zone: power 0 in the first, +1 per zone after (bosses are tuned as they are) */
export function zoneStats(s: Species['stats'], power: number): Species['stats'] {
  if (power <= 0) return s;
  return { hp: Math.round(s.hp * (1 + 0.3 * power)), atk: Math.round(s.atk * (1 + 0.2 * power)), def: s.def + power,
    spd: s.spd + power, exp: Math.round(s.exp * (1 + 0.4 * power)), lv: s.lv + 2 * power };
}

export const SPECIES: Species[] = [
  {
    name: '가시덩굴', cmf: 12, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'weak', personality: 'timid',
    field: { speed: 38, detect: 90, windup: 0.75, breakMax: 30, poise: 0, radius: 9 },
    stats: { hp: 34, atk: 7, def: 2, spd: 8, exp: 10, lv: 1 },
    moves: [{ name: '덩굴 채찍', windup: 0.9, hits: [0], power: 1 }],
    desc: '풀숲에 숨어 지나가는 것을 덥석 무는 덩굴. 겁이 많다.',
  },
  {
    name: '초원 사냥꾼', cmf: 13, fourDir: true, anim: { idle: 0, move: 3, attack: 6 }, tier: 'normal', personality: 'honorable',
    field: { speed: 72, detect: 150, windup: 0.6, breakMax: 55, poise: 1, radius: 10,
      shot: { side: 0x49, vert: 0x48, speed: 190, range: 150, lift: 22 } },
    stats: { hp: 70, atk: 11, def: 4, spd: 12, exp: 24, lv: 2 },
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
    stats: { hp: 58, atk: 10, def: 3, spd: 14, exp: 20, lv: 2 },
    moves: [
      { name: '물보라', windup: 0.9, hits: [0], power: 1.1, shot: true },
      { name: '물결 노래', windup: 1.2, hits: [0, 0.45, 0.9], power: 0.55, shot: true },
    ],
    desc: '호숫가에서 노래하는 반인반어. 모르는 것을 보면 못 참는다.',
  },
  {
    name: '물방울 정령', cmf: 28, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'weak', personality: 'childish',
    field: { speed: 48, detect: 100, windup: 0.8, breakMax: 28, poise: 0, radius: 8 },
    stats: { hp: 30, atk: 8, def: 2, spd: 11, exp: 9, lv: 1 },
    moves: [{ name: '물방울 튀기기', windup: 0.8, hits: [0, 0.5], power: 0.6 }],
    desc: '맑은 물에서 태어난 작은 정령. 노는 것을 좋아한다.',
  },
  {
    name: '초원의 왕 흑표', cmf: 14, fourDir: true, anim: { idle: 0, move: 3, attack: 6 }, tier: 'boss', personality: 'proud',
    talk: 'locked', talkReason: '초원의 왕은 말로 꺾이지 않는다',
    field: { speed: 90, detect: 260, windup: 0.55, breakMax: 160, poise: 2, radius: 16, noKill: true },
    stats: { hp: 320, atk: 15, def: 6, spd: 15, exp: 120, lv: 5 },
    moves: [
      { name: '발톱', windup: 0.75, hits: [0], power: 1.1 },
      { name: '삼연격', windup: 1.0, hits: [0, 0.45, 0.9], power: 0.7 },
      { name: '포효 돌진', windup: 1.4, hits: [0], power: 1.8 },
    ],
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
