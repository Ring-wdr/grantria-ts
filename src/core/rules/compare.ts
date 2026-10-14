// Equipment comparison (not in the original): what changes when `it` replaces the item worn in its slot.
// The original's candidate list (EquipTab pick) compares the main stat only.
import type { Item } from './items';

/** equipment slot of a gear item: weapon 0, armour pieces 1..4 by type / 3, accessory (type 15) 5 */
export function equipSlot(it: Item): number { return it.type === 15 ? 5 : Math.trunc(it.type / 3); }

export interface GearDiff {
  /** main stat (ATK / DEF / resist) difference */
  base: number;
  /** option id -> difference, non-zero only, in option id order */
  options: [number, number][];
  /** filled gem sockets / socket count of each */
  gems: [number, number];
  socketsOld: [number, number];
}

function optionSums(it: Item | null): Map<number, number> {
  const m = new Map<number, number>();
  for (const [id, v] of it?.options ?? []) if (id !== 0xff) m.set(id, (m.get(id) ?? 0) + v);
  return m;
}

const sockets = (it: Item | null): [number, number] =>
  it && it.type < 0x10 ? [it.sockets.filter((g) => g !== 0xff).length, it.count] : [0, 0];

/** `it` against the worn item (null = the slot is empty) */
export function compareGear(it: Item, worn: Item | null): GearDiff {
  const a = optionSums(it), b = optionSums(worn);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  return {
    base: it.base - (worn?.base ?? 0),
    options: ids.map((id): [number, number] => [id, (a.get(id) ?? 0) - (b.get(id) ?? 0)]).filter(([, d]) => d !== 0),
    gems: sockets(it),
    socketsOld: sockets(worn),
  };
}
