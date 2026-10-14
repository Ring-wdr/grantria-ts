// Community menu (tab state 0x24) and the screens behind it, with the online parts replaced by local
// grants (analysis/features/online.md): coupon shop 0x28 (free), premium shop 0x25 (the client's own
// default list at .rodata 0x1039A4, paid in coupons), bag expansion (25 coupons), and a local warehouse
// shared by the three slots (state 0x29 / 0x0F; the original kept it on the server).
import { account, saveAccount } from '../../core/rules/account';
import { cfmt } from '../../core/data/skillDetail';
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { BAG_COUNT, BAG_MAX, UNLOCK_1B, type Item } from '../../core/rules/items';
import { Popup, openPopup } from './popup';
import { OverlayStack } from './overlays';
import { Rng } from '../../core/rules/rules';
import { loadWarehouse, saveWarehouse } from '../../core/save/save';
import type { GameContext } from './scene';
import { consume, countOf } from '../../core/rules/shopRules';
import { DimensionScreen } from './dimension';
import { tint } from './mapTab';
import type { Ui } from '../render/ui';
import { button, gt, h, menuList, padBadge, sprite, type ScrollRef, type VNode } from '../render/view';
import '../styles/map-community.css';

const COUPON = [0x1b, 0x1b] as const;
const COUPON_MAX = 9999;
/** FUN_00020024: coupons per package (the 10/60/140/300/800 table only feeds the cap check 0x7A) */
const COUPON_PACK = [10, 33, 60, 130, 450];
const COUPON_CAP_CHECK = [10, 60, 140, 300, 800];
/** FUN_0003d020(7) default premium list .rodata 0x1039A4: (0x1b id, coupon price, quantity) */
const PREMIUM: [number, number, number][] = [
  [13, 23, 1], [25, 25, 1], [24, 39, 1], [29, 25, 1], [26, 12, 1], [8, 23, 1], [1, 19, 1], [9, 25, 1],
  [10, 25, 1], [18, 12, 1], [19, 9, 1], [20, 9, 1], [30, 3, 1], [14, 3, 1], [2, 3, 10], [28, 15, 5],
  [3, 9, 10], [12, 9, 10], [0, 19, 5], [11, 9, 10], [7, 19, 1], [4, 9, 1], [5, 9, 1], [6, 9, 1],
  [21, 5, 10], [22, 5, 10], [23, 5, 10], [34, 3, 1], [39, 19, 1], [40, 23, 1], [41, 29, 1], [42, 98, 1],
  // server-list point products (FUN_000752bc), not in the client list; local coupon prices
  [0x2f, 29, 1], [0x31, 19, 1], [0x32, 19, 1],
];
/** point products: gd[0x371] / +0x32a7 / +0x32a8 counters, refused (0x65) above 9 (FUN_00054cb8) */
const POINT_PACKS = new Set([0x2f, 0x31, 0x32]);
/** ids whose stack is capped at 9999 (FUN_00054cb8 cap check) */
const STACKED = new Set([0, 2, 3, 4, 5, 6, 7, 0xb, 0xc, 0x15, 0x16, 0x17, 0x1b, 0x1c]);
/** premium grid row pitch: 26 px cells + 4 px row gap (.mc-shelf .mc-grid) */
const PREMIUM_ROW = 30;
export const BAG_PRICE = 25;
export const WAREHOUSE_SIZE = 48;


export function coupons(fs: FieldScene): number { return countOf(fs.inv, COUPON[0], COUPON[1]); }

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

/** save after a grant the way FUN_00020024 does: at once where saving is allowed outside the garden */
function grantSave(fs: FieldScene): void { if (fs.canSave && fs.gardenMode === 0) fs.autosave(); }

/** bag expansion (popup 0x7E yes, FUN_00053510 case 0x44): 25 coupons, at most BAG_MAX bags (the original 2: 48 -> 64 -> 80) */
export function buyBag(ctx: GameContext, fs: FieldScene): Popup {
  if (fs.inv.bags >= BAG_MAX) return new Popup(ctx, 0x65);
  if (coupons(fs) < BAG_PRICE) return new Popup(ctx, 0x7d);
  consume(fs.inv, COUPON[0], COUPON[1], BAG_PRICE);
  fs.inv.setBags(fs.inv.bags + 1);
  grantSave(fs);
  return new Popup(ctx, 0x6a, 0, () => ctx.assets.text[0x4e9] ?? '');
}

/** Coupon shop 0x28 (FUN_000597d8 / FUN_00056528): five packages, granted locally for free. */
export class CouponShop {
  private sel = 0;
  private t = 0;
  /** popups over the screen (read by the game over screen: no close button while one is open) */
  readonly overlays = new OverlayStack();
  constructor(private ctx: GameContext, private fs: FieldScene) {}

  /** 'close' on CLR */
  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.overlays.update(presses)) return null;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (k === AVK.UP) this.sel = (this.sel + 4) % 5;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 5;
      else if (k === AVK.CLR) return 'close';
      else if (k === AVK.OK) this.buy();
    }
    return null;
  }

  private buy(): void {
    const fs = this.fs, i = this.sel, t = this.ctx.assets.text;
    if (coupons(fs) + COUPON_CAP_CHECK[i] >= COUPON_MAX + 1) { openPopup(this.overlays, new Popup(this.ctx, 0x7a)); return; }
    openPopup(this.overlays, new Popup(this.ctx, 0x74), () => {
      if (coupons(fs) === 0 && fs.inv.items.length >= fs.inv.cap) { openPopup(this.overlays, new Popup(this.ctx, 0x52)); return; }
      fs.inv.gain(COUPON[0], COUPON[1], 0, COUPON_PACK[i], fs.rng);
      grantSave(fs);
      openPopup(this.overlays, new Popup(this.ctx, 0x75, 0, (s) => s.replace('%s', t[0x1bbe + i] ?? '')));
    });
  }

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
  drawPopups(): void { this.overlays.draw(); }
}

/**
 * Popup kind 11 (FUN_0005f948 case 0xB -> FUN_0004bd98): an item card for a coupon purchase — icon, name, the item's
 * description (0xC48 + sub), then "내쿠폰 N -> N - price" and the body 0x1C14 with 0x1C13 "쿠폰 %d장에 구매하시겠습니까?";
 * with too few coupons only 0x1A3B "쿠폰이 부족합니다." and no body. 0x4C premium purchase, 0x4D coupon revive.
 */
export function couponCard(ctx: GameContext, fs: FieldScene, id: 0x4c | 0x4d, sub: number, price: number, name: string): Popup {
  const t = ctx.assets.text, have = coupons(fs), short = have < price;
  const p = new Popup(ctx, id, 0, (s) => cfmt(s, cfmt(t[0x1c13] ?? '', price, t[0x8e] ?? '')));
  p.hideBody = short;
  p.content = () => h('div.v-col.mc-card', null,
    h('div.v-row', { style: 'gap:6px' }, itemIcon(fs, 0x1b, sub), gt(name, { cls: 'v-grow v-left' })),
    gt(t[0xc48 + sub] ?? '', { cls: 'v-left mc-card-desc' }),
    short ? gt(t[0x1a3b] ?? '', { pen: 0xf800 }) : gt(`${t[0x1a54] ?? ''} ${have} → ${have - price}`, { pen: 0xffe0 }));
  return p;
}

/** Premium shop 0x25 (FUN_0005bf34 / FUN_00054cb8): 5x3 grid, info panel, '0' or 구매 buys for coupons. */
class PremiumShop {
  private cur = 0;
  private t = 0;
  /** popups over the screen (read by the game over screen: no close button while one is open) */
  readonly overlays = new OverlayStack();
  /** '#' bag view / '*' warehouse requested, or the coupon shop after popup 0x7D */
  request: 'bag' | 'warehouse' | 'coupon' | null = null;
  private names = new Map<number, string>();
  private scroll: ScrollRef = { y: 0 };
  /** the icon grid scrolls natively (touch / wheel); keys move it so the cursor sits on the bottom row of three */
  private gridScroll: ScrollRef = { y: 0 };
  /** controller focus on the button row (0 가방, 1 구매, 2 창고): DOWN from the last grid row, UP back */
  private btn: number | null = null;
  constructor(private ctx: GameContext, private fs: FieldScene) {}

  private name(id: number): string {
    if (!this.names.has(id)) this.names.set(id, this.fs.db.create(0x1b, id, 0, new Rng(1n, () => 0)).name);
    return this.names.get(id)!;
  }

  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.overlays.update(presses)) return null;
    const n = PREMIUM.length, cur0 = this.cur;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (this.btn !== null && (k === AVK.LEFT || k === AVK.RIGHT || k === AVK.UP || k === AVK.OK)) {
        if (k === AVK.LEFT) this.btn = (this.btn + 2) % 3;
        else if (k === AVK.RIGHT) this.btn = (this.btn + 1) % 3;
        else if (k === AVK.UP) this.btn = null;
        else if (this.btn === 0) this.request = 'bag';
        else if (this.btn === 2) this.request = 'warehouse';
        else this.buy();
      }
      else if (k === AVK.LEFT) this.cur = (this.cur + n - 1) % n;
      else if (k === AVK.RIGHT) this.cur = (this.cur + 1) % n;
      else if (k === AVK.UP) this.cur = Math.max(0, this.cur - 5);
      else if (k === AVK.DOWN) { if (this.cur + 5 >= Math.ceil(n / 5) * 5) this.btn ??= 1; else this.cur = Math.min(n - 1, this.cur + 5); }
      else if (k === AVK.K0 || k === AVK.OK) this.buy();
      else if (k === AVK.POUND) this.request = 'bag';
      else if (k === AVK.STAR) this.request = 'warehouse';
      else if (k === AVK.CLR) return 'close';
    }
    if (this.cur !== cur0) {
      this.scroll.y = 0;
      this.gridScroll.y = Math.max(0, Math.floor(this.cur / 5) - 2) * PREMIUM_ROW;   // FUN_0005bf34 top row
    }
    return null;
  }

  private buy(): void {
    const fs = this.fs, [id, price, qty] = PREMIUM[this.cur];
    // FUN_00054cb8: bag at most 2 (BAG_MAX here), stacks at most 9999, unlock items (1 / 9 / 10 / 13) once (+0x32a5 bit) -> 0x65
    const unlock = (UNLOCK_1B as readonly number[]).includes(id);
    const packCount = id === 0x2f ? account().traitBought : id === 0x31 ? fs.packs[0] : fs.packs[1];
    const capped = POINT_PACKS.has(id) ? packCount > 9
      : id === 8 ? fs.inv.bags >= BAG_MAX : unlock ? fs.inv.unlocked(id) : STACKED.has(id) && countOf(fs.inv, 0x1b, id) + qty > COUPON_MAX;
    if (capped) { openPopup(this.overlays, new Popup(this.ctx, 0x65)); return; }
    if (coupons(fs) < price) { openPopup(this.overlays, new Popup(this.ctx, 0x7d), () => { this.request = 'coupon'; }); return; }
    openPopup(this.overlays, couponCard(this.ctx, fs, 0x4c, id, price, qty > 1 ? `${this.name(id)} x${qty}` : this.name(id)), () => {
      if (POINT_PACKS.has(id)) {                                     // FUN_000752bc: points at once, nothing in the bag
        consume(fs.inv, COUPON[0], COUPON[1], price);
        if (id === 0x2f) { const a = account(); a.traitBought++; a.traitPoints++; saveAccount(); }
        else if (id === 0x31) { fs.packs[0]++; fs.statPoints += 30; }
        else { fs.packs[1]++; fs.skillPoints += 5; }
        grantSave(fs);
        openPopup(this.overlays, new Popup(this.ctx, 0x6a, 0, () => this.ctx.assets.text[0x4ea] ?? ''));
        return;
      }
      if (id === 8) { consume(fs.inv, COUPON[0], COUPON[1], price); fs.inv.setBags(fs.inv.bags + 1); grantSave(fs);
        openPopup(this.overlays, new Popup(this.ctx, 0x6a, 0, () => this.ctx.assets.text[0x4e9] ?? '')); return; }
      if (!unlock && fs.inv.items.length >= fs.inv.cap && !(STACKED.has(id) && countOf(fs.inv, 0x1b, id))) { openPopup(this.overlays, new Popup(this.ctx, 0x52)); return; }
      consume(fs.inv, COUPON[0], COUPON[1], price);
      fs.inv.gain(0x1b, id, 0, qty, fs.rng);
      grantSave(fs);
      // FUN_000752bc: permanent unlock items (1 / 9 / 10 / 13) point to the character page (0x506), the rest 0x4EA
      openPopup(this.overlays, new Popup(this.ctx, 0x6a, 0, () => this.ctx.assets.text[unlock ? 0x506 : 0x4ea] ?? ''));
    });
  }

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
  drawPopups(): void { this.overlays.draw(); }
}

/** State 0x29 (FUN_0002b774 / keys FUN_000442f4): the inventory grid FUN_00058890 over the own bag (mode 0)
 *  or the warehouse (mode 1, 3 bags = 48, local instead of the server). Buttons (8, 0xBD) / (0x4F, 0xBD) /
 *  (0x96, 0xBD): mode 0 고급상점 / 골드전송 / 창고, mode 1 고급상점 / 창고정리 / 가방. '#' and '*' as in the
 *  original, '5' (or the move button; a tap only selects) moves the item across (창고로 0x198 / 내가방으로 0x185), '0' sorts the warehouse (창고정리, state 0x0F).
 *  골드전송 ('0' in mode 0, FUN_00043500 / FUN_00026c58): thousands of gold go into the warehouse as a type 0x1C record
 *  (net 0x12), taken back as count × 1000 gold; the warehouse is shared by the three slots, so this moves gold between them. */
class Storage {
  mode: 0 | 1;
  private bag = 0;
  private sel = 0;
  /** 0 bag tabs, 1 grid, 2 button row (controller: DOWN from the grid's last row) */
  private focus: 0 | 1 | 2 = 1;
  private btn = 0;
  private t = 0;
  /** popups over the screen (read by the game over screen: no close button while one is open) */
  readonly overlays = new OverlayStack();
  request: 'premium' | null = null;
  /** 골드전송 input (DAT_00403420, thousands) while the pad is open (DAT_003b3c6e) */
  private goldPad: string | null = null;
  /** bag tab column scroll (the own bags go up to BAG_COUNT) */
  private bagScroll: ScrollRef = { y: 0 };
  constructor(private ctx: GameContext, private fs: FieldScene, mode: 0 | 1) { this.mode = mode; }

  /** FUN_00043500: digits (up to 11, value at most 10000), '#' deletes, '*' sends, CLR closes. The original keypad's
   *  digit keys are also the arrows here, so digits come as GOLD_DIGIT + d from the pad buttons and the keyboard digit
   *  keys; the d-pad steps the amount (up / down ±1, right / left ±10 thousand) and OK sends. */
  private goldKey(k: number): void {
    const s = this.goldPad!;
    const set = (v: number) => { this.goldPad = v > 0 ? String(Math.min(10000, v)) : ''; };
    if (k >= GOLD_DIGIT && k <= GOLD_DIGIT + 9) {
      if (s.length < 11) { this.goldPad = s + String(k - GOLD_DIGIT); this.ctx.audio.playSfx(0x2f); }
      if (Number(this.goldPad) > 10000) this.goldPad = this.goldPad!.slice(0, -1);
    } else if (k === AVK.UP || k === AVK.DOWN || k === AVK.LEFT || k === AVK.RIGHT) {
      set(Number(s || '0') + (k === AVK.UP ? 1 : k === AVK.DOWN ? -1 : k === AVK.RIGHT ? 10 : -10));
    } else if (k === AVK.POUND) this.goldPad = s.slice(0, -1);
    else if (k === AVK.CLR) this.goldPad = null;
    else if (k === AVK.STAR || k === AVK.OK) this.sendGold();
  }

  /** '*': 0 -> popup 0x0D, more than held -> 0x4B, else a 0x1C record of n into the warehouse (text 0x4EC) */
  private sendGold(): void {
    const fs = this.fs, n = Number(this.goldPad || '0'), t = this.ctx.assets.text;
    if (n * 1000 === 0) { openPopup(this.overlays, new Popup(this.ctx, 0x0d)); return; }
    if (n * 1000 > fs.inv.gold) { openPopup(this.overlays, new Popup(this.ctx, 0x4b)); return; }
    const wh = loadWarehouse();
    if (wh.length >= WAREHOUSE_SIZE) { openPopup(this.overlays, new Popup(this.ctx, 0x6a, 0, () => t[0x4f8] ?? '')); return; }
    wh.push(goldRecord(fs, n));
    saveWarehouse(wh);
    fs.inv.gold -= n * 1000;
    grantSave(fs);
    openPopup(this.overlays, new Popup(this.ctx, 0x6a, 0, () => t[0x4ec] ?? ''));
  }

  private list(): (Item | undefined)[] { return this.mode === 0 ? this.fs.inv.items : loadWarehouse(); }
  private bags(): number { return this.mode === 0 ? this.fs.inv.bags + 3 : 3; }

  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.overlays.update(presses)) return null;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (this.goldPad !== null) { this.goldKey(k); continue; }
      if (k === AVK.POUND) { if (this.mode === 1) { this.mode = 0; this.bag = 0; } else this.request = 'premium'; }
      else if (k === AVK.STAR) { if (this.mode === 0) { this.mode = 1; this.bag = 0; } else this.request = 'premium'; }
      else if (k === AVK.K0) { if (this.mode === 1) this.sortWarehouse(); else { this.goldPad = ''; this.ctx.audio.playSfx(0x2f); listenDigits((d) => this.goldPad !== null && this.goldKey(GOLD_DIGIT + d)); } }
      else if (this.focus === 2) {
        if (k === AVK.LEFT) this.btn = (this.btn + 2) % 3;
        else if (k === AVK.RIGHT) this.btn = (this.btn + 1) % 3;
        else if (k === AVK.UP) this.focus = 1;
        else if (k === AVK.OK) { const key = this.buttonKeys()[this.btn]; if (key !== null) this.update([key]); }
        else if (k === AVK.CLR) this.focus = 1;
      }
      else if (this.focus === 0) {
        if (k === AVK.UP || k === AVK.DOWN) { const n = this.bags(); this.bag = (this.bag + (k === AVK.UP ? n - 1 : 1)) % n; this.sel = 0; }
        else if (k === AVK.OK || k === AVK.RIGHT) this.focus = 1;
        else if (k === AVK.CLR) return 'close';
      } else {
        if (k === AVK.LEFT) { if (this.sel & 3) this.sel--; else this.focus = 0; }
        else if (k === AVK.RIGHT && (this.sel & 3) < 3) this.sel++;
        else if (k === AVK.UP && this.sel >= 4) this.sel -= 4;
        else if (k === AVK.DOWN) { if (this.sel < 12) this.sel += 4; else { this.focus = 2; this.btn = this.mode === 0 ? 2 : 1; } }
        else if (k === AVK.OK) this.move();
        else if (k === AVK.CLR) this.focus = 0;
      }
    }
    return null;
  }

  /** keys of the three buttons: 고급상점 / 골드전송 (off) or 창고정리 / 창고 or 가방 */
  private buttonKeys(): (number | null)[] {
    return this.mode === 0 ? [AVK.POUND, AVK.K0, AVK.STAR] : [AVK.STAR, AVK.K0, AVK.POUND];
  }

  /** 창고정리 (FUN_0003b3a8(2)): by type, sub, grade */
  private sortWarehouse(): void {
    const wh = loadWarehouse().sort((a, b) => a.type - b.type || a.sub - b.sub || b.grade - a.grade);
    saveWarehouse(wh);
  }

  /** '5': send to the warehouse (item menu 0x14 창고로) or back to the bag (0x185 내가방으로) */
  private move(): void {
    const fs = this.fs, idx = this.bag * 16 + this.sel;
    if (this.mode === 0) {
      const it = fs.inv.items[idx];
      if (!it) return;
      if (it.type === 0x1b || it.type === 0x18) { openPopup(this.overlays, new Popup(this.ctx, 0x7c)); return; }   // not storable
      const wh = loadWarehouse();
      if (wh.length >= WAREHOUSE_SIZE) { openPopup(this.overlays, new Popup(this.ctx, 0x52)); return; }
      fs.inv.remove(idx);
      wh.push(it);
      saveWarehouse(wh);
    } else {
      const wh = loadWarehouse(), it = wh[idx];
      if (!it) return;
      if (it.type === 0x1c) {                                        // FUN_000750bc: a gold record gives count × 1000
        fs.inv.gain(0x1c, it.count * 1000, 0, 1, fs.rng);
        wh.splice(idx, 1);
        saveWarehouse(wh);
        grantSave(fs);
        openPopup(this.overlays, new Popup(this.ctx, 0x6a, 0, () => this.ctx.assets.text[0x4ec] ?? ''));
        return;
      }
      if (!fs.inv.gain(it.type, it.sub, it.grade, it.count, fs.rng, it)) { openPopup(this.overlays, new Popup(this.ctx, 0x52)); return; }
      wh.splice(idx, 1);
      saveWarehouse(wh);
    }
    fs.recompute();
    grantSave(fs);
  }

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
  drawPopups(): void { this.overlays.draw(); }
}

/** gold pad digit keys (not AVK: the AVK digit codes double as arrows and quick-slot keys) */
const GOLD_DIGIT = 0x300;
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

/** warehouse gold record (type 0x1C, count = thousands of gold) shown with the gold icon */
function goldRecord(fs: FieldScene, n: number): Item {
  const it = fs.db.create(0x1b, 0x1b, 0, new Rng(1n, () => 0));
  return { ...it, type: 0x1c, sub: 0, count: n, icon: 324, name: `${n * 1000} Gold`, price: 0 };
}

/** Community menu 0x24 (FUN_0005ac04 / FUN_0005666c). */
export class CommunityTab {
  private sel = 0;
  private t = 0;
  private readonly overlays = new OverlayStack();
  private screen: CouponShop | PremiumShop | Storage | DimensionScreen | null = null;
  /** the screen a coupon shop opened by popup 0x7D returns to */
  private back: PremiumShop | DimensionScreen | null = null;
  /** menu tab a coupon shop opened from another tab returns to (inventory 0x7E / 0x49 shortfall); read by the menu */
  private backTab: number | null = null;
  wantTab: number | null = null;

  constructor(private ctx: GameContext, private fs: FieldScene) {}

  get busy(): boolean { return this.overlays.size > 0 || !!this.screen; }

  /** open a screen directly (HUD SHOP / coupon button) */
  open(screen: 'premium' | 'coupon' | 'dimension', backTab: number | null = null): void {
    this.back = null;
    this.backTab = backTab;
    // the coupon shop opens anywhere (HUD coupon button FUN_00047488, popup 0x7D close FUN_0005de24)
    if (screen !== 'coupon' && (!this.fs.canSave || (screen === 'dimension' && this.fs.gardenMode !== 0))) { openPopup(this.overlays, new Popup(this.ctx, 0x6d)); return; }
    this.sel = 4;
    this.screen = screen === 'premium' ? new PremiumShop(this.ctx, this.fs) : screen === 'coupon' ? new CouponShop(this.ctx, this.fs) : new DimensionScreen(this.ctx, this.fs);
  }

  private usable(i: number): boolean { return this.fs.canSave && !(i === 4 && this.fs.gardenMode !== 0); }

  update(presses: number[]): boolean {
    this.t++;
    if (this.overlays.update(presses)) return true;
    const s = this.screen;
    if (s) {
      if (s.update(presses) === 'close') {
        this.screen = this.back; this.back = null;
        if (!this.screen && this.backTab !== null) { this.wantTab = this.backTab; this.backTab = null; }
      }
      else if ((s instanceof PremiumShop && s.request === 'coupon') || (s instanceof DimensionScreen && s.toCoupons)) {
        // popup 0x7D "쿠폰 구매 페이지로 이동합니다": the coupon shop, then back here
        if (s instanceof PremiumShop) s.request = null; else s.toCoupons = false;
        this.back = s;
        this.screen = new CouponShop(this.ctx, this.fs);
      }
      else if (s instanceof PremiumShop && s.request) { const r = s.request; s.request = null; this.screen = new Storage(this.ctx, this.fs, r === 'bag' ? 0 : 1); }
      else if (s instanceof Storage && s.request) { s.request = null; this.screen = new PremiumShop(this.ctx, this.fs); }
      else if (s instanceof DimensionScreen && s.enter !== null) { this.fs.enterDimension(s.enter); this.screen = null; }
      return true;
    }
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (k === AVK.UP) this.sel = (this.sel + 4) % 5;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 5;
      else if (k === AVK.OK) this.choose();
      else return false;                                              // common tab keys
    }
    return true;
  }

  private choose(): void {
    const i = this.sel;
    if (!this.usable(i)) { openPopup(this.overlays, new Popup(this.ctx, 0x6d)); return; }
    if (i === 0) this.screen = new CouponShop(this.ctx, this.fs);
    else if (i === 1) openPopup(this.overlays, new Popup(this.ctx, 0x03), () => { this.screen = new PremiumShop(this.ctx, this.fs); });
    else if (i === 2) this.screen = new Storage(this.ctx, this.fs, 0);
    else if (i === 3) openPopup(this.overlays, new Popup(this.ctx, 0x68), () => { this.screen = new Storage(this.ctx, this.fs, 1); });
    else this.screen = new DimensionScreen(this.ctx, this.fs);
  }

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
  drawPopups(): void { this.screen?.drawPopups(); this.overlays.draw(); }
}
