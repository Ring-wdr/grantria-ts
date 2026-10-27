// 원정(가제): the side-view turn battle an encounter turns into (rules after the 3D prototype's battle).
// Turn order is CTB: every unit's gauge fills by its speed and the first to 100 acts; the order bar shows the next
// turns. The party shares AP: +1 at each of its turns, +1 for a basic attack, +1 for each parry; skills spend it.
// An enemy's attack has a readable windup (its first attack frame held, a ring closing on the target), then its hits
// land on a ms timeline; a parry (one window, ±95 ms) or a dodge (wider) is judged by the time of the key press, not
// by the frame it was read on. Parrying every hit of a move gives a counter. A broken unit skips its next turn and
// takes ×1.5 damage. With every enemy standing broken the command column is only 총공격 (the whole party on all of
// them at once; they get up after it) and 대화 (the hero speaks, whoever's turn it is). A talk that wins over a creature
// of a kind already in the party, or one the party had no room for and let no member go for, pays EXP instead
// (bonusExp, given with the win). Timing: `now` is the host's ms clock (the same clock as the press times).
import { AVK } from '../keys';
import type { Advantage, Press } from './field';
import type { FieldEnemy } from './field';
import type { Member, Run } from './run';
import { PARTY_MAX, POTION_HEAL } from './run';
import { SPECIES, type Move, type Species } from './species';

export const PARRY_MS = 95, DODGE_MS = 160;
/** a press that matches no hit locks defense out this long (no mashing) */
const WHIFF_PARRY_MS = 380, WHIFF_DODGE_MS = 300;
/** hits of one move are at least this far apart (room to react between them) */
const MIN_GAP_MS = 450;
export const AP_MAX = 9;
/** a talk won over a creature the party cannot take: this many times its EXP */
export const TALK_EXP = 1.5;

/** the EXP a talk pays for a creature the party cannot take */
export function talkExp(e: BUnit): number { return Math.round(((e.field?.stats ?? e.sp?.stats)?.exp ?? 0) * TALK_EXP); }
const CT_FULL = 100;

/** battle keys: confirm / back, and the defense keys (parry also on 확인 for one-handed play) */
export const BK = { PARRY: [AVK.K7, AVK.OK], DODGE: [AVK.K3] } as const;

export type Side = 'party' | 'enemy';

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
}

export const HERO_SKILLS: Skill[] = [
  { name: '일섬', ap: 2, power: 1.7, brk: 22, all: false, act: 4, fx: [0, 5], desc: '한 명을 깊게 벤다' },
  { name: '회전베기', ap: 3, power: 1.0, brk: 14, all: true, act: 5, fx: [0, 5], desc: '적 전원을 벤다' },
  { name: '파쇄격', ap: 4, power: 1.2, brk: 70, all: false, act: 7, fx: [0, 5], desc: '브레이크 게이지를 크게 깎는다' },
];
export const BEAST_SKILL: Skill = { name: '돌진', ap: 2, power: 1.6, brk: 20, all: false, act: 0, fx: [0, 5], desc: '힘껏 부딪친다' };
/** a recruited creature's own skill by species index (SPECIES), offered before 돌진 */
export const RECRUIT_SKILLS: Record<number, Skill> = {
  0: { name: '휘감기', ap: 2, power: 0.8, brk: 45, all: false, act: 0, fx: [0, 5], desc: '덩굴로 묶어 브레이크 게이지를 크게 깎는다' },
  1: { name: '사냥 본능', ap: 3, power: 2.2, brk: 18, all: false, act: 0, fx: [0, 5], desc: '급소를 노려 한 명에게 큰 피해' },
  2: { name: '물결 노래', ap: 3, power: 0.8, brk: 12, all: true, act: 0, fx: [0, 5], desc: '노래의 물결로 적 전원을 친다' },
  3: { name: '물보라 세례', ap: 2, power: 0.6, brk: 16, all: true, act: 0, fx: [0, 5], desc: '물방울을 흩뿌려 적 전원의 브레이크를 깎는다' },
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
}

export interface DefHit { t: number; result: 'parry' | 'dodge' | 'hit' | null }

/** an enemy's attack being defended: its move, its target, the hits on the ms timeline */
export interface EnemyAct {
  actor: BUnit;
  move: Move;
  target: BUnit;
  /** the windup ends (ms) */
  strikeAt: number;
  hits: DefHit[];
  lockUntil: number;
  /** the last whiff (for the flash) */
  whiff: { kind: 'parry' | 'dodge'; t: number } | null;
  /** after the last hit: end at */
  endAt: number;
  countered: boolean;
}

export interface Popup { unit: BUnit; text: string; kind: 'dmg' | 'heal' | 'parry' | 'dodge' | 'break' | 'info'; t: number }

let ids = 1;

function fromMember(m: Member): BUnit {
  const sp = m.species === null ? null : SPECIES[m.species];
  return { id: ids++, side: 'party', name: m.name, species: m.species, sp, member: m, field: null, lv: m.lv, hp: m.hp, hpMax: m.hpMax,
    atk: m.atk, def: m.def, spd: m.spd, ct: 0, brk: 0, brkMax: 1, broken: false, rapport: 0, mood: 0, talks: 0, gone: false };
}

function fromEnemy(e: FieldEnemy): BUnit {
  const sp = e.sp, s = e.stats ?? sp.stats;                       // zone-scaled (tests pass bare enemies)
  return { id: ids++, side: 'enemy', name: sp.name, species: e.species, sp, member: null, field: e, lv: s.lv,
    hp: Math.max(1, Math.round((s.hp * e.hp) / e.hpMax)), hpMax: s.hp, atk: s.atk, def: s.def, spd: s.spd, ct: 0,
    brk: 0, brkMax: sp.field.breakMax, broken: false, rapport: 0, mood: 0, talks: 0, gone: false };
}

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
  popups: Popup[] = [];
  /** a line under the order bar */
  line = '';
  exp = 0;
  /** level-up lines after a win */
  levelUps: string[] = [];
  /** EXP won by talks that could not recruit, given with the win (or on fleeing) */
  bonusExp = 0;
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
      for (const e of this.enemies) { e.broken = true; e.brk = e.brkMax; }
      for (const p of this.party) p.ct += 60;
      this.line = '선제 공격! 적이 모두 브레이크 상태다';
    } else if (advantage === 'enemy') {
      for (const e of this.enemies) e.ct += 60;
      this.line = '기습당했다!';
    } else this.line = `${this.enemies.map((e) => e.name).join(', ')}와(과) 싸운다`;
  }

  get units(): BUnit[] { return [...this.party, ...this.enemies]; }
  get liveParty(): BUnit[] { return this.party.filter((u) => u.hp > 0); }
  get liveEnemies(): BUnit[] { return this.enemies.filter((u) => u.hp > 0 && !u.gone); }
  get isBoss(): boolean { return this.enemies.some((e) => e.sp?.tier === 'boss'); }

  /** the next n turns as CTB would give them (the order bar) */
  order(n = 7): BUnit[] {
    const live = this.units.filter((u) => u.hp > 0 && !u.gone);
    const ct = new Map(live.map((u) => [u, u.ct]));
    const acting = this.phase === 'command' || this.phase === 'act' || this.phase === 'enemy' || this.phase === 'talk';
    const out: BUnit[] = acting && this.actor && live.includes(this.actor) ? [this.actor] : [];
    while (out.length < n && live.length) {
      let best: BUnit | null = null, bt = Infinity;
      for (const u of live) { const need = (CT_FULL - ct.get(u)!) / Math.max(1, u.spd); if (need < bt) { bt = need; best = u; } }
      for (const u of live) ct.set(u, ct.get(u)! + u.spd * bt);
      out.push(best!);
      ct.set(best!, 0);
    }
    return out;
  }

  /** advance the gauges to the next unit's turn */
  private nextTurn(): void {
    if (this.checkEnd()) return;
    const [u] = this.order(1);
    const live = this.units.filter((x) => x.hp > 0 && !x.gone);
    const need = (CT_FULL - u.ct) / Math.max(1, u.spd);
    for (const x of live) x.ct += x.spd * need;
    u.ct = 0;
    this.actor = u;
    this.t = 0;
    if (u.broken) {                                       // a broken unit loses this turn and gets up
      u.broken = false;
      u.brk = 0;
      this.pop(u, '회복', 'info');
      this.line = `${u.name}이(가) 자세를 바로잡는다`;
      this.phase = 'next';
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
    this.exp = this.enemies.filter((e) => !e.gone).reduce((s, e) => s + ((e.field?.stats ?? e.sp?.stats)?.exp ?? 0), 0) + this.bonusExp;
    this.sync();
    this.levelUps = this.run.award(this.exp);
    this.line = this.exp ? `승리! EXP +${this.exp}` : '적이 남지 않았다';
  }

  /** the party's HP back into the run */
  sync(): void {
    for (const u of this.party) if (u.member) u.member.hp = Math.max(0, u.hp);
  }

  pop(unit: BUnit, text: string, kind: Popup['kind']): void { this.popups.push({ unit, text, kind, t: 0 }); }

  private damage(from: BUnit, to: BUnit, power: number): number {
    const base = from.atk * power * (0.9 + this.rnd() * 0.2) - to.def * 0.6;
    return Math.max(1, Math.round(base * (to.broken ? 1.5 : 1)));
  }

  private hurt(to: BUnit, dmg: number, brk: number): void {
    to.hp = Math.max(0, to.hp - dmg);
    this.pop(to, String(dmg), 'dmg');
    if (to.side === 'enemy' && to.hp > 0 && !to.broken && brk > 0) {
      to.brk = Math.min(to.brkMax, to.brk + brk);
      if (to.brk >= to.brkMax) { to.broken = true; this.pop(to, 'BREAK', 'break'); this.line = `${to.name} 브레이크! 다음 턴을 쉬고 ×1.5 피해`; }
    }
  }

  // --- the party's turn ------------------------------------------------------------------------------------------

  /** skills of the acting unit */
  skills(u: BUnit | null = this.actor): Skill[] { return !u ? [] : u.species === null ? HERO_SKILLS
    : RECRUIT_SKILLS[u.species] ? [RECRUIT_SKILLS[u.species], BEAST_SKILL] : [BEAST_SKILL]; }

  /** why a command cannot be used now, or null */
  blocked(c: Command): string | null {
    if (c === '아이템' && this.run.potions <= 0) return '회복약이 없다';
    if (c === '도주' && this.isBoss) return '도망칠 수 없다';
    if (c === '대화') {
      const locked = this.liveEnemies.every((e) => e.sp?.talk === 'locked');
      if (locked) return this.liveEnemies[0]?.sp?.talkReason ?? '말이 통하지 않는다';
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

  /** the enemies a picker offers (talk: those not locked) */
  targets(talk = this.pending?.kind === 'talk'): BUnit[] {
    return this.liveEnemies.filter((e) => !talk || e.sp?.talk !== 'locked');
  }

  private pickTarget(): void {
    const p = this.pending, list = this.targets();
    const tgt = list[this.targetSel];
    if (!p || !tgt) return;
    if (p.kind === 'talk') { this.phase = 'talk'; this.onTalk?.(this.talker!, tgt); return; }
    if (p.kind === 'attack') this.startAct({ kind: 'attack', targets: [tgt] });
    else if (p.skill) this.startAct({ kind: 'skill', skill: p.skill, targets: p.skill.all ? this.liveEnemies : [tgt] });
  }

  private useSkill(s: Skill): void {
    if (this.ap < s.ap) { this.line = `AP가 부족하다 (${s.name}: AP ${s.ap})`; return; }
    this.pending = { kind: 'skill', skill: s };
    if (s.all) this.startAct({ kind: 'skill', skill: s, targets: this.liveEnemies });
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
    const dur = a.kind === 'item' ? 0.7 : a.kind === 'skill' ? 1.0 : a.kind === 'allout' ? 1.3 : 0.75;
    this.act = { actor: this.actor!, kind: a.kind, skill: a.skill, targets: a.targets, t: 0, dur, hitAt: a.kind === 'item' ? 0.3 : dur * 0.45, done: false };
    if (a.skill) this.ap -= a.skill.ap;
    this.phase = 'act';
    this.menu = 'main';
    this.pending = null;
    this.t = 0;
    this.line = a.kind === 'allout' ? '총공격!' : a.kind === 'skill' ? `${this.actor!.name}: ${a.skill!.name}!` : a.kind === 'item' ? `회복약 (남은 ${this.run.potions})` : `${this.actor!.name}의 공격`;
  }

  private landAct(a: Act): void {
    if (a.kind === 'item') {
      for (const u of a.targets) { const n = Math.ceil(u.hpMax * POTION_HEAL); u.hp = Math.min(u.hpMax, u.hp + n); this.pop(u, `+${n}`, 'heal'); }
      return;
    }
    if (a.kind === 'allout') {                              // everyone standing, on every enemy; then they get up
      const party = this.liveParty;
      for (const u of a.targets) {
        if (u.hp <= 0) continue;
        this.hurt(u, party.reduce((n, p) => n + this.damage(p, u, ALL_OUT_POWER), 0), 0);
        u.broken = false;
        u.brk = 0;
      }
      return;
    }
    const power = a.kind === 'skill' ? a.skill!.power : a.kind === 'counter' ? 1.2 : 1;
    const brk = a.kind === 'skill' ? a.skill!.brk : a.kind === 'counter' ? 25 : 10;
    for (const u of a.targets) if (u.hp > 0) this.hurt(u, this.damage(a.actor, u, power), brk);
    if (a.kind === 'attack') this.ap = Math.min(AP_MAX, this.ap + 1);
  }

  // --- the enemy's turn ------------------------------------------------------------------------------------------

  /** the host's clock this frame (ms) */
  now = 0;

  private startEnemy(u: BUnit): void {
    const moves = u.sp!.moves;
    // a boss in the second half uses its heaviest move more often
    const move = u.sp!.tier === 'boss' && u.hp < u.hpMax / 2 && this.rnd() < 0.4 ? moves[moves.length - 1] : moves[Math.floor(this.rnd() * moves.length)];
    const live = this.liveParty;
    const target = live[Math.floor(this.rnd() * live.length)];
    const strikeAt = this.now + move.windup * 1000 + 500;           // a beat to read who is targeted, then the windup
    const hits: DefHit[] = [];
    let at = strikeAt;
    move.hits.forEach((h, i) => {
      if (i > 0) at += Math.max(MIN_GAP_MS, (h - move.hits[i - 1]) * 1000);
      hits.push({ t: at, result: null });
    });
    this.enemyAct = { actor: u, move, target, strikeAt, hits, lockUntil: 0, whiff: null, endAt: Infinity, countered: false };
    this.phase = 'enemy';
    this.t = 0;
    this.line = `${u.name}: ${move.name} → ${target.name}`;
  }

  /** a defense key at time t (ms) */
  private defend(kind: 'parry' | 'dodge', t: number): void {
    const ea = this.enemyAct;
    if (!ea || t < ea.lockUntil) return;
    const w = kind === 'parry' ? PARRY_MS : DODGE_MS;
    const h = ea.hits.find((x) => !x.result && t >= x.t - w && t <= x.t + w);
    if (h) {
      h.result = kind;
      ea.lockUntil = t + 80;
      if (kind === 'parry') {
        this.ap = Math.min(AP_MAX, this.ap + 1);
        ea.actor.rapport++;
        this.run.parries++;
        this.pop(ea.target, '패링!', 'parry');
      } else this.pop(ea.target, '회피', 'dodge');
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
      if (h.result || this.now <= h.t + Math.max(PARRY_MS, DODGE_MS)) continue;
      h.result = 'hit';
      this.hurt(ea.target, this.damage(ea.actor, ea.target, ea.move.power), 0);
      if (ea.target.hp <= 0) { this.pop(ea.target, '쓰러짐', 'info'); }
    }
    if (ea.endAt === Infinity && ea.hits.every((h) => h.result)) {
      ea.endAt = this.now + 450;
      if (ea.hits.every((h) => h.result === 'parry') && ea.target.hp > 0) {
        ea.countered = true;
        this.line = '완벽한 패링! 반격!';
        this.act = { actor: ea.target, kind: 'counter', targets: [ea.actor], t: 0, dur: 0.6, hitAt: 0.25, done: false };
      }
      // a retargeted unit that fell: anyone else hit later picks a live one
    }
    if (this.now >= ea.endAt && (!this.act || this.act.done)) {
      this.enemyAct = null;
      this.act = null;
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
        if (!a.done && a.t >= a.hitAt) { a.done = true; this.landAct(a); }
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
          if (!a.done && a.t >= a.hitAt) { a.done = true; this.landAct(a); }
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
}
