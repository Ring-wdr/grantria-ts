// Active skill records and cooldowns (game-rules.md §4), read by the field and the skill tab.
import type { ItemDb } from './items';
import { rdiv, type Derived, type PlayerModel } from './rules';

/** Active skill record d+0x21160 + class*234 + s*26 (13 x u16). */
export function skillRec(p: { db: ItemDb; model: PlayerModel }, s: number): number[] {
  const a = p.db.a, base = 0x21160 + p.model.cls * 234 + s * 26;
  return Array.from({ length: 13 }, (_, i) => a.d16(base + i * 2));
}

/** Max cooldown when registering a skill (FUN_000379ac): class-0 record [5] minus cooldown-reduction %. */
export function skillMaxCd(p: { db: ItemDb; stats: Derived }, action: number): number {
  const s = p.db.a.d8(0x2558b + action);
  return rdiv(p.db.a.d16(0x2116a + 26 * s) * (100 - Math.min(75, p.stats.D[45])), 100);
}
