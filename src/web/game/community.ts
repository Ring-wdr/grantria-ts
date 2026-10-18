// Community menu (tab state 0x24) and the screens behind it, with the online parts replaced by local
// grants (analysis/features/online.md): coupon shop 0x28 (free), premium shop 0x25 (the client's own
// default list at .rodata 0x1039A4, paid in coupons), bag expansion (25 coupons), and a local warehouse
// shared by the three slots (state 0x29 / 0x0F; the original kept it on the server).
// The state and keys are core/menu/community.ts; this draws them.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { BAG_COUNT, type Item } from '../../core/rules/items';
import { popupPaint } from './popup';
import type { GameContext } from './scene';
import { DimensionScreen } from './dimension';
import { tint } from './mapTab';
import type { Ui } from '../render/ui';
import { button, gt, h, menuList, padBadge, sprite, type VNode } from '../render/view';
import { COUPON, CommunityTabLogic, CouponShopLogic, GOLD_DIGIT, PREMIUM, PREMIUM_ROW, PremiumShopLogic, StorageLogic, WAREHOUSE_SIZE, coupons } from '../../core/menu/community';
import '../styles/map-community.css';

/** the 16x16 item icon of (type, sub) from its original sheet */
function itemIcon(fs: FieldScene, type: number, sub: number): VNode {
  const r = fs.db.iconRect(fs.db.icon(type, sub));
  return sprite(r.image, r.sx, r.sy, 16, 16);
}

/** FUN_00078af4 style 0 digits (c.pxl 5x7 at 167 + 5d, 102, 4 px step) */
function digits(v: number, cls = ''): VNode {
  return h('span.mc-num', { cls }, [...String(Math.max(0, Math.trunc(v)))].map((d) => sprite('c', 167 + 5 * +d, 102, 5, 7)));
}

/** drawItemCell (tabs.ts) as a view: the icon, red-tinted when unusable, and the stack count at the top right */
function itemCell(fs: FieldScene, it: Item): VNode[] {
  const r = fs.db.iconRect(it.icon), usable = fs.inv.usable(it, fs.model.level, fs.model.cls);
  return [
    sprite(r.image, r.sx, r.sy, 16, 16, usable ? {} : { cls: 'mc-tint', style: tint(r.image, r.sx, r.sy, '255,0,0', 12) }),
    fs.db.showsCount(it) && digits(it.count, 'mc-qty'),
  ].filter((k): k is VNode => !!k);
}

/** Coupon shop 0x28 (FUN_000597d8 / FUN_00056528): five packages, granted locally for free. */
export class CouponShop extends CouponShopLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene) { super(ctx, fs); }

  /** FUN_000597d8: five package buttons (coupon icon, name, price) and the footer note 0x1bbd */
  draw(u: Ui): void {
    const t = this.ctx.assets.text, coupon = itemIcon(this.fs, COUPON[0], COUPON[1]);
    u.mount('tab', 'coupon', h('div.v-col.v-fill.v-tab', null,
      h('div.v-col.v-grow.mc-list', null, Array.from({ length: 5 }, (_, i) => button([
        coupon,
        gt(t[0x1bbe + i] ?? '', { cls: 'v-grow v-left' }),
        gt('무료', { pen: 0xffe0, cls: 'mc-price' }),                     // local grant (originally 1100..33000원)
      ], { sel: i === this.sel, cls: 'mc-row', on: () => { if (this.sel === i) return [AVK.OK]; this.sel = i; } }))),
      h('div.v-box.v-note', null, gt(t[0x1bbd] ?? ''))));
  }
  drawPopups(): void { this.overlays.draw(popupPaint(this.ctx)); }
}

/** Premium shop 0x25 (FUN_0005bf34 / FUN_00054cb8): 5x3 grid, info panel, '0' or 구매 buys for coupons. */
class PremiumShop extends PremiumShopLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene) { super(ctx, fs); }

  /**
   * FUN_0005bf34: 5x3 icon grid scrolled by rows (cursor kept on the middle row), the info panel
   * (name x quantity, coupon price / held) and the 가방 (#) / 구매 (0) / 창고 (*) buttons.
   */
  draw(u: Ui): void {
    const t = this.ctx.assets.text, n = PREMIUM.length, rows = Math.ceil(n / 5);
    // every row is laid out and the grid scrolls (3 rows visible), so touch reaches the rows below the third
    const total = rows * PREMIUM_ROW - (PREMIUM_ROW - 26), view = 3 * PREMIUM_ROW - (PREMIUM_ROW - 26);
    const thumbTop = Math.min(1, this.gridScroll.y / total), thumbH = Math.min(1, view / total);
    const cells = [];
    for (let i = 0; i < n; i++) {
      const [id, , qty] = PREMIUM[i];
      cells.push(h(`div.mc-cell${i === this.cur ? `.on${this.btn === null ? '.v-sel' : ''}` : ''}`, { on: () => { this.btn = null; if (this.cur === i) return [AVK.K0]; this.cur = i; this.scroll.y = 0; } },
        itemIcon(this.fs, 0x1b, id), qty > 1 && digits(qty, 'mc-qty')));
    }
    const [id, price, qty] = PREMIUM[this.cur], held = coupons(this.fs);
    u.mount('tab', 'premium', h('div.v-col.v-fill.v-tab', null,
      h('div.v-box.v-row.mc-shelf', null,
        h('div.mc-grid.v-scroll.mc-scroll-grid', { scroll: this.gridScroll }, cells),
        h('div.mc-scrollbar', null, h('div.mc-thumb', { style: `top:${thumbTop * 100}%;height:${thumbH * 100}%` }))),
      h('div.v-box.v-col.v-grow.mc-info', null,
        h('div.v-row', { style: 'gap:6px' }, itemIcon(this.fs, 0x1b, id), gt(qty > 1 ? `${this.name(id)} x${qty}` : this.name(id), { cls: 'v-grow v-left' })),
        // the item's own description (the item detail text), so the effect is not guessed from the name
        h('div.v-grow.v-scroll.mc-desc', { scroll: this.scroll }, gt(t[this.fs.db.descId(0x1b, id, 0)] ?? '', { cls: 'v-left' })),
        h('div.v-row.mc-cost', null,
          gt(`쿠폰 ${price}장`, { pen: 0xffe0 }),
          gt(`보유 ${held}`, { pen: held < price ? 0xf800 : 0xffff, cls: 'mc-held' }))),
      // 가방 '#' / 구매 '0' / 창고 '*': the focused one glows; pad badges show the shortcut triggers
      h('div.v-row.mc-buttons', null, ([[0x19e5, AVK.POUND], [0x17b, AVK.K0], [0x19e4, AVK.STAR]] as const).map(([id, key], b) =>
        button([gt(t[id] ?? ''), b !== 1 && padBadge(this.ctx.input, key, 'v-pad-corner')], {
          sel: b === 1 || this.btn === b, glow: this.btn === b, on: () => [key],
        })))));
  }
  drawPopups(): void { this.overlays.draw(popupPaint(this.ctx)); }
}

/** State 0x29 (FUN_0002b774 / keys FUN_000442f4): the inventory grid FUN_00058890 over the own bag (mode 0)
 *  or the warehouse (mode 1, 3 bags = 48, local instead of the server). Buttons (8, 0xBD) / (0x4F, 0xBD) /
 *  (0x96, 0xBD): mode 0 고급상점 / 골드전송 / 창고, mode 1 고급상점 / 창고정리 / 가방. '#' and '*' as in the
 *  original, '5' (or the move button; a tap only selects) moves the item across (창고로 0x198 / 내가방으로 0x185), '0' sorts the warehouse (창고정리, state 0x0F).
 *  골드전송 ('0' in mode 0, FUN_00043500 / FUN_00026c58): thousands of gold go into the warehouse as a type 0x1C record
 *  (net 0x12), taken back as count × 1000 gold; the warehouse is shared by the three slots, so this moves gold between them. */
class Storage extends StorageLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene, mode: 0 | 1) { super(ctx, fs, mode); }

  protected override padOpened(): void { listenDigits((d) => this.goldPad !== null && this.goldKey(GOLD_DIGIT + d)); }

  /**
   * FUN_0002b774 (grid FUN_00058890): the bag tabs (icon + item count; past the owned bags greyed out),
   * the 4x4 item grid with the selected item's name, and the three buttons of the mode.
   */
  draw(u: Ui): void {
    const t = this.ctx.assets.text, list = this.list(), n = this.bags(), shown = Math.min(BAG_COUNT, Math.max(5, n));
    this.bagScroll.follow = this.bag;
    const tabs = Array.from({ length: shown }, (_, i) => button(
      [sprite('t', 15, 24, 16, 16), i < n && digits(Math.max(0, Math.min(16, list.length - 16 * i)))], {
        sel: i === this.bag, glow: this.focus === 0,
        cls: `mc-bag${i >= n ? ' mc-off' : i === this.bag ? '' : ' mc-faint'}`,
        on: i < n ? () => { this.focus = 0; this.bag = i; this.sel = 0; } : undefined,
      }));
    const cells = Array.from({ length: 16 }, (_, k) => {
      const it = list[this.bag * 16 + k], on = this.focus === 1 && k === this.sel;
      return h(`div.mc-cell.mc-slot${on ? '.on.v-sel' : ''}`, { on: () => { this.focus = 1; this.sel = k; } },
        it && itemCell(this.fs, it));
    });
    const keys = this.buttonKeys();
    const btn = (id: number, b: number) => {
      const key = keys[b], badge = key !== null && key !== AVK.K0 && padBadge(this.ctx.input, key, 'v-pad-corner');
      return button([gt(t[id] ?? ''), badge], { sel: this.focus === 2 && this.btn === b, cls: key === null ? 'mc-off' : '', on: key === null ? undefined : () => [key] });
    };
    const it = this.focus === 1 ? list[this.bag * 16 + this.sel] : undefined;
    // '5' moves the selected item: 창고로 (0x198) / 내가방으로 (0x185), named on a button with a hint above
    const move = h('div.v-row.mc-move', null,
      h('div.mc-name.v-grow', null, it ? gt(it.name) : gt(this.mode === 0 ? '맡길 아이템 선택' : '꺼낼 아이템 선택', { pen: 0x9cd3 })),
      button(gt(t[this.mode === 0 ? 0x198 : 0x185] ?? ''), { sel: !!it, glow: false, cls: it ? 'mc-move-btn' : 'mc-move-btn mc-off', on: it ? () => [AVK.OK] : undefined }));
    u.mount('tab', 'storage', h('div.v-col.v-fill.v-tab', null,
      h('div.v-row.v-grow.mc-storage', null,
        h('div.v-col.v-scroll.v-bagcol.mc-bags', { cls: shown > 5 && 'many', scroll: this.bagScroll }, tabs),
        h('div.v-box.v-col.v-grow.mc-panel', null,
          h('div.v-row.mc-where', null, gt(t[this.mode === 0 ? 0x19e5 : 0x19e4] ?? '', { pen: 0xffe0 }), gt(`${list.length}/${this.mode === 0 ? this.fs.inv.cap : WAREHOUSE_SIZE}`)),
          h('div.mc-grid.mc-grid4', null, cells),
          move)),
      h('div.v-row.mc-buttons', null,
        btn(0x19e3, 0),                                                                    // 고급상점
        btn(this.mode === 0 ? 0x19e2 : 0x19da, 1),                                         // 골드전송 / 창고정리
        btn(this.mode === 0 ? 0x19e4 : 0x19e5, 2)),                                        // 창고 / 가방
      this.goldPad !== null && this.goldView()));
  }

  /** FUN_00026c58: title 0x19F3, 소지금, "1000 X n = n·1000", the input with a blinking '-', digit pad, 전송 / 수정 */
  private goldView(): VNode {
    const t = this.ctx.assets.text, s = this.goldPad ?? '', n = Number(s || '0');
    const key = (d: number) => button(gt(String(d)), { glow: false, cls: 'mc-gold-key', on: () => [GOLD_DIGIT + d] });
    return h('div.v-modal', { on: () => [] },
      h('div.u-window.v-col.v-pop-grow.mc-gold', null,
        gt(t[0x19f3] ?? '', { pen: 0xffe0 }),
        h('div.v-row.mc-gold-line', null, gt(t[0x19f4] ?? ''), gt(String(this.fs.inv.gold), { cls: 'v-grow v-right' })),
        h('div.v-row.mc-gold-line', null, gt(`1000 X ${n}`), gt(`= ${n * 1000}`, { cls: 'v-grow v-right' })),
        h('div.v-row.mc-gold-input', null, gt(s), (this.t >> 2) & 1 ? gt(t[0x19f5] ?? '-') : null),
        h('div.mc-gold-pad', null, [0, 2, 4, 6, 8, 1, 3, 5, 7, 9].map(key)),
        h('div.v-row.mc-buttons', null,
          button(gt(t[0x19ec] ?? ''), { sel: true, glow: false, on: () => [AVK.STAR] }),           // 전 송
          button(gt(t[0x19ed] ?? ''), { glow: false, on: () => [AVK.POUND] }),                     // 수 정
          button(gt('X'), { glow: false, on: () => [AVK.CLR] }))));
  }
  drawPopups(): void { this.overlays.draw(popupPaint(this.ctx)); }
}

let digitListener: ((e: KeyboardEvent) => void) | null = null;
/** keyboard digits (top row / numpad) while the gold pad is open; the handler returns false once it is closed */
function listenDigits(fn: (d: number) => boolean | void): void {
  if (digitListener) removeEventListener('keydown', digitListener, true);
  digitListener = (e: KeyboardEvent) => {
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (!m) return;
    if (fn(Number(m[1])) === false) { removeEventListener('keydown', digitListener!, true); digitListener = null; return; }
    e.preventDefault(); e.stopPropagation();
  };
  addEventListener('keydown', digitListener, true);
}

/** Community menu 0x24 (FUN_0005ac04 / FUN_0005666c). */
export class CommunityTab extends CommunityTabLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  declare protected screen: CouponShop | PremiumShop | Storage | DimensionScreen | null;

  constructor(ctx: GameContext, fs: FieldScene) { super(ctx, fs); }

  protected newCouponShop(): CouponShop { return new CouponShop(this.ctx, this.fs); }
  protected newPremiumShop(): PremiumShop { return new PremiumShop(this.ctx, this.fs); }
  protected newStorage(mode: 0 | 1): Storage { return new Storage(this.ctx, this.fs, mode); }
  protected newDimension(): DimensionScreen { return new DimensionScreen(this.ctx, this.fs); }

  /** FUN_0005ac04: five entries (unusable ones greyed: no save allowed here / 차원 outside the field) and the note */
  draw(u: Ui): void {
    if (this.screen) { this.screen.draw(u); return; }
    const t = this.ctx.assets.text, ok = this.usable(this.sel);
    u.mount('tab', 'community', menuList(Array.from({ length: 5 }, (_, i) => button(gt(t[i === 0 ? 0x1bbc : 0x153 + i] ?? ''), {
      sel: i === this.sel, cls: this.usable(i) ? '' : 'mc-off',
      on: () => { if (this.sel === i) return [AVK.OK]; this.sel = i; },
    })), gt(t[!ok ? 0x1a24 : this.sel === 0 ? 0x1bbd : 0x157 + this.sel] ?? '')));
  }
  drawOverlay(_u: Ui): void { /* none */ }
  drawPopups(): void { this.screen?.drawPopups(); this.overlays.draw(popupPaint(this.ctx)); }
}
