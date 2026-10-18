// 차원의 문 select / entry screen; the dungeon rules and the local floor generator are core/rules/dimension.ts.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { Popup, openPopup } from './popup';
import { OverlayStack } from '../../core/ui/overlays';
import type { GameContext } from './scene';
import { consume, countOf } from '../../core/rules/shopRules';
import { DUNGEONS, freeUsedToday, useFree } from '../../core/rules/dimension';
import type { Ui } from '../render/ui';
import { button, gt, h, sprite, type VNode } from '../render/view';
import '../styles/screens-misc.css';

/** States 0x2D (3x3 dungeon select, FUN_00026850 / FUN_00026740) and 0x2E (entry, FUN_00059984 / FUN_000528e4). */
export class DimensionScreen {
  private cur = 0;
  private confirm = false;
  private btn = 1;                                                    // 0 입 장, 1 취 소 (DAT_003b3acc = 0 → 취소 first)
  private t = 0;
  /** popups over the screen */
  private readonly overlays = new OverlayStack();
  /** the chosen dungeon once paid for */
  enter: number | null = null;
  /** popup 0x7D confirmed: the owner opens the coupon shop and comes back here */
  toCoupons = false;
  constructor(private ctx: GameContext, private fs: FieldScene) {}

  private recText(i: number): string {
    const t = this.ctx.assets.text, [lo, hi] = DUNGEONS[i].rec;
    // FUN_0007390c: 6..8 sprintf 0x1c28 "적정레벨 : %d" with 200
    return i >= 6 ? (t[0x1c28] ?? '%d').replace('%d', '200') : (t[0x1c27] ?? '%d ~ %d').replace('%d', String(lo)).replace('%d', String(hi));
  }

  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.overlays.update(presses)) return null;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (!this.confirm) {
        if (k === AVK.LEFT) this.cur = (this.cur + 8) % 9;
        else if (k === AVK.RIGHT) this.cur = (this.cur + 1) % 9;
        else if (k === AVK.UP) this.cur = (this.cur + 6) % 9;
        else if (k === AVK.DOWN) this.cur = (this.cur + 3) % 9;
        else if (k === AVK.OK) { this.confirm = true; this.btn = 1; }   // all dungeons unlocked locally
        else if (k === AVK.CLR) return 'close';
      } else {
        if (k === AVK.UP || k === AVK.LEFT) this.btn = 0;
        else if (k === AVK.DOWN || k === AVK.RIGHT) this.btn = 1;
        else if (k === AVK.CLR || (k === AVK.OK && this.btn === 1)) this.confirm = false;
        else if (k === AVK.OK) this.pay();
      }
    }
    return null;
  }

  /** free entry once a day / a ticket (0x1b, 0x1c) / 3 coupons, else popup 0x7D */
  private pay(): void {
    const inv = this.fs.inv;
    if (!freeUsedToday()) useFree();
    else if (countOf(inv, 0x1b, 0x1c) > 0) consume(inv, 0x1b, 0x1c, 1);
    else if (countOf(inv, 0x1b, 0x1b) >= 3) consume(inv, 0x1b, 0x1b, 3);
    else { openPopup(this.overlays, new Popup(this.ctx, 0x7d), undefined, { on: { close: () => { this.toCoupons = true; } } }); return; }
    this.enter = this.cur;
  }

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
  drawPopups(): void { this.overlays.draw(); }
}
