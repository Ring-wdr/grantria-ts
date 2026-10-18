// 회상 (not in the original): title screen → 회상 → the story chart (core/data/storyChart.ts) as a flowchart: the
// three opening arcs side by side, merging into the one shared route, chapter by chapter. Every story event has its
// card; the events a class has seen (records.seen, account-wide, written when an event ends in play) can be replayed.
// An event replays on a throwaway field built from that class's list alone (sandbox.ts), and the chart comes back
// when its script ends. The 시점 (point of view) picks the class a shared event is replayed as, when it has seen it.
// The state and keys are core/scenes/replay.ts; this draws them.
import { AVK } from '../input/input';
import type { GameContext } from './scene';
import { CHAPTERS } from '../../core/data/storyChart';
import { eventMap } from '../../core/field/fieldGame';
import { SandboxScene } from './sandbox';
import { frozenTitle, render } from './screens';
import { button, h, padBadge, type VNode } from '../render/view';
import { CLASS_NAME, COL_X, POV_KEY, ReplayListLogic } from '../../core/scenes/replay';
import '../styles/convenience.css';

export class ReplayListScene extends ReplayListLogic {
  declare protected readonly ctx: GameContext;

  protected override listening(): void {
    this.ctx.input.uiMode = true; this.ctx.input.zones = []; this.ctx.input.padField = false; this.ctx.input.confirm = false;
  }

  protected replay(cls: 0 | 1 | 2, e: number): void { void SandboxScene.replay(this.ctx, this, cls, e); }

  override update(presses: number[]): void {
    for (const t of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(t.x, t.y); if (k) presses = [...presses, ...k]; }
    super.update(presses);
  }

  constructor(ctx: GameContext) { super(ctx); }

  readonly wide = true;

  private mapName(e: number): string {
    return this.ctx.assets.text[0x1e4 + eventMap(e, this.sdb.headers[e].map)] ?? '';
  }

  private chartView(): VNode {
    const { nodes, lines, heads, height } = this.chart;
    const cards = nodes.map((n, i) => {
      const seenBy = [0, 1, 2].filter((c) => this.seen[c].has(n.e));
      const cls = [i === this.cur ? 'cur' : '', seenBy.length ? 'seen' : 'locked', n.lane === this.pov ? 'pov' : '', this.afterBoss(n.e) ? 'boss' : ''].filter(Boolean).join(' ');
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
        heads.map((hd) => h(`div.rc-head${hd.lane !== undefined ? `.lane.c${hd.lane}${hd.lane === this.pov ? '.pov' : ''}` : ''}`, {
          style: hd.lane !== undefined ? `left:${COL_X[hd.lane]}px;top:${hd.y}px` : `top:${hd.y}px;${hd.right ? 'right:4px' : 'left:4px'}`,
          on: hd.lane !== undefined ? () => [POV_KEY + hd.lane!] : undefined,
        }, hd.text)),
        cards));
  }

  private infoView(): VNode {
    const t = this.ctx.assets.text, n = this.chart.nodes[this.cur], e = n.e;
    const seenBy = [0, 1, 2].filter((c) => this.seen[c].has(e)), as = this.playAs(e), chain = !!this.ctx.options.replayChain;
    const place = (n.lane >= 0 ? `${CLASS_NAME[n.lane]}의 이야기` : CHAPTERS[n.chapter].title) + (this.afterBoss(e) ? ' · 보스 처치 후' : '');
    const line = (t[this.sdb.headers[e].textBase] ?? '').replace(/\|./g, '').replace(/@/g, ' ');
    const pov = h('div.v-row.rc-pov', null, padBadge(this.ctx.input, AVK.K1),
      [0, 1, 2].map((c) => button(CLASS_NAME[c], { sel: c === this.pov, glow: false, cls: `rc-pov-btn c${c}`, on: () => [POV_KEY + c] })),
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
