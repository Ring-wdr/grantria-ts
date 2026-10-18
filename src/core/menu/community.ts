// Community menu (tab state 0x24) and the screens behind it, with the online parts replaced by local
// grants (analysis/features/online.md): coupon shop 0x28 (free), premium shop 0x25 (the client's own
// default list at .rodata 0x1039A4, paid in coupons), bag expansion (25 coupons), and a local warehouse
// shared by the three slots (state 0x29 / 0x0F; the original kept it on the server).
// State and keys; the host draws them (web/game/community.ts).
import { account, saveAccount } from '../rules/account';
import { cfmt } from '../data/skillDetail';
import type { FieldGame } from '../field/fieldGame';
import type { Host } from '../host';
import { AVK } from '../keys';
import type { ScrollRef } from '../render';
import { BAG_MAX, UNLOCK_1B, type Item } from '../rules/items';
import { Popup, openPopup } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';
import { Rng } from '../rules/rules';
import { loadWarehouse, saveWarehouse } from '../save/save';
import { consume, countOf } from '../rules/shopRules';
import { DimensionScreenLogic } from './dimension';

export const COUPON = [0x1b, 0x1b] as const;
const COUPON_MAX = 9999;
/** FUN_00020024: coupons per package (the 10/60/140/300/800 table only feeds the cap check 0x7A) */
const COUPON_PACK = [10, 33, 60, 130, 450];
const COUPON_CAP_CHECK = [10, 60, 140, 300, 800];
/** FUN_0003d020(7) default premium list .rodata 0x1039A4: (0x1b id, coupon price, quantity) */
export const PREMIUM: [number, number, number][] = [
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
export const PREMIUM_ROW = 30;
export const BAG_PRICE = 25;
export const WAREHOUSE_SIZE = 48;

export function coupons(fs: FieldGame): number { return countOf(fs.inv, COUPON[0], COUPON[1]); }

/** save after a grant the way FUN_00020024 does: at once where saving is allowed outside the garden */
function grantSave(fs: FieldGame): void { if (fs.canSave && fs.gardenMode === 0) fs.autosave(); }

/** bag expansion (popup 0x7E yes, FUN_00053510 case 0x44): 25 coupons, at most BAG_MAX bags (the original 2: 48 -> 64 -> 80) */
export function buyBag(ctx: Host, fs: FieldGame): Popup {
  if (fs.inv.bags >= BAG_MAX) return new Popup(ctx, 0x65);
  if (coupons(fs) < BAG_PRICE) return new Popup(ctx, 0x7d);
  consume(fs.inv, COUPON[0], COUPON[1], BAG_PRICE);
  fs.inv.setBags(fs.inv.bags + 1);
  grantSave(fs);
  return new Popup(ctx, 0x6a, 0, () => ctx.assets.text[0x4e9] ?? '');
}

/**
 * Popup kind 11 (FUN_0005f948 case 0xB -> FUN_0004bd98): an item card for a coupon purchase — icon, name, the item's
 * description (0xC48 + sub), then "내쿠폰 N -> N - price" and the body 0x1C14 with 0x1C13 "쿠폰 %d장에 구매하시겠습니까?";
 * with too few coupons only 0x1A3B "쿠폰이 부족합니다." and no body. 0x4C premium purchase, 0x4D coupon revive.
 */
export function couponCard(ctx: Host, fs: FieldGame, id: 0x4c | 0x4d, sub: number, price: number, name: string): Popup {
  const t = ctx.assets.text, have = coupons(fs), short = have < price;
  const p = new Popup(ctx, id, 0, (s) => cfmt(s, cfmt(t[0x1c13] ?? '', price, t[0x8e] ?? '')));
  p.hideBody = short;
  p.card = { kind: 'coupon', icon: fs.db.iconRect(fs.db.icon(0x1b, sub)), name, sub, have, price };
  return p;
}

/** gold pad digit keys (not AVK: the AVK digit codes double as arrows and quick-slot keys) */
export const GOLD_DIGIT = 0x300;
/** warehouse gold record (type 0x1C, count = thousands of gold) shown with the gold icon */
function goldRecord(fs: FieldGame, n: number): Item {
  const it = fs.db.create(0x1b, 0x1b, 0, new Rng(1n, () => 0));
  return { ...it, type: 0x1c, sub: 0, count: n, icon: 324, name: `${n * 1000} Gold`, price: 0 };
}

/** Coupon shop 0x28 (FUN_000597d8 / FUN_00056528): five packages, granted locally for free. */
export class CouponShopLogic {
  protected sel = 0;
  private t = 0;
  /** popups over the screen (read by the game over screen: no close button while one is open) */
  readonly overlays = new OverlayStack();
  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

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
}

/** Premium shop 0x25 (FUN_0005bf34 / FUN_00054cb8): 5x3 grid, info panel, '0' or 구매 buys for coupons. */
export class PremiumShopLogic {
  protected cur = 0;
  private t = 0;
  /** popups over the screen (read by the game over screen: no close button while one is open) */
  readonly overlays = new OverlayStack();
  /** '#' bag view / '*' warehouse requested, or the coupon shop after popup 0x7D */
  request: 'bag' | 'warehouse' | 'coupon' | null = null;
  private names = new Map<number, string>();
  protected scroll: ScrollRef = { y: 0 };
  /** the icon grid scrolls natively (touch / wheel); keys move it so the cursor sits on the bottom row of three */
  protected gridScroll: ScrollRef = { y: 0 };
  /** controller focus on the button row (0 가방, 1 구매, 2 창고): DOWN from the last grid row, UP back */
  protected btn: number | null = null;
  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

  protected name(id: number): string {
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
}

/** State 0x29 (FUN_0002b774 / keys FUN_000442f4): the inventory grid FUN_00058890 over the own bag (mode 0)
 *  or the warehouse (mode 1, 3 bags = 48, local instead of the server). Buttons (8, 0xBD) / (0x4F, 0xBD) /
 *  (0x96, 0xBD): mode 0 고급상점 / 골드전송 / 창고, mode 1 고급상점 / 창고정리 / 가방. '#' and '*' as in the
 *  original, '5' (or the move button; a tap only selects) moves the item across (창고로 0x198 / 내가방으로 0x185), '0' sorts the warehouse (창고정리, state 0x0F).
 *  골드전송 ('0' in mode 0, FUN_00043500 / FUN_00026c58): thousands of gold go into the warehouse as a type 0x1C record
 *  (net 0x12), taken back as count × 1000 gold; the warehouse is shared by the three slots, so this moves gold between them. */
export class StorageLogic {
  mode: 0 | 1;
  protected bag = 0;
  protected sel = 0;
  /** 0 bag tabs, 1 grid, 2 button row (controller: DOWN from the grid's last row) */
  protected focus: 0 | 1 | 2 = 1;
  protected btn = 0;
  protected t = 0;
  /** popups over the screen (read by the game over screen: no close button while one is open) */
  readonly overlays = new OverlayStack();
  request: 'premium' | null = null;
  /** 골드전송 input (DAT_00403420, thousands) while the pad is open (DAT_003b3c6e) */
  protected goldPad: string | null = null;
  /** bag tab column scroll (the own bags go up to BAG_COUNT) */
  protected bagScroll: ScrollRef = { y: 0 };
  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame, mode: 0 | 1) { this.mode = mode; }

  /** the gold pad opened: a host with a keyboard feeds its digit keys to goldKey(GOLD_DIGIT + d) while goldPad is open */
  protected padOpened(): void {}

  /** FUN_00043500: digits (up to 11, value at most 10000), '#' deletes, '*' sends, CLR closes. The original keypad's
   *  digit keys are also the arrows here, so digits come as GOLD_DIGIT + d from the pad buttons and the keyboard digit
   *  keys; the d-pad steps the amount (up / down ±1, right / left ±10 thousand) and OK sends. */
  protected goldKey(k: number): void {
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

  protected list(): (Item | undefined)[] { return this.mode === 0 ? this.fs.inv.items : loadWarehouse(); }
  protected bags(): number { return this.mode === 0 ? this.fs.inv.bags + 3 : 3; }

  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.overlays.update(presses)) return null;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (this.goldPad !== null) { this.goldKey(k); continue; }
      if (k === AVK.POUND) { if (this.mode === 1) { this.mode = 0; this.bag = 0; } else this.request = 'premium'; }
      else if (k === AVK.STAR) { if (this.mode === 0) { this.mode = 1; this.bag = 0; } else this.request = 'premium'; }
      else if (k === AVK.K0) { if (this.mode === 1) this.sortWarehouse(); else { this.goldPad = ''; this.ctx.audio.playSfx(0x2f); this.padOpened(); } }
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
  protected buttonKeys(): (number | null)[] {
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
}

/** Community menu 0x24 (FUN_0005ac04 / FUN_0005666c). */
export abstract class CommunityTabLogic {
  protected sel = 0;
  private t = 0;
  protected readonly overlays = new OverlayStack();
  protected screen: CouponShopLogic | PremiumShopLogic | StorageLogic | DimensionScreenLogic | null = null;
  /** the screen a coupon shop opened by popup 0x7D returns to */
  private back: PremiumShopLogic | DimensionScreenLogic | null = null;
  /** menu tab a coupon shop opened from another tab returns to (inventory 0x7E / 0x49 shortfall); read by the menu */
  private backTab: number | null = null;
  wantTab: number | null = null;

  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

  /** the host's views of the screens behind the menu */
  protected abstract newCouponShop(): CouponShopLogic;
  protected abstract newPremiumShop(): PremiumShopLogic;
  protected abstract newStorage(mode: 0 | 1): StorageLogic;
  protected abstract newDimension(): DimensionScreenLogic;

  get busy(): boolean { return this.overlays.size > 0 || !!this.screen; }

  /** open a screen directly (HUD SHOP / coupon button) */
  open(screen: 'premium' | 'coupon' | 'dimension', backTab: number | null = null): void {
    this.back = null;
    this.backTab = backTab;
    // the coupon shop opens anywhere (HUD coupon button FUN_00047488, popup 0x7D close FUN_0005de24)
    if (screen !== 'coupon' && (!this.fs.canSave || (screen === 'dimension' && this.fs.gardenMode !== 0))) { openPopup(this.overlays, new Popup(this.ctx, 0x6d)); return; }
    this.sel = 4;
    this.screen = screen === 'premium' ? this.newPremiumShop() : screen === 'coupon' ? this.newCouponShop() : this.newDimension();
  }

  protected usable(i: number): boolean { return this.fs.canSave && !(i === 4 && this.fs.gardenMode !== 0); }

  update(presses: number[]): boolean {
    this.t++;
    if (this.overlays.update(presses)) return true;
    const s = this.screen;
    if (s) {
      if (s.update(presses) === 'close') {
        this.screen = this.back; this.back = null;
        if (!this.screen && this.backTab !== null) { this.wantTab = this.backTab; this.backTab = null; }
      }
      else if ((s instanceof PremiumShopLogic && s.request === 'coupon') || (s instanceof DimensionScreenLogic && s.toCoupons)) {
        // popup 0x7D "쿠폰 구매 페이지로 이동합니다": the coupon shop, then back here
        if (s instanceof PremiumShopLogic) s.request = null; else s.toCoupons = false;
        this.back = s;
        this.screen = this.newCouponShop();
      }
      else if (s instanceof PremiumShopLogic && s.request) { const r = s.request; s.request = null; this.screen = this.newStorage(r === 'bag' ? 0 : 1); }
      else if (s instanceof StorageLogic && s.request) { s.request = null; this.screen = this.newPremiumShop(); }
      else if (s instanceof DimensionScreenLogic && s.enter !== null) { this.fs.enterDimension(s.enter); this.screen = null; }
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
    if (i === 0) this.screen = this.newCouponShop();
    else if (i === 1) openPopup(this.overlays, new Popup(this.ctx, 0x03), () => { this.screen = this.newPremiumShop(); });
    else if (i === 2) this.screen = this.newStorage(0);
    else if (i === 3) openPopup(this.overlays, new Popup(this.ctx, 0x68), () => { this.screen = this.newStorage(1); });
    else this.screen = this.newDimension();
  }
}
