// Quest state machine (events.md §0.9): refresh, accept (FUN_0001fc94), progress (FUN_0001f648 /
// FUN_0001f928 / kills in FUN_0006ca90), complete (FUN_0001f21c). Key items (type 0x1a) live in their own
// 17-slot store (Inventory.keys, FUN_00036204). Second-run (hard mode)
// rewards follow hardmode.md §4.3 (gold level × 100, EXP table .rodata 0x100818 × level).
import type { Inventory } from './items';
import type { Rng } from './rules';
import { EVENT_COUNT, NO_ID, QUEST_COUNT, type Story, type StoryDb } from '../data/story';

/** hard-mode quest EXP per level for quests 0x4f..0x97 (.rodata 0x100818); others 300 */
const HARD_EXP = [400,300,300,300,300,300,300,300,300,300,300,300,300,300,300,400,300,300,300,300,300,300,400,400,400,400,400,400,300,300,400,300,400,400,400,500,500,400,500,400,500,500,400,400,500,600,600,600,600,700,600,600,600,500,400,400,500,500,800,900,300,500,500,900,900,800,700,700,800,800,900,1000,1000];

export interface QuestHost {
  /** hard mode (lap >= 2) and the player level, for FUN_00018d3c */
  hard?: () => boolean;
  level?: () => number;
  inv: Inventory;
  rng: Rng;
  /** show popup id with "%s" = quest name */
  questPopup(popup: number, q: number): void;
  message(text: string): void;
  grantExp(exp: number): void;
  sfx(n: number): void;
  /** running event id (DAT_0040857a) or -1 */
  eventId?: () => number;
}

/** FUN_00016f8c: a report NPC value >= 60000 means actor value - 60000; quests 0x5f / 0x3c also report to 0xc2 / 0xce */
function reportsTo(q: number, report: number, npcId: number): boolean {
  const v = report & 0xffff, r = v >= 60000 ? v - 60000 : v;
  return r === npcId || (v === 0xea93 && q === 0x5f && npcId === 0xc2) || (v === 0xeaf9 && q === 0x3c && npcId === 0xce);
}

export class QuestLog {
  private readonly db: StoryDb;
  private readonly story: Story;
  private readonly host: QuestHost;
  constructor(db: StoryDb, story: Story, host: QuestHost) { this.db = db; this.story = story; this.host = host; }

  name(q: number): string { return this.db.a.text[1300 + q] ?? ''; }

  /** FUN_00016f8c: locked quests open when the prerequisite is done (or have none: 0, 0x13, 0x26, 0x3a) */
  refresh(): void {
    const { qs } = this.story;
    for (let q = 0; q < QUEST_COUNT; q++) {
      if (qs[q] !== 0) continue;
      const p = this.db.quests[q].prereq;
      if (p !== NO_ID ? qs[p] === 4 : [0, 0x13, 0x26, 0x3a].includes(q)) qs[q] = 1;
    }
  }

  private itemCount(type: number, sub: number): number {
    if (type === 0x1c) return this.host.inv.gold;
    if (type === 0x1a) return this.host.inv.keyCount(sub);           // FUN_0003674c
    // FUN_000366ec: bag only, type / sub / grade 0 (equipped items do not count)
    return this.host.inv.items.filter((it) => it && it.type === type && it.sub === sub && it.grade === 0).reduce((n, it) => n + (it!.count || 1), 0);
  }

  /** repairEventChain: no popups or sounds */
  private quiet = false;

  /** returns false (with a popup) when the quest cannot be taken. The six-slot cap holds side quests only (the
   *  original refused main quests too: an event's accept with six side quests taken was lost with the event, and
   *  the story stopped there), so a main quest can be the seventh. */
  accept(q: number): boolean {
    const { story, db, host } = this;
    if (story.active.length >= 6 && !db.mainQuest(q)) { host.questPopup(0x24, q); return false; }
    const Q = db.quests[q];
    if (story.qs[q] !== 1 || (Q.prereq !== NO_ID && story.qs[Q.prereq] <= 3)) { host.questPopup(0x1d, q); return false; }
    const a = { q, cnt: 0, pct: 0 };
    if (Q.kind === 0) {
      const c = db.collectCond(Q);
      if (c.type === 0x1c) { a.cnt = Math.min(host.inv.gold, 200); a.pct = host.inv.gold >= c.count ? 100 : Math.trunc(host.inv.gold / c.count) * 100; }
      else { a.cnt = this.itemCount(c.type, c.sub); a.pct = a.cnt >= c.count ? 100 : a.cnt * Math.trunc(100 / c.count); }
    } else if (Q.kind >= 2) a.pct = 100;
    story.active.push(a);
    story.active.sort((x, y) => Number(!db.mainQuest(x.q)) - Number(!db.mainQuest(y.q)));
    if (Q.acceptItem !== NO_ID && Q.acceptItem >= 0) {
      if (Q.acceptItem < 100) host.inv.gain(0x1a, Q.acceptItem, 0, 1, host.rng);
      else host.inv.gain(0x1d, Q.acceptItem - 100, 0, 1, host.rng);
    }
    if (!this.quiet) { host.questPopup(0x1e, q); host.sfx(0x2b); }
    story.qs[q] = a.pct < 100 ? 2 : 3;
    host.message((db.a.text[0x3bf] ?? '%s').replace('%s', this.name(q)));   // FUN_0001e6e8(0xc): "%s 시작"
    this.refresh();
    return true;
  }

  private update(a: { q: number; cnt: number; pct: number }, need: number): void {
    a.pct = a.cnt >= need ? 100 : Math.trunc((a.cnt * 100) / need);
    const s = this.story.qs[a.q];
    if (a.pct === 100 && s !== 3 && s !== 4) {
      this.story.qs[a.q] = 3;
      this.host.message(`${this.name(a.q)} (${a.cnt}/${need})`);
    }
  }

  onKill(type: number): void {
    for (const a of this.story.active) {
      const Q = this.db.quests[a.q];
      if (Q.kind !== 1) continue;
      const [t, need] = this.db.killCond(Q);
      if (t !== type || a.cnt >= need) continue;
      a.cnt++;
      this.update(a, need);
    }
  }

  onItems(): void {
    for (const a of this.story.active) {
      const Q = this.db.quests[a.q];
      if (Q.kind !== 0) continue;
      const c = this.db.collectCond(Q);
      a.cnt = c.type === 0x1c ? Math.min(this.host.inv.gold, 200) : this.itemCount(c.type, c.sub);
      if (a.cnt < c.count && this.story.qs[a.q] === 3) this.story.qs[a.q] = 2;
      this.update(a, c.count);
    }
  }

  complete(q: number): void {
    const { story, db, host } = this;
    const ev = host.eventId?.() ?? -1;                               // keys taken by these events before the state check
    if (ev < 0 && !this.quiet && story.qs[q] === 3) {                // outside events: the reward must fit (FUN_0001c5cc, hard mode passes)
      const r = db.rewardOf(db.quests[q]);
      if (r && !(host.hard?.() ?? false) && r.type !== 0x1c && host.inv.items.length >= host.inv.cap && !host.inv.canGain(r.type, r.sub, 0, Math.max(1, r.count))) {
        host.message(db.a.text[0x3cc] ?? '');                        // FUN_0001e6e8(0x19); the quest stays reportable
        return;
      }
    }
    const evKey = ev === 0x1b ? 8 : ev === 0x36 ? 0xe : ev === 0x10 ? 5 : -1;
    if (evKey >= 0) host.inv.removeKey(evKey);
    if (story.qs[q] !== 3) return;
    const Q = db.quests[q];
    if (Q.kind === 2) this.takeAcceptKey(q);                         // FUN_0001c46c
    if (Q.kind === 0) {
      const c = db.collectCond(Q);
      if (c.type === 0x1c) host.inv.gold = Math.max(0, host.inv.gold - c.count);
      else if (c.type === 0x1a) host.inv.removeKey(c.sub);           // one record, whatever the count
      else {                                                         // FUN_000367e8(type, sub, 0): the first grade-0 record
        const i = host.inv.items.findIndex((it) => it && it.type === c.type && it.sub === c.sub && it.grade === 0);
        const it = host.inv.items[i];
        if (it) { if (it.type > 0x0f && (it.count || 1) > c.count) it.count -= c.count; else host.inv.remove(i); }
      }
    }
    if (!this.quiet) host.questPopup(0x20, q);
    story.qs[q] = 4;
    const r = db.rewardOf(Q);
    const hard = host.hard?.() ?? false, L = host.level?.() ?? 1;
    if (r) {
      if (hard && r.type !== 0x1a && r.type !== 0x1d) host.inv.gold += L * 100;          // hard: gold level × 100
      else if (r.type === 0x1c) host.inv.gold += r.count * 50;
      else host.inv.gain(r.type, r.sub, 0, Math.max(1, r.count), host.rng);
    }
    const exp = hard ? (q >= 0x4f && q <= 0x97 ? HARD_EXP[q - 0x4f] : 300) * L : (Q.exp & 0x1fff) << 3;
    if (exp) host.grantExp(exp);
    story.active = story.active.filter((a) => a.q !== q);
    host.message((db.a.text[0x3c1] ?? '%s').replace('%s', this.name(q)));   // FUN_0001e6e8(0xe): "%s 종료"
    this.refresh();
  }

  /** saves stuck before main quests passed the cap: a main quest only events give (giver 0), still "available"
   *  after an event that takes it ran, is taken now, and completed when an event that completes it ran too; on
   *  down the chain. Returns the quests taken. */
  repairEventChain(isDone: (e: number) => boolean): number[] {
    const { story, db } = this, took: number[] = [];
    const acc = new Set<number>(), cmp = new Set<number>();
    for (let e = 0; e < EVENT_COUNT; e++) {
      if (!isDone(e)) continue;
      for (const r of db.questCmds(e)) (r.cmd === 0x13 ? acc : cmp).add(r.arg);
    }
    this.quiet = true;
    try {
      for (let again = true; again;) {
        again = false;
        for (let q = 0; q < QUEST_COUNT; q++) {
          if (!db.mainQuest(q) || db.quests[q].giver !== 0) continue;
          if (story.qs[q] === 1 && acc.has(q) && !story.active.some((a) => a.q === q) && this.accept(q)) { took.push(q); again = true; }
          if (story.qs[q] === 3 && cmp.has(q) && took.includes(q)) { this.complete(q); again = true; }
        }
      }
    } finally { this.quiet = false; }
    return took;
  }

  /** FUN_0001c46c (errand completion, abandon): the key whose sub equals the accept item goes */
  takeAcceptKey(q: number): void {
    const it = this.db.quests[q].acceptItem;
    if (it !== NO_ID && it >= 0 && it < 100) this.host.inv.removeKey(it);
  }

  /** NPC head marker (+0x8d): 1 can accept, 2 in progress, 3 can report, 5 locked, 0 none; with the quest */
  marker(npcId: number): { mark: number; q: number } {
    const { story, db } = this;
    for (const a of story.active.slice(0, 3)) {
      const Q = db.quests[a.q];
      if (Q.kind === 4 && story.qs[a.q] < 4 && Q.cond === npcId) return { mark: 3, q: a.q };
    }
    for (let q = 0; q < QUEST_COUNT; q++) {
      const Q = db.quests[q], s = story.qs[q];
      if (reportsTo(q, Q.report, npcId) && Q.kind !== 4 && Q.kind !== 5 && (s === 2 || s === 3)) return { mark: s, q };
    }
    for (let q = 0; q < QUEST_COUNT; q++) {
      const Q = db.quests[q], s = story.qs[q];
      if (Q.giver === npcId && Q.giver !== 0 && s === 1) return { mark: 1, q };
    }
    return { mark: 0, q: 0 };
  }
}

/** 추적 (not in the original): a quest left off the HUD quest tracker, kept in the slot's story counters so the
 *  save format does not change */
export const untrackKey = (q: number): string => `qhide${q}`;
