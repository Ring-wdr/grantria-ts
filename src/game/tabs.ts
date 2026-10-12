// Inventory tab (0x1E) and equipment tab (0x1F, candidate select 0x2F) on the 1.3x layer,
// ported from analysis/features/ui-tabs.md §0.4 / §0.5 (C220 coordinates unless noted).
// Enhance / decompose / combine from the inventory open the shop screens (shop.md §2.9); socket reset
// and gem attach / detach follow shop.md §2.8. Bag purchase: locked bag -> popup 0x7E (community.ts). Not ported: "가방정리".
import type { Cmf } from '../assets';
import { stringWidth } from '../text';
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import type { Item } from './items';
import { Popup } from './popup';
import { buyBag } from './community';
import { ShopScreen } from './shop';
import { countOf, consume } from './shopRules';
import type { GameContext } from './scene';
import type { Ui } from './ui';

const CELL_EDGE = 0x354e73;
const EQUIP_FILL = 0x20252c;

/** Action ids of the item action popup (text 0x171 + id), kind 0 = inventory, 4 = equipment tab. */
const ACTION = { DETAIL: 1, USE: 2, DECOMPOSE: 3, QUICK: 5, DROP: 4, CANCEL: 6, UNEQUIP: 7, EQUIP: 8, ENHANCE: 12, SOCKET: 28 } as const;
const USABLE_1B = new Set([2, 4, 5, 6, 7, ...range(0xe, 0x1a), ...range(0x1d, 0x20), ...range(0x22, 0x2e), 0x30, ...range(0x33, 0x38)]);

function range(a: number, b: number): number[] { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }

/** FUN_0003bcf0 item cell: red tint 12 when unusable, icon at +4, count at (+24, 0). */
export function drawItemCell(u: Ui, fs: FieldScene, it: Item, x: number, y: number): void {
  const r = fs.db.iconRect(it.icon);
  const usable = fs.inv.usable(it, fs.model.level, fs.model.cls);
  u.image(r.image, r.sx, r.sy, 16, 16, x + 4, y + 4, 0, usable ? undefined : { tint: [255, 0, 0], amount: 12 });
  if (fs.db.showsCount(it)) u.number(it.count, x + 24, y, 0, 2);
}

/** Item action popup (FUN_00055820 / FUN_000552e0 / FUN_00055004), L1 absolute coordinates. */
export class ActionPopup {
  sel = 0;
  private c = 0;
  readonly w: number;
  readonly h: number;
  constructor(private ctx: GameContext, readonly entries: number[], private x0: number, private y0: number) {
    const t = ctx.assets.text;
    this.w = Math.max(...entries.map((v) => stringWidth(t[0x171 + v] ?? ''))) + 66;
    this.h = entries.length * 25 + 6;
  }
  /** returns the chosen action id, 0 for cancel, or null */
  handle(presses: number[]): number | null {
    if (this.c < 3) return null;
    for (const k of presses) {
      if (k === AVK.UP) this.sel = (this.sel + this.entries.length - 1) % this.entries.length;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % this.entries.length;
      else if (k === AVK.CLR) return 0;
      else if (k === AVK.OK) return this.entries[this.sel];
    }
    return null;
  }
  draw(u: Ui): void {
    const s = [4, 7, 9][this.c] ?? 10;
    this.c = this.c < 10 ? this.c + 1 : 3;
    const x = this.x0 + Math.trunc(((10 - s) * this.w) / 10), y0 = this.y0, t = this.ctx.assets.text;
    u.hit(-1000, -1000, 3000, 3000, () => [AVK.CLR]);           // tap outside closes
    u.glow(x + 1, y0 + 1 + this.sel * 25, 66, 26, this.c);
    this.entries.forEach((v, i) => {
      u.alpha = i === this.sel ? 32 : 24;
      u.button(x + 3, y0 + 3 + 25 * i, 0x3e, 0x16, 3, i === this.sel ? 1 : 0);
      u.hit(x, y0 + 25 * i, this.w, 25, () => { this.sel = i; return [AVK.OK]; });
      u.string(t[v === 0x1c ? 0x1bca : v === 0x14 ? 0x198 : 0x171 + v] ?? '', x + 33, y0 + 7 + 25 * i, 'center');
    });
    u.alpha = 32;
    u.finger(x - 20, y0 + 3 + this.sel * 25, this.c);
  }
}

/** Item detail (MENUPOP 1, FUN_00032344 + FUN_0002ae5c), simplified: no scroll, sets or sockets. */
export function drawItemDetail(u: Ui, fs: FieldScene, it: Item): void {
  const a = fs.db.a, t = a.text;
  u.window(0, 23, 220, 196);
  u.roundFill(7, 31, 206, 29, 0, 1);
  u.bevel(9, 32, 26, 26, CELL_EDGE, 0);
  const r = fs.db.iconRect(it.icon);
  u.image(r.image, r.sx, r.sy, 16, 16, 14, 37);
  u.string((it.enh && it.type < 0x10 ? `+${it.enh} ` : '') + it.name, 210, 40, 'right');
  u.roundFill(7, 63, 206, 150, 0, 1);
  let y = 70;
  if (it.type < 0x10) {
    u.cfont(t[0x24] ?? 'REQUIRE LV', 11, y);
    u.number(it.reqLevel, 70, y, 0, 2);
    if (it.type < 15) u.cfontCenter(t[0x5d + (it.type % 3)] ?? '', 185, y);
    u.fill(11, 80, 189, 1, 0x9ecad7);
    y = 85;
  }
  const desc = t[0xa50 + fs.db.model(it.type, it.sub, it.grade)] ?? '';
  y += u.paragraph(desc, 110, y, 180) * 15 + 5;
  if (it.type < 0x10) {
    u.fill(11, y, 189, 1, 0x9ecad7);
    y += 6;
    const label = it.type < 3 ? 0x1ad2 : it.type < 15 ? 0x1ad4 : 0x1ad6;
    u.string(`${t[label] ?? ''} ${it.base}`, 110, y, 'center');
    y += 15;
    for (const [id, v] of it.options) {
      if (id === 0xff) continue;
      u.string((t[1972 + id] ?? '').replace('%d', String(v)).replace('%%', '%'), 110, y, 'center');
      y += 15;
    }
  }
}

/** Inventory tab 0x1E (FUN_0005b744 -> FUN_00058890, keys FUN_000572a8). */
export class InventoryTab {
  private bag = 0;
  private focus: 0 | 1 = 1;
  private sel = 0;
  private f = 0;
  private t = 0;
  private action: ActionPopup | null = null;
  private detail: Item | null = null;
  private quick: { cur: number; idx: number } | null = null;
  private confirm: { popup: Popup; idx: number; yes?: () => void } | null = null;
  private message: Popup | null = null;
  /** shop screen opened from the inventory (enhance / decompose / combine) */
  private shop: ShopScreen | null = null;
  /** gem picker in the item detail ('0'): gem inventory indexes and the cursor */
  private gems: { list: number[]; cur: number } | null = null;

  constructor(private ctx: GameContext, private fs: FieldScene) {}

  get busy(): boolean { return !!(this.action || this.detail || this.quick || this.confirm || this.message || this.shop); }

  private get idx(): number { return this.bag * 16 + this.sel; }

  update(presses: number[]): boolean {
    this.t++;
    if (this.f < 15) this.f++;
    const inv = this.fs.inv;
    if (this.shop) { if (this.shop.update(presses) === 'close') { this.shop = null; this.fs.recompute(); } return true; }
    if (this.message) { if (this.message.handle(presses)) this.message = null; return true; }
    if (this.confirm) {
      const r = this.confirm.popup.handle(presses);
      if (r === 'yes') { if (this.confirm.yes) this.confirm.yes(); else { inv.remove(this.confirm.idx); this.fs.recompute(); } }
      if (r) this.confirm = null;
      return true;
    }
    if (this.gems) { this.gemKeys(presses); return true; }
    if (this.detail) {
      const it = this.detail;
      for (const k of presses) {
        if (k === AVK.OK || k === AVK.CLR) { this.detail = null; break; }
        if (k === AVK.K0 && it.type < 0x10) this.openGems(it);
        else if (k === AVK.POUND && it.type < 0x10) this.extractGems(it);
      }
      return true;
    }
    if (this.quick) {
      for (const k of presses) {
        if (k === AVK.LEFT) this.quick.cur = (this.quick.cur + 5) % 6;
        else if (k === AVK.RIGHT) this.quick.cur = (this.quick.cur + 1) % 6;
        else if (k === AVK.OK) { inv.registerQuick(this.quick.cur, 2, this.quick.idx); this.quick = null; break; }
        else if (k === AVK.CLR) { this.quick = null; break; }
      }
      return true;
    }
    if (this.action) {
      const r = this.action.handle(presses);
      if (r !== null) { this.action = null; if (r) this.run(r); }
      return true;
    }
    for (const k of presses) {
      if (this.focus === 0) {
        if (k === AVK.UP || k === AVK.DOWN) { const n = inv.bags + 3; this.bag = (this.bag + (k === AVK.UP ? n - 1 : 1)) % n; this.sel = 0; this.f = 0; }
        else if (k === AVK.OK) this.focus = 1;
        else return false;                                            // common tab keys
      } else {
        const before = this.sel;
        if (k === AVK.LEFT && this.sel > 0) this.sel--;
        else if (k === AVK.RIGHT && this.sel < 15) this.sel++;
        else if (k === AVK.UP && this.sel >= 4) this.sel -= 4;
        else if (k === AVK.DOWN) this.sel = Math.min(this.sel + 4, 15);
        else if (k === AVK.OK) { if (inv.items[this.idx]) this.openActions(); }
        else if (k === AVK.CLR) this.focus = 0;
        else return false;
        if (this.sel !== before) this.f = 0;
      }
    }
    return true;
  }

  private openActions(): void {
    const it = this.fs.inv.items[this.idx], cls = this.fs.model.cls;
    const e: number[] = [ACTION.DETAIL];
    if (it.type === 0x11 || it.type === 0x19 || (it.type === 0x1b && USABLE_1B.has(it.sub))) e.push(ACTION.USE);
    if (it.type < 0x10 && (it.type === 15 || it.type % 3 === cls)) e.push(ACTION.EQUIP);
    if (it.type < 0x0f) e.push(ACTION.ENHANCE);
    if (it.type < 0x10) e.push(ACTION.DECOMPOSE);
    if (it.type === 0x11 || it.type === 0x1b) e.push(ACTION.QUICK);          // FUN_00036d24 [추정: consumables]
    e.push(ACTION.DROP);
    if (it.type < 0x10) e.push(ACTION.SOCKET);
    e.push(ACTION.CANCEL);
    const col = this.sel % 4;
    this.action = new ActionPopup(this.ctx, e, 130 + (col > 1 ? 12 : 77) + col * 36, 88);
  }

  private run(action: number): void {
    const inv = this.fs.inv, idx = this.idx, it = inv.items[idx];
    if (!it) return;
    const has = (t: number, sub: number) => countOf(inv, t, sub) > 0;
    if (action === ACTION.DETAIL) this.detail = it;
    else if (action === ACTION.USE && it.type === 0x19) {                   // recipe: the blacksmith combine screen
      if (has(0x1b, 10)) this.shop = new ShopScreen(this.ctx, this.fs, 2, { mode: 'combine', idx });
      else this.message = new Popup(this.ctx, 0x6d);
    } else if (action === ACTION.USE) this.fs.useItem(idx);
    else if (action === ACTION.ENHANCE) {                                    // needs the enhance scroll (0x1b, 0x0c)
      if (has(0x1b, 0x0c)) this.shop = new ShopScreen(this.ctx, this.fs, 2, { mode: 'enhance', idx });
      else this.message = new Popup(this.ctx, 0x6d);
    } else if (action === ACTION.DECOMPOSE) {                                // needs the magic dismantler (0x1b, 9)
      if (has(0x1b, 9)) this.shop = new ShopScreen(this.ctx, this.fs, 2, { mode: 'decompose', idx });
      else this.message = new Popup(this.ctx, 0x6d);
    } else if (action === ACTION.SOCKET) {                                   // socket scroll (0x1b, 0x21)
      if (!has(0x1b, 0x21)) { this.message = new Popup(this.ctx, 0x77); return; }
      this.confirm = { popup: new Popup(this.ctx, 0x76), idx, yes: () => {
        const r = this.fs.rng.rand(1000);
        it.sockets = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
        it.count = r > 500 ? 3 : r > 150 ? 4 : 5;                          // 49.9 % / 35 % / 15.1 %
        consume(inv, 0x1b, 0x21, 1);
        this.fs.recompute();
        this.fs.autosave();
      } };
    }
    else if (action === ACTION.EQUIP) {
      if (!inv.usable(it, this.fs.model.level, this.fs.model.cls)) this.message = new Popup(this.ctx, 0x2b);
      else { inv.equipFrom(idx); this.fs.recompute(); }
    } else if (action === ACTION.QUICK) this.quick = { cur: Math.max(0, inv.quick.findIndex((q) => q.kind === 0)), idx };
    else if (action === ACTION.DROP) this.confirm = { popup: new Popup(this.ctx, 0xb), idx };
  }

  /** '0' in the detail: gem list (FUN_000441e4) when an empty socket exists */
  private openGems(it: Item): void {
    const used = it.sockets.filter((g) => g !== 0xff).length;
    if (used >= it.count) { this.message = new Popup(this.ctx, 0x44); return; }
    const list = this.fs.inv.items.map((x, i) => [x, i] as const).filter(([x]) => x.type === 0x10).map(([, i]) => i);
    this.gems = { list, cur: 0 };
  }
  private gemKeys(presses: number[]): void {
    const g = this.gems!, it = this.detail!, inv = this.fs.inv;
    for (const k of presses) {
      if (k === AVK.LEFT && g.cur > 0) g.cur--;
      else if (k === AVK.RIGHT && g.cur < g.list.length - 1) g.cur++;
      else if (k === AVK.CLR) { this.gems = null; return; }
      else if (k === AVK.OK && g.list.length) {
        const gi = g.list[g.cur];
        this.confirm = { popup: new Popup(this.ctx, 0x43), idx: gi, yes: () => {       // FUN_0003dcd0
          const gem = inv.items[gi], slot = it.sockets.findIndex((v, i) => i < it.count && v === 0xff);
          if (!gem || slot < 0) return;
          while (it.sockets.length < 6) it.sockets.push(0xff);
          it.sockets[slot] = gem.grade * 50 + gem.sub;
          this.fs.achieve({ k: 'gem' });
          consume(inv, 0x10, gem.sub, 1);
          this.gems = null;
          this.fs.recompute();
          this.fs.autosave();
        } };
        return;
      }
    }
  }
  /** '#': take the gems back out with a gem extractor (0x1b, 0x0b) [추정: all gems, one extractor] */
  private extractGems(it: Item): void {
    const inv = this.fs.inv, gems = it.sockets.filter((v) => v !== 0xff);
    if (!gems.length) { this.message = new Popup(this.ctx, 0x63); return; }
    if (countOf(inv, 0x1b, 0x0b) === 0) { this.message = new Popup(this.ctx, 0x62); return; }
    if (inv.items.length + gems.length > inv.cap) { this.message = new Popup(this.ctx, 0x61); return; }
    for (const v of gems) inv.gain(0x10, v % 50, Math.trunc(v / 50), 1, this.fs.rng);
    it.sockets = it.sockets.map(() => 0xff);
    consume(inv, 0x1b, 0x0b, 1);
    this.fs.recompute();
    this.fs.autosave();
  }

  draw(u: Ui): void {
    const fs = this.fs, inv = fs.inv, t = this.ctx.assets.text;
    if (this.shop) return;
    if (this.detail) {
      drawItemDetail(u, fs, this.detail);
      u.hit(-200, -200, 700, 700, () => (this.gems ? [AVK.CLR] : [AVK.OK]));
      if (this.detail.type < 0x10) {                         // gem buttons and the gem list
        const it = this.detail, empty = it.sockets.filter((g) => g !== 0xff).length < it.count;
        u.button(6, 192, 62, 22, 3, empty ? 0 : 3);
        u.hit(6, 192, 62, 22, () => [AVK.K0]);
        u.textId(0x19e6, 37, 196, 'center');
        u.button(152, 192, 62, 22, 3, it.sockets.some((g) => g !== 0xff) && countOf(inv, 0x1b, 0x0b) > 0 ? 0 : 3);
        u.hit(152, 192, 62, 22, () => [AVK.POUND]);
        u.textId(0x19e7, 183, 196, 'center');
        if (this.gems) {
          const g = this.gems;
          u.roundFill(7, 120, 206, 40, 0, 1);
          u.image('t', 0, 19, 15, 19, 12, 130);
          u.image('t', 0, 19, 15, 19, 195, 130, 1);
          const top = Math.max(0, Math.min(g.cur - 3, g.list.length - 4));
          for (let k = 0; k < 4; k++) {
            const gi = g.list[top + k], x = 42 + 35 * k;
            if (gi !== undefined) u.hit(x, 126, 26, 26, () => { if (g.cur === top + k) return [AVK.OK]; g.cur = top + k; });
            if (top + k === g.cur && gi !== undefined) u.glow(x - 2, 124, 30, 30, this.t);
            u.bevel(x, 126, 26, 26, CELL_EDGE, 0);
            if (gi !== undefined && inv.items[gi]) drawItemCell(u, fs, inv.items[gi], x + 1, 127);
          }
          if (!g.list.length) u.string('-', 110, 134, 'center');
        }
      }
      return;
    }
    u.roundFill(55, 35, 150, 154, 0, 1);
    for (let k = 0; k < 16; k++) {
      const x = (k & 3) * 36 + 63, y = (k >> 2) * 35 + 47;
      if (this.focus === 1 && k === this.sel) u.glow(x - 2, y - 2, 30, 30, this.t);
      u.bevel(x, y, 26, 26, CELL_EDGE, 0);
      u.hit(x - 4, y - 4, 34, 34, () => { if (this.focus === 1 && this.sel === k) return [AVK.OK]; this.focus = 1; this.sel = k; this.f = 0; });
      const it = inv.items[this.bag * 16 + k];
      if (!it) continue;
      drawItemCell(u, fs, it, x + 1, y + 1);
      if (it.type === 0x11 && it.enh) {                     // FUN_000226b0 cooldown shade
        const max = it.sub < 14 ? 100 : 900;
        if (it.enh < 4) { u.alpha = it.enh * 8; u.fill(x + 1, y + 1, 24, 24, 0xffffff); }
        else if (it.enh >= max - 1) { u.alpha = 16; u.fill(x + 1, y + 1, 24, 24, 0); }
        u.alpha = 32;
      }
    }
    if (this.focus === 0) u.glow(6, this.bag * 32 + 30, 34, 34, this.t);
    const bags = inv.bags + 3;
    for (let i = 0; i < 5; i++) {
      u.alpha = i === this.bag ? 32 : 16;
      u.button(8, 32 * (i + 1), 0x1e, 0x1e, 3, i >= bags ? 3 : i === this.bag ? 1 : 0);
      if (i < bags) u.hit(6, 32 * (i + 1) - 2, 34, 32, () => { this.focus = 0; if (this.bag !== i) { this.bag = i; this.sel = 0; } });
      else u.hit(6, 32 * (i + 1) - 2, 34, 32, () => {                 // locked bag: popup 0x7E (25 coupons, FUN_00047488)
        this.confirm = { popup: new Popup(this.ctx, 0x7e), idx: -1, yes: () => { this.message = buyBag(this.ctx, this.fs); } };
      });
      u.image('t', 15, 24, 16, 16, 15, 38 + 32 * i);
      u.alpha = 32;
      if (i < bags) {                                        // FUN_0004c514 "n/16"
        const n = Math.max(0, Math.min(16, inv.items.length - 16 * i));
        const w = String(n).length * 4 + 1;
        u.number(n, 11, 55 + 32 * i, 0, 0);
        u.cfont(t[80] ?? '/', 11 + w + 2, 55 + 32 * i);
        u.number(16, 11 + w + 8, 55 + 32 * i, 0, 0);
      }
    }
    for (let k = 0; k < 5 - bags; k++) u.image('c', 208, 63, 7, 9, 28, 175 - 32 * k);
    const it = inv.items[this.idx];
    if (this.f > 4 && it && this.focus === 1 && !this.action) {        // FUN_00058740 name tooltip
      const row = this.sel >> 2;
      const px = Math.trunc(((this.sel & 3) * 13 + 115) * 0.9);
      const y = row * 35 + 47 + (row > 2 ? -30 : 50);
      const anim = Math.min(2 * this.f, 30), k = (anim - 10) >> 1;
      if (k > 0) { u.alpha = 16; u.fill(px - 100, y - 2 * k, 200, 4 * k, 0); u.alpha = 32; }
      if (anim === 30) u.string(it.name, px, y - 8, 'center');
    }
    u.roundFill(55, 194, 82, 16, 0, 1);                      // FUN_0004c550 gold, 9 digits
    u.number(inv.gold, 130, 196, 1, 2, 9);
    u.image('t', 38, 24, 12, 12, 59, 196);
    u.button(152, 192, 0x3e, 0x16, 3, 0);
    u.textId(0x1a1d, 183, 196, 'center');
    if (this.quick) this.drawQuick(u);
  }

  /** Quick slot register overlay (FUN_00028a48). */
  private drawQuick(u: Ui): void {
    const q = this.quick!, inv = this.fs.inv;
    for (let i = 0; i < 6; i++) {
      const y = 18 + 35 * i;
      u.image('touch', 0, 18, 31, 31, -50, y - 3, 0, i === q.cur ? { tint: [255, 255, 153], amount: Math.abs(16 - (this.t % 32)) } : undefined);
      u.hit(-50, y - 3, 31, 31, () => { if (q.cur === i) return [AVK.OK]; q.cur = i; });
      const s = inv.quick[i];
      u.alpha = 16;
      if (i !== q.cur && s.kind === 2 && inv.items[s.id]) drawItemCell(u, this.fs, inv.items[s.id], -46, y);
      if (i !== q.cur && s.kind === 1) u.image('sIcon', (s.id % 10) * 24, this.fs.model.cls * 24, 24, 24, -46, y);
      u.alpha = 32;
    }
    const it = inv.items[q.idx];
    if (it) drawItemCell(u, this.fs, it, -46, 18 + 35 * q.cur);
  }

  drawOverlay(u: Ui): void {
    if (this.action) { u.pop(); this.action.draw(u); u.pushCenter220(); }
  }

  drawPopups(): void {
    if (this.shop) { this.shop.drawOverlay(); return; }
    (this.message ?? this.confirm?.popup)?.draw();
  }
}

/** Equipment tab 0x1F (FUN_0005b4b8, keys FUN_00057174) with candidate select 0x2F (FUN_0005d948). */
export class EquipTab {
  private slot = 0;
  private t = 0;
  private action: ActionPopup | null = null;
  private detail: Item | null = null;
  private pick: { cands: number[]; cur: number } | null = null;

  constructor(private ctx: GameContext, private fs: FieldScene, private playerCmf: Cmf) {}

  get busy(): boolean { return !!(this.action || this.detail || this.pick); }

  private slotOf(it: Item): number { return it.type === 15 ? 5 : Math.trunc(it.type / 3); }

  update(presses: number[]): boolean {
    this.t++;
    const inv = this.fs.inv;
    if (this.detail) { if (presses.includes(AVK.OK) || presses.includes(AVK.CLR)) this.detail = null; return true; }
    if (this.pick) {
      const p = this.pick;
      for (const k of presses) {
        if (k === AVK.LEFT && p.cur > 0) p.cur--;
        else if (k === AVK.RIGHT && p.cur < p.cands.length - 1) p.cur++;
        else if (k === AVK.OK && p.cands.length) {
          const idx = p.cands[p.cur];
          if (inv.usable(inv.items[idx], this.fs.model.level, this.fs.model.cls)) { inv.equipFrom(idx); this.fs.recompute(); }
          this.pick = null;
          break;
        } else if (k === AVK.CLR) { this.pick = null; break; }
      }
      return true;
    }
    if (this.action) {
      const r = this.action.handle(presses);
      if (r !== null) { this.action = null; if (r) this.run(r); }
      return true;
    }
    for (const k of presses) {
      if (k === AVK.LEFT) this.slot = (this.slot + 5) % 6;
      else if (k === AVK.RIGHT) this.slot = (this.slot + 7) % 6;
      else if (k === AVK.UP) this.slot = (this.slot + 4) % 6;
      else if (k === AVK.DOWN) this.slot = (this.slot + 8) % 6;
      else if (k === AVK.OK) {
        const eq = !!inv.equip[this.slot];
        const e = eq ? [ACTION.DETAIL, ACTION.EQUIP, ACTION.UNEQUIP, ACTION.DROP, ACTION.CANCEL] : [ACTION.EQUIP, ACTION.CANCEL];
        const s = this.slot;
        this.action = new ActionPopup(this.ctx, e, 130 + (s & 1) * 48 + 52, 50 + (s >> 1) * 33 + 45 - ((s >> 1) === 2 ? 30 : 0));
      } else return false;
    }
    return true;
  }

  private run(action: number): void {
    const inv = this.fs.inv, it = inv.equip[this.slot];
    if (action === ACTION.DETAIL && it) this.detail = it;
    else if (action === ACTION.EQUIP) {
      const cands = inv.items.map((x, i) => [x, i] as const).filter(([x]) => x.type < 0x10 && this.slotOf(x) === this.slot).map(([, i]) => i);
      this.pick = { cands, cur: 0 };
    } else if (action === ACTION.UNEQUIP) { inv.unequip(this.slot); this.fs.recompute(); }
    else if (action === ACTION.DROP && it) { inv.equip[this.slot] = null; this.fs.recompute(); }
  }

  draw(u: Ui): void {
    const fs = this.fs, inv = fs.inv, t = this.ctx.assets.text;
    if (this.detail) { drawItemDetail(u, fs, this.detail); u.hit(-200, -200, 700, 700, () => [AVK.OK]); return; }
    if (this.pick) { this.drawPick(u); return; }
    for (let i = 0; i < 6; i++) {
      const x = (i & 1) * 116 + 40, y = (i >> 1) * 35 + 33;
      if (i === this.slot) u.glow(x - 3, y - 3, 30, 30, this.t);
      u.bevel(x, y, 24, 24, CELL_EDGE, EQUIP_FILL);
      u.hit(x - 5, y - 5, 34, 34, () => { if (this.slot === i) return [AVK.OK]; this.slot = i; });
      const it = inv.equip[i];
      if (it) drawItemCell(u, fs, it, x, y);
      else u.cSprite(12 + i, x + 12, y + 13, true);
    }
    u.alpha = 20;
    u.image('shadow', 120, 0, 36, 20, 92, 96, 14 << 8);           // multiply
    u.alpha = 32;
    const f = (Math.trunc(this.t / 2) % 6) + 0;                    // idle frames 0..5 (facing down)
    u.frame(`cmf_c${fs.model.cls}`, this.playerCmf, f, 110, 102);
    u.roundFill(8, 135, 204, 22, 0, 1);
    const cur = inv.equip[this.slot];
    if (cur) u.string(cur.name, 110, 139, 'center');
    u.roundFill(8, 161, 204, 48, 0x171d24, 1);
    const st = fs.stats;
    const vals = [st.D[6], st.D[7], st.D[8], st.D[9], st.atk, st.def];
    const labels = [t[0x15], t[0x16], t[0x17], t[0x18], t[0x4e] ?? 'DMG', t[0x4f] ?? 'DEF'];
    for (let i = 0; i < 6; i++) {
      const x = (i >> 1) * 64 + 20, row = (i % 3) - (i > 3 ? 1 : 0) - (i === 2 ? 1 : 0);
      const y = 172 + 18 * row;
      u.tfont(labels[i] ?? '', x, y);
      u.number(vals[i], x + 27, y - 2, 1, 0);
    }
  }

  /** 0x2F candidate select, simplified comparison (main stat only). */
  private drawPick(u: Ui): void {
    const fs = this.fs, inv = fs.inv, p = this.pick!, t = this.ctx.assets.text;
    u.image('t', 0, 0x13, 0xf, 0x13, 17, 35);
    u.image('t', 0, 0x13, 0xf, 0x13, 189, 35, 1);
    u.hit(-200, -200, 700, 700, () => [AVK.CLR]);              // tap outside the list closes
    u.hit(10, 28, 30, 30, () => [AVK.LEFT]);
    u.hit(182, 28, 30, 30, () => [AVK.RIGHT]);
    u.roundFill(41, 30, 138, 32, 0, 1);
    const top = Math.max(0, p.cur - 3);
    for (let k = 0; k < 4; k++) {
      const x = 46 + 34 * k, idx = p.cands[top + k];
      if (top + k === p.cur && idx !== undefined) u.glow(x - 2, 30, 28, 28, this.t);
      u.bevel(x, 32, 24, 24, CELL_EDGE, EQUIP_FILL);
      if (idx !== undefined) u.hit(x - 4, 28, 32, 32, () => { if (p.cur === top + k) return [AVK.OK]; p.cur = top + k; });
      if (idx !== undefined) drawItemCell(u, fs, inv.items[idx], x, 32);
      else u.cSprite(12 + this.slot, x + 12, 45, true);
    }
    u.roundFill(18, 63, 185, 148, 0, 1);
    if (!p.cands.length) { u.textId(0x1a1e, 110, 70, 'center'); return; }
    const it = inv.items[p.cands[p.cur]], old = inv.equip[this.slot];
    u.bevel(38, 68, 24, 24, CELL_EDGE, EQUIP_FILL);
    drawItemCell(u, fs, it, 38, 68);
    u.string(it.name, 70, 74);
    u.cfont(t[0x24] ?? 'REQUIRE LV', 130, 94);
    u.number(it.reqLevel, 190, 94, 0, 2);
    const label = t[this.slot === 0 ? 0x1ad2 : this.slot === 5 ? 0x1ad6 : 0x1ad4] ?? '';
    const d = it.base - (old?.base ?? 0);
    const cmp = d > 0 ? `${label} ${it.base}(|e+${d}|b)` : d < 0 ? `${label} ${it.base}|b(|c${d}|b)` : `${label} ${it.base}`;
    u.string(cmp, 110, 110, 'center');
    let y = 128;
    for (const [id, v] of it.options) {
      if (id === 0xff) continue;
      u.string((t[1972 + id] ?? '').replace('%d', String(v)).replace('%%', '%'), 106, y, 'center');
      y += 15;
    }
  }

  drawOverlay(u: Ui): void {
    if (this.action) { u.pop(); this.action.draw(u); u.pushCenter220(); }
  }
}
