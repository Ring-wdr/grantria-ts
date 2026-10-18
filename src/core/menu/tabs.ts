// Inventory tab (0x1E) and equipment tab (0x1F, candidate select 0x2F) on the 1.3x layer,
// ported from analysis/features/ui-tabs.md §0.4 / §0.5 (C220 coordinates unless noted).
// Enhance / decompose / combine from the inventory open the shop screens (shop.md §2.9); socket reset
// and gem attach / detach follow shop.md §2.8. Bag purchase: locked bag -> popup 0x7E (community.ts). 가방정리 ('#') opens
// 가방 관리 (bagTools.ts, not in the original): 정렬 (the original FUN_0003b3a8(0), Inventory.sortBag), 일괄 버리기, 일괄 분해.
// State and keys; the host draws it (web/game/tabs.ts).
import type { FieldGame } from '../field/fieldGame';
import { AVK, slotPickerKey } from '../keys';
import { BAG_COUNT, type Item } from '../rules/items';
import { Popup, QtyPopup, popupOverlay } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';
import { flowOverlay, type Step } from '../ui/flow';
import { quantityFlow, type QuantityEvent } from '../ui/flows/quantityFlow';
import { buyCouponTool, couponToolPopup } from './bagTools';
import { countOf, consume } from '../rules/shopRules';
import type { Host } from '../host';
import type { ShopLogic } from './shop';
import type { BagToolsLogic } from './bagTools';
import type { ScrollRef } from '../render';
import { buyBag } from './community';
import { ActionPopup } from './actionPopup';

/** Action ids of the item action popup (text 0x171 + id), kind 0 = inventory, 4 = equipment tab. */
export const ACTION = { DETAIL: 1, USE: 2, DECOMPOSE: 3, QUICK: 5, DROP: 4, CANCEL: 6, UNEQUIP: 7, EQUIP: 8, ENHANCE: 12, SOCKET: 28,
  /** 잠금 / 잠금 해제 (not in the original, no text id: the host labels them) */
  LOCK: 40, UNLOCK: 41 } as const;
/** FUN_00036d24: 0x1b subs that can go on a quick slot (half HP/MP, 차원·공격·방어 elixirs, special elixirs) */
const QUICK_1B = new Set([0x02, 0x15, 0x16, 0x17, 0x23, 0x24, 0x25, 0x26]);
// 0x30 (황금알) and the operator boxes 0x33..0x38 are server gifts with no offline source: no "use" entry
// 0x30 황금알 is usable here (not in the original): the 출석 보상's day-7 gift (core/rules/attendance.ts)
const USABLE_1B = new Set([2, 4, 5, 6, 7, ...range(0xe, 0x1a), ...range(0x1d, 0x20), ...range(0x22, 0x2e), 0x30]);

function range(a: number, b: number): number[] { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }

/** Inventory tab 0x1E (FUN_0005b744 -> FUN_00058890, keys FUN_000572a8). */
export abstract class InventoryTabLogic {
  protected bag = 0;
  protected focus: 0 | 1 = 1;
  protected sel = 0;
  protected f = 0;
  private t = 0;
  protected action: ActionPopup | null = null;
  protected detail: Item | null = null;
  protected quick: { cur: number; idx: number } | null = null;
  /** messages, confirmations and the drop flow over the tab */
  protected readonly overlays = new OverlayStack();
  /** popup 0x7D (bag expansion without coupons) confirmed: the menu opens the coupon shop */
  toCoupons = false;
  /** shop screen opened from the inventory (enhance / decompose / combine) */
  protected shop: ShopLogic | null = null;
  /** gem picker in the item detail ('0'): gem inventory indexes and the cursor */
  protected gems: { list: number[]; cur: number } | null = null;
  /** 가방 관리 panel ('#') */
  protected tools: BagToolsLogic | null = null;
  /** bag column scroll (up to BAG_COUNT bags, 5 in view) */
  protected bagScroll: ScrollRef = { y: 0 };

  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

  /** the host's views of the screens the inventory opens */
  protected abstract newShop(kind: number, inv: { mode: 'enhance' | 'decompose' | 'combine'; idx: number }): ShopLogic;
  protected abstract newBagTools(): BagToolsLogic;

  get busy(): boolean { return !!(this.action || this.detail || this.quick || this.overlays.size || this.shop || this.tools); }
  /** the quick-slot picker is open (its slot keys must not page the menu) */
  get picking(): boolean { return !!this.quick; }

  protected get idx(): number { return this.bag * 16 + this.sel; }

  update(presses: number[]): boolean {
    this.t++;
    if (this.f < 15) this.f++;
    const inv = this.fs.inv;
    if (this.shop) { if (this.shop.update(presses) === 'close') { this.shop = null; this.fs.recompute(); } return true; }
    if (this.tools) {
      if (!this.tools.update(presses)) { if (this.tools.toCoupons) this.toCoupons = true; this.tools = null; this.sel = Math.min(this.sel, 15); }
      return true;
    }
    if (this.overlays.update(presses)) return true;
    if (this.gems) { this.gemKeys(presses); return true; }
    if (this.detail) {
      const it = this.detail;
      for (const k of presses) {
        if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
        if (k === AVK.OK || k === AVK.CLR) { this.detail = null; break; }
        if ((k === AVK.K0 || k === AVK.STAR) && it.type < 0x10) this.openGems(it);   // '0' (pad: L2)
        else if (k === AVK.POUND && it.type < 0x10) this.extractGems(it);
      }
      return true;
    }
    if (this.quick) {
      for (const k of presses) {
        const m = slotPickerKey(k, this.quick.cur);
        if (m) this.quick.cur = m.cur;
        if (m?.pick || k === AVK.OK) { inv.registerQuick(this.quick.cur, 2, this.quick.idx); this.quick = null; break; }
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
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (this.focus === 0) {
        // the cursor also reaches the first locked bag (BAG_COUNT at most), where OK asks to buy it (popup 0x7E)
        if (k === AVK.UP || k === AVK.DOWN) { const n = Math.min(BAG_COUNT, inv.bags + 4); this.bag = (this.bag + (k === AVK.UP ? n - 1 : 1)) % n; this.sel = 0; this.f = 0; }
        else if (k === AVK.OK) { if (this.bag >= inv.bags + 3) this.askBag(); else this.focus = 1; }
        else if (k === AVK.POUND) this.tools = this.newBagTools();   // 가방정리 → 가방 관리 (both foci)
        else return false;                                            // common tab keys
      } else {
        const before = this.sel;
        if (k === AVK.LEFT && this.sel > 0) this.sel--;
        else if (k === AVK.RIGHT && this.sel < 15) this.sel++;
        else if (k === AVK.UP && this.sel >= 4) this.sel -= 4;
        else if (k === AVK.DOWN) this.sel = Math.min(this.sel + 4, 15);
        else if (k === AVK.OK) { if (inv.items[this.idx]) this.openActions(); }
        else if (k === AVK.POUND) this.tools = this.newBagTools();
        else if (k === AVK.CLR) this.focus = 0;
        else return false;
        if (this.sel !== before) this.f = 0;
      }
    }
    return true;
  }

  /** a message popup; 0x7D (쿠폰 부족) once confirmed opens the coupon shop from the menu */
  private say(p: Popup): void {
    this.overlays.open(popupOverlay(p), { on: { close: () => { if (p.id === 0x7d) this.toCoupons = true; } } });
  }
  private ask(p: Popup, yes: () => void): void { this.overlays.open(popupOverlay(p), { on: { yes } }); }

  /** DROP (FUN_0005e23c case 4): the quantity flow (flows/quantityFlow.ts) over popups 0x0C, 0x0D, 0x58 and 0xB */
  private dropItem(idx: number): void {
    const inv = this.fs.inv, it = inv.items[idx], stack = this.fs.db.stackable(it.type, it.sub) && it.type !== 0x18;
    const qty = new QtyPopup(it.count);
    const machine = quantityFlow.provide({ actions: { commit: (_, { n }) => {
      if (!stack) inv.remove(idx);
      else { if (it.count > n) it.count -= n; else inv.remove(idx); inv.remapQuick(); }
      this.fs.recompute();
    } } });
    const popup = (id: number, answer: (r: 'yes' | 'no' | 'ok') => QuantityEvent) => (): Step<QuantityEvent> => {
      const p = new Popup(this.ctx, id);
      return { handle: (k) => { const r = p.handle(k); return r && answer(r); }, model: p };
    };
    this.overlays.open(flowOverlay(machine, { held: it.count, stack, tooManyBack: true }, {
      qty: () => ({
        handle: (k): QuantityEvent | null => { const r = qty.handle(k); return r === 'cancel' ? { type: 'cancel' } : r === 'ok' ? { type: 'qty', n: qty.qty } : null; },
        model: qty,
      }),
      none: popup(0x0d, () => ({ type: 'ok' })),
      tooMany: popup(0x58, () => ({ type: 'ok' })),
      confirm: popup(0xb, (r) => ({ type: r === 'yes' ? 'yes' : 'no' })),
    }));
  }

  private openActions(): void {
    const it = this.fs.inv.items[this.idx], cls = this.fs.model.cls;
    const e: number[] = [ACTION.DETAIL];
    if (it.type === 0x11 || it.type === 0x19 || (it.type === 0x1b && USABLE_1B.has(it.sub))) e.push(ACTION.USE);
    if (it.type < 0x10 && (it.type === 15 || it.type % 3 === cls)) e.push(ACTION.EQUIP);
    if (it.type < 0x0f) e.push(ACTION.ENHANCE);
    // 잠금 (not in the original): a locked item offers no 분해 / 버리기
    if (it.type < 0x10 && !it.lock) e.push(ACTION.DECOMPOSE);
    if (it.type === 0x11 || (it.type === 0x1b && QUICK_1B.has(it.sub))) e.push(ACTION.QUICK);   // FUN_00036d24 (jump table 0x102F30)
    if (!it.lock) e.push(ACTION.DROP);
    if (it.type < 0x10) e.push(ACTION.SOCKET, it.lock ? ACTION.UNLOCK : ACTION.LOCK);
    e.push(ACTION.CANCEL);
    const col = this.sel % 4;
    this.action = new ActionPopup(e, col > 1 ? 'left' : 'right', Math.trunc(this.sel / 4) > 1);
  }

  private run(action: number): void {
    const inv = this.fs.inv, idx = this.idx, it = inv.items[idx];
    if (!it) return;
    const has = (t: number, sub: number) => countOf(inv, t, sub) > 0;
    if (action === ACTION.DETAIL) this.detail = it;
    else if (action === ACTION.USE && it.type === 0x19) {                   // recipe: the blacksmith combine screen
      if (inv.unlocked(10)) this.shop = this.newShop(2, { mode: 'combine', idx });
      else this.askCoupon(3, idx);
    } else if (action === ACTION.USE) this.fs.useItem(idx);
    else if (action === ACTION.ENHANCE) {                                    // needs the enhance scroll (0x1b, 0x0c)
      if (has(0x1b, 0x0c)) this.shop = this.newShop(2, { mode: 'enhance', idx });
      else this.askCoupon(2, idx);
    } else if (action === ACTION.DECOMPOSE) {                                // needs the magic dismantler (0x1b, 9: unlock bit)
      if (inv.unlocked(9)) this.shop = this.newShop(2, { mode: 'decompose', idx });
      else this.askCoupon(4, idx);
    } else if (action === ACTION.SOCKET) {                                   // socket scroll (0x1b, 0x21)
      if (!has(0x1b, 0x21)) { this.say(new Popup(this.ctx, 0x77)); return; }
      this.ask(new Popup(this.ctx, 0x76), () => {
        const r = this.fs.rng.rand(1000);
        it.sockets = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
        it.count = r > 500 ? 3 : r > 150 ? 4 : 5;                          // 49.9 % / 35 % / 15.1 %
        consume(inv, 0x1b, 0x21, 1);
        this.fs.recompute();
        this.fs.autosave();
      });
    }
    else if (action === ACTION.EQUIP) {
      if (!inv.usable(it, this.fs.model.level, this.fs.model.cls)) this.say(new Popup(this.ctx, 0x2b));
      else { inv.equipFrom(idx); this.fs.recompute(); }
    } else if (action === ACTION.QUICK) this.quick = { cur: Math.max(0, inv.quick.findIndex((q) => q.kind === 0)), idx };
    else if (action === ACTION.DROP) this.dropItem(idx);
    else if (action === ACTION.LOCK) it.lock = 1;
    else if (action === ACTION.UNLOCK) delete it.lock;
  }

  /** '0' in the detail: gem list (FUN_000441e4) when an empty socket exists */
  private openGems(it: Item): void {
    const used = it.sockets.filter((g) => g !== 0xff).length;
    if (used >= it.count) { this.say(new Popup(this.ctx, 0x44)); return; }
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
        this.ask(new Popup(this.ctx, 0x43), () => {                                    // FUN_0003dcd0
          const gem = inv.items[gi], slot = it.sockets.findIndex((v, i) => i < it.count && v === 0xff);
          if (!gem || slot < 0) return;
          while (it.sockets.length < 6) it.sockets.push(0xff);
          it.sockets[slot] = gem.grade * 50 + gem.sub;
          this.fs.achieve({ k: 'gem' });
          consume(inv, 0x10, gem.sub, 1);
          this.gems = null;
          this.fs.recompute();
          this.fs.autosave();
        });
        return;
      }
    }
  }
  /**
   * No tool (FUN_0005446c / FUN_00055004): outside save-allowed areas popup 0x6D, else popup 0x49 offering to buy it with
   * coupons (text FUN_0004d7dc: 강화석 ×10 for 10 coupons, 대장장이의 모루 / 마법 해체기 (permanent) for 15). Yes
   * (FUN_00053ca0 case 0x18): too few coupons -> 0x7D, no room for 10 stones -> 0x6A; then the coupons go and the tool is
   * granted (server op 0x30, FUN_00076398, done locally) and the action continues as with the tool (op 0x32, FUN_000752bc).
   */
  private askCoupon(act: 2 | 3 | 4, idx: number): void {
    if (!this.fs.canSave) { this.say(new Popup(this.ctx, 0x6d)); return; }
    this.ask(couponToolPopup(this.ctx, this.fs, act), () => {
      const refused = buyCouponTool(this.ctx, this.fs, act);
      if (refused) { this.say(refused); return; }
      this.shop = this.newShop(2, { mode: act === 2 ? 'enhance' : act === 3 ? 'combine' : 'decompose', idx });
    });
  }

  /** '#' (FUN_00044564 -> FUN_00040320): the bag check first (0x61), then no gems 0x63 / no extractor 0x62. One
   *  extractor takes every gem of sockets 0..4 out (no choice, no breaking); for each gem the item's options with the
   *  gem's stat id lose the gem's value (attaching never added them: original behaviour). Log 0x1ACC, sfx 0x2f, the
   *  detail window closes. */
  private extractGems(it: Item): void {
    const inv = this.fs.inv, gems = it.sockets.filter((v) => v !== 0xff).length;   // FUN_000395a4
    if (inv.items.length + gems > inv.cap) { this.say(new Popup(this.ctx, 0x61)); return; }
    if (countOf(inv, 0x1b, 0x0b) === 0 || gems === 0) { this.say(new Popup(this.ctx, gems === 0 ? 0x63 : 0x62)); return; }
    consume(inv, 0x1b, 0x0b, 1);
    for (let s = 0; s < 5; s++) {
      const v = it.sockets[s];
      if (v === undefined || v === 0xff) continue;
      const sub = v % 50, grade = Math.trunc(v / 50);
      inv.gain(0x10, sub, grade, 1, this.fs.rng);
      it.sockets[s] = 0xff;
      const g = inv.items.find((x) => x.type === 0x10 && x.sub === sub && x.grade === grade);
      if (g) it.options = it.options.flatMap(([id, val]): [number, number][] => id !== g.aux ? [[id, val]] : val <= g.base ? [] : [[id, val - g.base]]);
    }
    this.fs.hud.message(this.ctx.assets.text[0x1acc] ?? '');           // 보석추출을 완료하였습니다.
    this.ctx.audio.playSfx(0x2f);
    this.detail = null;
    this.fs.recompute();
    this.fs.autosave();
  }

  /** locked bag: popup 0x7E (25 coupons, FUN_00047488) */
  protected askBag(): void {
    this.ask(new Popup(this.ctx, 0x7e), () => this.say(buyBag(this.ctx, this.fs)));
  }
}

/** Equipment tab 0x1F (FUN_0005b4b8, keys FUN_00057174) with candidate select 0x2F (FUN_0005d948). */
export class EquipTabLogic {
  protected slot = 0;
  protected t = 0;
  protected action: ActionPopup | null = null;
  protected detail: Item | null = null;
  protected pick: { cands: number[]; cur: number } | null = null;
  /** not in the original: DROP of a worn item asks first (popup 0xB, as for a bag item) */
  protected readonly overlays = new OverlayStack();

  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

  get busy(): boolean { return !!(this.action || this.detail || this.pick || this.overlays.size); }

  private slotOf(it: Item): number { return it.type === 15 ? 5 : Math.trunc(it.type / 3); }

  update(presses: number[]): boolean {
    this.t++;
    const inv = this.fs.inv;
    if (this.detail) { if (presses.includes(AVK.OK) || presses.includes(AVK.CLR)) this.detail = null; return true; }
    if (this.overlays.update(presses)) return true;
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
        const e = eq ? [ACTION.DETAIL, ACTION.EQUIP, ACTION.UNEQUIP, ...(inv.equip[this.slot]!.lock ? [] : [ACTION.DROP]), ACTION.CANCEL] : [ACTION.EQUIP, ACTION.CANCEL];
        const s = this.slot;
        this.action = new ActionPopup(e, s & 1 ? 'left' : 'right', (s >> 1) === 2);
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
    else if (action === ACTION.DROP && it) {                                   // the original drops at once
      this.overlays.open(popupOverlay(new Popup(this.ctx, 0xb)), { on: { yes: () => {
        if (inv.equip[this.slot]) { inv.equip[this.slot] = null; this.fs.recompute(); }
      } } });
    }
  }
}
