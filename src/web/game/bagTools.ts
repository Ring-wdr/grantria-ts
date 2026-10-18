// 가방 관리 (not in the original): the inventory's 가방정리 button ('#') opens 정렬 (the original 가방정리, FUN_0003b3a8(0)),
// 일괄 버리기, 조합서 버리기 (recipes 0x19 up to a grade) and 일괄 분해. Both bulk orders take what 일괄 판매 takes (core/rules/bulkSell.ts: plain equipment up to a
// grade, never premium / quest items or materials). 일괄 분해 works like the inventory's single decompose: it needs the
// 마법 해체기 (0x1b sub 9, a coupon-shop item kept as an unlock bit) and costs no gold; without it popup 0x49 offers it for
// coupons first, as the single decompose does (tabs.ts askCoupon).
// The state and keys are core/menu/bagTools.ts; this draws them.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { popupPaint } from './popup';
import type { GameContext } from './scene';
import { button, gt, h, sprite, type VNode } from '../render/view';
import { BagToolsLogic, HELP, MENU } from '../../core/menu/bagTools';

export class BagTools extends BagToolsLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene) { super(ctx, fs); }

  /** the panel over the inventory window */
  view(): VNode {
    if (this.screen === 'menu') {
      return h('div.u-window.v-col.v-fill.tb-detail.tb-tools', { on: () => [] },
        h('div.v-box.v-heading', null, gt('가방 관리', { pen: 0xffe0 })),
        h('div.v-col.v-grow.v-menu-list', null, MENU.map((label, i) => button(gt(label), {
          sel: i === this.cur, on: () => { if (this.cur === i) return [AVK.OK]; this.cur = i; },
        }))),
        h('div.v-box.v-note', null, gt(HELP[this.cur])));
    }
    const fs = this.fs, inv = fs.inv, picks = this.picks(), drop = this.screen !== 'decompose', noun = this.noun;
    const f = picks.length ? this.focus : 1;
    return h('div.u-window.v-col.v-fill.tb-detail.tb-tools', { on: () => [] },
      h('div.v-box.v-heading', null, gt(this.screen === 'recipes' ? '조합서 버리기' : drop ? '일괄 버리기' : '일괄 분해', { pen: 0xffe0 })),
      h('div.v-row.v-center.shop-bulk-grade', null,
        h('span.tb-arrow', { on: () => [AVK.DOWN] }, sprite('t', 0, 0x13, 0xf, 0x13)),
        h('span.v-grow', { style: 'text-align:center' }, `등급 0 ~ ${this.grade} · ${picks.length}개`),
        h('span.tb-arrow', { on: () => [AVK.UP] }, sprite('t', 0, 0x13, 0xf, 0x13, { flip: true }))),
      h('div.v-box.v-col.v-grow.v-scroll.shop-bulk-list', { scroll: this.list },
        picks.length ? picks.map((i) => {
          const it = inv.items[i], r = fs.db.iconRect(it.icon);
          return h('div.v-row.shop-bulk-row', null, h('div.tb-cell', null, sprite(r.image, r.sx, r.sy, 16, 16)), gt(it.name, { cls: 'v-grow tb-ellipsis' }));
        }) : h('div.v-center', { style: 'padding-top:30px' }, `해당하는 ${noun}가 없습니다.`)),
      h('div.v-row.tb-detail-foot', null,
        button(gt(drop ? '버리기' : '분해'), { cls: `tb-wide${picks.length ? '' : ' off'}`, sel: f === 0, on: () => { if (!picks.length) return; this.focus = 0; return [AVK.OK]; } }),
        button(gt('취소'), { cls: 'tb-wide', sel: f === 1, on: () => { this.focus = 1; return [AVK.OK]; } })));
  }

  drawPopup(): void { this.overlays.draw(popupPaint(this.ctx)); }
}
