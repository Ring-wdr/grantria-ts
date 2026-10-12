// Item boxes and packages of type 0x1b (analysis/features/misc-systems.md §3). The equipment box is a
// port of FUN_0003f6d8 (tools/grantria_misc.py checked it against the original over 398,400 rand paths);
// the RNG call order is kept. Tier 2 switches the item tables only while the item is created
// (leftovers-combat.md §3; checked against tests/boxes.test.ts). Operator boxes 0x33..0x38 are not obtainable offline and are left out.
import type { Inventory, ItemDb } from './items';
import type { Rng } from './rules';

const GOLD_MAX = 999_999_999;
/** sub -> (a, b) of FUN_0003f6d8 */
const EQUIP_BOX: Record<number, [number, number]> = {
  0x0e: [3, 0], 0x0f: [0, 0], 0x10: [1, 0], 0x11: [2, 0], 0x12: [0, 1], 0x13: [1, 1], 0x14: [2, 1],
  0x2b: [0, 2], 0x2c: [1, 2], 0x2d: [2, 2], 0x2e: [3, 3],
};

/** FUN_00036304: equipment step for a level */
function subFor(L: number): number { return L < 11 ? 0 : L <= 15 ? 1 : Math.min(Math.floor((L - 1) / 10) + 1, 10); }

export type BoxResult = 'ok' | 'full' | 'slots' | 'gold';

/** null when the sub is not a box / package */
export function boxEquipment(db: ItemDb, inv: Inventory, sub: number, level: number, cls: number, rng: Rng): BoxResult | null {
  const a = db.a, free = inv.cap - inv.items.length;
  const eb = EQUIP_BOX[sub];
  if (eb) {
    const [ka, kb] = eb;
    if (free < 2) return 'full';
    const L = level;
    let t: number;
    if (ka === 0) t = cls;
    else if (ka === 1) t = (rng.rand(4) + 1) * 3 + cls;
    else if (ka === 2) t = 15;
    else { t = rng.rand(16); rng.rand(11); }
    let tier2 = L >= 90 ? 2 : 0, s: number;
    if (ka === 3) { tier2 = L >= 151 ? 2 : 0; s = rng.rand(3) + 8; }
    else if (rng.rand(100) <= 20) { s = rng.rand(11); tier2 = rng.rand(100) <= 50 ? 0 : 2; }
    else s = subFor(tier2 === 2 ? L - 89 : L);
    const r = rng.rand(10000);
    let g: number;
    if (kb === 0) g = r <= 999 ? 0 : r <= 5999 ? 1 : r <= 9499 ? 2 : r <= 9989 ? 3 : 4;
    else if (kb === 1) g = r <= 7499 ? 2 : r <= 9899 ? 3 : 4;
    else if (kb === 2) {
      s = subFor(tier2 === 2 ? L - 89 : L);
      if (r <= 8999) { g = 3; if (s <= 3) s = 4; } else { g = 4; if (s <= 7) s = 8; }
    } else g = 4;
    g = Math.min(g, a.d8(0x24636 + s));
    const saved = db.tier2;
    db.tier2 = tier2 === 2;                          // DAT_003b3bef only while the item is created
    inv.gain(t, s, g, 1, rng);
    db.tier2 = saved;                                // restore: lap >= 2 (the dimension gate rule is not ported)
    if ((kb === 1 || kb === 2) && rng.rand(10) <= 1) inv.gain(0x1b, 0x21, 0, 1, rng);   // 20 %: socket scroll
    return 'ok';
  }
  const give = (list: [number, number, number][]) => { for (const [ty, su, n] of list) if (!inv.gain(ty, su, 0, n, rng)) return false; return true; };
  switch (sub) {
    case 0x18:                                       // enhance package: scrolls ×5, protect stones ×2, gold
      if (!give([[0x1b, 12, 5], [0x1b, 0, 2]])) return 'slots';
      if (inv.gold + 10_000_000 > GOLD_MAX) return 'gold';
      inv.gold += 1_000_000;
      return 'ok';
    case 0x19:                                       // beginner package
      if (free < 4) return 'slots';
      if (inv.gold + 50_000 > GOLD_MAX) return 'gold';
      give([[0x11, 2, 50], [0x1b, 3, 10], [0x1b, 0x12, 1]]);
      inv.gold += 50_000;
      return 'ok';
    case 0x1a:                                       // dimension package
      if (free < 4) return 'slots';
      give([[0x1b, 3, 10], [0x1b, 0x17, 10], [0x1b, 0x1c, 5]]);
      return 'ok';
    case 0x1d:                                       // luck package: three rare boxes
      if (free < 4) return 'slots';
      give([[0x1b, 0x12, 1], [0x1b, 0x13, 1], [0x1b, 0x14, 1]]);
      return 'ok';
    case 0x27: case 0x28: case 0x29: case 0x2a: {    // full sets: weapon + 4 armour parts
      if (free < 5) return 'slots';
      const s = [2, 4, 7, 8][sub - 0x27], g = sub === 0x27 ? 2 : 3;
      for (let part = 0; part < 5; part++) inv.gain(cls + 3 * part, s, g, 1, rng);
      return 'ok';
    }
  }
  return null;
}
