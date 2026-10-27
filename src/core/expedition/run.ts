// 원정(가제): the run, in memory only (no save slot): the party (the hero and up to two recruited creatures), their
// levels inside this run, the items and where the run is.
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
}

export const PARTY_MAX = 3;
export const POTION_HEAL = 0.4;

/** EXP from level lv to the next */
export function expToNext(lv: number): number { return 20 + lv * 18; }

export function newHero(): Member {
  return { name: '검사', species: null, lv: 1, exp: 0, hp: 120, hpMax: 120, atk: 14, def: 5, spd: 12 };
}

/** a creature joining at its own level (a little sturdier than in the wild) */
export function recruit(species: number): Member {
  const s = SPECIES[species].stats, hp = Math.round(s.hp * 1.3);
  return { name: SPECIES[species].name, species, lv: s.lv, exp: 0, hp, hpMax: hp, atk: s.atk, def: s.def, spd: s.spd };
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

export class Run {
  party: Member[] = [newHero()];
  potions = 3;
  /** battle zones cleared */
  cleared = 0;
  /** run statistics for the result screen */
  kills = 0;
  recruits = 0;
  parries = 0;

  get alive(): Member[] { return this.party.filter((m) => m.hp > 0); }

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
      if (up) lines.push(`${m.name} Lv.${m.lv}!`);
    }
    return lines;
  }
}
