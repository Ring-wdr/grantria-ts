// Popups on the 1.3x layer L1 (analysis/features/ui-screens.md §0.6); their state and keys are core/ui/popup.ts.
import { VIEW_H as H, VIEW_W as W } from '../render/field';
import { AVK } from '../input/input';
import { button, gt, h, sprite, type VChild, type VNode } from '../render/view';
import type { GameContext } from './scene';
import type { Overlay } from '../../core/ui/overlays';
import { Popup, QtyPopup, type PopupCard } from '../../core/ui/popup';

export { Popup, QtyPopup };
export { openPopup, popupOverlay } from '../../core/ui/popup';

/**
 * HTML view: the frame grows / fades in (CSS), the body (optional content view, then the text)
 * is centred and wraps to the popup width; the height follows it (at least the table height h).
 */
export function drawPopup(ctx: GameContext, p: Popup): void {
  const u = ctx.ui13, { w, h: ph } = p, t = ctx.assets.text;
  const grow = [1, 3, 8, 15, 16].includes(p.type);
  const choice = (label: number, i: number) => button(gt(t[label] ?? ''), {
    sel: p.sel === i, on: () => { p.sel = i; return [AVK.OK]; },
  });
  const buttons = p.yesNo
    ? [choice(400, 0), choice(401, 1)]
    : [button(gt(t[0x196] ?? ''), { sel: true, on: () => [AVK.OK] })];
  const body = h('div.v-popup-body', null,
    p.id === 0 && gt(t[0x3e1 + p.cls] ?? '', { pen: 0xffe0 }),
    p.content?.() as VChild,
    p.card && cardView(t, p.card),
    !p.hideBody && gt(p.body()));
  const box = h(`div.v-popup.${grow ? 'v-pop-grow' : 'v-pop-fade'}`, {
    style: `width:${w}px;min-height:${ph}px;max-height:${H - 8}px`,
    on: () => (p.yesNo ? [] : [AVK.OK]),                          // a tap on a message popup confirms
  }, h('div.u-btn.s0.v0.v-popup-bar'), body, h('div.v-popup-buttons', null, buttons));
  // modal: the backdrop swallows taps outside the popup
  u.view(`popup${p.serial}`, 0, 0, W, H, h('div.v-modal', { on: () => [] }, box));
}

/** a logic-made popup's card (core/ui/popup.ts PopupCard) */
function cardView(t: string[], c: PopupCard): VNode {
  const icon = sprite(c.icon.image, c.icon.sx, c.icon.sy, 16, 16);
  if (c.kind === 'item') {                     // enhance result: the cell, then the name (wraps) and the red line beside it
    return h('div.v-row.v-center.shop-enh-res', null,
      h('div.shop-cell', null, icon),
      h('div.v-col.shop-enh-res-text', null,
        gt(c.name),
        c.destroyed && gt(t[0x1a29] ?? '', { pen: 0xf800 })));
  }
  const short = c.have < c.price;              // coupon purchase card
  return h('div.v-col.mc-card', null,
    h('div.v-row', { style: 'gap:6px' }, icon, gt(c.name, { cls: 'v-grow v-left' })),
    gt(t[0xc48 + c.sub] ?? '', { cls: 'v-left mc-card-desc' }),
    short ? gt(t[0x1a3b] ?? '', { pen: 0xf800 }) : gt(`${t[0x1a54] ?? ''} ${c.have} → ${c.have - c.price}`, { pen: 0xffe0 }));
}

/** Quantity popup 0x0C: ◀ ▶, +100 / -100 and OK as tap targets around the amount */
export function drawQty(ctx: GameContext, q: QtyPopup): void {
  const t = ctx.assets.text;
  const step = (label: number, key: number) => h('span.shop-step', { on: () => [key] }, `${t[label] ?? ''}100`);
  const arrow = (right: boolean, key: number) => h('span.shop-arrow', { on: () => [key] }, sprite('t', 0, 19, 15, 19, { flip: right }));
  ctx.ui13.view(`qty${q.serial}`, 0, 0, W, H, h('div.v-modal', { on: () => [] },
    h('div.v-popup.v-pop-fade.v-row.shop-qty', null,
      arrow(false, AVK.LEFT),
      h('div.v-col.v-center.shop-qty-mid', null,
        step(0x55, AVK.UP),
        h('div.v-row.shop-qty-value', null, h('span.shop-label', null, t[0x52] ?? ''), h('span.shop-num', null, String(q.qty).padStart(4, '0'))),
        step(0x56, AVK.DOWN)),
      arrow(true, AVK.RIGHT),
      button(gt(t[0x1a00] ?? ''), { sel: true, on: () => [AVK.OK], cls: 'shop-btn shop-qty-ok' }))));
}

const painters = new WeakMap<GameContext, (o: Overlay) => void>();

/** OverlayStack.draw's painter for the overlays the logic opens with a model (popups) */
export function popupPaint(ctx: GameContext): (o: Overlay) => void {
  let p = painters.get(ctx);
  if (!p) {
    p = (o) => {
      if (o.model instanceof Popup) drawPopup(ctx, o.model);
      else if (o.model instanceof QtyPopup) drawQty(ctx, o.model);
    };
    painters.set(ctx, p);
  }
  return p;
}
