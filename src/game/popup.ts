// Popup (FUN_0005f948 + FUN_0005f4f8) on the 1.3x layer L1 (analysis/features/ui-screens.md §0.6).
import { VIEW_H as H, VIEW_W as W } from './field';
import { AVK } from './input';
import type { GameContext } from './scene';

/** Popup (FUN_0005f948 + FUN_0005f4f8) on the 1.3x layer: definition d.dat 0x4009d7 + id*6. */
export class Popup {
  readonly type: number;
  readonly w: number;
  h: number;
  readonly textId: number;
  sel: number;
  private age = 0;
  /** extra drawing in popup coordinates (type 10 result popups: the item cell) */
  extra?: (u: import('./ui').Ui, w: number, h: number) => void;
  /** the extra drawing replaces the body text (popup 0x55 fortune result) */
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

  get yesNo(): boolean { return [2, 3, 4, 12, 13].includes(this.type); }
  handle(presses: number[]): 'yes' | 'no' | 'ok' | null {
    for (const k of presses) {
      if (this.yesNo && (k === AVK.LEFT || k === AVK.RIGHT)) this.sel ^= 1;
      else if (k === AVK.OK) return this.yesNo ? (this.sel === 0 ? 'yes' : 'no') : 'ok';
      else if (k === AVK.CLR) return this.yesNo ? 'no' : 'ok';
    }
    return null;
  }
  draw(): void {
    const u = this.ctx.ui13, { w, h } = this;
    this.age++;
    // opening animation: types 1,3,8,15,16 grow over 3 frames, the others appear at once
    const anim = [1, 3, 8, 15, 16].includes(this.type) ? ([0, 2, 4][this.age] ?? 10) : 10;
    u.push((W - w) >> 1, (H - h) >> 1);
    const sw = Math.trunc((anim * w) / 10), sh = Math.trunc((anim * h) / 10);
    u.popupFrame(((w - sw) >> 1) + 2, ((h - sh) >> 1) + 2, sw - 4, sh - 4);
    u.hit(-1000, -1000, 3000, 3000, () => []);                 // modal: swallow taps outside the buttons
    u.alpha = 16;
    u.button(4, 4, w - 8, 0x10, 0, 0);
    u.alpha = 32;
    if (anim === 10) {
      this.extra?.(u, w, h);
      const lines = this.body().split('|@');
      const y0 = this.extra ? 92 : ((h - 0x1c) - lines.length * 15) >> 1;
      if (this.id === 0) u.textId(0x3e1 + this.cls, 0x69, 0x4b, 'center', { pen: 0xffe0 });
      if (!this.hideBody) lines.forEach((ln, i) => u.string(ln, w >> 1, y0 + i * 15, 'center'));
      if (this.yesNo) {
        const c = w >> 1;
        u.glow(c + this.sel * 0x4e - 0x48, h - 0x20, 0x42, 0x1a, this.age);
        u.alpha = this.sel ? 16 : 32;
        u.button(c - 0x46, h - 0x1e, 0, 0x16, 1, 1, 400);
        u.hit(c - 0x46, h - 0x1e, 0x3e, 0x16, () => { this.sel = 0; return [AVK.OK]; });
        u.alpha = this.sel === 0 ? 16 : 32;
        u.button(c + 8, h - 0x1e, 0, 0x16, 1, 1, 401);
        u.hit(c + 8, h - 0x1e, 0x3e, 0x16, () => { this.sel = 1; return [AVK.OK]; });
        u.alpha = 32;
      } else {
        const bx = (w - 0x3e) >> 1;
        u.glow(bx - 2, h - 0x20, 0x42, 0x1a, this.age);
        u.button(bx, h - 0x1e, 0x196, 0x16, 1, 1, 0x196);
        u.hit(0, 0, w, h, () => [AVK.OK]);                       // any tap on a message popup confirms
      }
    }
    u.pop();
  }
}

