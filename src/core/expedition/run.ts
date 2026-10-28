// 원정(가제): the run, in memory only (no save slot): the party (the hero and up to two recruited creatures), their
// levels inside this run, the potions, gold and the equipment worn (web/docs/expedition-balance.md §4.3), and where the run is.
import { SLOTS, addStats, type Gear, type Stats } from './loot';
import { SPECIES } from './species';

export interface Member {
  name: string;
  /** the hero, or the species index of a recruited creature */
  species: number | null;
  lv: number;
  exp: number;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  /** a rare creature recruited: ×1.2 and it keeps its sparkle */
  shiny?: boolean;
  /** what the party's equipment adds to this member now (taken off again when a piece is changed) */
  gear?: { atk: number; spd: number; hp: number };
}

export const PARTY_MAX = 3;
export const POTION_HEAL = 0.4;

/** EXP from level lv to the next */
export function expToNext(lv: number): number { return 20 + lv * 18; }

export function newHero(): Member {
  return { name: '검사', species: null, lv: 1, exp: 0, hp: 120, hpMax: 120, atk: 14, def: 5, spd: 12 };
}

/** a rare recruit's stats ×this (§7) */
export const SHINY_MUL = 1.2;

/** a creature joining at its own level (a little sturdier than in the wild); a rare one ×1.2 */
export function recruit(species: number, shiny = false): Member {
  const s = SPECIES[species].stats, k = shiny ? SHINY_MUL : 1, hp = Math.round(s.hp * 1.3 * k);
  return { name: SPECIES[species].name, species, lv: s.lv, exp: 0, hp, hpMax: hp, atk: Math.round(s.atk * k), def: Math.round(s.def * k), spd: Math.round(s.spd * k),
    shiny: shiny || undefined };
}

/** one level up: the gains */
function grow(m: Member): void {
  const k = m.species === null ? 1 : 0.85;
  m.lv++;
  const hp = Math.round(14 * k);
  m.hpMax += hp;
  m.hp += hp;
  m.atk += m.lv % 2 ? 2 : 1;
  m.def += 1;
  m.spd += m.lv % 3 === 0 ? 1 : 0;
}

/** give EXP; returns the levels gained */
export function gainExp(m: Member, n: number): number {
  m.exp += n;
  let up = 0;
  while (m.exp >= expToNext(m.lv)) { m.exp -= expToNext(m.lv); grow(m); up++; }
  return up;
}

/** the damage a party takes is cut by its equipment at most this much */
export const GUARD_MAX = 0.5;

/** a member's attack, speed and max HP with these equipment stats instead of what it wears now */
export function statsWith(m: Member, s: Stats): { atk: number; spd: number; hpMax: number } {
  const was = m.gear ?? { atk: 0, spd: 0, hp: 0 }, base = m.hpMax - was.hp;
  return { atk: m.atk - was.atk + (s.atk ?? 0), spd: m.spd - was.spd + (s.spd ?? 0), hpMax: base + Math.round(base * (s.hpPct ?? 0)) };
}

export class Run {
  party: Member[] = [newHero()];
  potions = 3;
  gold = 0;
  /** the pieces worn by slot (무기, 투구, 갑옷, 목걸이), each on every member */
  equip: (Gear | null)[] = Array(SLOTS).fill(null);
  /** battle zones cleared */
  cleared = 0;
  /** run statistics for the result screen */
  kills = 0;
  recruits = 0;
  parries = 0;

  get alive(): Member[] { return this.party.filter((m) => m.hp > 0); }

  /** what the worn pieces add up to (or would, with g in its slot) */
  gearStats(g: Gear | null = null): Stats {
    return this.equip.reduce<Stats>((s, e, i) => { const x = g && g.slot === i ? g : e; return x ? addStats(s, x) : s; }, {});
  }

  /** the share of damage the party's equipment takes off (or would, with g in its slot) */
  guardWith(g: Gear | null = null): number { return Math.min(GUARD_MAX, this.gearStats(g).guard ?? 0); }
  get guard(): number { return this.guardWith(); }

  /** put g on (for everyone now, and whoever joins later); the piece it replaces is returned (and gone) */
  wear(g: Gear): Gear | null {
    const old = this.equip[g.slot];
    this.equip[g.slot] = g;
    for (const m of this.party) this.fit(m);
    return old;
  }

  /** a member's stats with the equipment worn now: what it added before is taken off, what it adds now put on (max HP
   *  by the share, so it is fitted again after a level-up) */
  private fit(m: Member): void {
    const was = m.gear ?? { atk: 0, spd: 0, hp: 0 }, s = this.gearStats(), now = statsWith(m, s), hp = now.hpMax - (m.hpMax - was.hp);
    m.atk = now.atk;
    m.spd = now.spd;
    m.hpMax = now.hpMax;
    if (m.hp > 0) m.hp = Math.max(1, Math.min(m.hpMax, m.hp + hp - was.hp));
    m.gear = { atk: s.atk ?? 0, spd: s.spd ?? 0, hp };
  }

  /** a recruit joins with the equipment worn */
  join(m: Member): void {
    this.fit(m);
    this.party.push(m);
  }

  /** heal everyone by a part of their max HP (the fallen get up with it too) */
  heal(part: number): void {
    for (const m of this.party) m.hp = Math.min(m.hpMax, m.hp + Math.ceil(m.hpMax * part));
  }

  /** EXP to the standing members; returns lines for those who levelled up */
  award(exp: number): string[] {
    const lines: string[] = [];
    for (const m of this.party) {
      if (m.hp <= 0) continue;
      const up = gainExp(m, exp);
      if (up) { this.fit(m); lines.push(`${m.name} Lv.${m.lv}!`); }
    }
    return lines;
  }
}
