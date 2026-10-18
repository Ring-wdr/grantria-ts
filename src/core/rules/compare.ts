// Equipment comparison (not in the original): what changes when `it` replaces the item worn in its slot.
// The main stat is the character's, from the stat rebuild (rules.derive) run with the current equipment and again
// with `it` swapped in, so options of every piece, rounding, the enhancement bonus, 총방어력 %, sets and gems all count
// the way they do once worn. The armour enhancement effect follows FUN_000371c4 of both items.
import type { Item } from './items';
import { derive, usable, type Derived, type EquipTables, type PlayerModel } from './rules';
import { enhEffect } from './shopRules';

/** equipment slot of a gear item: weapon 0, armour pieces 1..4 by type / 3, accessory (type 15) 5 */
export function equipSlot(it: Item): number { return it.type === 15 ? 5 : Math.trunc(it.type / 3); }

export interface GearDiff {
  /** character main stat (ATK / DEF / lowest of the three resistances) as worn now and with `it` in its slot */
  stat: [number, number];
  /** false when `it` cannot be worn (level or class), so it would add nothing */
  usable: boolean;
  /** armour enhancement effect (option id, difference); null when neither item has one */
  enh: [number, number] | null;
  /** option id -> difference, non-zero only, in option id order */
  options: [number, number][];
  /** filled gem sockets / socket count of each */
  gems: [number, number];
  socketsOld: [number, number];
}

/** options that share one text and one effect: 공격력 % 0x1b = 0, 방어력 % 0x21 = 2 */
const SAME_OPTION: Record<number, number> = { 0x1b: 0, 0x21: 2 };

function optionSums(it: Item | null): Map<number, number> {
  const m = new Map<number, number>();
  for (const [raw, v] of it?.options ?? []) {
    if (raw === 0xff) continue;
    const id = SAME_OPTION[raw] ?? raw;
    m.set(id, (m.get(id) ?? 0) + v);
  }
  return m;
}

const sockets = (it: Item | null): [number, number] =>
  it && it.type < 0x10 ? [it.sockets.filter((g) => g !== 0xff).length, it.count] : [0, 0];

const mainOf = (slot: number, d: Derived): number =>
  slot === 0 ? d.atk : slot < 5 ? d.def : Math.min(d.D[12], d.D[13], d.D[14]);

/** `it` against the item worn in its slot of `equip` (null = the slot is empty), for the player `p` */
export function compareGear(it: Item, equip: readonly (Item | null)[], p: PlayerModel, tables?: EquipTables): GearDiff {
  const slot = equipSlot(it), worn = equip[slot] ?? null;
  const now = Array.from({ length: 6 }, (_, i) => equip[i] ?? null);
  const next = now.map((x, i) => (i === slot ? it : x));
  const a = optionSums(it), b = optionSums(worn);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  const fa = enhEffect(it), fb = worn ? enhEffect(worn) : null;
  return {
    stat: [mainOf(slot, derive({ ...p, equip: now }, tables)), mainOf(slot, derive({ ...p, equip: next }, tables))],
    usable: usable(it, p.level, p.cls),
    enh: fa || fb ? [(fa ?? fb)!.opt, (fa?.value ?? 0) - (fb?.value ?? 0)] : null,
    options: ids.map((id): [number, number] => [id, (a.get(id) ?? 0) - (b.get(id) ?? 0)]).filter(([, d]) => d !== 0),
    gems: sockets(it),
    socketsOld: sockets(worn),
  };
}
