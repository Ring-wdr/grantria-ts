// 환경설정 → 키 설정 (not in the original): every rebindable action with its keyboard key and pad button.
// '5' / a click on a cell waits for the next key or button (Esc or 5 s cancels); taking a key from another
// action leaves that one without it. Bindings are global (input/bindings.ts), keyboard and pad only.
import { AVK } from '../input/input';
import { ACTIONS, BINDABLE_PAD, bindKey, bindPad, kbOf, keyLabel, padOf, resetBindings } from '../input/bindings';
import { padGlyph } from '../input/gamepad';
import type { GameContext } from './scene';
import { button, gt, h, type ScrollRef, type VNode } from '../render/view';

const ROW_H = 17;
const WAIT_MS = 5000;

export class KeyMapPanel {
  private cur = 0;
  /** 0 keyboard, 1 pad */
  private col: 0 | 1 = 0;
  private waiting = false;
  private waitUntil = 0;
  private msg = '';
  private scroll: ScrollRef = { y: 0 };

  constructor(private ctx: GameContext) {
    this.col = ctx.input.device === 'pad' ? 1 : 0;
  }

  private get rows(): number { return ACTIONS.length + 1; }

  /** false once closed (CLR) */
  update(presses: number[]): boolean {
    if (this.waiting) {
      if (performance.now() > this.waitUntil) this.stopWaiting('입력 시간이 지났습니다.');
      return true;
    }
    for (const k of presses) {
      if (k === AVK.UP) this.move((this.cur + this.rows - 1) % this.rows);
      else if (k === AVK.DOWN) this.move((this.cur + 1) % this.rows);
      else if (k === AVK.LEFT || k === AVK.RIGHT) this.col = this.col ? 0 : 1;
      else if (k === AVK.OK) this.activate();
      else if (k === AVK.CLR) { this.stopWaiting(''); return false; }
    }
    return true;
  }

  private move(i: number): void {
    this.cur = i;
    this.msg = '';
    const top = i * ROW_H, view = 7 * ROW_H;                         // keep the cursor row in the scrolled box
    if (top < this.scroll.y) this.scroll.y = top;
    else if (top + ROW_H > this.scroll.y + view) this.scroll.y = top + ROW_H - view;
  }

  private activate(): void {
    if (this.cur === ACTIONS.length) { resetBindings(); this.msg = '기본값으로 되돌렸습니다.'; return; }
    this.waiting = true;
    this.waitUntil = performance.now() + WAIT_MS;
    this.msg = this.col === 0 ? '새 키를 누르세요 (Esc 취소)' : '새 패드 버튼을 누르세요 (Esc 취소)';
    this.arm();
  }

  private arm(): void {
    const a = ACTIONS[this.cur], input = this.ctx.input;
    input.capture = (c) => {
      if ('cancel' in c) { this.stopWaiting('취소했습니다.'); return; }
      if (this.col === 0 && 'kb' in c) { bindKey(a.key, c.kb); this.stopWaiting(`${a.label}: ${keyLabel(c.kb)}`); return; }
      if (this.col === 1 && 'pad' in c) {
        if (!BINDABLE_PAD.includes(c.pad)) { this.msg = '방향 패드는 바꿀 수 없습니다. 다른 버튼을 누르세요.'; this.arm(); return; }
        bindPad(a.key, c.pad);
        this.stopWaiting(`${a.label}: ${padGlyph(input.padKind, c.pad)}`);
        return;
      }
      this.arm();                                                      // the other device's input: keep waiting
    };
  }

  private stopWaiting(msg: string): void {
    if (this.waiting) this.ctx.input.capture = null;
    this.waiting = false;
    if (msg) this.msg = msg;
  }

  view(): VNode {
    const kind = this.ctx.input.padKind;
    const cell = (i: number, col: 0 | 1, text: string) => {
      const on = i === this.cur && col === this.col, wait = on && this.waiting;
      return h(`span.km-cell${on ? '.on' : ''}${wait ? '.wait' : ''}`, {
        on: () => { if (this.waiting) return; this.move(i); this.col = col; return [AVK.OK]; },
      }, wait ? '…' : text || '-');
    };
    const rows = ACTIONS.map((a, i) => {
      const code = kbOf(a.key), b = padOf(a.key);
      return h(`div.v-row.km-row${i === this.cur ? '.cur' : ''}`, { on: () => { if (!this.waiting) this.move(i); } },
        gt(a.label, { cls: 'km-label' }),
        cell(i, 0, code ? keyLabel(code) : ''),
        cell(i, 1, b ? padGlyph(kind, b) : ''));
    });
    const reset = button(gt('기본값으로 되돌리기'), {
      sel: this.cur === ACTIONS.length, cls: 'km-reset',
      on: () => { if (this.waiting) return; if (this.cur === ACTIONS.length) return [AVK.OK]; this.move(ACTIONS.length); },
    });
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px' },
      h('div.v-box.v-heading', null, gt('키 설정')),
      h('div.v-row.km-row.km-head', null, h('span.km-label', null, '동작'), h('span.km-cell', null, '키보드'), h('span.km-cell', null, '패드')),
      h('div.v-box.v-grow.v-scroll.km-list', { scroll: this.scroll }, h('div.v-col', null, rows, reset)),
      h('div.v-box.km-foot', null, gt(this.msg || '←→ 키보드 / 패드, 5 바꾸기')));
  }
}
