// 회상 (not in the original): title screen → 회상 → character select (CharSelectScene in replay mode) → the story
// events that class has seen (records.seen, account-wide, written when an event ends in play). An event replays on a
// throwaway field built from that list alone (sandbox.ts), and this list comes back when its script ends.
import { AVK } from '../input/input';
import type { GameContext } from './scene';
import { StoryDb, Story } from '../../core/data/story';
import { addSeen, markSeenFromSlots, records, seenEvents } from '../../core/rules/records';
import { readLog } from '../../core/save/readLog';
import { SLOT_COUNT, loadSlot } from '../../core/save/save';
import { eventMap, OPENING } from './fieldScene';
import { REPEATABLE, SET_WITHOUT_PLAY } from './events';
import { SandboxScene } from './sandbox';
import { CharSelectScene, frozenTitle, render } from './screens';
import { gt, h, type ScrollRef } from '../render/view';
import '../styles/convenience.css';

const ROW_H = 24;

/** text ids of an event's dialogue pages and captions, in script order */
function lineIds(sdb: StoryDb, e: number): number[] {
  const [a, b] = sdb.range(e), out: number[] = [];
  let id = sdb.headers[e].textBase - 1;
  for (let s = a; s < b; s++) {
    const c = sdb.rec(e, s).cmd;
    if (c === 5 || c === 6 || c === 7 || c === 0x1d) out.push(++id);
  }
  return out;
}

/** events worth a replay: with lines and a map, not the repeatable hints, the garden floors or 0x6B */
function replayable(sdb: StoryDb, e: number): boolean {
  if (REPEATABLE.includes(e) || (e >= 0x9b && e <= 0xa3) || e === 0x6b || eventMap(e, sdb.headers[e].map) < 0) return false;
  return lineIds(sdb, e).length > 0;
}

/** the slots made before the seen record: their finished events, once. An event an end hook marks done without
 *  playing it (another class's arc) counts only with one of its lines in the read log; the slot's own opening is
 *  played (classes 1 / 2 set flag 0 at a new game, which is why event 0 is in SET_WITHOUT_PLAY). */
export function seenFromSlots(sdb: StoryDb): void {
  if (records().seenFromSlots) return;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = loadSlot(i);
    if (!s?.story) continue;
    const st = Story.from(s.story, s.cls), events: number[] = [];
    sdb.headers.forEach((_, e) => {
      if (!st.isDone(e) || !replayable(sdb, e) || (OPENING.includes(e) && e !== OPENING[s.cls])) return;   // another class's opening
      if (SET_WITHOUT_PLAY.has(e) && e !== OPENING[s.cls] && !lineIds(sdb, e).some((id) => readLog().has(id))) return;
      events.push(e);
    });
    addSeen(s.cls, events);
  }
  markSeenFromSlots();
}

/** the replay list of class cls */
export function replayEvents(sdb: StoryDb, cls: number): number[] {
  return seenEvents(cls).filter((e) => e >= 0 && e < sdb.headers.length && replayable(sdb, e));
}

export class ReplayListScene {
  readonly wide = true;
  private cur = 0;
  private scroll: ScrollRef = { y: 0 };
  private sdb: StoryDb;
  private events: number[] = [];

  constructor(private ctx: GameContext, private cls: 0 | 1 | 2) {
    this.sdb = new StoryDb(ctx.assets);
    seenFromSlots(this.sdb);
    this.resume();
  }

  /** back from a replay (or opened): title input and music, the list read again */
  resume(): void {
    this.ctx.input.uiMode = true; this.ctx.input.zones = []; this.ctx.input.padField = false; this.ctx.input.confirm = false;
    this.ctx.audio.playBgm(0);
    this.events = replayEvents(this.sdb, this.cls);
    this.cur = Math.min(this.cur, Math.max(0, this.events.length - 1));
  }

  update(presses: number[]): void {
    for (const t of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(t.x, t.y); if (k) presses = [...presses, ...k]; }
    const n = this.events.length;
    for (const k of presses) {
      if (k === AVK.UP && n) this.move((this.cur + n - 1) % n);
      else if (k === AVK.DOWN && n) this.move((this.cur + 1) % n);
      else if (k === AVK.OK && n) { void SandboxScene.replay(this.ctx, this, this.cls, this.events[this.cur]); return; }
      else if (k === AVK.CLR) { this.ctx.go(new CharSelectScene(this.ctx, -1, true, this.cls)); return; }
    }
  }

  private move(i: number): void {
    this.cur = i;
    const top = i * ROW_H, view = 5 * ROW_H;
    if (top < this.scroll.y) this.scroll.y = top;
    else if (top + ROW_H > this.scroll.y + view) this.scroll.y = top + ROW_H - view;
  }

  draw(): void {
    const t = this.ctx.assets.text, sdb = this.sdb;
    const rows = this.events.map((e, i) => {
      const hd = sdb.headers[e], line = (t[hd.textBase] ?? '').replace(/\|./g, '').replace(/@/g, ' ');
      return h(`div.v-row.ar-row${i === this.cur ? '.cur' : ''}`, { on: () => { if (this.cur === i) return [AVK.OK]; this.move(i); } },
        h('span.ar-num', null, String(i + 1)),
        h('div.v-col.v-grow.ar-cell', null, gt(t[0x1e4 + eventMap(e, hd.map)] ?? '', { cls: 'ar-sub' }), h('span.ar-line', null, line)));
    });
    // the character select's frame (CharSelectScene, C220): title plate, the class's portrait card and name on the left
    render(this.ctx, () => {
      const u = this.ctx.ui, cls = this.cls;
      frozenTitle(this.ctx);
      u.pushCenter220();
      u.window(0x48, 0, 0x4c, 0x16);
      u.string('회상', 0x6e, 5, 'center');
      u.window(0, 0x17, 0x4a, 0x82);
      u.image('char_slot', cls * 0x42, 0, 0x42, 0x7a, 4, 0x1b);
      u.window(0, 0x9b, 0x4a, 0x16);
      u.textId(0x3e1 + cls, 0x25 - (cls === 1 ? 1 : 0), 0xa0, 'center');
      u.window(0x4d, 0x17, 0x8f, 0xb2);
      u.view('replayList', 0x51, 0x1b, 0x87, 0xaa, h('div.v-scroll.ar-list.rp-list', { scroll: this.scroll },
        h('div.v-col', null, rows.length ? rows : h('div.ar-empty', null, '아직 본 이야기가 없습니다.'))));
      u.pop();
      u.closeButton();
    });
  }
}
