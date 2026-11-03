// 원정(가제): the creatures of the three stages, this mode's own table. The sprites are the original monsters of the
// stage's maps (cmf_cN: stage 1 the t3 초원·호수, stage 2 the t4 카라스 사막, stage 3 the t6 벨루카 화산, with the
// wyvern of the 크레이그 협곡); stats, field behaviour, battle moves and temperament are this mode's and owe nothing to the
// main game's monster records. A later stage's creatures have stage-1-sized base stats: zoneStats raises them by the
// zone's power (3..5 in stage 2, 6..8 in stage 3), so every stage continues one curve.

export type Personality = 'timid' | 'childish' | 'proud' | 'curious' | 'honorable';
export type Tier = 'weak' | 'normal' | 'boss';

/** attack types (web/docs/expedition-balance.md §18.3): a hit of a type the target is weak to breaks it twice as fast */
export type AtkType = 'slash' | 'pierce' | 'blunt' | 'magic';
export const TYPE_NAME: Record<AtkType, string> = { slash: '베기', pierce: '찌르기', blunt: '타격', magic: '마법' };

/** the statuses (§18.2); 절개 is an effect, not a status */
export type StatusKey = 'mark' | 'bleed' | 'delay' | 'weak' | 'shield' | 'taunt';

/** what an action does besides its damage (§18.2, §18.5): on each target it hits (self / ally ones on the user's side) */
export interface Effect {
  /** bleed stacks put on */
  bleed?: number;
  mark?: boolean;
  delay?: boolean;
  /** 약화 for this many of its turns */
  weak?: number;
  /** 절개: the remaining bleed at once */
  rupture?: boolean;
  /** ×this on a marked target (a harvester's skill), on top of the mark */
  markBonus?: number;
  /** break ×this */
  brkMul?: number;
  /** shields on every standing member of the user's side */
  allyShield?: number;
  /** the user taunts (enemy single-target moves go to it) */
  taunt?: boolean;
}

export const STATUS_NAME: Record<StatusKey, string> = { mark: '표식', bleed: '출혈', delay: '지연', weak: '약화', shield: '방어막', taunt: '도발' };
export const STATUS_DESC: Record<StatusKey, string> = {
  mark: '다음 단일 공격의 모든 타격 ×1.5', bleed: '자기 턴마다 스택만큼 피해, 스택 −1', delay: '순서가 뒤로 밀린다',
  weak: '주는 피해 −30%', shield: '맞을 때마다 하나씩 깎이고 그 타격은 0', taunt: '적의 단일 공격을 끌어온다',
};

/** an effect as short words (skill lines, intents) */
export function effectText(e: Effect | undefined): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (e.bleed) out.push(`출혈 ${e.bleed}`);
  if (e.mark) out.push('표식');
  if (e.delay) out.push('지연');
  if (e.weak) out.push(`약화 ${e.weak}턴`);
  if (e.rupture) out.push('절개(출혈 폭발)');
  if (e.markBonus) out.push(`표식이면 ×${e.markBonus}`);
  if (e.brkMul) out.push(`브레이크 ×${e.brkMul}`);
  if (e.allyShield) out.push(`아군 방어막 ${e.allyShield}`);
  if (e.taunt) out.push('도발');
  return out;
}

/** how a hit may be defended (§18.6): any (parry or dodge), dodge only (a red flash), parry only (black and white, a
 *  narrower window, a big counter) */
export type Cue = 'any' | 'dodge' | 'parry';

/** a battle move: hits land at these seconds after the windup ends (a ring closes on each), power × attack */
export interface Move {
  name: string;
  /** windup before the first hit, seconds (the sprite holds its first attack frame) */
  windup: number;
  hits: number[];
  power: number;
  /** fired from where it stands (the species' field shot flies at the target for each hit) */
  shot?: boolean;
  /** every hit lands on the whole party (one defense for all) */
  all?: boolean;
  /** how each hit may be defended (missing: 'any') */
  cues?: Cue[];
  /** a status the move puts on whoever a hit lands on (a defended hit puts nothing) */
  apply?: Effect;
  /** the first hit comes late: it glows (and holds) before it */
  late?: boolean;
  /** the anim record it plays in battle (the species' attack otherwise) */
  anim?: number;
  /** a boss's last-ditch move: used once, on its first turn under 30% */
  once?: boolean;
}

/** a boss phase (§18.6): from this share of HP down, moves added and a rule */
export interface BossPhase {
  at: number;
  line: string;
  add: Move[];
  /** charge turns from here on */
  chargeTurns?: number;
  /** calls these species in, at this zone power */
  summon?: number[];
  summonPower?: number;
  /** gets this many shields (a golem's stone armour; heads: each head) */
  shield?: number;
  /** a shield more every this many turns */
  shieldEvery?: number;
  /** broken heads stand again */
  reviveHeads?: boolean;
  /** each standing head acts in a turn */
  allHeads?: boolean;
}

/** a boss's pattern (§18.6, §18.7): a charge move announced chargeTurns ahead and every chargeEvery of its turns, phases
 *  at HP shares, enrage after enrageAt turns (pushed back by breaks), heads (separate break gauges, one move each) */
export interface BossPattern {
  charge: Move;
  chargeTurns: number;
  chargeEvery: number;
  enrageAt: number;
  enrageAtk: number;
  phases: BossPhase[];
  /** shields at the start (stone armour) */
  shield?: number;
  /** a charge is called off when this many heads are broken (heads), else by breaking the boss */
  heads?: { name: string; move: Move }[];
  headsToCancel?: number;
  /** while summoned creatures stand, its bleed damage is halved */
  guardedBleed?: boolean;
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
  /** one facing only (a boss drawn from the front): its anim records are used as they are */
  fixed?: boolean;
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
  /** its weaknesses (§18.3) and the statuses it ignores */
  weak?: AtkType[];
  immune?: StatusKey[];
  /** the type of its basic attack when it fights for the party (blunt otherwise) */
  atkType?: AtkType;
  desc: string;
}

/** a creature's stats in a deeper battle zone: power 0 in the first, +1 per zone after (bosses are tuned as they are);
 *  gold grows like EXP. HP ×(1 + 0.07·power) and attack ×(1 + 0.02·power) more keep pace with the equipment, which
 *  grows with the zone too (web/docs/expedition-balance.md §19) */
export function zoneStats(s: Species['stats'], power: number): Species['stats'] {
  if (power <= 0) return s;
  return { hp: Math.round(s.hp * (1 + 0.3 * power) * (1 + 0.07 * power)), atk: Math.round(s.atk * (1 + 0.2 * power) * (1 + 0.02 * power)), def: s.def + power,
    spd: s.spd + power, exp: Math.round(s.exp * (1 + 0.4 * power)), lv: s.lv + 2 * power, gold: Math.round(s.gold * (1 + 0.4 * power)) };
}

/** a normal creature's hits on the party ×this at zone power 0..8 (stage 1's battle zones are power 0..2, stage 2's
 *  3..5, stage 3's 6..8); bosses are tuned as they are (web/docs/expedition-balance.md §15, §17: a hit takes 10–15% of a
 *  member at the level a baseline party has there) */
export const ENEMY_HIT = [2.5, 3.5, 4, 4.5, 5, 5.5, 5.5, 6, 6.5] as const;
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
    weak: ['slash', 'magic'],
    desc: '풀숲에 숨어 지나가는 것을 덥석 무는 덩굴. 겁이 많다.',
  },
  {
    name: '초원 사냥꾼', cmf: 13, fourDir: true, anim: { idle: 0, move: 3, attack: 6 }, tier: 'normal', personality: 'honorable',
    field: { speed: 72, detect: 150, windup: 0.6, breakMax: 55, poise: 1, radius: 10,
      shot: { side: 0x49, vert: 0x48, speed: 190, range: 150, lift: 22 } },
    stats: { hp: 70, atk: 11, def: 4, spd: 12, exp: 24, lv: 2, gold: 12 },
    moves: [
      { name: '할퀴기', windup: 0.8, hits: [0], power: 1 },
      { name: '연속 할퀴기', windup: 1.0, hits: [0, 0.5], power: 0.75, apply: { bleed: 1 } },
      { name: '사격', windup: 0.9, hits: [0], power: 1.0, shot: true },
    ],
    weak: ['pierce'], atkType: 'slash',
    desc: '초원을 떠돌며 사냥감을 쫓는 짐승. 정면으로 맞서는 자를 인정한다.',
  },
  {
    name: '물가의 노래꾼', cmf: 27, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'normal', personality: 'curious',
    field: { speed: 55, detect: 150, windup: 0.7, breakMax: 45, poise: 0, radius: 9,
      shot: { side: 0x24, vert: 0x24, speed: 150, range: 210, lift: 24 } },
    stats: { hp: 58, atk: 10, def: 3, spd: 14, exp: 20, lv: 2, gold: 10 },
    moves: [
      { name: '물보라', windup: 0.9, hits: [0], power: 1.1, shot: true },
      { name: '물결 노래', windup: 1.2, hits: [0, 0.45, 0.9], power: 0.55, shot: true, apply: { weak: 2 } },
    ],
    weak: ['blunt'], atkType: 'magic',
    desc: '호숫가에서 노래하는 반인반어. 모르는 것을 보면 못 참는다.',
  },
  {
    name: '물방울 정령', cmf: 28, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'weak', personality: 'childish',
    field: { speed: 48, detect: 100, windup: 0.8, breakMax: 28, poise: 0, radius: 8 },
    stats: { hp: 30, atk: 8, def: 2, spd: 11, exp: 9, lv: 1, gold: 5 },
    moves: [{ name: '물방울 튀기기', windup: 0.8, hits: [0, 0.5], power: 0.6 }],
    weak: ['blunt'], atkType: 'magic',
    desc: '맑은 물에서 태어난 작은 정령. 노는 것을 좋아한다.',
  },
  {
    name: '초원의 왕 흑표', cmf: 14, fourDir: true, anim: { idle: 0, move: 3, attack: 6 }, tier: 'boss', personality: 'proud',
    talk: 'locked', talkReason: '초원의 왕은 말로 꺾이지 않는다',
    field: { speed: 90, detect: 260, windup: 0.55, breakMax: 160, poise: 2, radius: 16, noKill: true },
    stats: { hp: 1500, atk: 44, def: 14, spd: 16, exp: 120, lv: 10, gold: 0 },
    moves: [
      { name: '발톱', windup: 0.75, hits: [0], power: 1.1 },
      { name: '삼연격', windup: 1.0, hits: [0, 0.35, 0.7], power: 0.7 },
      { name: '사냥감 지정', windup: 0.8, hits: [0], power: 0.6, apply: { mark: true } },
    ],
    weak: ['pierce'],
    boss: {
      charge: { name: '포효 돌진', windup: 1.0, hits: [0, 0.4, 0.75, 1.1, 1.45], power: 0.75, all: true, cues: ['dodge'] },
      chargeTurns: 2, chargeEvery: 4, enrageAt: 14, enrageAtk: 1.3, guardedBleed: true,
      phases: [
        { at: 0.6, line: '흑표가 울부짖자 초원의 사냥꾼들이 모여든다!', add: [], summon: [1, 1], summonPower: 2 },
        { at: 0.3, line: '흑표의 눈빛이 바뀌었다. 초원의 왕이 마지막 질주를 준비한다!', chargeTurns: 1,
          add: [{ name: '왕의 질주', windup: 1.2, hits: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 2.1], power: 0.6, once: true,
            cues: ['any', 'any', 'any', 'any', 'any', 'any', 'parry'] }] },
      ],
    },
    desc: '깊은 초원의 주인. 쓰러뜨려야만 지나갈 수 있다.',
  },
  // --- stage 2, 카라스 사막 (t4) ---
  {
    name: '바늘 선인장', cmf: 15, fourDir: true, anim: { idle: 0, move: 3, attack: 6 }, tier: 'weak', personality: 'proud',
    field: { speed: 30, detect: 130, windup: 0.8, breakMax: 32, poise: 0, radius: 9,
      shot: { side: 0x37, vert: 0x36, speed: 170, range: 170, lift: 20 } },
    stats: { hp: 36, atk: 8, def: 3, spd: 8, exp: 11, lv: 1, gold: 6 },
    moves: [
      { name: '가시 찌르기', windup: 0.8, hits: [0], power: 1 },
      { name: '가시 세례', windup: 1.0, hits: [0, 0.35, 0.7], power: 0.45, shot: true, apply: { bleed: 1 } },
    ],
    weak: ['blunt'], atkType: 'pierce',
    desc: '모래 속에 뿌리를 내린 채 걸어 다니는 선인장. 가시만큼 자존심이 세다.',
  },
  {
    name: '유적의 석상', cmf: 16, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'normal', personality: 'honorable',
    field: { speed: 40, detect: 140, windup: 0.9, breakMax: 70, poise: 1, radius: 11 },
    stats: { hp: 86, atk: 11, def: 7, spd: 8, exp: 26, lv: 2, gold: 14 },
    moves: [
      { name: '내려찍기', windup: 1.2, hits: [0], power: 1.3, late: true },
      { name: '돌의 응시', windup: 0.9, hits: [0, 0.6], power: 0.75, apply: { delay: true } },
    ],
    weak: ['blunt'],
    desc: '모래에 묻힌 유적을 지키는 석상. 느리지만 맞서는 자를 똑바로 본다.',
  },
  {
    name: '모래바람 독수리', cmf: 18, fourDir: true, anim: { idle: 0, move: 3, attack: 6 }, tier: 'normal', personality: 'curious',
    field: { speed: 96, detect: 170, windup: 0.55, breakMax: 40, poise: 0, radius: 10 },
    stats: { hp: 54, atk: 11, def: 3, spd: 17, exp: 22, lv: 2, gold: 12 },
    moves: [
      { name: '급강하', windup: 0.6, hits: [0], power: 1.1 },
      { name: '연속 쪼기', windup: 0.8, hits: [0, 0.3, 0.6], power: 0.5, apply: { mark: true } },
    ],
    weak: ['pierce', 'magic'], atkType: 'pierce',
    desc: '사막 위를 맴도는 커다란 독수리. 반짝이는 것이라면 뭐든 들여다본다.',
  },
  {
    name: '모래 정령', cmf: 19, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'weak', personality: 'childish',
    field: { speed: 50, detect: 100, windup: 0.8, breakMax: 28, poise: 0, radius: 9 },
    stats: { hp: 32, atk: 8, def: 2, spd: 12, exp: 10, lv: 1, gold: 5 },
    moves: [{ name: '모래 뿌리기', windup: 0.8, hits: [0, 0.4], power: 0.6 }],
    weak: ['magic'], atkType: 'magic',
    desc: '바람에 날린 모래가 뭉쳐 생긴 정령. 장난을 좋아한다.',
  },
  {
    name: '봉인의 골렘', cmf: 20, fourDir: false, anim: { idle: 0, move: 0, attack: 2 }, tier: 'boss', personality: 'honorable',
    talk: 'locked', talkReason: '봉인을 지키는 골렘에게는 말이 닿지 않는다',
    field: { speed: 60, detect: 260, windup: 0.8, breakMax: 220, poise: 2, radius: 18, noKill: true },
    stats: { hp: 4000, atk: 72, def: 18, spd: 17, exp: 260, lv: 20, gold: 0 },
    moves: [
      { name: '철퇴 휘두르기', windup: 0.9, hits: [0], power: 1.2, late: true, anim: 2 },
      { name: '연타', windup: 1.1, hits: [0, 0.5], power: 0.8, anim: 4 },
    ],
    weak: ['blunt'], immune: ['bleed'],
    boss: {
      charge: { name: '대지의 가시', windup: 1.3, hits: [0, 0.35, 0.7, 1.05, 1.4, 2.0], power: 0.7, all: true, anim: 8,
        cues: ['any', 'any', 'any', 'any', 'any', 'parry'] },
      chargeTurns: 3, chargeEvery: 5, enrageAt: 14, enrageAtk: 1.3, shield: 3,
      phases: [
        { at: 0.6, line: '골렘의 돌 갑옷이 다시 차오른다!', shield: 3, shieldEvery: 3,
          add: [{ name: '대지 강타', windup: 1.4, hits: [0], power: 1.7, cues: ['dodge'], anim: 4 }] },
        { at: 0.3, line: '봉인이 흔들린다. 골렘이 대지를 깨우려 한다!', chargeTurns: 2, add: [] },
      ],
    },
    desc: '사막의 봉인을 지키는 돌 골렘. 쓰러뜨려야만 봉인 너머로 갈 수 있다.',
  },
  // --- stage 3, 벨루카 화산 (t6) ---
  {
    name: '용암 정령', cmf: 30, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'weak', personality: 'timid',
    field: { speed: 42, detect: 100, windup: 0.75, breakMax: 34, poise: 0, radius: 10 },
    stats: { hp: 38, atk: 8, def: 3, spd: 9, exp: 11, lv: 1, gold: 6 },
    moves: [{ name: '용암 튀기기', windup: 0.9, hits: [0, 0.5], power: 0.65 }],
    weak: ['blunt'], atkType: 'magic',
    desc: '뜨거운 용암이 엉겨 생긴 정령. 차가운 것을 무서워한다.',
  },
  {
    name: '불의 정령', cmf: 31, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'normal', personality: 'childish',
    field: { speed: 58, detect: 160, windup: 0.7, breakMax: 46, poise: 0, radius: 10,
      shot: { side: 0x18, vert: 0x1a, speed: 180, range: 200, lift: 22 } },
    stats: { hp: 58, atk: 11, def: 3, spd: 14, exp: 21, lv: 2, gold: 11 },
    moves: [
      { name: '불덩이', windup: 0.9, hits: [0], power: 1.1, shot: true },
      { name: '불꽃 춤', windup: 1.1, hits: [0, 0.4, 0.8], power: 0.5, shot: true, apply: { bleed: 1 } },
    ],
    weak: ['magic', 'pierce'], atkType: 'magic',
    desc: '용암 속에 숨어 있다가 지나가는 이에게 불을 던지는 정령. 놀이인 줄 안다.',
  },
  {
    name: '화산 와이번', cmf: 33, fourDir: false, anim: { idle: 0, move: 2, attack: 4 }, tier: 'normal', personality: 'proud',
    field: { speed: 92, detect: 180, windup: 0.55, breakMax: 52, poise: 1, radius: 11 },
    stats: { hp: 66, atk: 11, def: 4, spd: 15, exp: 25, lv: 2, gold: 13 },
    moves: [
      { name: '물어뜯기', windup: 0.7, hits: [0], power: 1.15 },
      { name: '날개 후려치기', windup: 0.9, hits: [0, 0.45], power: 0.75, apply: { delay: true } },
    ],
    weak: ['pierce'], atkType: 'pierce',
    desc: '협곡에서 화산까지 날아든 와이번. 제 날개를 무엇보다 자랑스러워한다.',
  },
  {
    name: '화염의 지옥견', cmf: 32, fourDir: false, fixed: true, anim: { idle: 0, move: 0, attack: 1 }, tier: 'boss', personality: 'proud',
    talk: 'locked', talkReason: '지옥견의 세 머리는 누구의 말도 듣지 않는다',
    field: { speed: 80, detect: 260, windup: 0.6, breakMax: 260, poise: 2, radius: 22, noKill: true },
    stats: { hp: 7000, atk: 102, def: 22, spd: 19, exp: 400, lv: 30, gold: 0 },
    moves: [{ name: '할퀴기', windup: 0.75, hits: [0], power: 1.1, anim: 1 }],
    weak: ['pierce'],
    boss: {
      charge: { name: '지옥의 불길', windup: 1.4, hits: [0, 0.35, 0.7, 1.05, 1.4, 1.75], power: 0.7, all: true, anim: 3,
        cues: ['any', 'dodge', 'any', 'dodge', 'any', 'parry'] },
      chargeTurns: 3, chargeEvery: 4, enrageAt: 14, enrageAtk: 1.3, headsToCancel: 2,
      heads: [
        { name: '왼쪽 머리', move: { name: '화염 숨결', windup: 1.0, hits: [0], power: 0.9, all: true, cues: ['dodge'], apply: { bleed: 2 }, anim: 3 } },
        { name: '가운데 머리', move: { name: '세 번 물기', windup: 1.0, hits: [0, 0.35, 0.7], power: 0.75, cues: ['parry', 'parry', 'parry'], anim: 2 } },
        { name: '오른쪽 머리', move: { name: '위협의 포효', windup: 1.1, hits: [0], power: 0.6, all: true, apply: { weak: 2 }, anim: 1 } },
      ],
      phases: [
        { at: 0.6, line: '부러진 머리가 다시 고개를 든다! 세 머리가 불꽃을 두른다', add: [], reviveHeads: true, shield: 1 },
        { at: 0.3, line: '지옥견이 날뛴다. 남은 머리가 모두 덤벼든다!', add: [], allHeads: true, chargeTurns: 2 },
      ],
    },
    desc: '지옥의 불에서 태어난 세 머리의 개. 화산 가장 깊은 곳을 지킨다.',
  },
];

/** the species of stage 1's battle zones and its boss (stages.ts lists every stage's) */
export const FIELD_SPECIES = [0, 1, 2, 3];
export const BOSS_SPECIES = 4;

/** facing row of a sprite direction (left / right / up / down): four-way down 0, side 1, up 2; two-way front 0, back 1 */
export function animRec(sp: Species, base: number, dir: number, lastV: 2 | 3): number {
  if (sp.fixed) return base;
  if (sp.fourDir) return base + [1, 1, 2, 0][dir];
  return base + (dir === 2 || (dir < 2 && lastV === 2) ? 1 : 0);
}
