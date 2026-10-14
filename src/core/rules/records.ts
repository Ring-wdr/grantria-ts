// 기록실 (not in the original): account-wide records kept apart from the slot saves and option.dat, like the
// monster book. Item book (every item kind ever taken, best grade), boss records (kills, fastest kill, a kill
// without being hit, the boss room), the best boss rush, the deepest 심연 floor per dungeon and the story events seen
// per class (회상 on the title screen replays them without any slot).
import { loadJson, saveJson } from '../platform';

const KEY = 'grantria.records';

export interface BossRecord {
  /** kills */
  k: number;
  /** fastest kill in ticks from the first hit, 0 = none */
  best: number;
  /** killed once without being hit after the first blow */
  clean: boolean;
  /** the boss room (normal story maps only), -1 unknown */
  map: number;
}

export interface Records {
  /** "type:sub" -> best grade taken */
  items: Record<string, number>;
  bosses: Record<string, BossRecord>;
  /** best boss rush: total ticks and how many bosses it had */
  rush?: { ticks: number; bosses: number; cls: number; at: number; all?: boolean };
  /** deepest 심연 depth reached per dungeon (0 = the normal 10 floors only) */
  abyss: Record<string, number>;
  /** events replayed (회상) */
  replays: number;
  /** 추가 도전과제 whose gold was paid: once per account, since their goals mostly read these records */
  extraPaid?: number[];
  /** story events played to their end, per class ("0".."2"), for 회상; seenFromSlots = the slots made before this
   *  record have been read into it once */
  seen?: Record<string, number[]>;
  seenFromSlots?: boolean;
}

let cache: Records | null = null;

export function records(): Records {
  if (cache) return cache;
  const r = loadJson<Partial<Records>>(KEY) ?? {};
  cache = { items: r.items ?? {}, bosses: r.bosses ?? {}, rush: r.rush, abyss: r.abyss ?? {}, replays: r.replays ?? 0, extraPaid: r.extraPaid ?? [],
    seen: r.seen ?? {}, seenFromSlots: r.seenFromSlots ?? false };
  return cache;
}

export function saveRecords(): void { if (cache) saveJson(KEY, cache); }

/** drop the cached copy (tests, a backup import) */
export function resetRecordsCache(): void { cache = null; }

/** an item went into the bag (gear, gems, consumables, materials; not gold, keys or unlocks); true when new */
export function recordItem(type: number, sub: number, grade: number): boolean {
  const r = records(), k = `${type}:${sub}`, old = r.items[k];
  if (old !== undefined && old >= grade) return false;
  r.items[k] = grade;
  saveRecords();
  return old === undefined;
}

export function itemKinds(): number { return Object.keys(records().items).length; }

/** a boss went down: `ticks` since the first hit (-1 unknown), `clean` = not hit since, `map` its room (-1 unknown) */
export function recordBoss(type: number, ticks: number, clean: boolean, map: number): void {
  const r = records(), b = r.bosses[type] ??= { k: 0, best: 0, clean: false, map: -1 };
  b.k = Math.min(1_000_000, b.k + 1);
  if (ticks > 0 && (!b.best || ticks < b.best)) b.best = ticks;
  if (clean) b.clean = true;
  if (map >= 0 && b.map < 0) b.map = map;
  saveRecords();
}

/** a finished boss rush; true when it is a new best (more bosses, or the same number faster) */
export function recordRush(ticks: number, bosses: number, cls: number, at: number, all = false): boolean {
  const r = records(), old = r.rush;
  if (old && (old.bosses > bosses || (old.bosses === bosses && old.ticks <= ticks))) {
    if (all && !old.all) { old.all = true; saveRecords(); }
    return false;
  }
  r.rush = { ticks, bosses, cls, at, all: all || !!old?.all };
  saveRecords();
  return true;
}

export function recordAbyss(dungeon: number, depth: number): void {
  const r = records();
  if ((r.abyss[dungeon] ?? 0) >= depth) return;
  r.abyss[dungeon] = depth;
  saveRecords();
}

export function deepestAbyss(): number { return Math.max(0, ...Object.values(records().abyss)); }

export function countReplay(): void { records().replays++; saveRecords(); }

/** story events class cls has seen, in event order */
export function seenEvents(cls: number): number[] { return [...(records().seen?.[cls] ?? [])].sort((a, b) => a - b); }

/** add seen events of class cls; saved when any is new */
export function addSeen(cls: number, events: Iterable<number>): void {
  const r = records(), list = ((r.seen ??= {})[cls] ??= []);
  let changed = false;
  for (const e of events) if (!list.includes(e)) { list.push(e); changed = true; }
  if (changed) saveRecords();
}

/** the slots made before the seen record were read into it (once) */
export function markSeenFromSlots(): void { records().seenFromSlots = true; saveRecords(); }

export function extraPaid(id: number): boolean { return !!records().extraPaid?.includes(id); }

export function markExtraPaid(id: number): void {
  const r = records();
  if (extraPaid(id)) return;
  (r.extraPaid ??= []).push(id);
  saveRecords();
}
