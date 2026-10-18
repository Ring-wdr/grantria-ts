// 차원의 문 select / entry screen; the dungeon rules and the local floor generator are core/rules/dimension.ts.
// State and keys; the host draws it (web/game/dimension.ts).
import type { FieldGame } from '../field/fieldGame';
import { AVK } from '../keys';
import { Popup, openPopup } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';
import type { Host } from '../host';
import { consume, countOf } from '../rules/shopRules';
import { DUNGEONS, freeUsedToday, useFree } from '../rules/dimension';

/** States 0x2D (3x3 dungeon select, FUN_00026850 / FUN_00026740) and 0x2E (entry, FUN_00059984 / FUN_000528e4). */
export class DimensionScreenLogic {
  protected cur = 0;
  protected confirm = false;
  protected btn = 1;                                                    // 0 입 장, 1 취 소 (DAT_003b3acc = 0 → 취소 first)
  private t = 0;
  /** popups over the screen */
  protected readonly overlays = new OverlayStack();
  /** the chosen dungeon once paid for */
  enter: number | null = null;
  /** popup 0x7D confirmed: the owner opens the coupon shop and comes back here */
  toCoupons = false;
  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

  protected recText(i: number): string {
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
}
