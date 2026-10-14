// Event / NPC dialogue window (FUN_00034b84, events.md §0.8) with the event text paging and
// typewriter of text-rendering.md §0.5: width W-12, 3 lines per page, 13 px lines, '@' breaks,
// character-based wrapping (margin 18 on a page's 3rd line, else 9), one character per frame.
// Window frames: c.pxl pieces of FUN_0002a270 styles 8 / 0xd (polish.md §5); the original has no page-end mark.
// Not in the original (편의 설정): typewriter speed, auto advance, the blinking ▼ at a page end and the LOG / AUTO
// buttons. The event clock stands still while a page is shown, so none of them changes an event's timing.
import { stringWidth } from '../render/text';
import type { Ui } from '../render/ui';
import type { Options } from '../../core/save/options';
import { optionFps } from '../../core/save/options';
import { AVK } from '../input/input';
import { button, h, type VChild } from '../render/view';
import { keyHint } from '../input/keyHints';
import type { PadKind } from '../input/gamepad';
import '../styles/convenience.css';
import { readLog } from '../../core/save/readLog';

const W = 480, H = 320;

/** Split event text into lines; a colour code still active at a line break is repeated on the next line. */
export function wrapEventText(s: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '', pen = '';
  const push = () => { lines.push(cur); cur = pen; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '|') {
      const c = s[i + 1] ?? '';
      cur += ch + c; i++;
      if ((c >= 'a' && c <= 'p') || c === 'r' || c === 'q') pen = '|' + c; else if (c === 's') pen = '';
      continue;
    }
    if (ch === '@') { push(); if (s[i + 1] === ' ') i++; continue; }
    const margin = lines.length % 3 === 2 ? 18 : 9;
    if (stringWidth(cur + ch) >= maxW - margin && cur !== pen) {
      push();
      if (ch === ' ') continue;
    }
    cur += ch;
  }
  if (cur !== pen || !lines.length) lines.push(cur);
  return lines;
}

/** visible characters of a line (a colour code counts as 2, like the original) */
function units(s: string): number { return s.length; }

export class Dialogue {
  readonly lines: string[];
  page = 0;
  /** typewriter position in characters within the page */
  shown = 0;
  /** ticks since the page was complete (auto advance) */
  private doneTicks = 0;
  /** the line was read before (읽은 대사): it may be fast-forwarded and shows a mark */
  readonly seen: boolean;

  /** textId: the game text shown, for the log and the read marks (-1 = not tracked) */
  constructor(text: string, readonly speakerName: string, readonly face: number, readonly shake = false, readonly textId = -1) {
    this.lines = wrapEventText(text, W - 12);
    this.seen = readLog().has(textId);
  }

  /** the last page was dismissed: remember the line as read (written to storage at once if new) */
  markRead(): void {
    if (this.textId < 0) return;
    readLog().mark(this.textId);
    readLog().flush();
  }

  /** held fast-forward (편의 설정 빨리 넘기기): fills the page at once and turns it after 2 ticks; true = advance now */
  fastDue(o: Options, holding: boolean): boolean {
    if (!holding || !o.skip || (o.skip === 1 && !this.seen)) return false;
    if (!this.pageDone) { this.shown = this.pageLen(); this.doneTicks = 0; return false; }
    return this.doneTicks >= 2;
  }

  get pages(): number { return Math.max(1, Math.ceil(this.lines.length / 3)); }
  private pageLines(): string[] { return this.lines.slice(this.page * 3, this.page * 3 + 3); }
  private pageLen(): number { return this.pageLines().reduce((n, l) => n + units(l), 0); }
  get pageDone(): boolean { return this.shown >= this.pageLen(); }

  /** one tick of the typewriter: 1 character in the original, more with the text speed option */
  tick(o?: Options): void {
    if (this.pageDone) { this.doneTicks++; return; }
    const step = [1, 2, 4, Infinity][o?.textSpeed ?? 0] ?? 1;
    this.shown = Math.min(this.pageLen(), this.shown + step);
    this.doneTicks = 0;
  }

  /** auto advance: the page has been complete long enough to read it (about 10 / 15 / 22 characters a second) */
  autoDue(o: Options): boolean {
    if (!o.auto || !this.pageDone) return false;
    const chars = this.pageLines().reduce((n, l) => n + l.replace(/\|./g, '').length, 0);
    const ms = [1400 + chars * 100, 900 + chars * 65, 500 + chars * 45][o.autoSpeed] ?? 900 + chars * 65;
    return this.doneTicks * (1000 / optionFps(o)) >= ms;
  }

  /** '5': finish the page, else next page; true when the last page is dismissed */
  advance(): boolean {
    if (!this.pageDone) { this.shown = this.pageLen(); return false; }
    if (this.page + 1 < this.pages) { this.page++; this.shown = 0; this.doneTicks = 0; return false; }
    return true;
  }

  draw(u: Ui, frame: number): void {
    if (this.face >= 0) u.image(`face${this.face}`, 0, 0, 160, 164, W - 160, H - 231);
    namePlate(u, 2, H - 89, 84, 21);
    textBox(u, 1, H - 65, W - 2, 64);
    u.string(this.speakerName, 43, H - 85, 'center');
    let left = this.shown;
    const dy = this.shake ? ((frame & 1) ? 1 : -1) : 0;
    this.pageLines().forEach((ln, i) => {
      if (left <= 0) return;
      const vis = ln.slice(0, left);
      left -= units(ln);
      u.string(vis.endsWith('|') ? vis.slice(0, -1) : vis, 6, H - 52 + dy + i * 13);
    });
    if (this.pageDone && (frame & 8)) u.string('▼', W - 14, H - 15, 'left', { pen: 0xffe0 });
    // beside the LOG / AUTO buttons: the box's right end is under the touch confirm button
    if (this.seen) u.string('읽은 대사', 196, H - 84, 'left', { pen: 0xc618, outline: 0x3186 });
  }
}

/** '5' or the 빨리 넘기기 key held for 0.3 s (a tap never fast-forwards) */
export class HoldSkip {
  private t = 0;
  /** a key already down when the dialogue opened (the '5' that started a talk, attack held into an event) must be let
   *  go first, so a hold never runs into pages or a shop the player did not mean to skip */
  private armed = false;
  update(held: boolean): boolean {
    if (!held) { this.armed = true; this.t = 0; return false; }
    if (this.armed) this.t++;
    return this.t >= 6;
  }
  reset(): void { this.t = 0; this.armed = false; }
}

type HintInput = { device: string; padKind: PadKind };

/** the key or pad button glyph of an action, inline after a label (nothing on touch) */
export function inlineHint(input: HintInput, key: number): VChild {
  const k = keyHint(input, key);
  return k && h(`span.u-pad.dlg-key.${k.cls.split(' ').join('.')}`, null, k.glyph);
}

/** LOG / AUTO buttons beside the name plate, each with its key: pad □ / △ (the quick-slot 1 / 2 buttons, which
 *  turn into LOG / AUTO while a page is up), keyboard L / K */
export function drawDialogueButtons(u: Ui, auto: boolean, input: HintInput): void {
  const pad = input.device === 'pad';
  u.view('dlgButtons', 90, H - 88, 130, 19, h('div.v-row.dlg-buttons', null,
    button(['LOG', inlineHint(input, pad ? AVK.K1 : AVK.LOG)], { cls: 'dlg-btn', glow: false, on: () => [AVK.LOG] }),
    button(['AUTO', inlineHint(input, pad ? AVK.K3 : AVK.AUTO)], { sel: auto, cls: `dlg-btn${auto ? ' on' : ''}`, glow: false, on: () => [AVK.AUTO] })));
}

/** CAPTION (cmd 0x1d): white centred text rising 1 px per frame over 80 frames. */
export function drawCaption(u: Ui, text: string | string[], n: number): void {
  const a = n < 10 ? 2 * n : n <= 60 ? 32 : Math.max(0, (76 - n) * 2);
  u.alpha = Math.min(32, a);
  if (Array.isArray(text)) {                       // ending staff roll (event 0x6A): L lines centred, no rise
    const L = text.length;
    text.forEach((ln, i) => u.string(ln, W >> 1, (H >> 1) - 10 * L + 22 * i, 'center', { outline: 0x3186 }));
  } else text.split('@').forEach((ln, i) => u.string(ln, W >> 1, (H >> 1) - n + i * 22, 'center', { outline: 0x3186 }));
  u.alpha = 32;
}


/** FUN_0002a270 style 8: text box (1, H−65, W−2, 64) */
function textBox(u: Ui, x: number, y: number, w: number, h: number): void {
  const d = (sx: number, sy: number, pw: number, ph: number, dx: number, dy: number, flip = 0) => u.image('c', sx, sy, pw, ph, dx, dy, flip);
  u.alpha = 24;
  u.roundFill(x + 8, y - 1, w - 16, 6, 0, 1);
  u.roundFill(x + 1, y + 5, w - 2, 57, 0, 1);
  u.alpha = 32;
  for (let yy = y + 11; yy !== y + 59; yy += 16) { d(0x58, 0x29, 3, 16, x, yy); d(0x58, 0x29, 3, 16, x + w - 3, yy); }
  const n = W >> 4;
  for (let i = 0; i < n - 1; i++) {
    if (i < n - 3) d(0x60, 0x22, 16, 3, x + 26 + 16 * i, y - 2);
    d(0x60, 0x22, 16, 3, x + 3 + 16 * i, y + h - 3);
  }
  d(0x52, 0x1c, 13, 13, x, y - 2); d(0x52, 0x1c, 13, 13, x + w - 13, y - 2, 1);
  d(0x60, 0x1c, 16, 3, x + 13, y - 2); d(0x60, 0x1c, 16, 3, x + w - 28, y - 2, 1);
  d(0x60, 0x1c, 16, 3, x + 3, y + h - 3); d(0x60, 0x1c, 16, 3, x + w - 19, y + h - 3, 1);
  d(0x55, 0x29, 3, 16, x, y + 11); d(0x55, 0x29, 3, 16, x + w - 3, y + 11);
  d(0x5b, 0x29, 3, 15, x, y + h - 16, 1); d(0x5b, 0x29, 3, 15, x + w - 3, y + h - 16);
}

/** FUN_0002a270 style 0xd: name plate (2, H−89, 84, 21) */
function namePlate(u: Ui, x: number, y: number, w: number, h: number): void {
  u.alpha = 24;
  for (let i = 0; i < 6; i++) u.fill(x + 4 + i, y + 8 - i, w - 6 - i, 1, 0);
  u.fill(x + 3, y + 9, w - 6, h - 9, 0);
  u.alpha = 32;
  u.image('c', 0x5f, 0x25, 9, 9, x, y);
  u.fill(x + 9, y, w - 10, 1, 0); u.fill(x + 1, y + h - 1, w - 2, 1, 0);
  u.fill(x, y + 9, 1, h - 10, 0); u.fill(x + w - 1, y + 1, 1, h - 2, 0);
  u.fill(x + 9, y + 1, w - 10, 1, 0xffffff); u.fill(x + 1, y + h - 2, w - 2, 1, 0xffffff);
  u.fill(x + 1, y + 9, 1, h - 11, 0xffffff); u.fill(x + w - 2, y + 1, 1, h - 2, 0xffffff);
  u.fill(x + 9, y + 2, w - 12, 1, 0); u.fill(x + 2, y + h - 3, w - 5, 1, 0);
  u.fill(x + 2, y + 9, 1, h - 12, 0); u.fill(x + w - 3, y + 2, 1, h - 4, 0);
}
