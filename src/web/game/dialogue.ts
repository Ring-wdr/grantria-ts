// Event / NPC dialogue window (FUN_00034b84, events.md §0.8) with the event text paging and
// typewriter of text-rendering.md §0.5: width W-12, 3 lines per page, 13 px lines, '@' breaks,
// character-based wrapping (margin 18 on a page's 3rd line, else 9), one character per frame.
// Window frames: c.pxl pieces of FUN_0002a270 styles 8 / 0xd (polish.md §5); the original has no page-end mark.
import { stringWidth } from '../render/text';
import type { Ui } from '../render/ui';

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

  constructor(text: string, readonly speakerName: string, readonly face: number, readonly shake = false) {
    this.lines = wrapEventText(text, W - 12);
  }

  get pages(): number { return Math.max(1, Math.ceil(this.lines.length / 3)); }
  private pageLines(): string[] { return this.lines.slice(this.page * 3, this.page * 3 + 3); }
  private pageLen(): number { return this.pageLines().reduce((n, l) => n + units(l), 0); }
  get pageDone(): boolean { return this.shown >= this.pageLen(); }

  tick(): void { if (!this.pageDone) this.shown++; }

  /** '5': finish the page, else next page; true when the last page is dismissed */
  advance(): boolean {
    if (!this.pageDone) { this.shown = this.pageLen(); return false; }
    if (this.page + 1 < this.pages) { this.page++; this.shown = 0; return false; }
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
  }
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
