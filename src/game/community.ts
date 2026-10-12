// Community menu (tab state 0x24) and the screens behind it, with the online parts replaced by local
// grants (analysis/features/online.md): coupon shop 0x28 (free), premium shop 0x25 (the client's own
// default list at .rodata 0x1039A4, paid in coupons), bag expansion (25 coupons), and a local warehouse
// shared by the three slots (state 0x29 / 0x0F; the original kept it on the server).
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import type { Item } from './items';
import { Popup } from './popup';
import { Rng } from './rules';
import { loadWarehouse, saveWarehouse } from './save';
import type { GameContext } from './scene';
import { consume, countOf } from './shopRules';
import { drawItemCell } from './tabs';
import { DimensionScreen } from './dimension';
import type { Ui } from './ui';

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
];
/** ids whose stack is capped at 9999 (FUN_00054cb8 cap check) */
const STACKED = new Set([0, 2, 3, 4, 5, 6, 7, 0xb, 0xc, 0x15, 0x16, 0x17, 0x1b, 0x1c]);
export const BAG_PRICE = 25;
export const WAREHOUSE_SIZE = 48;

type PopupState = { p: Popup; yes?: () => void; ok?: () => void };

export function coupons(fs: FieldScene): number { return countOf(fs.inv, COUPON[0], COUPON[1]); }

/** save after a grant the way FUN_00020024 does: at once where saving is allowed outside the garden */
function grantSave(fs: FieldScene): void { if (fs.canSave && fs.gardenMode === 0) fs.autosave(); }

/** bag expansion (popup 0x7E yes, FUN_00053510 case 0x44): 25 coupons, at most 2 bags (48 -> 64 -> 80) */
export function buyBag(ctx: GameContext, fs: FieldScene): Popup {
  if (fs.inv.bags >= 2) return new Popup(ctx, 0x65);
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
  private popup: PopupState | null = null;
  constructor(private ctx: GameContext, private fs: FieldScene) {}

  /** 'close' on CLR */
  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.popup) { const r = this.popup.p.handle(presses); if (r) { const p = this.popup; this.popup = null; if (r === 'yes') p.yes?.(); else if (r === 'ok') p.ok?.(); } return null; }
    for (const k of presses) {
      if (k === AVK.UP) this.sel = (this.sel + 4) % 5;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 5;
      else if (k === AVK.CLR) return 'close';
      else if (k === AVK.OK) this.buy();
    }
    return null;
  }

  private buy(): void {
    const fs = this.fs, i = this.sel, t = this.ctx.assets.text;
    if (coupons(fs) + COUPON_CAP_CHECK[i] >= COUPON_MAX + 1) { this.popup = { p: new Popup(this.ctx, 0x7a) }; return; }
    this.popup = { p: new Popup(this.ctx, 0x74), yes: () => {
      if (coupons(fs) === 0 && fs.inv.items.length >= fs.inv.cap) { this.popup = { p: new Popup(this.ctx, 0x52) }; return; }
      fs.inv.gain(COUPON[0], COUPON[1], 0, COUPON_PACK[i], fs.rng);
      grantSave(fs);
      this.popup = { p: new Popup(this.ctx, 0x75, 0, (s) => s.replace('%s', t[0x1bbe + i] ?? '')) };
    } };
  }

  draw(u: Ui): void {
    const t = this.ctx.assets.text;
    u.glow(16, this.sel * 32 + 42, 188, 26, this.t);
    for (let i = 0; i < 5; i++) {
      u.button(18, 44 + 32 * i, 184, 22, 3, i === this.sel ? 1 : 0);
      u.hit(18, 44 + 32 * i, 184, 22, () => { if (this.sel === i) return [AVK.OK]; this.sel = i; });
      u.string(t[0x1bbe + i] ?? '', 38, 47 + 32 * i);
      u.string('무료', 180, 47 + 32 * i, 'right', { pen: 0xffe0 });       // local grant (originally 1100..33000원)
    }
    u.roundFill(8, 195, 204, 16, 0, 1);
    u.textId(0x1bbd, 110, 197, 'center');
  }
  drawPopups(): void { this.popup?.p.draw(); }
}

/** Premium shop 0x25 (FUN_0005bf34 / FUN_00054cb8): 5x3 grid, info panel, '0' or 구매 buys for coupons. */
class PremiumShop {
  private cur = 0;
  private t = 0;
  popup: PopupState | null = null;
  /** '#' bag view / '*' warehouse requested */
  request: 'bag' | 'warehouse' | null = null;
  private names = new Map<number, string>();
  constructor(private ctx: GameContext, private fs: FieldScene) {}

  private name(id: number): string {
    if (!this.names.has(id)) this.names.set(id, this.fs.db.create(0x1b, id, 0, new Rng(1n, () => 0)).name);
    return this.names.get(id)!;
  }

  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.popup) { const r = this.popup.p.handle(presses); if (r) { const p = this.popup; this.popup = null; if (r === 'yes') p.yes?.(); else if (r === 'ok') p.ok?.(); } return null; }
    const n = PREMIUM.length;
    for (const k of presses) {
      if (k === AVK.LEFT) this.cur = (this.cur + n - 1) % n;
      else if (k === AVK.RIGHT) this.cur = (this.cur + 1) % n;
      else if (k === AVK.UP) this.cur = Math.max(0, this.cur - 5);
      else if (k === AVK.DOWN) this.cur = Math.min(n - 1, this.cur + 5);
      else if (k === AVK.K0 || k === AVK.OK) this.buy();
      else if (k === AVK.POUND) this.request = 'bag';
      else if (k === AVK.STAR) this.request = 'warehouse';
      else if (k === AVK.CLR) return 'close';
    }
    return null;
  }

  private buy(): void {
    const fs = this.fs, [id, price, qty] = PREMIUM[this.cur];
    const capped = id === 8 ? fs.inv.bags >= 2 : STACKED.has(id) && countOf(fs.inv, 0x1b, id) + qty > COUPON_MAX;
    if (capped) { this.popup = { p: new Popup(this.ctx, 0x65) }; return; }
    if (coupons(fs) < price) { this.popup = { p: new Popup(this.ctx, 0x7d) }; return; }
    this.popup = { p: new Popup(this.ctx, 0x74), yes: () => {
      if (id === 8) { consume(fs.inv, COUPON[0], COUPON[1], price); fs.inv.setBags(fs.inv.bags + 1); grantSave(fs);
        this.popup = { p: new Popup(this.ctx, 0x6a, 0, () => this.ctx.assets.text[0x4e9] ?? '') }; return; }
      if (fs.inv.items.length >= fs.inv.cap && !(STACKED.has(id) && countOf(fs.inv, 0x1b, id))) { this.popup = { p: new Popup(this.ctx, 0x52) }; return; }
      consume(fs.inv, COUPON[0], COUPON[1], price);
      fs.inv.gain(0x1b, id, 0, qty, fs.rng);
      grantSave(fs);
      this.popup = { p: new Popup(this.ctx, 0x6a) };
    } };
  }

  draw(u: Ui): void {
    const t = this.ctx.assets.text, top = Math.max(0, Math.floor(this.cur / 5) - 2) * 5;
    u.roundFill(10, 0x1f, 199, 0x62, 0, 1);
    for (let k = 0; k < 15 && top + k < PREMIUM.length; k++) {
      const i = top + k, col = k % 5, row = Math.floor(k / 5), [id] = PREMIUM[i];
      const x = col * 0x24 + 0x16, y = row * 0x20 + 0x22;
      if (i === this.cur) u.glow(col * 0x24 + 0x14, (row + 1) * 0x20, 0x1e, 0x1e, this.t);
      const r = this.fs.db.iconRect(this.fs.db.icon(0x1b, id));
      u.image(r.image, r.sx, r.sy, 16, 16, x + 5, y + 5);
      u.hit(x, y, 0x1a, 0x1a, () => { if (this.cur === i) return [AVK.K0]; this.cur = i; });
    }
    const [id, price, qty] = PREMIUM[this.cur];
    u.roundFill(10, 0x86, 199, 0x32, 0, 1);
    u.string(qty > 1 ? `${this.name(id)} x${qty}` : this.name(id), 0x0e, 0x8b);
    u.string(`쿠폰 ${price}장  (보유 ${coupons(this.fs)})`, 0xcd, 0xa2, 'right', { pen: 0xffe0 });
    u.button(8, 0xbd, 0x3e, 0x16, 3, 0); u.textId(0x19e5, 0x27, 0xc1, 'center'); u.hit(8, 0xbd, 0x3e, 0x16, () => [AVK.POUND]);
    u.button(0x50, 0xbd, 0x3e, 0x16, 2, 0); u.textId(0x17b, 100, 0xc1, 'center'); u.hit(0x50, 0xbd, 0x3e, 0x16, () => [AVK.K0]);
    u.button(0x96, 0xbd, 0x3e, 0x16, 3, 0); u.textId(0x19e4, 0xb5, 0xc1, 'center'); u.hit(0x96, 0xbd, 0x3e, 0x16, () => [AVK.STAR]);
    void t;
  }
  drawPopups(): void { this.popup?.p.draw(); }
}

/** State 0x29 (FUN_0002b774 / keys FUN_000442f4): the inventory grid FUN_00058890 over the own bag (mode 0)
 *  or the warehouse (mode 1, 3 bags = 48, local instead of the server). Buttons (8, 0xBD) / (0x4F, 0xBD) /
 *  (0x96, 0xBD): mode 0 고급상점 / 골드전송 / 창고, mode 1 고급상점 / 창고정리 / 가방. '#' and '*' as in the
 *  original, '5' moves the item across (창고로 / 내가방으로), '0' sorts the warehouse (창고정리, state 0x0F). */
class Storage {
  mode: 0 | 1;
  private bag = 0;
  private sel = 0;
  private focus: 0 | 1 = 1;
  private t = 0;
  popup: PopupState | null = null;
  request: 'premium' | null = null;
  constructor(private ctx: GameContext, private fs: FieldScene, mode: 0 | 1) { this.mode = mode; }

  private list(): (Item | undefined)[] { return this.mode === 0 ? this.fs.inv.items : loadWarehouse(); }
  private bags(): number { return this.mode === 0 ? this.fs.inv.bags + 3 : 3; }

  update(presses: number[]): 'close' | null {
    this.t++;
    if (this.popup) { const r = this.popup.p.handle(presses); if (r) { const p = this.popup; this.popup = null; if (r === 'yes') p.yes?.(); } return null; }
    for (const k of presses) {
      if (k === AVK.POUND) { if (this.mode === 1) { this.mode = 0; this.bag = 0; } else this.request = 'premium'; }
      else if (k === AVK.STAR) { if (this.mode === 0) { this.mode = 1; this.bag = 0; } else this.request = 'premium'; }
      else if (k === AVK.K0) { if (this.mode === 1) this.sortWarehouse(); }
      else if (this.focus === 0) {
        if (k === AVK.UP || k === AVK.DOWN) { const n = this.bags(); this.bag = (this.bag + (k === AVK.UP ? n - 1 : 1)) % n; this.sel = 0; }
        else if (k === AVK.OK || k === AVK.RIGHT) this.focus = 1;
        else if (k === AVK.CLR) return 'close';
      } else {
        if (k === AVK.LEFT) { if (this.sel & 3) this.sel--; else this.focus = 0; }
        else if (k === AVK.RIGHT && (this.sel & 3) < 3) this.sel++;
        else if (k === AVK.UP && this.sel >= 4) this.sel -= 4;
        else if (k === AVK.DOWN && this.sel < 12) this.sel += 4;
        else if (k === AVK.OK) this.move();
        else if (k === AVK.CLR) this.focus = 0;
      }
    }
    return null;
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
      const wh = loadWarehouse();
      if (wh.length >= WAREHOUSE_SIZE) { this.popup = { p: new Popup(this.ctx, 0x52) }; return; }
      fs.inv.remove(idx);
      wh.push(it);
      saveWarehouse(wh);
    } else {
      const wh = loadWarehouse(), it = wh[idx];
      if (!it) return;
      if (!fs.inv.gain(it.type, it.sub, it.grade, it.count, fs.rng, it)) { this.popup = { p: new Popup(this.ctx, 0x52) }; return; }
      wh.splice(idx, 1);
      saveWarehouse(wh);
    }
    fs.recompute();
    grantSave(fs);
  }

  draw(u: Ui): void {
    const list = this.list(), n = this.bags();
    u.roundFill(55, 35, 150, 154, 0, 1);
    for (let k = 0; k < 16; k++) {
      const x = (k & 3) * 36 + 63, y = (k >> 2) * 35 + 47, it = list[this.bag * 16 + k];
      if (this.focus === 1 && k === this.sel) u.glow(x - 2, y - 2, 30, 30, this.t);
      u.bevel(x, y, 26, 26, 0x354e73, 0);
      u.hit(x - 4, y - 4, 34, 34, () => { if (this.focus === 1 && this.sel === k) return [AVK.OK]; this.focus = 1; this.sel = k; });
      if (it) drawItemCell(u, this.fs, it, x + 1, y + 1);
    }
    if (this.focus === 0) u.glow(6, this.bag * 32 + 30, 34, 34, this.t);
    for (let i = 0; i < 5; i++) {
      u.alpha = i === this.bag ? 32 : 16;
      u.button(8, 32 * (i + 1), 0x1e, 0x1e, 3, i >= n ? 3 : i === this.bag ? 1 : 0);
      if (i < n) u.hit(6, 32 * (i + 1) - 2, 34, 32, () => { this.focus = 0; this.bag = i; this.sel = 0; });
      u.image('t', 15, 24, 16, 16, 15, 38 + 32 * i);
      u.alpha = 32;
      if (i < n) u.number(Math.max(0, Math.min(16, list.length - 16 * i)), 11, 55 + 32 * i, 0, 0);
    }
    const btn = (x: number, id: number, key: number | null, cx: number) => {
      u.button(x, 0xbd, 0x3e, 0x16, key === null ? 3 : 3, key === null ? 3 : 0);
      u.textId(id, cx, 0xc1, 'center');
      if (key !== null) u.hit(x, 0xbd, 0x3e, 0x16, () => [key]);
    };
    btn(8, 0x19e3, this.mode === 0 ? AVK.POUND : AVK.STAR, 0x27);                    // 고급상점
    if (this.mode === 0) btn(0x4f, 0x19e2, null, 0x6e);                              // 골드전송 (server gift: off)
    else btn(0x4f, 0x19da, AVK.K0, 0x6e);                                            // 창고정리
    btn(0x96, this.mode === 0 ? 0x19e4 : 0x19e5, this.mode === 0 ? AVK.STAR : AVK.POUND, 0xb5);   // 창고 / 가방
    const it = list[this.bag * 16 + this.sel];
    if (it && this.focus === 1) u.string(it.name, 130, 175, 'center');
  }
  drawPopups(): void { this.popup?.p.draw(); }
}

/** Community menu 0x24 (FUN_0005ac04 / FUN_0005666c). */
export class CommunityTab {
  private sel = 0;
  private t = 0;
  private popup: PopupState | null = null;
  private screen: CouponShop | PremiumShop | Storage | DimensionScreen | null = null;

  constructor(private ctx: GameContext, private fs: FieldScene) {}

  get busy(): boolean { return !!this.popup || !!this.screen; }

  /** open a screen directly (HUD SHOP / coupon button) */
  open(screen: 'premium' | 'coupon' | 'dimension'): void {
    if (!this.fs.canSave || (screen === 'dimension' && this.fs.gardenMode !== 0)) { this.popup = { p: new Popup(this.ctx, 0x6d) }; return; }
    this.sel = 4;
    this.screen = screen === 'premium' ? new PremiumShop(this.ctx, this.fs) : screen === 'coupon' ? new CouponShop(this.ctx, this.fs) : new DimensionScreen(this.ctx, this.fs);
  }

  private usable(i: number): boolean { return this.fs.canSave && !(i === 4 && this.fs.gardenMode !== 0); }

  update(presses: number[]): boolean {
    this.t++;
    if (this.popup) { const r = this.popup.p.handle(presses); if (r) { const p = this.popup; this.popup = null; if (r === 'yes') p.yes?.(); else if (r === 'ok') p.ok?.(); } return true; }
    const s = this.screen;
    if (s) {
      if (s.update(presses) === 'close') this.screen = null;
      else if (s instanceof PremiumShop && s.request) { const r = s.request; s.request = null; this.screen = new Storage(this.ctx, this.fs, r === 'bag' ? 0 : 1); }
      else if (s instanceof Storage && s.request) { s.request = null; this.screen = new PremiumShop(this.ctx, this.fs); }
      else if (s instanceof DimensionScreen && s.enter !== null) { this.fs.enterDimension(s.enter); this.screen = null; }
      return true;
    }
    for (const k of presses) {
      if (k === AVK.UP) this.sel = (this.sel + 4) % 5;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 5;
      else if (k === AVK.OK) this.choose();
      else return false;                                              // common tab keys
    }
    return true;
  }

  private choose(): void {
    const i = this.sel;
    if (!this.usable(i)) { this.popup = { p: new Popup(this.ctx, 0x6d) }; return; }
    if (i === 0) this.screen = new CouponShop(this.ctx, this.fs);
    else if (i === 1) this.popup = { p: new Popup(this.ctx, 0x03), yes: () => { this.screen = new PremiumShop(this.ctx, this.fs); } };
    else if (i === 2) this.screen = new Storage(this.ctx, this.fs, 0);
    else if (i === 3) this.popup = { p: new Popup(this.ctx, 0x68), yes: () => { this.screen = new Storage(this.ctx, this.fs, 1); } };
    else this.screen = new DimensionScreen(this.ctx, this.fs);
  }

  draw(u: Ui): void {
    if (this.screen) { this.screen.draw(u); return; }
    const t = this.ctx.assets.text;
    u.glow(16, this.sel * 32 + 42, 188, 26, this.t);
    for (let i = 0; i < 5; i++) {
      u.button(18, 44 + 32 * i, 184, 22, 3, !this.usable(i) ? 3 : i === this.sel ? 1 : 0);
      u.hit(18, 44 + 32 * i, 184, 22, () => { if (this.sel === i) return [AVK.OK]; this.sel = i; });
      u.textId(i === 0 ? 0x1bbc : 0x153 + i, 110, 47 + 32 * i, 'center');
    }
    u.roundFill(8, 195, 204, 16, 0, 1);
    const ok = this.usable(this.sel);
    u.string(t[!ok ? 0x1a24 : this.sel === 0 ? 0x1bbd : 0x157 + this.sel] ?? '', 110, 197, 'center');
  }
  drawOverlay(_u: Ui): void { /* none */ }
  drawPopups(): void { this.screen?.drawPopups(); this.popup?.p.draw(); }
}
