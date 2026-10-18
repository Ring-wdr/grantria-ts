// Event / NPC dialogue state (FUN_00034b84, events.md §0.8) with the event text paging and
// typewriter of text-rendering.md §0.5: width W-12, 3 lines per page, 13 px lines, '@' breaks,
// character-based wrapping (margin 18 on a page's 3rd line, else 9), one character per frame.
// Not in the original (편의 설정): typewriter speed, auto advance and the held fast-forward. The event clock stands
// still while a page is shown, so none of them changes an event's timing. The window is drawn by web/game/dialogue.ts.
import type { Options } from '../save/options';
import { optionFps } from '../save/options';
import { readLog } from '../save/readLog';
import { stringWidth } from '../text';

const W = 480;

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
export function units(s: string): number { return s.length; }

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
  /** the lines of the page shown */
  pageLines(): string[] { return this.lines.slice(this.page * 3, this.page * 3 + 3); }
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
