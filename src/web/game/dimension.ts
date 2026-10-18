// 차원의 문 select / entry screen; the dungeon rules and the local floor generator are core/rules/dimension.ts.
// The state and keys are core/menu/dimension.ts; this draws them.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { popupPaint } from './popup';
import type { GameContext } from './scene';
import { countOf } from '../../core/rules/shopRules';
import { freeUsedToday } from '../../core/rules/dimension';
import type { Ui } from '../render/ui';
import { button, gt, h, sprite, type VNode } from '../render/view';
import { DimensionScreenLogic } from '../../core/menu/dimension';
import '../styles/screens-misc.css';

/** States 0x2D (3x3 dungeon select, FUN_00026850 / FUN_00026740) and 0x2E (entry, FUN_00059984 / FUN_000528e4). */
export class DimensionScreen extends DimensionScreenLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene) { super(ctx, fs); }

  /** FUN_00026850 select (name, 3x3 dungeon icons, recommended level) / FUN_00059984 entry
   *  (icon, name, recommended level, ticket message, 입 장 / 취 소) as a view in the tab body */
  draw(u: Ui): void {
    u.mount('tab', 'dimension', this.confirm ? this.confirmView() : this.selectView());
  }

  private icon(k: number): VNode {
    return sprite('dungeon', (k & 3) * 30, (k >> 2) * 30, 30, 30);
  }

  private selectView(): VNode {
    const t = this.ctx.assets.text, i = this.cur;
    return h('div.v-col.v-fill.v-tab', null,
      h('div.v-box.v-heading', null, gt(t[0x4d8 + i] ?? '', { pen: 0xffe0 })),
      h('div.v-box.v-grow.v-center.v-col', null,
        h('div.sm-dim-grid', null, Array.from({ length: 9 }, (_, k) => h(`div.sm-dim-cell${k === i ? '.v-sel.cur' : ''}`, {
          on: () => { if (this.cur === k) return [AVK.OK]; this.cur = k; },
        }, this.icon(k))))),
      h('div.v-box.v-note', null, gt(this.recText(i))));
  }

  private confirmView(): VNode {
    const t = this.ctx.assets.text, i = this.cur;
    const tickets = countOf(this.fs.inv, 0x1b, 0x1c);
    const msg = tickets > 0 ? (t[0x1b19] ?? '').replace('%d', String(tickets))
      : !freeUsedToday() ? '하루 한 번 무료로 입장할 수 있습니다.' : (t[0x1c10] ?? '');
    return h('div.v-col.v-fill.v-tab', null,
      h('div.v-box.v-col.v-grow.sm-dim-confirm', null,
        h('div.v-row', { style: 'gap:10px' }, h('div.sm-dim-cell', null, this.icon(i)), gt(t[0x4d8 + i] ?? '', { pen: 0xffe0, cls: 'v-grow v-left' })),
        h('div.v-rule.sm-rule'),
        gt(this.recText(i)),
        h('div.v-grow.v-center.v-col', null, gt(msg.replace(/%d/g, '0')))),
      h('div.v-row.sm-buttons', null, ([[0, 0x1a39], [1, 0x1a2b]] as const).map(([b, id]) => button(gt(t[id] ?? ''), {
        sel: this.btn === b, cls: 'sm-wide', on: () => { if (this.btn === b) return [AVK.OK]; this.btn = b; },
      }))));
  }
  drawPopups(): void { this.overlays.draw(popupPaint(this.ctx)); }
}
