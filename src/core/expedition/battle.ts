// 원정(가제): the side-view turn battle an encounter turns into (rules after the 3D prototype's battle).
// Turn order is CTB: every unit's gauge fills by its speed and the first to 100 acts; the order bar shows the next
// turns. The party shares AP: +1 at each of its turns, +1 for a basic attack, +1 for each parry; skills spend it.
// An enemy's attack has a readable windup (its first attack frame held, a ring closing on the target), then its hits
// land on a ms timeline; a parry (±95 ms) or a dodge (wider) is judged by the time of the key press, not by the frame
// it was read on. Each hit has a cue (Move.cues): any defence, dodge only (a red flash) or parry only (black and white,
// ±60 ms, a big counter). Parrying every hit of a move gives a counter and marks the attacker. A broken unit skips its
// next turn and takes ×1.5 damage. With every enemy standing broken the command column is only 총공격 (the whole party
// on all of them at once, bleed burst and marks spent; they get up after it) and 대화 (the hero speaks). A talk that
// wins over a creature of a kind already in the party, or one the party had no room for and let no member go for, pays
// EXP instead (bonusExp, given with the win). A rare creature may run on its turn (§7). The win pays gold besides EXP.
// The decision kit (web/docs/expedition-balance.md §18): statuses (표식, 출혈, 지연, 약화, 방어막, 도발; 절개 bursts
// bleed), attack types and weaknesses (a weakness doubles break and is revealed for the run once struck), and every
// enemy's next action shown (its intent, decided when its turn ends). A boss (Species.boss) announces a charge move
// turns ahead (breaking it first calls it off and pushes its enrage back), changes at its HP phases (moves, summons,
// stone armour, heads standing again) and, the hellhound, fights with three heads, each its own break gauge and move.
// Timing: `now` is the host's ms clock (the same clock as the press times).
import { AVK } from '../keys';
import type { Advantage, Press } from './field';
import type { FieldEnemy } from './field';
import type { Member, Run } from './run';
import { PARTY_MAX, POTION_HEAL } from './run';
import { RARE_GOLD } from './loot';
import { CRIT_MUL, CRIT_RATE, ENEMY_HIT, RARE, SPECIES, TYPE_NAME, effectText, zoneStats, type AtkType, type Cue, type Effect, type Move,
  type Species, type StatusKey } from './species';

export const PARRY_MS = 95, DODGE_MS = 160;
/** a parry-only hit (black and white) is parried within this */
export const PARRY_NARROW_MS = 60;
/** a press that matches no hit locks defense out this long (no mashing) */
const WHIFF_PARRY_MS = 380, WHIFF_DODGE_MS = 300;
/** hits of one move are at least this far apart (room to react between them; kept wide enough for touch, §18.6) */
const MIN_GAP_MS = 300;
/** a hit after a pause this long (or a late move's first) glows LATE_CUE_MS before it */
export const LATE_GAP_MS = 700, LATE_CUE_MS = 350;
/** a late move holds this much longer before its first hit */
const LATE_HOLD_MS = 450;
export const AP_MAX = 9;
/** a talk won over a creature the party cannot take: this many times its EXP */
export const TALK_EXP = 1.5;

/** status numbers (§18.2) */
export const MARK_MUL = 1.5, WEAK_MUL = 0.7, BLEED_MAX = 20, SHIELD_MAX = 3, DELAY_CT = 40, RUPTURE_PART = 0.6;
/** a bleed stack's tick: the applier's attack × this */
const BLEED_PER = 0.3;
/** a perfect parry against a parry-only move: counter power and break, and AP besides each parry's */
const BIG_COUNTER = { power: 2.5, brk: 60, ap: 1 };
/** breaking a boss pushes its enrage back this many turns */
const ENRAGE_BACK = 2;
/** a head's break gauge: the boss's × this */
const HEAD_BRK = 0.45;

/** the EXP a talk pays for a creature the party cannot take */
export function talkExp(e: BUnit): number { return Math.round(((e.field?.stats ?? e.sp?.stats)?.exp ?? 0) * TALK_EXP); }
const CT_FULL = 100;

/** battle keys: confirm / back, and the defense keys (parry also on 확인 for one-handed play) */
export const BK = { PARRY: [AVK.K7, AVK.OK], DODGE: [AVK.K3] } as const;

export type Side = 'party' | 'enemy';

export interface Status {
  mark: boolean;
  bleed: number;
  /** one stack's tick */
  bleedPer: number;
  /** turns of its own still weakened */
  weak: number;
  shield: number;
  /** enemy turns it still draws single-target attacks */
  taunt: number;
}

/** an enemy's next action, shown over it: the move, its target (null: the whole party), the head that does it */
export interface Intent { move: Move; target: BUnit | null; by: BUnit; charge?: boolean }

export interface BUnit {
  id: number;
  side: Side;
  name: string;
  /** species of an enemy or a recruited creature; null for the hero */
  species: number | null;
  sp: Species | null;
  member: Member | null;
  field: FieldEnemy | null;
  lv: number;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  ct: number;
  brk: number;
  brkMax: number;
  broken: boolean;
  /** parries against this enemy (negotiation) */
  rapport: number;
  mood: number;
  talks: number;
  /** recruited / left during the battle: off the field without being beaten */
  gone: boolean;
  /** a rare creature (it may run on its turn), and it ran */
  rare: boolean;
  fled: boolean;
  /** turns it has acted (a broken turn does not count): the boss's enrage clock */
  turns: number;
  enraged: boolean;
  /** an enemy's hits on the party × this (its battle zone, §15); 1 for the party and the boss */
  hitMul: number;
  st: Status;
  /** times it was delayed (a boss halves each next one) */
  delays: number;
  intent: Intent | null;
  /** a boss: its charge's turns left (null: none announced), turns to the next one, the phase reached, the turns its
   *  enrage was pushed back, its once-only move spent, turns since its last armour shield */
  charge: number | null;
  chargeWait: number;
  phase: number;
  enrageBack: number;
  usedOnce: boolean;
  shieldTick: number;
  /** its stone armour went down: the party's next hit breaks ×2 */
  exposed: boolean;
  /** called in by a boss (no talk) */
  summoned: boolean;
  /** a head: the body it belongs to (it has no HP of its own) and its move; a body: its heads */
  body: BUnit | null;
  headMove: Move | null;
  heads: BUnit[];
}

export interface Skill {
  name: string;
  ap: number;
  power: number;
  brk: number;
  all: boolean;
  /** c0 action record the hero plays (creatures play their attack) */
  act: number;
  /** effect bank frames played on the target */
  fx: [number, number];
  desc: string;
  /** an original skill (skillbook.ts): its hit times and length (s), its level and the projectile drawn on the target */
  hits?: number[];
  dur?: number;
  lv?: number;
  proj?: 'boomerang' | 'slider';
  /** its attack type (slash otherwise) and what it does besides damage (§18.5) */
  type?: AtkType;
  effect?: Effect;
}

export const HERO_SKILLS: Skill[] = [
  { name: '일섬', ap: 2, power: 1.7, brk: 22, all: false, act: 4, fx: [0, 5], type: 'slash', effect: { bleed: 2 }, desc: '한 명을 깊게 벤다' },
  { name: '회전베기', ap: 3, power: 1.0, brk: 14, all: true, act: 5, fx: [0, 5], type: 'slash', desc: '적 전원을 벤다' },
  { name: '파쇄격', ap: 4, power: 1.2, brk: 70, all: false, act: 7, fx: [0, 5], type: 'blunt', desc: '브레이크 게이지를 크게 깎는다' },
];
export const BEAST_SKILL: Skill = { name: '돌진', ap: 2, power: 1.6, brk: 20, all: false, act: 0, fx: [0, 5], type: 'blunt', desc: '힘껏 부딪친다' };
/** a recruited creature's own skill by species index (SPECIES), offered before 돌진: by its role (§18.5) — openers put
 *  statuses on, harvesters cash them in, guardians protect */
export const RECRUIT_SKILLS: Record<number, Skill> = {
  0: { name: '휘감기', ap: 2, power: 0.8, brk: 45, all: false, act: 0, fx: [0, 5], type: 'blunt', effect: { delay: true }, desc: '덩굴로 묶어 순서를 늦추고 브레이크를 크게 깎는다' },
  1: { name: '사냥 본능', ap: 3, power: 1.6, brk: 18, all: false, act: 0, fx: [0, 5], type: 'slash', effect: { markBonus: 2 }, desc: '급소를 노린다. 표식이 있으면 두 배' },
  2: { name: '물결 노래', ap: 3, power: 0.7, brk: 12, all: true, act: 0, fx: [0, 5], type: 'magic', effect: { weak: 2 }, desc: '노래의 물결로 적 전원을 약하게 만든다' },
  3: { name: '물보라 방패', ap: 2, power: 0.3, brk: 8, all: true, act: 0, fx: [0, 5], type: 'magic', effect: { allyShield: 1 }, desc: '물방울 막으로 아군 전원을 감싼다' },
  5: { name: '가시 세례', ap: 3, power: 0.6, brk: 18, all: true, act: 0, fx: [0, 5], type: 'pierce', effect: { bleed: 1 }, desc: '가시를 쏟아 적 전원에게 출혈' },
  6: { name: '석상의 일격', ap: 3, power: 1.2, brk: 60, all: false, act: 0, fx: [0, 5], type: 'blunt', effect: { taunt: true }, desc: '적을 내리치고 시선을 자기에게 돌린다' },
  7: { name: '급강하', ap: 3, power: 1.6, brk: 18, all: false, act: 0, fx: [0, 5], type: 'pierce', effect: { markBonus: 2 }, desc: '하늘에서 내리꽂힌다. 표식이 있으면 두 배' },
  8: { name: '모래 폭풍', ap: 2, power: 0.5, brk: 16, all: true, act: 0, fx: [0, 5], type: 'magic', effect: { weak: 2 }, desc: '모래를 휘몰아 적 전원을 약하게 만든다' },
  10: { name: '용암 분출', ap: 3, power: 0.7, brk: 14, all: true, act: 0, fx: [0, 5], type: 'magic', effect: { bleed: 2 }, desc: '용암을 뿜어 적 전원에게 출혈' },
  11: { name: '불꽃 놀이', ap: 3, power: 0.5, brk: 18, all: true, act: 0, fx: [0, 5], type: 'magic', effect: { rupture: true }, desc: '불티로 적 전원의 출혈을 터뜨린다' },
  12: { name: '비룡의 송곳니', ap: 3, power: 2.0, brk: 20, all: false, act: 0, fx: [0, 5], type: 'pierce', effect: { delay: true }, desc: '큰 한 방을 꽂고 순서를 늦춘다' },
};

export const COMMANDS = ['공격', '스킬', '아이템', '대화', '도주'] as const;
export const ALL_OUT = '총공격';
export type Command = (typeof COMMANDS)[number] | typeof ALL_OUT;
/** each standing member's share of 총공격, × attack, on every enemy */
const ALL_OUT_POWER = 0.9;

export type Phase = 'intro' | 'next' | 'command' | 'act' | 'enemy' | 'talk' | 'won' | 'lost' | 'fled';

/** a party action being played: who, what, on whom, how far along */
export interface Act {
  actor: BUnit;
  kind: 'attack' | 'skill' | 'item' | 'counter' | 'flee' | 'allout';
  skill?: Skill;
  targets: BUnit[];
  t: number;
  dur: number;
  hitAt: number;
  done: boolean;
  /** hits landed so far and when the last one did (a skill may hit several times) */
  hitN?: number;
  lastHit?: number;
  /** a counter's power and break */
  power?: number;
  brk?: number;
}

export interface DefHit { t: number; result: 'parry' | 'dodge' | 'hit' | null; cue: Cue; /** it glows before it */ late: boolean }

/** an enemy's attack being defended: its move, its target (null: the whole party), the hits on the ms timeline */
export interface EnemyAct {
  actor: BUnit;
  /** the head doing it (or the actor) */
  by: BUnit;
  move: Move;
  target: BUnit | null;
  /** the windup ends (ms) */
  strikeAt: number;
  hits: DefHit[];
  lockUntil: number;
  /** the last whiff (for the flash) */
  whiff: { kind: 'parry' | 'dodge'; t: number } | null;
  /** after the last hit: end at */
  endAt: number;
  countered: boolean;
  charge: boolean;
}

export interface Popup { unit: BUnit; text: string; kind: 'dmg' | 'heal' | 'parry' | 'dodge' | 'break' | 'info' | 'status'; t: number; crit?: boolean }

let ids = 1;

const noStatus = (): Status => ({ mark: false, bleed: 0, bleedPer: 0, weak: 0, shield: 0, taunt: 0 });

function unit(u: Omit<BUnit, 'id' | 'st' | 'delays' | 'intent' | 'charge' | 'chargeWait' | 'phase' | 'enrageBack' | 'usedOnce' | 'shieldTick' | 'exposed' | 'summoned' | 'body' | 'headMove' | 'heads' | 'ct' | 'brk' | 'broken' | 'rapport' | 'mood' | 'talks' | 'gone' | 'fled' | 'turns' | 'enraged'>): BUnit {
  return { ...u, id: ids++, ct: 0, brk: 0, broken: false, rapport: 0, mood: 0, talks: 0, gone: false, fled: false, turns: 0, enraged: false,
    st: noStatus(), delays: 0, intent: null, charge: null, chargeWait: 0, phase: 0, enrageBack: 0, usedOnce: false, shieldTick: 0, exposed: false,
    summoned: false, body: null, headMove: null, heads: [] };
}

function fromMember(m: Member): BUnit {
  const sp = m.species === null ? null : SPECIES[m.species];
  return unit({ side: 'party', name: m.name, species: m.species, sp, member: m, field: null, lv: m.lv, hp: m.hp, hpMax: m.hpMax,
    atk: m.atk, def: m.def, spd: m.spd, brkMax: 1, rare: false, hitMul: 1 });
}

function fromEnemy(e: FieldEnemy): BUnit {
  const sp = e.sp, s = e.stats ?? sp.stats;                       // zone-scaled (tests pass bare enemies)
  const u = unit({ side: 'enemy', name: sp.name, species: e.species, sp, member: null, field: e, lv: s.lv,
    hp: Math.max(1, Math.round((s.hp * e.hp) / e.hpMax)), hpMax: s.hp, atk: s.atk, def: s.def, spd: s.spd,
    brkMax: sp.field.breakMax, rare: !!e.rare,
    hitMul: sp.tier === 'boss' ? 1 : ENEMY_HIT[Math.max(0, Math.min(ENEMY_HIT.length - 1, Math.round((s.lv - sp.stats.lv) / 2)))] });   // zone power = lv steps of 2
  const pat = sp.boss;
  if (pat) {
    u.chargeWait = 1;                                             // the first charge is announced on its first turn
    u.st.shield = pat.shield ?? 0;
    u.heads = (pat.heads ?? []).map((hd) => {
      const p = unit({ side: 'enemy', name: hd.name, species: e.species, sp, member: null, field: null, lv: u.lv, hp: u.hp, hpMax: u.hpMax,
        atk: u.atk, def: u.def, spd: u.spd, brkMax: Math.round(sp.field.breakMax * HEAD_BRK), rare: false, hitMul: 1 });
      p.body = u;
      p.headMove = hd.move;
      return p;
    });
  }
  return u;
}

/** the unit that carries HP and statuses for u (a head's body) */
const holder = (u: BUnit): BUnit => u.body ?? u;

export class Battle {
  readonly party: BUnit[];
  readonly enemies: BUnit[];
  readonly advantage: Advantage;
  phase: Phase = 'intro';
  /** seconds in the phase */
  t = 0;
  ap = 1;
  actor: BUnit | null = null;
  /** command menu: the level open and its cursor */
  menu: 'main' | 'skill' | 'item' | 'target' = 'main';
  sel = 0;
  subSel = 0;
  targetSel = 0;
  /** what the target picker is for */
  pending: { kind: 'attack' | 'skill' | 'talk'; skill?: Skill } | null = null;
  act: Act | null = null;
  enemyAct: EnemyAct | null = null;
  /** heads still to act this turn (a boss in its all-heads phase) */
  private headQueue: BUnit[] = [];
  popups: Popup[] = [];
  /** a line under the order bar */
  line = '';
  exp = 0;
  /** level-up lines after a win */
  levelUps: string[] = [];
  /** EXP won by talks that could not recruit, given with the win (or on fleeing) */
  bonusExp = 0;
  /** damage the party takes ×this (the night, §8) and the gold of the win ×goldMul (set by the owner) */
  takenMul = 1;
  goldMul = 1;
  /** gold of the win, and the rare creatures beaten in it (each drops a piece of equipment) */
  gold = 0;
  rares: BUnit[] = [];
  /** the run log (§12.1): hits the party took, the damage its bosses' charge moves did */
  hitsTaken = 0;
  roarDmg = 0;
  readonly run: Run;
  private rnd: () => number;
  /** set by the owner: a talk begins with this enemy (negotiation runs outside) */
  onTalk: ((talker: BUnit, enemy: BUnit) => void) | null = null;

  constructor(run: Run, enemies: FieldEnemy[], advantage: Advantage, rnd: () => number = Math.random) {
    this.run = run;
    this.rnd = rnd;
    this.advantage = advantage;
    this.party = run.party.map(fromMember);
    this.enemies = enemies.map(fromEnemy);
    for (const u of this.units) u.ct = rnd() * 30;
    if (advantage === 'party') {
      for (const e of this.enemies) { e.broken = true; e.brk = e.brkMax; for (const hd of e.heads) { hd.broken = true; hd.brk = hd.brkMax; } }
      for (const p of this.party) p.ct += 60;
      this.line = '선제 공격! 적이 모두 브레이크 상태다';
    } else if (advantage === 'enemy') {
      for (const e of this.enemies) e.ct += 60;
      this.line = '기습당했다!';
    } else this.line = `${this.enemies.map((e) => e.name).join(', ')}와(과) 싸운다`;
    for (const e of this.enemies) this.plan(e);
  }

  get units(): BUnit[] { return [...this.party, ...this.enemies]; }
  get liveParty(): BUnit[] { return this.party.filter((u) => u.hp > 0); }
  get liveEnemies(): BUnit[] { return this.enemies.filter((u) => u.hp > 0 && !u.gone); }
  get isBoss(): boolean { return this.enemies.some((e) => e.sp?.tier === 'boss'); }
  /** the boss standing, if any */
  get boss(): BUnit | null { return this.enemies.find((e) => e.sp?.boss && e.hp > 0) ?? null; }

  /** the next n turns as CTB would give them (the order bar); ct: gauges to use instead (a preview) */
  order(n = 7, ct0?: Map<BUnit, number>): BUnit[] {
    const live = this.units.filter((u) => u.hp > 0 && !u.gone);
    const ct = new Map(live.map((u) => [u, ct0?.get(u) ?? u.ct]));
    const acting = this.phase === 'command' || this.phase === 'act' || this.phase === 'enemy' || this.phase === 'talk';
    const out: BUnit[] = acting && this.actor && live.includes(this.actor) ? [this.actor] : [];
    if (ct0 && this.actor && ct.has(this.actor)) ct.set(this.actor, 0);
    while (out.length < n && live.length) {
      let best: BUnit | null = null, bt = Infinity;
      for (const u of live) { const need = (CT_FULL - ct.get(u)!) / Math.max(1, u.spd); if (need < bt) { bt = need; best = u; } }
      for (const u of live) ct.set(u, ct.get(u)! + u.spd * bt);
      out.push(best!);
      ct.set(best!, 0);
    }
    return out;
  }

  /** the order after the action under the cursor, when it delays someone (§18.4); null otherwise */
  preview(n = 7): BUnit[] | null {
    if (this.phase !== 'command') return null;
    const s = this.menu === 'skill' ? this.skills()[this.subSel] : this.menu === 'target' && this.pending?.kind === 'skill' ? this.pending.skill : null;
    if (!s?.effect?.delay) return null;
    const aimed = this.menu === 'target' ? this.targets()[this.targetSel] : null;
    const hit = s.all ? this.liveEnemies : aimed ? [holder(aimed)] : [];
    if (!hit.length) return null;
    const ct = new Map(this.units.map((u) => [u, u.ct]));
    for (const u of hit) if (!u.sp?.immune?.includes('delay')) ct.set(u, ct.get(u)! - this.delayAmount(u));
    return this.order(n, ct);
  }

  private delayAmount(u: BUnit): number { return u.sp?.tier === 'boss' ? DELAY_CT / 2 ** u.delays : DELAY_CT; }

  /** advance the gauges to the next unit's turn */
  private nextTurn(): void {
    const prev = this.actor;
    if (prev && prev.st.weak > 0 && prev.hp > 0) prev.st.weak--;     // its turn is over
    if (prev?.side === 'enemy') for (const p of this.party) if (p.st.taunt > 0) p.st.taunt--;
    if (this.checkEnd()) return;
    const [u] = this.order(1);
    const live = this.units.filter((x) => x.hp > 0 && !x.gone);
    const need = (CT_FULL - u.ct) / Math.max(1, u.spd);
    for (const x of live) x.ct += x.spd * need;
    u.ct = 0;
    this.actor = u;
    this.t = 0;
    if (u.st.bleed > 0) {                                           // bleed ticks at the start of its turn
      const guarded = u.sp?.boss?.guardedBleed && this.liveEnemies.some((e) => e.summoned);
      const d = Math.max(1, Math.round(u.st.bleed * u.st.bleedPer * (guarded ? 0.5 : 1)));
      u.hp = Math.max(0, u.hp - d);
      u.st.bleed--;
      this.pop(u, `출혈 ${d}`, 'dmg');
      this.checkPhase(u);
      if (u.hp <= 0) { this.pop(u, '쓰러짐', 'info'); this.phase = 'next'; return; }
    }
    if (u.broken) {                                       // a broken unit loses this turn and gets up
      u.broken = false;
      u.brk = 0;
      for (const hd of u.heads) { hd.broken = false; hd.brk = 0; }  // a fully broken body gets all its heads back
      this.pop(u, '회복', 'info');
      this.line = `${u.name}이(가) 자세를 바로잡는다`;
      this.phase = 'next';
      if (u.side === 'enemy') this.endEnemyTurn(u, false);
      return;
    }
    if (u.side === 'party') {
      this.ap = Math.min(AP_MAX, this.ap + 1);
      this.phase = 'command';
      this.menu = 'main';
      this.sel = this.allBroken ? 0 : Math.min(this.sel, this.commands().length - 1);
      this.line = `${u.name}의 차례`;
    } else this.startEnemy(u);
  }

  private checkEnd(): boolean {
    if (!this.liveEnemies.length) { this.win(); return true; }
    if (!this.liveParty.length) { this.phase = 'lost'; this.t = 0; this.line = '파티가 쓰러졌다...'; this.sync(); return true; }
    return false;
  }

  private win(): void {
    this.phase = 'won';
    this.t = 0;
    const beaten = this.enemies.filter((e) => !e.gone);
    this.exp = beaten.reduce((s, e) => s + ((e.field?.stats ?? e.sp?.stats)?.exp ?? 0), 0) + this.bonusExp;
    this.gold = Math.round(beaten.reduce((s, e) => s + ((e.field?.stats ?? e.sp?.stats)?.gold ?? 0) * (e.rare ? RARE_GOLD : 1), 0) * this.goldMul);
    this.rares = beaten.filter((e) => e.rare);
    this.run.gold += this.gold;
    this.sync();
    this.levelUps = this.run.award(this.exp);
    this.line = this.exp ? `승리! EXP +${this.exp}${this.gold ? ` · ${this.gold}G` : ''}` : '적이 남지 않았다';
  }

  /** the party's HP back into the run */
  sync(): void {
    for (const u of this.party) if (u.member) u.member.hp = Math.max(0, u.hp);
  }

  pop(unit: BUnit, text: string, kind: Popup['kind'], crit = false): void { this.popups.push({ unit, text, kind, t: 0, crit: crit || undefined }); }

  /** a crit rolled by damage() since the last hurt() (its popup shows it) */
  private critHit = false;

  /** a hit's damage: attack × power ± 10% − defense × 0.6, ×1.5 on the broken, ×0.7 from the weakened; on the party
   *  × the enemy's zone and the night, less its guard; then a 10% crit ×1.8 either way (§15) */
  private damage(from: BUnit, to: BUnit, power: number): number {
    const src = holder(from), base = src.atk * power * (0.9 + this.rnd() * 0.2) - holder(to).def * 0.6;
    const k = to.side === 'party' ? src.hitMul * this.takenMul * (1 - this.run.guard) : 1;
    const crit = this.rnd() < CRIT_RATE;
    if (crit) this.critHit = true;
    return Math.max(1, Math.round(base * (to.broken ? 1.5 : 1) * (src.st.weak > 0 ? WEAK_MUL : 1) * k * (crit ? CRIT_MUL : 1)));
  }

  /** the boss's turns left before it is enraged, or null (no pattern, or already enraged) */
  get enrageIn(): number | null {
    const b = this.boss;
    if (!b || b.enraged) return null;
    return Math.max(0, b.sp!.boss!.enrageAt + b.enrageBack - b.turns);
  }

  /** the boss is enraged */
  get enraged(): boolean { return this.enemies.some((e) => e.enraged && e.hp > 0); }

  /** a hit lands on `to` (a head passes its HP loss to its body): a shield takes it whole; brk goes to the gauge, ×2 on
   *  a weakness (revealed for the run) or on an exposed golem, halved while shielded. Returns whether it got through */
  private hurt(to: BUnit, dmg: number, brk: number, type: AtkType | null = null): boolean {
    const h = holder(to), sh = this.shieldOf(to);
    if (sh.shield > 0) {
      sh.shield--;
      this.pop(to, sh.shield ? '막힘' : '방어막 파괴', 'status');
      if (!sh.shield && sh === h.st && h.sp?.boss?.shield) { h.exposed = true; this.line = `${h.name}의 돌 갑옷이 벗겨졌다! 다음 공격의 브레이크 ×2`; }
      return false;
    }
    h.hp = Math.max(0, h.hp - dmg);
    for (const hd of h.heads) hd.hp = h.hp;
    this.pop(to, this.critHit ? `${dmg}!` : String(dmg), 'dmg', this.critHit);
    this.critHit = false;
    if (to.side === 'enemy' && h.hp > 0 && brk > 0 && !to.broken && !(to.heads.length && !to.body)) {
      let b = brk;
      if (type && h.sp?.weak?.includes(type)) {
        b *= 2;
        const key = `${h.species}:${type}`;
        if (!this.run.seenWeak.has(key)) { this.run.seenWeak.add(key); this.line = `약점 발견: ${h.name} — ${TYPE_NAME[type]}`; }
        this.pop(to, '약점!', 'break');
      }
      if (h.exposed) { b *= 2; h.exposed = false; }
      to.brk = Math.min(to.brkMax, to.brk + b);
      if (to.brk >= to.brkMax) this.breakUnit(to);
    }
    if (to.side === 'enemy') this.checkPhase(h);
    return true;
  }

  /** a unit (or a head) broken: it skips its next turn; a boss's charge is called off and its enrage pushed back */
  private breakUnit(u: BUnit): void {
    u.broken = true;
    this.pop(u, 'BREAK', 'break');
    const b = u.body;
    if (b) {                                                        // a head: its move is gone till the next phase
      const down = b.heads.filter((hd) => hd.broken).length, pat = b.sp!.boss!;
      this.line = `${u.name} 브레이크! (${down}/${b.heads.length})`;
      if (b.charge !== null && down >= (pat.headsToCancel ?? b.heads.length)) this.cancelCharge(b);
      if (down >= b.heads.length) { b.broken = true; b.brk = b.brkMax; this.line = `${b.name}의 머리가 모두 꺾였다! 완전히 무너졌다`; b.enrageBack += ENRAGE_BACK; }
      return;
    }
    this.line = `${u.name} 브레이크! 다음 턴을 쉬고 ×1.5 피해`;
    if (u.sp?.boss) {
      u.enrageBack += ENRAGE_BACK;
      if (u.charge !== null) this.cancelCharge(u);
    }
  }

  private cancelCharge(b: BUnit): void {
    const pat = b.sp!.boss!;
    b.charge = null;
    b.chargeWait = pat.chargeEvery;
    this.pop(b, '차지 취소!', 'break');
    this.line = `${pat.charge.name}을(를) 끊었다!`;
    if (b.intent?.charge) this.plan(b);
  }

  /** a boss crossing an HP phase: its line, moves, summons, armour and heads */
  private checkPhase(u: BUnit): void {
    const pat = u.sp?.boss;
    if (!pat || u.hp <= 0) return;
    while (u.phase < pat.phases.length && u.hp <= u.hpMax * pat.phases[u.phase].at) {
      const ph = pat.phases[u.phase++];
      this.line = ph.line;
      this.pop(u, '페이즈 변화', 'break');
      u.brk = 0;
      if (ph.shield) {
        if (u.heads.length) for (const hd of u.heads) hd.st.shield = Math.min(SHIELD_MAX, ph.shield);
        u.st.shield = Math.min(SHIELD_MAX, u.st.shield + ph.shield);
        u.exposed = false;
      }
      if (ph.reviveHeads) for (const hd of u.heads) { hd.broken = false; hd.brk = 0; }
      for (const s of ph.summon ?? []) this.summon(s, ph.summonPower ?? 0);
    }
  }

  /** a creature called into the battle by a boss */
  private summon(species: number, power: number): void {
    const sp = SPECIES[species], stats = zoneStats(sp.stats, power);
    const e = fromEnemy({ species, sp, stats, hp: stats.hp, hpMax: stats.hp } as unknown as FieldEnemy);
    e.field = null;
    e.summoned = true;
    e.ct = this.rnd() * 40;
    this.enemies.push(e);
    this.plan(e);
    this.pop(e, '등장', 'info');
  }

  /** a head's statuses live on its body, except its shield (each head's own) */
  private shieldOf(u: BUnit): Status { return u.body && u.st.shield > 0 ? u.st : holder(u).st; }

  // --- statuses --------------------------------------------------------------------------------------------------

  /** what an action does besides damage, from src on target (a head passes it to its body) */
  private applyEffect(src: BUnit, target: BUnit, e: Effect | undefined): void {
    if (!e) return;
    const t = holder(target), imm = t.sp?.immune ?? [];
    const has = (k: StatusKey) => !imm.includes(k);
    if (e.bleed && has('bleed') && t.hp > 0) {
      const per = Math.max(1, Math.round(holder(src).atk * BLEED_PER * (t.side === 'party' ? holder(src).hitMul * this.takenMul * (1 - this.run.guard) : 1)));
      t.st.bleed = Math.min(BLEED_MAX, t.st.bleed + e.bleed);
      t.st.bleedPer = Math.max(t.st.bleedPer, per);
      this.pop(target, `출혈 +${e.bleed}`, 'status');
    } else if (e.bleed && !has('bleed')) this.pop(target, '출혈 무효', 'status');
    if (e.rupture && t.st.bleed > 0 && t.hp > 0) {
      const s = t.st.bleed, d = Math.max(1, Math.round(t.st.bleedPer * (s * (s + 1)) / 2 * RUPTURE_PART * (t.broken || target.broken ? 1.5 : 1)));
      t.st.bleed = 0;
      t.hp = Math.max(0, t.hp - d);
      for (const hd of t.heads) hd.hp = t.hp;
      this.pop(target, `절개 ${d}`, 'dmg', true);
      if (t.side === 'enemy') this.checkPhase(t);
    }
    if (e.mark && has('mark') && t.hp > 0) { t.st.mark = true; this.pop(target, '표식', 'status'); }
    if (e.delay && has('delay') && t.hp > 0) this.delay(t);
    if (e.weak && has('weak') && t.hp > 0) { t.st.weak = Math.max(t.st.weak, e.weak); this.pop(target, '약화', 'status'); }
    if (e.allyShield) for (const m of src.side === 'party' ? this.liveParty : this.liveEnemies) m.st.shield = Math.min(SHIELD_MAX, m.st.shield + e.allyShield);
    if (e.taunt) { holder(src).st.taunt = 2; this.pop(src, '도발', 'status'); }
  }

  /** push a unit back in the order (a boss halves each next push in one battle) */
  private delay(u: BUnit): void {
    const n = this.delayAmount(u);
    u.ct -= n;
    if (u.sp?.tier === 'boss') u.delays++;
    this.pop(u, n >= DELAY_CT ? '지연' : `지연 (${Math.round((100 * n) / DELAY_CT)}%)`, 'status');
  }

  // --- the party's turn ------------------------------------------------------------------------------------------

  /** skills of the acting unit */
  skills(u: BUnit | null = this.actor): Skill[] { return !u ? [] : u.species === null ? [...HERO_SKILLS, ...this.run.learned()]
    : RECRUIT_SKILLS[u.species] ? [RECRUIT_SKILLS[u.species], BEAST_SKILL] : [BEAST_SKILL]; }

  /** a skill's line with what it does besides damage */
  skillText(s: Skill): string {
    const ex = effectText(s.effect);
    return `${s.name} · ${TYPE_NAME[s.type ?? 'slash']} · ${s.desc}${ex.length ? ` · ${ex.join(', ')}` : ''}`;
  }

  /** the type of a unit's basic attack */
  attackType(u: BUnit): AtkType { return u.species === null ? 'slash' : u.sp?.atkType ?? 'blunt'; }

  /** why a command cannot be used now, or null */
  blocked(c: Command): string | null {
    if (c === '아이템' && this.run.potions <= 0) return '회복약이 없다';
    if (c === '도주' && this.isBoss) return '도망칠 수 없다';
    if (c === '대화') {
      if (!this.targets(true).length) return this.liveEnemies.find((e) => e.sp?.talk === 'locked')?.sp?.talkReason ?? '말이 통하지 않는다';
      if (!this.talker) return this.allBroken ? '검사가 쓰러져 있다' : '검사만 대화할 수 있다';
    }
    return null;
  }

  /** who speaks for the party: the hero on its own turn, or, while every enemy is broken, the hero standing anywhere */
  get talker(): BUnit | null {
    const hero = this.party.find((u) => u.species === null && u.hp > 0) ?? null;
    return this.actor === hero || this.allBroken ? hero : null;
  }

  /** every enemy still standing is broken: 총공격 is offered */
  get allBroken(): boolean { const l = this.liveEnemies; return l.length > 0 && l.every((e) => e.broken); }

  /** the command column: only 총공격 and 대화 while every enemy is broken */
  commands(): Command[] { return this.allBroken ? [ALL_OUT, '대화'] : [...COMMANDS]; }

  /** why a won-over creature cannot simply join: one of its kind already walks with the party, or the party is full
   *  (a member may be let go for it then); null when it can */
  recruitBlock(e: BUnit): 'kin' | 'full' | null {
    if (this.run.party.some((m) => m.species !== null && m.species === e.species)) return 'kin';
    return this.run.party.length >= PARTY_MAX ? 'full' : null;
  }

  /** a member leaves the party for good (let go to make room for a recruit) */
  release(m: Member): void {
    this.run.party = this.run.party.filter((x) => x !== m);
    const i = this.party.findIndex((u) => u.member === m);
    if (i >= 0) this.party.splice(i, 1);
  }

  private command(c: Command): void {
    if (this.blocked(c)) return;
    if (c === ALL_OUT) this.startAct({ kind: 'allout', targets: this.liveEnemies });
    else if (c === '공격') { this.pending = { kind: 'attack' }; this.openTarget(); }
    else if (c === '스킬') { this.menu = 'skill'; this.subSel = 0; }
    else if (c === '아이템') { this.menu = 'item'; this.subSel = 0; }
    else if (c === '대화') { this.pending = { kind: 'talk' }; this.openTarget(true); }
    else this.flee();
  }

  private openTarget(talk = false): void {
    const list = this.targets(talk);
    if (!list.length) return;
    this.menu = 'target';
    this.targetSel = Math.min(this.targetSel, list.length - 1);
  }

  /** the enemies a picker offers: a boss with heads is picked by its heads (talk: those not locked or called in) */
  targets(talk = this.pending?.kind === 'talk'): BUnit[] {
    if (talk) return this.liveEnemies.filter((e) => e.sp?.talk !== 'locked' && !e.summoned);
    return this.liveEnemies.flatMap((e) => (e.heads.length ? e.heads : [e]));
  }

  private pickTarget(): void {
    const p = this.pending, list = this.targets();
    const tgt = list[this.targetSel];
    if (!p || !tgt) return;
    if (p.kind === 'talk') { this.phase = 'talk'; this.onTalk?.(this.talker!, tgt); return; }
    if (p.kind === 'attack') this.startAct({ kind: 'attack', targets: [tgt] });
    else if (p.skill) this.startAct({ kind: 'skill', skill: p.skill, targets: p.skill.all ? this.spread() : [tgt] });
  }

  /** what a whole-side skill hits: every standing enemy, a boss by each of its heads */
  private spread(): BUnit[] { return this.targets(false); }

  private useSkill(s: Skill): void {
    if (this.ap < s.ap) { this.line = `AP가 부족하다 (${s.name}: AP ${s.ap})`; return; }
    this.pending = { kind: 'skill', skill: s };
    if (s.all) this.startAct({ kind: 'skill', skill: s, targets: this.spread() });
    else this.openTarget();
  }

  private usePotion(target: BUnit): void {
    if (this.run.potions <= 0) return;
    this.run.potions--;
    this.startAct({ kind: 'item', targets: [target] });
  }

  private flee(): void {
    const ok = this.rnd() < (this.advantage === 'enemy' ? 0.4 : 0.65);
    if (ok) {
      this.phase = 'fled'; this.t = 0; this.line = '무사히 도망쳤다'; this.sync();
      if (this.bonusExp) this.levelUps = this.run.award(this.bonusExp);
      return;
    }
    this.line = '도망치지 못했다!';
    this.phase = 'next';
    this.t = 0;
  }

  private startAct(a: { kind: Act['kind']; skill?: Skill; targets: BUnit[] }): void {
    const hs = a.skill?.hits, dur = a.skill?.dur ?? (a.kind === 'item' ? 0.7 : a.kind === 'skill' ? 1.0 : a.kind === 'allout' ? 1.3 : 0.75);
    this.act = { actor: this.actor!, kind: a.kind, skill: a.skill, targets: a.targets, t: 0, dur, hitAt: hs ? hs[0] : a.kind === 'item' ? 0.3 : dur * 0.45, done: false };
    if (a.skill) this.ap -= a.skill.ap;
    this.phase = 'act';
    this.menu = 'main';
    this.pending = null;
    this.t = 0;
    this.line = a.kind === 'allout' ? '총공격!' : a.kind === 'skill' ? `${this.actor!.name}: ${a.skill!.name}!` : a.kind === 'item' ? `회복약 (남은 ${this.run.potions})` : `${this.actor!.name}의 공격`;
  }

  /** land the hits whose time has come (an original skill hits on each of its hit times) */
  private stepAct(a: Act): void {
    while (!a.done && a.t >= a.hitAt) {
      const hs = a.skill?.hits, last = !hs || (a.hitN ?? 0) + 1 >= hs.length;
      this.landAct(a, last);
      a.hitN = (a.hitN ?? 0) + 1;
      a.lastHit = a.t;
      if (hs && a.hitN < hs.length) a.hitAt = hs[a.hitN];
      else a.done = true;
    }
  }

  private landAct(a: Act, last: boolean): void {
    if (a.kind === 'item') {
      for (const u of a.targets) { const n = Math.ceil(u.hpMax * POTION_HEAL); u.hp = Math.min(u.hpMax, u.hp + n); this.pop(u, `+${n}`, 'heal'); }
      return;
    }
    if (a.kind === 'allout') {                              // everyone standing, on every enemy: marks spent, bleed burst; then they get up
      const party = this.liveParty;
      for (const u of a.targets) {
        if (u.hp <= 0) continue;
        const k = u.st.mark ? MARK_MUL : 1;
        u.st.mark = false;
        this.hurt(u, party.reduce((n, p) => n + this.damage(p, u, ALL_OUT_POWER * k), 0), 0);
        this.applyEffect(party[0] ?? u, u, { rupture: true });
        u.broken = false;
        u.brk = 0;
        for (const hd of u.heads) { hd.broken = false; hd.brk = 0; }
      }
      return;
    }
    const e = a.kind === 'skill' ? a.skill!.effect : undefined, single = a.targets.length === 1 && a.kind !== 'counter';
    const type = a.kind === 'skill' ? a.skill!.type ?? 'slash' : this.attackType(a.actor);
    const power0 = a.kind === 'skill' ? a.skill!.power : a.kind === 'counter' ? a.power ?? 1.2 : 1;
    const brk = Math.round((a.kind === 'skill' ? a.skill!.brk : a.kind === 'counter' ? a.brk ?? 25 : 10) * (e?.brkMul ?? 1));
    for (const u of a.targets) {
      if (holder(u).hp <= 0) continue;
      const marked = single && holder(u).st.mark;
      const power = power0 * (marked ? MARK_MUL * (e?.markBonus ?? 1) : 1);
      this.hurt(u, this.damage(a.actor, u, power), brk, type);
    }
    if (a.kind === 'attack') this.ap = Math.min(AP_MAX, this.ap + 1);
    if (!last) return;
    if (single) holder(a.targets[0]).st.mark = false;               // a single-target action spends the mark
    if (e?.allyShield || e?.taunt) this.applyEffect(a.actor, a.actor, { allyShield: e.allyShield, taunt: e.taunt });
    const rest: Effect | undefined = e && { ...e, allyShield: undefined, taunt: undefined };
    const done = new Set<BUnit>();
    for (const u of a.targets) {                                   // a whole-side skill on heads touches the body once
      if (done.has(holder(u))) continue;
      done.add(holder(u));
      this.applyEffect(a.actor, u, rest);
    }
  }

  // --- the enemy's turn ------------------------------------------------------------------------------------------

  /** the host's clock this frame (ms) */
  now = 0;

  /** an enemy decides what it does on its next turn (shown over it) */
  private plan(u: BUnit): void {
    if (u.hp <= 0 || u.gone) { u.intent = null; return; }
    const pat = u.sp!.boss;
    if (pat) {
      if (u.charge === null && u.chargeWait <= 0) {
        u.charge = pat.phases.slice(0, u.phase).reduce((n, ph) => ph.chargeTurns ?? n, pat.chargeTurns);
        this.pop(u, `차지: ${pat.charge.name}`, 'break');
      }
      if (u.charge !== null && u.charge <= 0) { u.intent = { move: pat.charge, target: null, by: u, charge: true }; return; }
      const once = pat.phases.slice(0, u.phase).flatMap((ph) => ph.add).find((m) => m.once);
      if (once && !u.usedOnce) { u.intent = { move: once, target: this.aimAt(once), by: u }; return; }
      if (u.heads.length) {
        const up = u.heads.filter((hd) => !hd.broken);
        const hd = up[Math.floor(this.rnd() * up.length)];
        if (hd) { u.intent = { move: hd.headMove!, target: this.aimAt(hd.headMove!), by: hd }; return; }
      }
    }
    const moves = [...u.sp!.moves, ...(pat?.phases.slice(0, u.phase).flatMap((ph) => ph.add).filter((m) => !m.once) ?? [])];
    // a boss in the second half uses its heaviest move more often
    const move = pat && u.hp < u.hpMax / 2 && this.rnd() < 0.4 ? moves[moves.length - 1] : moves[Math.floor(this.rnd() * moves.length)];
    u.intent = { move, target: this.aimAt(move), by: u };
  }

  /** a single-target move's target: a taunter, else anyone standing */
  private aimAt(m: Move): BUnit | null {
    if (m.all) return null;
    const live = this.liveParty, taunt = live.find((p) => p.st.taunt > 0);
    return taunt ?? live[Math.floor(this.rnd() * live.length)] ?? null;
  }

  /** an enemy's turn is over: a boss's charge and armour clocks run, and it decides its next action */
  private endEnemyTurn(u: BUnit, acted: boolean): void {
    const pat = u.sp?.boss;
    if (pat && acted) {
      if (u.charge !== null) u.charge--;
      else u.chargeWait--;
      const every = pat.phases.slice(0, u.phase).reduce<number | undefined>((n, ph) => ph.shieldEvery ?? n, undefined);
      if (every && ++u.shieldTick >= every) { u.shieldTick = 0; u.st.shield = Math.min(SHIELD_MAX, u.st.shield + 1); this.pop(u, '방어막 +1', 'status'); }
    }
    this.plan(u);
  }

  private startEnemy(u: BUnit): void {
    u.turns++;
    if (u.rare && this.rnd() < RARE.flee) {                         // a rare creature runs: no reward, gone from the field
      u.gone = true;
      u.fled = true;
      this.pop(u, '도망', 'info');
      this.line = `${u.name}이(가) 반짝이며 달아났다!`;
      this.phase = 'next';
      this.t = 0;
      return;
    }
    const pat = u.sp!.boss;
    if (pat && !u.enraged && u.turns > pat.enrageAt + u.enrageBack) {
      u.enraged = true;
      u.atk = Math.round(u.atk * pat.enrageAtk);
      this.pop(u, '광폭화', 'break');
    }
    if (!u.intent) this.plan(u);
    const it = u.intent!;
    if (it.charge) { u.charge = null; u.chargeWait = Math.max(1, pat!.chargeEvery - (u.enraged ? 1 : 0)); }
    if (it.move.once) u.usedOnce = true;
    this.headQueue = pat?.phases.slice(0, u.phase).some((ph) => ph.allHeads) && !it.charge
      ? u.heads.filter((hd) => !hd.broken && hd !== it.by) : [];
    this.startMove(u, it.by, it.move, it.charge ?? false);
  }

  /** an enemy move begins: its target (a taunter takes single-target moves; a fallen target is replaced) and its hits */
  private startMove(u: BUnit, by: BUnit, move: Move, charge: boolean): void {
    let target = move.all ? null : u.intent?.move === move && u.intent.target && u.intent.target.hp > 0 ? u.intent.target : null;
    const taunt = this.liveParty.find((p) => p.st.taunt > 0);
    if (!move.all && taunt && !charge) target = taunt;
    if (!move.all && !target) target = this.aimAt(move);
    const strikeAt = this.now + move.windup * 1000 + 500 + (move.late ? LATE_HOLD_MS : 0);   // a beat to read who is targeted, then the windup
    const hits: DefHit[] = [];
    let at = strikeAt;
    move.hits.forEach((h, i) => {
      const gap = i > 0 ? Math.max(MIN_GAP_MS, (h - move.hits[i - 1]) * 1000) : 0;
      at += gap;
      hits.push({ t: at, result: null, cue: move.cues?.[i] ?? 'any', late: (i === 0 && !!move.late) || gap >= LATE_GAP_MS });
    });
    this.enemyAct = { actor: u, by, move, target, strikeAt, hits, lockUntil: 0, whiff: null, endAt: Infinity, countered: false, charge };
    this.phase = 'enemy';
    this.t = 0;
    const who = by === u ? u.name : `${u.name} ${by.name}`;
    this.line = charge ? `${who}: ${move.name}! 끊지 못했다 — 막아라!` : `${who}: ${move.name} → ${target ? target.name : '파티 전원'}`;
  }

  /** a defense window, × the timing option */
  private window(kind: 'parry' | 'dodge', cue: Cue): number {
    return (kind === 'dodge' ? DODGE_MS : cue === 'parry' ? PARRY_NARROW_MS : PARRY_MS) * this.run.timing;
  }

  /** a defense key at time t (ms): a hit within its window and allowing the key is defended; a key it does not allow (a
   *  parry on a red one, a dodge on a black-and-white one) is a whiff */
  private defend(kind: 'parry' | 'dodge', t: number): void {
    const ea = this.enemyAct;
    if (!ea || t < ea.lockUntil) return;
    const h = ea.hits.find((x) => !x.result && x.cue !== (kind === 'parry' ? 'dodge' : 'parry') && t >= x.t - this.window(kind, x.cue) && t <= x.t + this.window(kind, x.cue));
    if (h) {
      h.result = kind;
      ea.lockUntil = t + 80;
      const shown = ea.target ?? this.liveParty[0] ?? ea.actor;
      if (kind === 'parry') {
        this.ap = Math.min(AP_MAX, this.ap + 1 + (h.cue === 'parry' ? BIG_COUNTER.ap : 0));
        ea.actor.rapport++;
        this.run.parries++;
        this.pop(shown, '패링!', 'parry');
      } else this.pop(shown, '회피', 'dodge');
      return;
    }
    // only a press near a coming hit is a whiff
    if (ea.hits.some((x) => !x.result && x.t - t < 700)) {
      ea.lockUntil = t + (kind === 'parry' ? WHIFF_PARRY_MS : WHIFF_DODGE_MS);
      ea.whiff = { kind, t };
    }
  }

  private enemyFrame(): void {
    const ea = this.enemyAct!;
    for (const h of ea.hits) {
      if (h.result || this.now <= h.t + Math.max(this.window('parry', h.cue), this.window('dodge', h.cue))) continue;
      h.result = 'hit';
      for (const t of ea.target ? (ea.target.hp > 0 ? [ea.target] : this.liveParty.slice(0, 1)) : this.liveParty) {
        const d = this.damage(ea.actor, t, ea.move.power);
        if (!this.hurt(t, d, 0)) continue;
        this.hitsTaken++;
        if (ea.charge) this.roarDmg += d;
        if (t.hp > 0) this.applyEffect(ea.actor, t, ea.move.apply);
        if (t.hp <= 0) this.pop(t, '쓰러짐', 'info');
      }
    }
    if (ea.endAt === Infinity && ea.hits.every((h) => h.result)) {
      ea.endAt = this.now + 450;
      const by = ea.target ?? this.liveParty.find((p) => p.species === null) ?? this.liveParty[0];
      if (ea.hits.every((h) => h.result === 'parry') && by && by.hp > 0 && holder(ea.by).hp > 0) {
        const big = ea.hits.some((h) => h.cue === 'parry');
        ea.countered = true;
        holder(ea.by).st.mark = true;                                // a perfect parry marks the attacker (§18.5)
        this.line = big ? '완벽한 패링! 대반격!' : '완벽한 패링! 반격 · 표식';
        this.act = { actor: by, kind: 'counter', targets: [ea.by], t: 0, dur: 0.6, hitAt: 0.25, done: false,
          power: big ? BIG_COUNTER.power : 1.2, brk: big ? BIG_COUNTER.brk : 25 };
      }
    }
    if (this.now >= ea.endAt && (!this.act || this.act.done)) {
      this.enemyAct = null;
      this.act = null;
      const u = ea.actor, next = this.headQueue.shift();
      if (next && u.hp > 0 && !next.broken && this.liveParty.length) {           // the next head of an all-heads turn
        this.startMove(u, next, next.headMove!, false);
        return;
      }
      this.endEnemyTurn(u, true);
      this.phase = 'next';
      this.t = 0;
    }
  }

  // --- the frame -------------------------------------------------------------------------------------------------

  frame(dt: number, presses: Press[], now: number): void {
    this.now = now;
    this.t += dt;
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < 1.1);
    switch (this.phase) {
      case 'intro':
        if (this.t > 1.0) this.nextTurn();
        break;
      case 'next':
        if (this.t > 0.45) this.nextTurn();
        break;
      case 'command':
        for (const p of presses) this.menuKey(p.key);
        break;
      case 'act': {
        const a = this.act!;
        a.t += dt;
        this.stepAct(a);
        if (a.t >= a.dur) { this.act = null; this.phase = 'next'; this.t = 0; }
        break;
      }
      case 'enemy': {
        for (const p of presses) {
          if ((BK.PARRY as readonly number[]).includes(p.key)) this.defend('parry', p.t);
          else if ((BK.DODGE as readonly number[]).includes(p.key)) this.defend('dodge', p.t);
        }
        if (this.act) {
          const a = this.act;
          a.t += dt;
          this.stepAct(a);
        }
        this.enemyFrame();
        break;
      }
      default:
        break;
    }
  }

  /** a key in the command menu */
  menuKey(k: number): void {
    const n = this.menu === 'main' ? this.commands().length : this.menu === 'skill' ? this.skills().length : this.menu === 'item' ? this.liveParty.length : this.targets().length;
    if (this.menu === 'target') {
      if (k === AVK.LEFT || k === AVK.UP) this.targetSel = (this.targetSel + n - 1) % n;
      else if (k === AVK.RIGHT || k === AVK.DOWN) this.targetSel = (this.targetSel + 1) % n;
      else if (k === AVK.OK) this.pickTarget();
      else if (k === AVK.CLR) { this.menu = this.pending?.kind === 'skill' ? 'skill' : 'main'; this.pending = null; }
      return;
    }
    if (this.menu === 'main') {
      if (k === AVK.UP) this.sel = (this.sel + n - 1) % n;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % n;
      else if (k === AVK.OK) this.command(this.commands()[this.sel]);
      return;
    }
    if (k === AVK.UP) this.subSel = (this.subSel + n - 1) % n;
    else if (k === AVK.DOWN) this.subSel = (this.subSel + 1) % n;
    else if (k === AVK.CLR || k === AVK.LEFT) this.menu = 'main';
    else if (k === AVK.OK) {
      if (this.menu === 'skill') this.useSkill(this.skills()[this.subSel]);
      else this.usePotion(this.liveParty[this.subSel]);
    }
  }

  /** a tapped row: put the cursor there and confirm */
  tap(menu: Battle['menu'], i: number): void {
    if (this.phase !== 'command') return;
    if (menu === 'main') { this.menu = 'main'; this.sel = i; }
    else if (menu === 'target') this.targetSel = i;
    else this.subSel = i;
    this.menuKey(AVK.OK);
  }

  /** a creature that joined fights on the party's side from now */
  addMember(m: Member): BUnit {
    const u = fromMember(m);
    this.party.push(u);
    return u;
  }

  /** the talk ended (negotiation): the enemy may have joined or left; the turn passes */
  endTalk(result: 'joined' | 'bonded' | 'left' | 'failed' | 'angry', enemy: BUnit): void {
    if (result === 'joined' || result === 'bonded' || result === 'left') { enemy.gone = true; enemy.hp = enemy.hp || 1; }
    if (result === 'bonded') this.bonusExp += talkExp(enemy);
    if (result === 'angry') { enemy.ct = CT_FULL - 1; }
    this.phase = 'next';
    this.t = 0;
    this.menu = 'main';
    this.pending = null;
  }

  /** an enemy's intent as short words (its bubble): the move, how many hits, on whom, what it puts on */
  intentText(u: BUnit): string | null {
    const it = u.intent;
    if (!it || u.hp <= 0 || u.gone) return null;
    if (it.charge) return `⚡ ${it.move.name}! 전원 ${it.move.hits.length}연타`;
    const n = it.move.hits.length, ex = effectText(it.move.apply);
    const cue = it.move.cues?.includes('parry') ? ' ◐' : it.move.cues?.includes('dodge') ? ' ◆' : '';
    return `${it.by !== u ? `${it.by.name}: ` : ''}${n > 1 ? `${n}연타` : '공격'} → ${it.target ? it.target.name : '전원'}${ex.length ? ` · ${ex.join(', ')}` : ''}${cue}`;
  }

  /** a unit's statuses as [key, label] (its icons), a head's own shield and its body's others */
  statuses(u: BUnit): [StatusKey, string][] {
    const s = holder(u).st, out: [StatusKey, string][] = [];
    const sh = this.shieldOf(u).shield;
    if (s.mark) out.push(['mark', '표']);
    if (s.bleed) out.push(['bleed', `혈${s.bleed}`]);
    if (s.weak) out.push(['weak', `약${s.weak}`]);
    if (sh) out.push(['shield', `막${sh}`]);
    if (s.taunt) out.push(['taunt', '도']);
    return out;
  }
}
