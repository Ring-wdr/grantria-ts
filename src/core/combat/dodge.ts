// Dash dodging (2.5D, not in the original): attacks landing in the dash's invulnerable ticks miss, except the
// unblockable ones. Those are the boss patterns being rebuilt around a warning sign and a dodge window (a beam that
// is announced, then can be stepped out of, then hits whoever is still in it), so dash i-frames do not trivialise them.

/** unblockable boss attacks as `${boss type}:${action}`; filled in as each pattern is redesigned */
export const UNBLOCKABLE = new Set<string>();

/** whether the dash's invulnerability lets this attack miss: monster attacks always, boss attacks unless unblockable */
export function dashDodges(bossType: number, action: number): boolean {
  return bossType < 0 || !UNBLOCKABLE.has(`${bossType}:${action}`);
}
