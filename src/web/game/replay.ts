// 회상 (not in the original): title screen → 회상 → the story chart (core/data/storyChart.ts) as a flowchart: the
// three opening arcs side by side, merging into the one shared route, chapter by chapter. Every story event has its
// card; the events a class has seen (records.seen, account-wide, written when an event ends in play) can be replayed.
// An event replays on a throwaway field built from that class's list alone (sandbox.ts), and the chart comes back
// when its script ends. The 시점 (point of view) picks the class a shared event is replayed as, when it has seen it.
import { AVK } from '../input/input';
import type { GameContext } from './scene';
import { StoryDb, Story, OPENING } from '../../core/data/story';
import { BRANCHES, CHAPTERS, lineIds, replayable, route, seenAlongRoute } from '../../core/data/storyChart';
import { saveOptions } from '../../core/save/options';
import { addSeen, markSeenFromSlots, records, seenEvents } from '../../core/rules/records';
import { readLog } from '../../core/save/readLog';
import { SLOT_COUNT, loadSlot } from '../../core/save/save';
import { eventMap } from './fieldScene';
import { SET_WITHOUT_PLAY } from './events';
import { SandboxScene } from './sandbox';
import { frozenTitle, render, TitleScene } from './screens';
import { button, h, padBadge, type ScrollRef, type VNode } from '../render/view';
import '../styles/convenience.css';

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

const CLASS_NAME = ['러스티', '엘', '알피'];
/** chart geometry (px inside the scrolling chart): three columns of cards, rows 34 apart */
const COL_X = [4, 114, 224], CARD_W = 96, CARD_H = 22, PITCH = 34, HEAD_H = 20, VIEW_H = 270;
const cx = (col: number) => COL_X[col] + CARD_W / 2;

interface ChartNode { e: number; x: number; y: number; col: number; lane: number; chapter: number }
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

export class ReplayListScene {
  readonly wide = true;
  private sdb: StoryDb;
  private chart = layout();
  /** events each class has seen (replayable ones) */
  private seen: Set<number>[] = [];
  private cur = 0;
  private scroll: ScrollRef = { y: 0 };

  constructor(private ctx: GameContext) {
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
    this.ctx.input.uiMode = true; this.ctx.input.zones = []; this.ctx.input.padField = false; this.ctx.input.confirm = false;
    this.ctx.audio.playBgm(0);
  }

  private play(e: number, cls: 0 | 1 | 2): void {
    lastEvent = e;
    this.playing = cls;
    this.select(this.chart.nodes.findIndex((n) => n.e === e));
    void SandboxScene.replay(this.ctx, this, cls, e);
  }

  /** the class an event replays as: the point of view when it has seen it, else the first that has */
  private playAs(e: number): 0 | 1 | 2 | -1 {
    if (this.seen[lastCls].has(e)) return lastCls;
    return ([0, 1, 2] as const).find((c) => this.seen[c].has(e)) ?? -1;
  }

  update(presses: number[]): void {
    for (const t of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(t.x, t.y); if (k) presses = [...presses, ...k]; }
    for (const k of presses) {
      if (k === AVK.UP || k === AVK.DOWN || k === AVK.LEFT || k === AVK.RIGHT) this.step(k);
      else if (k === AVK.K1 || k === AVK.K3) lastCls = ((lastCls + (k === AVK.K1 ? 2 : 1)) % 3) as 0 | 1 | 2;
      else if (k >= 0x120 && k < 0x123) lastCls = (k - 0x120) as 0 | 1 | 2;
      else if (k === AVK.STAR) { this.ctx.options.replayChain ^= 1; saveOptions(this.ctx.options); }
      else if (k === AVK.OK) {
        const e = this.chart.nodes[this.cur].e, cls = this.playAs(e);
        if (cls === -1) continue;
        this.play(e, cls);
        return;
      } else if (k === AVK.CLR) { this.ctx.go(new TitleScene(this.ctx)); return; }
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

  private select(i: number): void {
    if (i < 0) return;
    this.cur = i;
    const n = this.chart.nodes[i];
    if (n.y - HEAD_H < this.scroll.y) this.scroll.y = Math.max(0, n.y - HEAD_H - 6);
    else if (n.y + CARD_H + 6 > this.scroll.y + VIEW_H) this.scroll.y = n.y + CARD_H + 6 - VIEW_H;
  }

  /** kind 0 events other than the openings start when a boss falls (events.md §0.5) */
  private afterBoss(e: number): boolean { return this.sdb.headers[e].kind === 0 && !OPENING.includes(e); }

  private mapName(e: number): string {
    return this.ctx.assets.text[0x1e4 + eventMap(e, this.sdb.headers[e].map)] ?? '';
  }

  private chartView(): VNode {
    const { nodes, lines, heads, height } = this.chart;
    const cards = nodes.map((n, i) => {
      const seenBy = [0, 1, 2].filter((c) => this.seen[c].has(n.e));
      const cls = [i === this.cur ? 'cur' : '', seenBy.length ? 'seen' : 'locked', n.lane === lastCls ? 'pov' : '', this.afterBoss(n.e) ? 'boss' : ''].filter(Boolean).join(' ');
      return h('div.rc-card', {
        cls, style: `left:${n.x}px;top:${n.y}px`,
        on: () => { if (this.cur === i) return [AVK.OK]; this.select(i); },
      },
      h('span.rc-name', null, seenBy.length ? this.mapName(n.e) : '???'),
      n.lane < 0 && h('span.rc-dots', null, [0, 1, 2].map((c) => h(`i.rc-dot.c${c}${seenBy.includes(c) ? '.on' : ''}`))));
    });
    return h('div.v-scroll.rc-scroll', { scroll: this.scroll },
      h('div.rc-chart', { style: `height:${height}px` },
        lines.map((l) => h(`div.rc-line${l.arrow ? `.${l.arrow}` : ''}`, { style: `left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px` })),
        heads.map((hd) => h(`div.rc-head${hd.lane !== undefined ? `.lane.c${hd.lane}${hd.lane === lastCls ? '.pov' : ''}` : ''}`, {
          style: hd.lane !== undefined ? `left:${COL_X[hd.lane]}px;top:${hd.y}px` : `top:${hd.y}px;${hd.right ? 'right:4px' : 'left:4px'}`,
          on: hd.lane !== undefined ? () => [0x120 + hd.lane!] : undefined,
        }, hd.text)),
        cards));
  }

  private infoView(): VNode {
    const t = this.ctx.assets.text, n = this.chart.nodes[this.cur], e = n.e;
    const seenBy = [0, 1, 2].filter((c) => this.seen[c].has(e)), as = this.playAs(e), chain = !!this.ctx.options.replayChain;
    const place = (n.lane >= 0 ? `${CLASS_NAME[n.lane]}의 이야기` : CHAPTERS[n.chapter].title) + (this.afterBoss(e) ? ' · 보스 처치 후' : '');
    const line = (t[this.sdb.headers[e].textBase] ?? '').replace(/\|./g, '').replace(/@/g, ' ');
    const pov = h('div.v-row.rc-pov', null, padBadge(this.ctx.input, AVK.K1),
      [0, 1, 2].map((c) => button(CLASS_NAME[c], { sel: c === lastCls, glow: false, cls: `rc-pov-btn c${c}`, on: () => [0x120 + c] })),
      padBadge(this.ctx.input, AVK.K3));
    return h('div.v-col.rc-info', null,
      h('div.rc-info-label', null, '시점'),
      pov,
      h('div.v-col.v-grow.v-box.rc-detail', null,
        h('div.rc-place', null, place),
        seenBy.length
          ? [h('div.rc-map', null, this.mapName(e)), h('div.rc-line-text', null, line),
            h('div.v-row.rc-seen', null, '본 캐릭터', seenBy.map((c) => h(`span.rc-who.c${c}`, null, CLASS_NAME[c])))]
          : h('div.rc-locked', null, '아직 보지 못한 이야기')),
      h(`div.v-row.rc-chain${chain ? '.on' : ''}`, { on: () => [AVK.STAR] },
        h('span.rc-check', null, chain ? '✓' : ''), h('span.v-grow', null, '이어서 보기'), padBadge(this.ctx.input, AVK.STAR)),
      button([as >= 0 ? `${CLASS_NAME[as]}로 재생` : '재생할 수 없음', padBadge(this.ctx.input, AVK.OK, 'v-pad-corner')], {
        sel: as >= 0, glow: false, cls: `rc-play${as >= 0 ? '' : ' off'}`, on: () => (as >= 0 ? [AVK.OK] : undefined),
      }));
  }

  draw(): void {
    render(this.ctx, () => {
      const u = this.ctx.ui;
      frozenTitle(this.ctx);
      u.view('replayChart', 0, 0, 480, 320, h('div.v-fill.v-col.rc-screen', null,
        h('div.v-row.rc-top', null, h('span.rc-title', null, '회상'), h('span.rc-sub', null, '본 이야기만 다시 볼 수 있습니다')),
        h('div.v-row.v-grow.rc-body', null, h('div.v-box.rc-chart-box', null, this.chartView()), this.infoView())));
      u.closeButton(-44);                                           // top right, in the title row (C220 y -44 = screen 6)
    });
  }
}
