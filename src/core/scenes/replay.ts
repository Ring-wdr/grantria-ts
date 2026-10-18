// 회상 (not in the original): the story chart (core/data/storyChart.ts) laid out as a flowchart — the three opening
// arcs side by side, merging into the one shared route, chapter by chapter — and the cursor that walks it, the point of
// view and 이어서 보기. The layout is part of the logic: the arrows move to the nearest card on it. The host draws the
// chart (web/game/replay.ts) and replays an event on a throwaway field (sandbox).
import { AVK } from '../keys';
import type { SceneHost } from './host';
import { StoryDb, Story, OPENING } from '../data/story';
import { BRANCHES, CHAPTERS, lineIds, replayable, route, seenAlongRoute } from '../data/storyChart';
import { saveOptions } from '../save/options';
import { addSeen, markSeenFromSlots, records, seenEvents } from '../rules/records';
import { readLog } from '../save/readLog';
import { SLOT_COUNT, loadSlot } from '../save/save';
import { SET_WITHOUT_PLAY } from '../field/events';
import type { ScrollRef } from '../render';

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

/** the replay list of class cls: what it has seen and everything before that on its route (seenAlongRoute) */
export function replayEvents(sdb: StoryDb, cls: number): number[] {
  return seenAlongRoute(cls, seenEvents(cls)).filter((e) => e >= 0 && e < sdb.headers.length && replayable(sdb, e));
}

export const CLASS_NAME = ['러스티', '엘', '알피'];
/** chart geometry (px inside the scrolling chart): three columns of cards, rows 34 apart */
export const COL_X = [4, 114, 224], CARD_W = 96, CARD_H = 22, PITCH = 34, HEAD_H = 20, VIEW_H = 270;
const cx = (col: number) => COL_X[col] + CARD_W / 2;

export interface ChartNode { e: number; x: number; y: number; col: number; lane: number; chapter: number }
interface Line { x: number; y: number; w: number; h: number; arrow?: 'down' | 'right' | 'left' }
interface Chart { nodes: ChartNode[]; lines: Line[]; heads: { text: string; y: number; lane?: number; right?: boolean }[]; height: number }

/** lay the chart out: lanes top-down, a merge bar, then the shared route snaking three cards a row, chapter by
 *  chapter (a chapter starts under the card the last one ended on, so the line runs straight through its title) */
function layout(): Chart {
  const nodes: ChartNode[] = [], lines: Line[] = [], heads: Chart['heads'] = [];
  const link = (a: ChartNode, b: ChartNode) => {
    if (a.y === b.y) {
      const right = b.x > a.x, x0 = right ? a.x + CARD_W : b.x + CARD_W;
      lines.push({ x: x0, y: a.y + CARD_H / 2 - 1, w: Math.abs(b.x - a.x) - CARD_W, h: 2, arrow: right ? 'right' : 'left' });
    } else lines.push({ x: cx(a.col) - 1, y: a.y + CARD_H, w: 2, h: b.y - a.y - CARD_H, arrow: 'down' });
  };
  BRANCHES.forEach((lane, l) => {
    heads.push({ text: CLASS_NAME[l], y: 1, lane: l });            // y 1: the 1 px outline (box-shadow) clears the scroll edge
    lane.forEach((e, i) => {
      const n: ChartNode = { e, x: COL_X[l], y: HEAD_H + i * PITCH, col: l, lane: l, chapter: -1 };
      if (i) link(nodes[nodes.length - 1], n);
      nodes.push(n);
    });
  });
  const longest = Math.max(...BRANCHES.map((b) => b.length));
  const mergeY = HEAD_H + longest * PITCH - 4;
  BRANCHES.forEach((lane, l) => {                                   // each arc's last card down to the merge bar
    const y = HEAD_H + (lane.length - 1) * PITCH + CARD_H;
    lines.push({ x: cx(l) - 1, y, w: 2, h: mergeY - y });
  });
  lines.push({ x: cx(0) - 1, y: mergeY, w: cx(2) - cx(0) + 2, h: 2 });
  let y = mergeY + 10, col = 1, dir = 1, prev: ChartNode | null = null, rowUsed = false;
  lines.push({ x: cx(1) - 1, y: mergeY, w: 2, h: 0, arrow: 'down' });   // stretched below once the first card is placed
  const mergeLine = lines[lines.length - 1];
  CHAPTERS.forEach((ch, c) => {
    if (rowUsed) { y += PITCH; dir = col === 0 ? 1 : col === 2 ? -1 : -dir; rowUsed = false; }
    heads.push({ text: ch.title, y, right: col === 0 });             // away from the line running down through it
    y += HEAD_H;
    ch.events.forEach((e) => {
      if (rowUsed) {
        const nc = col + dir;
        if (nc < 0 || nc > 2) { y += PITCH; dir = -dir; } else col = nc;
      }
      const n: ChartNode = { e, x: COL_X[col], y, col, lane: -1, chapter: c };
      if (prev) link(prev, n); else mergeLine.h = y - mergeY;
      nodes.push(n);
      prev = n;
      rowUsed = true;
    });
  });
  return { nodes, lines, heads, height: y + CARD_H + 6 };
}


/** the point of view and the card last looked at, kept while the game runs */
let lastCls: 0 | 1 | 2 = 0, lastEvent = -1;

/** point of view keys (the host's class buttons send POV_KEY + class) */
export const POV_KEY = 0x120;

export abstract class ReplayListLogic {
  protected sdb: StoryDb;
  protected chart = layout();
  /** events each class has seen (replayable ones) */
  protected seen: Set<number>[] = [];
  protected cur = 0;
  protected scroll: ScrollRef = { y: 0 };

  constructor(protected readonly ctx: SceneHost) {
    this.sdb = new StoryDb(ctx.assets);
    seenFromSlots(this.sdb);
    this.resume();
    const i = this.chart.nodes.findIndex((n) => n.e === lastEvent);
    this.select(i >= 0 ? i : this.chart.nodes.findIndex((n) => n.e === OPENING[lastCls]));
  }

  /** the class the running chain replays as (-1 = none) */
  private playing: 0 | 1 | 2 | -1 = -1;

  /** back from a replay (or opened): the lists read again; with 이어서 보기 a finished scene goes on to the next one
   *  the same class can replay on its route, else title input and music come back */
  resume(finished = false): void {
    this.seen = [0, 1, 2].map((c) => new Set(replayEvents(this.sdb, c)));
    const cls = this.playing;
    this.playing = -1;
    if (finished && cls !== -1 && this.ctx.options.replayChain) {
      const path = route(cls), next = path.slice(path.indexOf(lastEvent) + 1).find((e) => this.seen[cls].has(e));
      if (next !== undefined && path.includes(lastEvent)) { this.play(next, cls); return; }
    }
    this.listening();
    this.ctx.audio.playBgm(0);
  }

  /** the chart takes the input again (opened, or back from a replay that does not go on) */
  protected listening(): void {}

  /** the point of view: the class a shared event replays as when it has seen it */
  protected get pov(): 0 | 1 | 2 { return lastCls; }

  /** the host replays event e as class cls over this chart, which resume()s after */
  protected abstract replay(cls: 0 | 1 | 2, e: number): void;

  private play(e: number, cls: 0 | 1 | 2): void {
    lastEvent = e;
    this.playing = cls;
    this.select(this.chart.nodes.findIndex((n) => n.e === e));
    this.replay(cls, e);
  }

  /** the class an event replays as: the point of view when it has seen it, else the first that has */
  protected playAs(e: number): 0 | 1 | 2 | -1 {
    if (this.seen[lastCls].has(e)) return lastCls;
    return ([0, 1, 2] as const).find((c) => this.seen[c].has(e)) ?? -1;
  }

  update(presses: number[]): void {
    for (const k of presses) {
      if (k === AVK.UP || k === AVK.DOWN || k === AVK.LEFT || k === AVK.RIGHT) this.step(k);
      else if (k === AVK.K1 || k === AVK.K3) lastCls = ((lastCls + (k === AVK.K1 ? 2 : 1)) % 3) as 0 | 1 | 2;
      else if (k >= POV_KEY && k < POV_KEY + 3) lastCls = (k - POV_KEY) as 0 | 1 | 2;
      else if (k === AVK.STAR) { this.ctx.options.replayChain ^= 1; saveOptions(this.ctx.options); }
      else if (k === AVK.OK) {
        const e = this.chart.nodes[this.cur].e, cls = this.playAs(e);
        if (cls === -1) continue;
        this.play(e, cls);
        return;
      } else if (k === AVK.CLR) { this.ctx.screens.title(); return; }
    }
  }

  /** the nearest card that way: along the axis first, sideways counts double */
  private step(k: number): void {
    const a = this.chart.nodes[this.cur];
    let best = -1, bestScore = Infinity;
    this.chart.nodes.forEach((n, i) => {
      const dx = n.x - a.x, dy = n.y - a.y;
      const along = k === AVK.UP ? -dy : k === AVK.DOWN ? dy : k === AVK.LEFT ? -dx : dx;
      const side = k === AVK.UP || k === AVK.DOWN ? Math.abs(dx) : Math.abs(dy);
      if (along <= 0) return;
      const score = along + 2 * side;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) this.select(best);
  }

  protected select(i: number): void {
    if (i < 0) return;
    this.cur = i;
    const n = this.chart.nodes[i];
    if (n.y - HEAD_H < this.scroll.y) this.scroll.y = Math.max(0, n.y - HEAD_H - 6);
    else if (n.y + CARD_H + 6 > this.scroll.y + VIEW_H) this.scroll.y = n.y + CARD_H + 6 - VIEW_H;
  }

  /** kind 0 events other than the openings start when a boss falls (events.md §0.5) */
  protected afterBoss(e: number): boolean { return this.sdb.headers[e].kind === 0 && !OPENING.includes(e); }
}
