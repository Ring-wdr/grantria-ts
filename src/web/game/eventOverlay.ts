// What the event VM shows over the field (FUN_0003357c after the field pass): FILL, fades, the white flash, SHOW_ITEM,
// captions, the dialogue window and the SKIP button. The VM itself is core/field/events.ts.
import type { EventRunner } from '../../core/field/events';
import { fxScale } from '../../core/save/options';
import type { FieldScene } from './fieldScene';
import { drawCaption, drawDialogue, drawDialogueButtons } from './dialogue';
import { AVK } from '../input/input';
import type { Ui } from '../render/ui';
import { button, h, padBadge } from '../render/view';

const W = 480, H = 320;
const FLASH = [32, 32, 32, 24, 24, 16, 8, 6, 24, 16, 8, 4, 2, 0, 0];

export function drawEventOverlay(u: Ui, ev: EventRunner, fs: FieldScene): void {
  if (ev.fill) u.fill(0, 0, W, H, ev.fill === 1 ? 0x000001 : 0xffffff);
  const flashK = fxScale(fs.ctx.options.flash);              // 편의 설정: white flashes reduced / off
  if (ev.fade) {
    const a = ev.fade < 0 ? ((ev.fade + 15) * 2) : ((ev.fade - 1) * 2);
    const k = ev.fadeWhite && ev.lightMode === 2 ? flashK : 1;  // LIGHTNING's white burst
    if (a * k > 0) { u.alpha = Math.min(32, Math.round(a * k)); u.fill(0, 0, W, H, ev.fadeWhite ? 0xffffff : 0); u.alpha = 32; }
  }
  if (ev.skipFade) { u.alpha = Math.min(32, (16 - ev.skipFade) * 2); u.fill(0, 0, W, H, 0); u.alpha = 32; }
  if (ev.flash && flashK) { u.alpha = Math.round((FLASH[15 - ev.flash] ?? 0) * flashK); u.fill(0, 0, W, H, 0xffffff); u.alpha = 32; }
  if (ev.showItem) {
    const s = ev.showItem, r = fs.db.iconRect(s.icon);
    const x = s.x < 0 ? (W >> 1) - 12 : s.x - fs.cam.x - 12, y = s.y < 0 ? (H >> 1) - 12 : s.y - fs.cam.y - 24;
    u.alpha = Math.max(0, Math.min(32, Math.round(Math.sin((s.k * Math.PI) / 180 * 4) * 32)));
    u.image(r.image, r.sx, r.sy, 24, 24, x, y);
    u.alpha = 32;
  }
  if (ev.caption) drawCaption(u, ev.caption.text, ev.caption.n);
  if (ev.active) u.hit(0, 0, W, H, () => [AVK.OK]);       // tap = next line
  if (ev.dialogue) { drawDialogue(u, ev.dialogue, ev.frame); drawDialogueButtons(u, !!fs.ctx.options.auto, fs.ctx.input); }
  if (ev.active && ev.progress >= 11 && ev.skippable(ev.lastCmd) && !ev.skipFade) {
    // SKIP: the button at alpha 16 with the label blinking every 8 frames (CSS), centred in the button
    u.view('evSkip', W - 70 + fs.ctx.input.edge, 6, 50, 24,   // edge layout: at the right edge with the buttons
 button([h('span.ev-skip', null, fs.db.a.text[100] ?? 'SKIP'), padBadge(fs.ctx.input, AVK.POUND, 'ev-skip-pad')], {
      sel: true, glow: false, cls: 'ev-skip-btn', style: 'width:100%;height:100%', on: () => [AVK.POUND],
    }));
  }
}
