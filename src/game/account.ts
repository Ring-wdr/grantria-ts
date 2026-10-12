// Account data (gamedata.dat, analysis/features/account.md §1–§2): laps, account traits (12 tracks × 5
// levels, skill tab sub-tab 2), bought trait points. Kept in localStorage 'grantria.gamedata' next to the
// existing {lap}; import / export of the original files is in origfile.ts.
import type { Rng } from './rules';
import { loadGamedata, saveGamedata, watchGamedata, type GameData } from './save';

export interface AccountData extends GameData {
  /** gd+0x35c unspent trait points */
  traitPoints: number;
  /** gd+0x35d.. levels of tracks 1..12 (0..5) */
  traits: number[];
  /** gd+0x371 trait points bought */
  traitBought: number;
  /** gd+0x378 member number (from an imported file name), as a decimal string */
  memberNo?: string;
  /** imported gamedata plaintext (base64), to keep the unknown bytes on export */
  raw?: string;
}

/** d+0x2543b + 3k: value per level of track k (1..12) */
export const TRAIT_PER = [100, 100, 4, 4, 4, 1, 1, 4, 1, 1, 1, 4];

let cache: AccountData | null = null;
watchGamedata(() => { cache = null; });

export function account(): AccountData {
  if (cache) return cache;
  const g = loadGamedata() as Partial<AccountData> & GameData;
  cache = { ...g, traitPoints: g.traitPoints ?? 0, traits: g.traits?.length === 12 ? g.traits : new Array(12).fill(0), traitBought: g.traitBought ?? 0 };
  return cache;
}
export function saveAccount(): void { if (cache) saveGamedata(cache); }
/** reload after an import or a change made through save.ts (laps) */
export function resetAccountCache(): void { cache = null; }

/** level × value of track k (1..12): gd[0x369..0x370] cache values for tracks 4..11 */
export function traitVal(k: number): number { return (account().traits[k - 1] ?? 0) * TRAIT_PER[k - 1]; }

/** FUN_00029b1c: a point every 20 levels while unspent + spent stays at 29 or below (30 over all slots) */
export function traitOnLevelUp(level: number): 'got' | 'full' | null {
  if (level % 20 !== 0) return null;
  const a = account();
  if (a.traitPoints + a.traits.reduce((s, v) => s + v, 0) > 29) return 'full';
  a.traitPoints++; saveAccount();
  return 'got';
}

/** investment check (FUN_00056e4c): popup 0x28 max level, 0x27 no points, 0x26 confirm */
export function traitCheck(k: number): 0x28 | 0x27 | 0x26 {
  const a = account();
  return a.traits[k - 1] > 4 ? 0x28 : a.traitPoints === 0 ? 0x27 : 0x26;
}

/** FUN_00053ca0 case 5: returns the title earned when the track's group of four reaches 20 */
export function traitCommit(k: number): number | null {
  const a = account();
  a.traits[k - 1]++; a.traitPoints--;
  saveAccount();
  const g = (k - 1) >> 2, s = a.traits.slice(4 * g, 4 * g + 4).reduce((x, v) => x + v, 0);
  return s >= 20 ? [2, 0x1a, 0x37][g] : null;
}

/** 0x1b sub 6 / 7: spent points come back, levels and the bought counter clear (gd 0x35d..0x373 = 0) */
export function traitReset(): void {
  const a = account();
  a.traitPoints += a.traits.reduce((s, v) => s + v, 0);
  a.traits.fill(0); a.traitBought = 0;
  saveAccount();
}

/** 0x1b sub 0x20: trait points += the item level (no cap) */
export function traitBox(n: number): void { account().traitPoints += n; saveAccount(); }

/** §2.4: the second drop roll, drawn at the start of the kill handling */
export function secondDrop(rng: Rng): boolean { return rng.rand(100000) <= traitVal(9) * 1000; }

/** derive bonus of tracks 1, 2, 3, 11, 12 (FUN_0003bdfc, before the caps) */
export function traitStatBonus(): { hp: number; mp: number; cd: number; resist: number; potion: number } {
  return { hp: traitVal(1), mp: traitVal(2), cd: traitVal(3), resist: traitVal(11), potion: traitVal(12) };
}
