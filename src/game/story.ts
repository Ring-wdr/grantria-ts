// Story state: event tables in d.dat, event-done flags, quests (analysis/features/events.md §0.1, §0.5, §0.9).
import type { Assets } from '../assets';

export const EVENT_COUNT = 164;
export const QUEST_COUNT = 152;
export const NO_ID = 1000;

export interface EventHeader { map: number; kind: number; p1: number; p2: number; textBase: number; }
export interface EventRec { time: number; cmd: number; arg: number; }
export interface Quest {
  kind: number; prereq: number; giver: number; report: number; cond: number;
  acceptItem: number; reward: number; exp: number;
}
export interface ActiveQuest { q: number; cnt: number; pct: number; }

/** Read-only event / quest / NPC tables (d.dat offsets d+X). */
export class StoryDb {
  readonly headers: EventHeader[] = [];
  readonly quests: Quest[] = [];
  readonly a: Assets;

  constructor(a: Assets) {
    this.a = a;
    const s16 = (o: number) => (a.d16(o) << 16) >> 16;
    for (let e = 0; e < EVENT_COUNT; e++) {
      const o = 0x2ae + 10 * e;
      this.headers.push({ map: s16(o), kind: s16(o + 2), p1: s16(o + 4), p2: s16(o + 6), textBase: s16(o + 8) });
    }
    for (let q = 0; q < QUEST_COUNT; q++) {
      const o = 0x2170c + 16 * q, v = (i: number) => s16(o + 2 * i);
      this.quests.push({ kind: v(0), prereq: v(1), giver: v(2), report: v(3), cond: v(4), acceptItem: v(5), reward: v(6), exp: v(7) });
    }
  }

  private s16(o: number): number { return (this.a.d16(o) << 16) >> 16; }

  /** script record range [start, end) */
  range(e: number): [number, number] { return [this.a.d16(0x1841c + 2 * e), this.a.d16(0x18564 + 2 * e)]; }
  rec(e: number, s: number): EventRec {
    const o = 0x916 + 6 * s - 10 * e;
    return { time: this.s16(o), cmd: this.s16(o + 2), arg: this.s16(o + 4) };
  }

  /** NPC default lines per story stage (0 = reuse the previous stage) */
  npcLine(id: number, stage: number): number {
    let k = 3 * (id - 43) + stage;
    for (let i = 0; i <= stage; i++) if (this.s16(0x1b0ac + 2 * k) === 0 && k > 3 * (id - 43)) k--;
    return this.s16(0x1b0ac + 2 * k);
  }
  /** name text id of an actor: 992 "?????" for 0x3e0, 993 + id below 43, else d+0x1bfb0 */
  nameId(id: number): number {
    if (id === 0x3e0) return 992;
    return id < 43 ? 993 + id : this.a.d16(0x1bfb0 + 2 * id);
  }
  /** actor type record d+0x22d3d + 8 id: [0] cmf, [1] behaviour, [3,4,6,7] appearance flags */
  typeByte(id: number, i: number): number { return this.a.s8(0x22d3d + 8 * id + i); }
  mainQuest(q: number): boolean { return this.a.d8(0x22c8f + q) === 0; }
  /** kind 1 condition {monster type, count} */
  killCond(q: Quest): [number, number] { return [this.a.d8(0x22ab8 + 2 * q.cond), this.a.d8(0x22ab8 + 2 * q.cond + 1)]; }
  /** kind 0 condition {sub, count, type, grade} */
  collectCond(q: Quest): { sub: number; count: number; type: number; grade: number } {
    const o = 0x22ae0 + 4 * q.cond;
    return { sub: this.a.d8(o), count: this.a.d8(o + 1), type: this.a.d8(o + 2), grade: this.a.d8(o + 3) };
  }
  rewardOf(q: Quest): { type: number; count: number; sub: number } | null {
    if (q.reward < 0 || q.reward >= NO_ID) return null;
    const o = 0x22b78 + 3 * q.reward;
    return { type: this.a.d8(o), count: this.a.d8(o + 1), sub: this.a.d8(o + 2) };
  }
}

/** Mutable per-save story state. */
export class Story {
  /** event-done flags +0x31ad */
  done = new Uint8Array(EVENT_COUNT);
  /** quest states +0x31e1: 0 locked, 1 available, 2 in progress, 3 completable, 4 done, 5 other class */
  qs = new Uint8Array(QUEST_COUNT);
  /** active quest slots +0x327e / +0x3284 (max 6) */
  active: ActiveQuest[] = [];
  /** visited regions (zones of visited maps, from the +0x3175 map bitset) */
  zones = new Set<number>();
  /** visited maps +0x3175 (map tab floor view) */
  maps = new Set<number>();
  /** 차원의 문 clears +0x3100 */
  dimClears = 0;
  /** titles +0x2e80 (56 flags, slot data) and the worn one +0x2eb8 (0xff none) */
  titles = new Set<number>();
  title = 0xff;
  /** achievement counters (+0x2df4 ...) and finished challenges (+0x2c64 flags) */
  counters: Record<string, number> = {};
  challenges = new Set<number>();
  /** day of the last fortune (+0x3291; the web keeps YYYYMMDD) */
  fortuneDay = 0;
  /** type 0x1d collection bits +0x3171 (keys 1..3, sage stones 5..7), opened chests +0x3292, opened doors +0x32a1,
   *  registered warp stones +0x31d5, gather level / exp +0x2ec0 / +0x2ebc */
  collect = new Set<number>();
  /** +0x3173: collection display toggles (FUN_00037afc, flipped by events 0x31 / 0x5d / 0x58): a key item
   *  whose bit is set is drawn dimmed (alpha 10) on character page 4 */
  collectDim = new Set<number>();
  chests = new Set<number>();
  doors = new Set<number>();
  stones = new Set<number>();
  gather = { lv: 0, exp: 0 };
  /** monster book (gamedata 0..0x31f, misc-systems.md §8.1): per type-3 {kills, deaths, habitat zone}, null = not found */
  book: ({ k: number; d: number; z: number } | null)[] = Array.from({ length: 40 }, () => null);

  /** FUN_0004ab38: kill (first kill records the habitat; King Dusty / Witch Tree / Tauron register together) */
  recordKill(type: number, zone: number): void {
    const i = type - 3;
    if (i < 0 || i >= 40) return;
    if (!this.book[i]) {
      if ([2, 5, 8].includes(i)) [2, 5, 8].forEach((j, n) => { this.book[j] ??= { k: 0, d: 0, z: n }; });
      this.book[i] ??= { k: 0, d: 0, z: zone };
    }
    this.book[i]!.k = Math.min(1_000_000, this.book[i]!.k + 1);
  }
  recordDeath(type: number): void { const b = this.book[type - 3]; if (b) b.d++; }

  isDone(e: number): boolean { return e >= 0 && e < EVENT_COUNT && this.done[e] === 1; }
  set(e: number, v = true): void { if (e >= 0 && e < EVENT_COUNT) this.done[e] = v ? 1 : 0; }

  /** new game quest states (FUN_0001a8d8): 0..56 = 19 per class, others' are 5 */
  static fresh(cls: number): Story {
    const s = new Story();
    s.qs.fill(5, 0, 57);
    for (let i = 0; i < 19; i++) s.qs[cls * 19 + i] = 0;
    return s;
  }

  toJSON(): StorySave {
    const done: number[] = [];
    this.done.forEach((v, i) => { if (v) done.push(i); });
    return { done, qs: Array.from(this.qs), active: this.active.map((a) => ({ ...a })), zones: [...this.zones], maps: [...this.maps], dimClears: this.dimClears, titles: [...this.titles], title: this.title, counters: { ...this.counters }, challenges: [...this.challenges], fortuneDay: this.fortuneDay, book: this.book,
      collect: [...this.collect], collectDim: [...this.collectDim], chests: [...this.chests], doors: [...this.doors], stones: [...this.stones], gather: { ...this.gather } };
  }
  static from(d: StorySave | undefined, cls: number): Story {
    if (!d) return Story.fresh(cls);
    const s = new Story();
    for (const e of d.done) s.set(e);
    d.qs.forEach((v, i) => { if (i < QUEST_COUNT) s.qs[i] = v; });
    s.active = d.active.map((a) => ({ ...a }));
    for (const z of d.zones ?? []) s.zones.add(z);
    for (const m of d.maps ?? []) s.maps.add(m);
    s.dimClears = d.dimClears ?? 0;
    for (const n of d.titles ?? []) s.titles.add(n);
    s.title = d.title ?? 0xff;
    s.counters = { ...(d.counters ?? {}) };
    for (const n of d.challenges ?? []) s.challenges.add(n);
    s.fortuneDay = d.fortuneDay ?? 0;
    if (d.book) s.book = d.book.map((b) => (b ? { ...b } : null));
    for (const [k, v] of [['collect', d.collect], ['collectDim', d.collectDim], ['chests', d.chests], ['doors', d.doors], ['stones', d.stones]] as const) for (const x of v ?? []) s[k].add(x);
    if (d.gather) s.gather = { ...d.gather };
    return s;
  }
}

export interface StorySave { done: number[]; qs: number[]; active: ActiveQuest[]; zones?: number[]; maps?: number[]; dimClears?: number; titles?: number[]; title?: number; counters?: Record<string, number>; challenges?: number[]; fortuneDay?: number; book?: ({ k: number; d: number; z: number } | null)[];
  collect?: number[]; collectDim?: number[]; chests?: number[]; doors?: number[]; stones?: number[]; gather?: { lv: number; exp: number }; }
