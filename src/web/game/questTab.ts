// Quest tab 0x21 (FUN_0005b010 / keys FUN_00056df0) and the detail popup MENUPOP 3 (FUN_00031f68,
// keys FUN_00044564), analysis/features/ui-tabs.md §0.8. The detail's NPC portrait cell and the
// location string are not drawn; the body (clip 7,57,204,120) is an HTML view clipped by CSS.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { Popup, openPopup, popupPaint } from './popup';
import { OverlayStack } from '../../core/ui/overlays';
import { untrackKey } from '../../core/rules/quests';
import type { GameContext } from './scene';
import type { Ui } from '../render/ui';
import { button, gt, h, sprite, type ScrollRef, type VChild } from '../render/view';
import '../styles/skill-quest.css';

const YELLOW = 0xffe0;

/** detail body: 15 px lines; rewards keep at least two */
const LINE = 15;

export class QuestTab {
  private sel = 0;
  private t = 0;
  /** focus: 0 확인, 1 추적 켬 / 끔 (not in the original), 2 포기 (side quests) */
  private detail: { q: number; scroll: ScrollRef; focus: number } | null = null;
  /** popups over the tab */
  private readonly overlays = new OverlayStack();

  constructor(private ctx: GameContext, private fs: FieldScene) {}

  get busy(): boolean { return !!(this.detail || this.overlays.size); }

  update(presses: number[]): boolean {
    this.t++;
    const active = this.fs.story.active;
    if (this.overlays.update(presses)) return true;
    if (this.detail) {
      const d = this.detail, n = this.fs.sdb.mainQuest(d.q) ? 2 : 3;
      for (const k of presses) {
        if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
        if (k === AVK.LEFT) d.focus = (d.focus + n - 1) % n;
        else if (k === AVK.RIGHT) d.focus = (d.focus + 1) % n;
        else if (k === AVK.UP) d.scroll.y = Math.max(0, d.scroll.y - 15);
        else if (k === AVK.DOWN) d.scroll.y += 15;                     // the browser clamps at the end
        else if (k === AVK.OK) {
          if (d.focus === 2) openPopup(this.overlays, new Popup(this.ctx, 0x51), () => { if (this.detail) this.abandon(this.detail.q); this.detail = null; });
          else if (d.focus === 1) this.toggleTracked(d.q);
          else this.detail = null;
        }
        else if (k === AVK.CLR) this.detail = null;
      }
      return true;
    }
    for (const k of presses) {
      if (k === AVK.UP) this.sel = (this.sel + 5) % 6;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 6;
      else if (k === AVK.OK) { const a = active[this.sel]; if (a) this.detail = { q: a.q, scroll: { y: 0 }, focus: 0 }; }
      else return false;
    }
    return true;
  }

  tracked(q: number): boolean { return !this.fs.story.counters[untrackKey(q)]; }

  private toggleTracked(q: number): void {
    const c = this.fs.story.counters, k = untrackKey(q);
    if (c[k]) delete c[k]; else c[k] = 1;
  }

  /** FUN_0001c59c: back to "available", accept items taken back, slot removed */
  private abandon(q: number): void {
    const { story, sdb, inv } = this.fs;
    delete story.counters[untrackKey(q)];                            // a quest taken again is tracked again
    story.qs[q] = 1;
    story.active = story.active.filter((a) => a.q !== q);
    const it = sdb.quests[q].acceptItem;
    if (it >= 0 && it < 100) inv.removeKey(it);                     // only the key store is searched (0x1d stays)
  }

  private rewardLines(q: number): string[] {
    const Q = this.fs.sdb.quests[q], out: string[] = [];
    const exp = (Q.exp & 0x1fff) << 3;
    if (exp) out.push(`EXP ${exp}`);
    const r = this.fs.sdb.rewardOf(Q);
    if (r) {
      if (r.type === 0x1c) out.push(`${r.count * 50} Gold`);
      else {
        const it = this.fs.db.create(r.type, r.sub, 0, this.fs.rng, true);
        out.push(`${this.fs.db.makeName(it, this.fs.rng)}${r.count > 1 ? ` x${r.count}` : ''}`);
      }
    }
    return out;
  }

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
    const rows = Array.from({ length: 6 }, (_, i) => {
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
