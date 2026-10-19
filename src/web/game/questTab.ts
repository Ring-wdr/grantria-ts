// Quest tab 0x21 and the detail popup MENUPOP 3 drawn (their state and keys are core/menu/questTab.ts). The detail's
// NPC portrait cell and the location string are not drawn; the body (clip 7,57,204,120) is an HTML view clipped by CSS.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { popupPaint } from './popup';
import { QuestTabLogic } from '../../core/menu/questTab';
import type { GameContext } from './scene';
import type { Ui } from '../render/ui';
import { button, gt, h, sprite, type ScrollRef, type VChild } from '../render/view';
import '../styles/skill-quest.css';

const YELLOW = 0xffe0;

/** detail body: 15 px lines; rewards keep at least two */
const LINE = 15;

export class QuestTab extends QuestTabLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene) { super(ctx, fs); }

  /** 진행도 (not in the original): kill / collect count and, for a kill quest, the habitat the monster book knows */
  private progressLine(q: number): VChild {
    const sdb = this.fs.sdb, Q = sdb.quests[q], a = this.fs.story.active.find((x) => x.q === q), t = this.ctx.assets.text;
    if (!a) return null;
    const out: VChild[] = [];
    if (Q.kind === 1) {
      const [type, need] = sdb.killCond(Q), b = this.fs.story.book[type - 3];
      out.push(gt(`진행도 ${Math.min(a.cnt, need)}/${need}`, { pen: 0x07ff }));
      if (b) out.push(gt(`서식지 ${t[470 + b.z] ?? ''}`, { pen: 0xc618 }));
    } else if (Q.kind === 0) {
      const c = sdb.collectCond(Q);
      if (c.type !== 0x1c) out.push(gt(`진행도 ${Math.min(a.cnt, c.count)}/${c.count}`, { pen: 0x07ff }));
    }
    return out;
  }

  /** FUN_0005b010: six keycap rows of the active quests (main quests tagged and yellow), empty rows dashed */
  draw(u: Ui): void {
    if (this.detail) return;                       // the detail window replaces the list
    const active = this.fs.story.active, t = this.ctx.assets.text, sdb = this.fs.sdb;
    const rows = Array.from({ length: Math.max(6, active.length) }, (_, i) => {
      const a = active[i], main = !!a && sdb.mainQuest(a.q);
      return button(a
        ? [main && h('span.qs-tag', null, t[0x28] ?? 'MAIN'), gt(t[0x514 + a.q] ?? '', { cls: 'qs-title', pen: main ? YELLOW : undefined })]
        : sprite('c', 208, 63, 7, 9, { cls: 'qs-empty' }), {
        sel: i === this.sel, cls: 'qs-row', on: () => { if (this.sel === i) return [AVK.OK]; this.sel = i; },
      });
    });
    u.mount('tab', 'quest', h('div.v-col.v-fill.v-tab.qs-list', null, rows));
  }

  drawOverlay(): void { /* no absolute-coordinate overlays */ }

  /** MENUPOP 3 detail, drawn over the tab body */
  drawPopups(): void {
    const d = this.detail;
    const u = this.ctx.ui13;
    if (d) {                                       // called inside the menu's ui13 begin/end
      u.pushCenter220();
      this.drawDetail(u, d);
      u.pop();
    }
    this.overlays.draw(popupPaint(this.ctx));
  }

  /**
   * FUN_00031f68 detail window (0,23,220,196): title bar, then a scrolling body (giver, goal,
   * rewards, story; tapping its upper / lower half scrolls), then OK (and abandon for side quests).
   */
  private drawDetail(u: Ui, d: { q: number; scroll: ScrollRef; focus: number }): void {
    const t = this.ctx.assets.text, sdb = this.fs.sdb, Q = sdb.quests[d.q], main = sdb.mainQuest(d.q);
    u.hit(-200, -200, 700, 700, () => []);         // modal: taps outside the window are swallowed
    const giver = Q.giver === 0 ? t[0x3e1 + this.fs.model.cls] : t[sdb.nameId(Q.giver)];
    const section = (label: string, pen: number | undefined, body: VChild, style?: string) =>
      [h('div.qs-rule'), gt(label, { cls: 'qs-heading', pen }), h('div.v-col.qs-lines', { style }, body)];
    const ok = button(gt(t[406] ?? ''), { sel: d.focus === 0, on: () => { d.focus = 0; return [AVK.OK]; } });
    // 추적 (not in the original): this quest on the HUD quest tracker or not (편의 설정 퀘스트 추적)
    const track = button(gt(this.tracked(d.q) ? '추적 켬' : '추적 끔'), { sel: d.focus === 1, cls: this.tracked(d.q) ? '' : 'qs-untracked',
      on: () => { d.focus = 1; return [AVK.OK]; } });
    const quit = !main && button(gt(t[0x18b] ?? ''), { sel: d.focus === 2, on: () => { d.focus = 2; return [AVK.OK]; } });
    u.mount('tab-over', 'quest-detail', h('div.u-window.v-col.v-fill.qs-detail', { on: () => [] },
      h('div.v-row.qs-head', null,
        h('span.qs-tag', null, t[0x28 + (main ? 0 : 1)] ?? ''),
        gt(t[0x514 + d.q] ?? '', { cls: 'qs-title' })),
      h('div.qs-scroll.v-scroll', { scroll: d.scroll },                // native scroll: keys, wheel, touch
        h('div.v-col.qs-body', null,
          h('div.v-row.qs-giver', null, h('span.qs-tag', null, t[0x2a] ?? 'NPC'), gt(giver ?? '')),
          section(t[0x1a44] ?? '[ 목표 ]', undefined, [gt(t[0x6dd + d.q] ?? ''), this.progressLine(d.q)]),
          section(t[0x1a45] ?? '[ 보상 ]', 0xf81f, this.rewardLines(d.q).map((ln) => gt(ln)), `min-height:${2 * LINE}px`),
          section(t[0x1a46] ?? '[ 내용 ]', undefined, gt(t[0x5ac + d.q] ?? '')))),
      h(`div.v-row.qs-bar${main ? '' : '.triple'}`, null, ok, track, quit)));
  }
}
