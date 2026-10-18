// Event / NPC dialogue window (FUN_00034b84, events.md §0.8): window frames are c.pxl pieces of FUN_0002a270 styles
// 8 / 0xd (polish.md §5); the original has no page-end mark. Not in the original (편의 설정): the blinking ▼ at a page
// end and the LOG / AUTO buttons. The paging and typewriter are core/ui/dialogue.ts.
import { units, type Dialogue } from '../../core/ui/dialogue';
import type { Ui } from '../render/ui';
import { AVK } from '../input/input';
import { button, h, type VChild } from '../render/view';
import { keyHint } from '../input/keyHints';
import type { PadKind } from '../input/gamepad';
import '../styles/convenience.css';

const W = 480, H = 320;

/** the dialogue window with the page typed so far */
export function drawDialogue(u: Ui, d: Dialogue, frame: number): void {
  if (d.face >= 0) u.image(`face${d.face}`, 0, 0, 160, 164, W - 160, H - 231);
  namePlate(u, 2, H - 89, 84, 21);
  textBox(u, 1, H - 65, W - 2, 64);
  u.string(d.speakerName, 43, H - 85, 'center');
  let left = d.shown;
  const dy = d.shake ? ((frame & 1) ? 1 : -1) : 0;
  d.pageLines().forEach((ln, i) => {
    if (left <= 0) return;
    const vis = ln.slice(0, left);
    left -= units(ln);
    u.string(vis.endsWith('|') ? vis.slice(0, -1) : vis, 6, H - 52 + dy + i * 13);
  });
  if (d.pageDone && (frame & 8)) u.string('▼', W - 14, H - 15, 'left', { pen: 0xffe0 });
  // beside the LOG / AUTO buttons: the box's right end is under the touch confirm button
  if (d.seen) u.string('읽은 대사', 196, H - 84, 'left', { pen: 0xc618, outline: 0x3186 });
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
