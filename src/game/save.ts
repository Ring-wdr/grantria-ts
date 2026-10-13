// Save slots. The original keeps 3 slots in an XTEA-encrypted save.dat with a checksum
// (analysis/native/SAVE_FORMAT.md); the web port stores plain JSON per slot in localStorage.
// Storage can be unavailable (private mode, blocked site data), so every access is guarded.

import type { Item, QuickSlot } from './items';
import type { StorySave } from './story';

export const SLOT_COUNT = 3;
const KEY = 'grantria.save.';

export interface SaveData {
  version: 1;
  cls: 0 | 1 | 2;
  level: number;
  exp: number;
  gold: number;
  stats: number[];
  statPoints: number;
  /** bought point packs: stats +0x32a7 (AP +30 each), skills +0x32a8 (SP +5 each), at most 10 */
  packs?: [number, number];
  map: number;
  /** map zone, shown as the area name (text 0x1D6 + zone) in the slot list */
  zone?: number;
  x: number;
  y: number;
  dir: 0 | 1 | 2 | 3;
  hp: number;
  mp: number;
  /** play time in ticks (20 per second) */
  playTicks: number;
  savedAt: number;
  /** learned skill levels +0x3141: 0..8 actives (tab order), 9..15 passives; skill points */
  skills?: number[];
  skillPoints?: number;
  /** inventory, equipment, quick slots and gold (absent in a new game) */
  /** elixir buff slots [t, on], day/night counter, return stone row */
  buffs?: [number, number][];
  day?: number;
  returnZone?: number;
  /** event flags and quests (absent in a new game) */
  story?: StorySave;
  inv?: { items: Item[]; equip: (Item | null)[]; quick: QuickSlot[]; gold: number; bags?: number; unlocks?: number; keys?: Item[] };
}

export function loadSlot(i: number): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY + i);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d && d.version === 1 ? d : null;
  } catch {
    return null;
  }
}

export function saveSlot(i: number, d: SaveData): boolean {
  try {
    localStorage.setItem(KEY + i, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

/** local warehouse shared by the slots (the original kept it on the server, online.md §5) */
const WAREHOUSE = 'grantria.warehouse';
export function loadWarehouse(): Item[] {
  try { const r = localStorage.getItem(WAREHOUSE); return r ? JSON.parse(r) as Item[] : []; } catch { return []; }
}
export function saveWarehouse(items: Item[]): void {
  try { localStorage.setItem(WAREHOUSE, JSON.stringify(items)); } catch { /* storage unavailable */ }
}

export function deleteSlot(i: number): void {
  setLap(i, 0);
  try {
    localStorage.removeItem(KEY + i);
  } catch { /* storage unavailable */ }
}

/** New game values (FUN_0001a8d8): Lv 1, 4 stat points, class base stats, start map 18. */
export function newGame(cls: 0 | 1 | 2): SaveData {
  const stats = [[5, 5, 3, 3], [3, 3, 3, 7], [7, 1, 5, 3]][cls];
  return {
    version: 1, cls, level: 1, exp: 0, gold: 0, stats: [...stats], statPoints: 4,
    // start map per class (FUN_00053510 case 2): 10 / 0x2F / 0x62; the opening event (0 / 10 / 0x14)
    // places the player, so the position is left to the field default until events are ported
    map: [10, 0x2f, 0x62][cls], x: -1, y: -1, dir: 3, hp: -1, mp: -1, playTicks: 0, savedAt: 0,
  };
}

// gamedata.dat (account file): per-slot lap (gamedata + 0x3d4 + slot, hardmode.md §1):
// 0 normal, 1 ending seen (hardcore conversion open), 2 hardcore (hard mode)
const GAMEDATA = 'grantria.gamedata';
export interface GameData { lap: number[]; }
export function loadGamedata(): GameData {
  try {
    const d = JSON.parse(localStorage.getItem(GAMEDATA) ?? 'null') as GameData | null;
    if (d && Array.isArray(d.lap)) return { ...d, lap: [0, 1, 2].map((i) => d.lap[i] ?? 0) };   // other account fields kept (account.ts)
  } catch { /* storage unavailable */ }
  return { lap: [0, 0, 0] };
}
export function saveGamedata(d: GameData): void {
  try { localStorage.setItem(GAMEDATA, JSON.stringify(d)); } catch { /* storage unavailable */ }
}
export function setLap(slot: number, lap: number): void { const g = loadGamedata(); g.lap[slot] = lap; saveGamedata(g); onGamedataChange(); }
/** account.ts drops its cached copy when another writer changes the file */
let onGamedataChange: () => void = () => {};
export function watchGamedata(f: () => void): void { onGamedataChange = f; }
