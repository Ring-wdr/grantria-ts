// 환경설정 → 편의 설정 (not in the original): settings kept outside option.dat (core/save/options.ts EXTRA_COUNTS).
// ↑↓ pick a row, ←→ / 5 change it (applied at once), Esc closes and saves. Every default is the original behaviour.
// The state and keys are core/menu/convenience.ts; this draws them.
import { AVK } from '../input/input';
import type { GameContext } from './scene';
import { gt, h, type VNode } from '../render/view';
import { ConveniencePanelLogic, ROWS } from '../../core/menu/convenience';
import '../styles/convenience.css';

export class ConveniencePanel extends ConveniencePanelLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext) { super(ctx); }

  view(): VNode {
    const o = this.ctx.options;
    const rows = ROWS.map((r, i) => {
      const v = o[r.key], cur = i === this.cur;
      const value = r.values
        ? r.values[v] ?? ''
        : [h('span.cv-bar', null, Array.from({ length: 10 }, (_, k) => h(`i${k < v ? '.on' : ''}`))), String(v)];
      return h(`div.v-row.cv-row${cur ? '.cur' : ''}`, { on: () => { if (this.cur === i) return [AVK.RIGHT]; this.move(i); } },
        h('span.cv-label', null, r.label),
        h('span.v-opt-arrow', { on: () => { this.cur = i; return [AVK.LEFT]; } }, cur ? '◀' : ''),
        h('span.cv-value', null, value),
        h('span.v-opt-arrow', { on: () => { this.cur = i; return [AVK.RIGHT]; } }, cur ? '▶' : ''));
    });
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px' },
      h('div.v-box.v-heading', null, gt('편의 설정')),
      h('div.v-box.v-grow.v-scroll.cv-list', { style: 'padding:4px 6px', scroll: this.scroll }, h('div.v-col', null, rows)),
      h('div.v-box.km-foot.cv-foot', null, gt(this.note || ROWS[this.cur].help)));
  }
}
