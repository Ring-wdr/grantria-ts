// Popup (FUN_0005f948 + FUN_0005f4f8, analysis/features/ui-screens.md §0.6): definition d.dat 0x4009d7 + id*6, the
// answer keys and the quantity popup 0x0C. The host draws them (web/game/popup.ts) on its popup layer.
import type { Assets } from '../data/assets';
import { AVK } from '../keys';
import { popupRole, type OpenOpts, type Overlay, type OverlayStack } from './overlays';

let serial = 0;

/** an item icon cell on its original sheet */
export interface IconRect { image: string; sx: number; sy: number }

/** what a card popup shows above its text: the enhance result (FUN_0005f948 case 10: the item cell, its name, a red
 *  line when destroyed) or a coupon purchase (case 0xB: icon, name, description 0xC48 + sub, coupons held -> left) */
export type PopupCard =
  | { kind: 'item'; icon: IconRect; name: string; destroyed: boolean }
  | { kind: 'coupon'; icon: IconRect; name: string; sub: number; have: number; price: number };

export class Popup {
  /** identifies this popup to the host's drawing (a new popup plays its opening animation) */
  readonly serial = ++serial;
  readonly type: number;
  readonly w: number;
  h: number;
  readonly textId: number;
  sel: number;
  /** host view content above the body text (the fortune popups); web: a VChild */
  content?: () => unknown;
  /** a card the host draws above the body text (logic-made popups carry this instead of a view) */
  card?: PopupCard;
  /** the content replaces the body text (popup 0x55 fortune result) */
  hideBody = false;
  private readonly assets: Assets;
  readonly id: number;
  readonly cls: number;
  private readonly format?: (s: string) => string;
  /** format fills sprintf-style fields of the popup text (e.g. popup 0x29 "%s ... %d") */
  constructor(src: { assets: Assets }, id: number, cls = 0, format?: (s: string) => string) {
    this.id = id; this.cls = cls; this.format = format;
    const a = this.assets = src.assets;
    this.type = a.dd(0x4009d7, id * 6);
    this.w = a.dd(0x4009d7, id * 6 + 3);
    const h0 = a.dd(0x4009d7, id * 6 + 4);
    this.sel = a.dd(0x4009d7, id * 6 + 5);
    const o = (id + 0xd8) * 2;
    this.textId = ((a.ddat[o] | (a.ddat[o + 1] << 8)) << 16) >> 16;
    const lines = this.body().split('|@').length;
    this.h = Math.max(h0, lines * 15 + 0x36);
  }
  /** the popup text with its fields filled */
  body(): string {
    const t = this.assets.text[this.textId] ?? '';
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
}

/** a Popup as an overlay of an OverlayStack (ok answers as 'yes'); the host draws it from the model */
export function popupOverlay(p: Popup): Overlay {
  return { handle: (presses) => popupRole(p.handle(presses)), model: p };
}

/** open a Popup on a stack; yes runs on its affirmative answer (yes / ok) */
export function openPopup(stack: OverlayStack, p: Popup, yes?: () => void, opts: OpenOpts = {}): Popup {
  stack.open(popupOverlay(p), { ...opts, on: { yes, ...opts.on } });
  return p;
}

/** Quantity popup 0x0C (type 7, as in shop.ts): ◀ ▶ ±1 (wrapping), +100 / -100, OK; CLR cancels. */
export class QtyPopup {
  qty = 0;
  readonly serial = ++serial;
  readonly max: number;
  constructor(max: number) { this.max = max; }
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
}
