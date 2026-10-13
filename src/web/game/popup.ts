// Popup (FUN_0005f948 + FUN_0005f4f8) on the 1.3x layer L1 (analysis/features/ui-screens.md §0.6).
import { VIEW_H as H, VIEW_W as W } from '../render/field';
import { AVK } from '../input/input';
import { button, gt, h, sprite, type VChild } from '../render/view';
import type { GameContext } from './scene';

/** Popup (FUN_0005f948 + FUN_0005f4f8) on the 1.3x layer: definition d.dat 0x4009d7 + id*6. */
let serial = 0;

export class Popup {
  /** identifies this popup's DOM group, so a new popup plays its opening animation */
  private readonly serial = ++serial;
  readonly type: number;
  readonly w: number;
  h: number;
  readonly textId: number;
  sel: number;
  private age = 0;
  /** view content above the body text, laid out in the popup body (result item cell, fortune result) */
  content?: () => VChild;
  /** the content replaces the body text (popup 0x55 fortune result) */
  hideBody = false;
  /** format fills sprintf-style fields of the popup text (e.g. popup 0x29 "%s ... %d") */
  constructor(private ctx: GameContext, readonly id: number, private cls = 0, private format?: (s: string) => string) {
    const a = ctx.assets;
    this.type = a.dd(0x4009d7, id * 6);
    this.w = a.dd(0x4009d7, id * 6 + 3);
    const h0 = a.dd(0x4009d7, id * 6 + 4);
    this.sel = a.dd(0x4009d7, id * 6 + 5);
    const o = (id + 0xd8) * 2;
    this.textId = ((a.ddat[o] | (a.ddat[o + 1] << 8)) << 16) >> 16;
    const lines = this.body().split('|@').length;
    this.h = Math.max(h0, lines * 15 + 0x36);
  }
  private body(): string {
    const t = this.ctx.assets.text[this.textId] ?? '';
    return this.format ? this.format(t) : t;
  }

  get yesNo(): boolean { return [2, 3, 4, 11, 12, 13].includes(this.type); }
  handle(presses: number[]): 'yes' | 'no' | 'ok' | null {
    for (const k of presses) {
      if (this.yesNo && (k === AVK.LEFT || k === AVK.RIGHT)) this.sel ^= 1;
      else if (k === AVK.OK) return this.yesNo ? (this.sel === 0 ? 'yes' : 'no') : 'ok';
      else if (k === AVK.CLR) return this.yesNo ? 'no' : 'ok';
    }
    return null;
  }
  /**
   * HTML view: the frame grows / fades in (CSS), the body (optional content view, then the text)
   * is centred and wraps to the popup width; the height follows it (at least the table height h).
   */
  draw(): void {
    const u = this.ctx.ui13, { w, h: ph } = this, t = this.ctx.assets.text;
    this.age++;
    const grow = [1, 3, 8, 15, 16].includes(this.type);
    const choice = (label: number, i: number) => button(gt(t[label] ?? ''), {
      sel: this.sel === i, on: () => { this.sel = i; return [AVK.OK]; },
    });
    const buttons = this.yesNo
      ? [choice(400, 0), choice(401, 1)]
      : [button(gt(t[0x196] ?? ''), { sel: true, on: () => [AVK.OK] })];
    const body = h('div.v-popup-body', null,
      this.id === 0 && gt(t[0x3e1 + this.cls] ?? '', { pen: 0xffe0 }),
      this.content?.(),
      !this.hideBody && gt(this.body()));
    const box = h(`div.v-popup.${grow ? 'v-pop-grow' : 'v-pop-fade'}`, {
      style: `width:${w}px;min-height:${ph}px;max-height:${H - 8}px`,
      on: () => (this.yesNo ? [] : [AVK.OK]),                          // a tap on a message popup confirms
    }, h('div.u-btn.s0.v0.v-popup-bar'), body, h('div.v-popup-buttons', null, buttons));
    // modal: the backdrop swallows taps outside the popup
    u.view(`popup${this.serial}`, 0, 0, W, H, h('div.v-modal', { on: () => [] }, box));
  }
}


/** Quantity popup 0x0C (type 7, as in shop.ts): ◀ ▶ ±1 (wrapping), +100 / -100, OK; CLR cancels. */
export class QtyPopup {
  qty = 0;
  private readonly serial = ++serial;
  constructor(private ctx: GameContext, readonly max: number) {}
  handle(presses: number[]): 'ok' | 'cancel' | null {
    for (const k of presses) {
      if (k === AVK.RIGHT) this.qty = (this.qty + 1) % (this.max + 1);
      else if (k === AVK.LEFT) this.qty = (this.qty + this.max) % (this.max + 1);
      else if (k === AVK.UP) this.qty = Math.min(this.qty + 100, this.max);
      else if (k === AVK.DOWN) this.qty = this.qty < 100 ? 0 : this.qty - 100;
      else if (k === AVK.CLR) return 'cancel';
      else if (k === AVK.OK) return 'ok';
    }
    return null;
  }
  draw(): void {
    const t = this.ctx.assets.text;
    const step = (label: number, key: number) => h('span.shop-step', { on: () => [key] }, `${t[label] ?? ''}100`);
    const arrow = (right: boolean, key: number) => h('span.shop-arrow', { on: () => [key] }, sprite('t', 0, 19, 15, 19, { flip: right }));
    this.ctx.ui13.view(`qty${this.serial}`, 0, 0, W, H, h('div.v-modal', { on: () => [] },
      h('div.v-popup.v-pop-fade.v-row.shop-qty', null,
        arrow(false, AVK.LEFT),
        h('div.v-col.v-center.shop-qty-mid', null,
          step(0x55, AVK.UP),
          h('div.v-row.shop-qty-value', null, h('span.shop-label', null, t[0x52] ?? ''), h('span.shop-num', null, String(this.qty).padStart(4, '0'))),
          step(0x56, AVK.DOWN)),
        arrow(true, AVK.RIGHT),
        button(gt(t[0x1a00] ?? ''), { sel: true, on: () => [AVK.OK], cls: 'shop-btn shop-qty-ok' }))));
  }
}
