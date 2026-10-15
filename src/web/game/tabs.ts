// Inventory tab (0x1E) and equipment tab (0x1F, candidate select 0x2F) on the 1.3x layer,
// ported from analysis/features/ui-tabs.md §0.4 / §0.5 (C220 coordinates unless noted).
// Enhance / decompose / combine from the inventory open the shop screens (shop.md §2.9); socket reset
// and gem attach / detach follow shop.md §2.8. Bag purchase: locked bag -> popup 0x7E (community.ts). 가방정리 ('#') opens
// 가방 관리 (bagTools.ts, not in the original): 정렬 (the original FUN_0003b3a8(0), Inventory.sortBag), 일괄 버리기, 일괄 분해.
import type { Cmf } from '../../core/data/assets';
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { QUICK_KEYS, slotPickerKey } from '../../core/keys';
import { BAG_COUNT, type Item } from '../../core/rules/items';
import { Popup, QtyPopup, popupOverlay } from './popup';
import { OverlayStack } from './overlays';
import { flowOverlay, type Step } from './flow';
import { quantityFlow, type QuantityEvent } from './flows/quantityFlow';
import { buyBag } from './community';
import { BagTools, buyCouponTool, couponToolPopup } from './bagTools';
import { ShopScreen } from './shop';
import { combineNeeds, countOf, consume, detailLines } from '../../core/rules/shopRules';
import type { GameContext } from './scene';
import type { Ui } from '../render/ui';
import { button, cSprite, gt, h, padBadge, sprite, type KeyAct, type ScrollRef, type VChild, type VNode } from '../render/view';
import '../styles/tabs.css';
import { compareGear, equipSlot } from '../../core/rules/compare';
import '../styles/convenience.css';
import { platform } from '../../core/platform';

/** URL of an image under assets/images (resolved per call: the platform is installed at boot) */
const imageUrl = (name: string) => platform().assets.url(`images/${name}.png`);

/** Action ids of the item action popup (text 0x171 + id), kind 0 = inventory, 4 = equipment tab. */
const ACTION = { DETAIL: 1, USE: 2, DECOMPOSE: 3, QUICK: 5, DROP: 4, CANCEL: 6, UNEQUIP: 7, EQUIP: 8, ENHANCE: 12, SOCKET: 28 } as const;
/** FUN_00036d24: 0x1b subs that can go on a quick slot (half HP/MP, 차원·공격·방어 elixirs, special elixirs) */
const QUICK_1B = new Set([0x02, 0x15, 0x16, 0x17, 0x23, 0x24, 0x25, 0x26]);
// 0x30 (황금알) and the operator boxes 0x33..0x38 are server gifts with no offline source: no "use" entry
// 0x30 황금알 is usable here (not in the original): the 출석 보상's day-7 gift (core/rules/attendance.ts)
const USABLE_1B = new Set([2, 4, 5, 6, 7, ...range(0xe, 0x1a), ...range(0x1d, 0x20), ...range(0x22, 0x2e), 0x30]);

function range(a: number, b: number): number[] { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }

/** FUN_0003bcf0 item cell: red tint 12 when unusable, icon at +4, count at (+24, 0). */
export function drawItemCell(u: Ui, fs: FieldScene, it: Item, x: number, y: number): void {
  const r = fs.db.iconRect(it.icon);
  const usable = fs.inv.usable(it, fs.model.level, fs.model.cls);
  u.image(r.image, r.sx, r.sy, 16, 16, x + 4, y + 4, 0, usable ? undefined : { tint: [255, 0, 0], amount: 12 });
  if (fs.db.showsCount(it)) u.number(it.count, x + 24, y, 0, 2);
}

/** item icon as a view sprite; unusable items get the red tint 12 (FUN_0003bcf0) */
export function itemIcon(fs: FieldScene, it: Item, cls = ''): VNode {
  const r = fs.db.iconRect(it.icon);
  const usable = fs.inv.usable(it, fs.model.level, fs.model.cls);
  return sprite(r.image, r.sx, r.sy, 16, 16, usable ? { cls } : {
    cls: `v-tint ${cls}`, style: `--tint:rgb(255,0,0);--tint-a:${12 / 32};--mask:url("${imageUrl(r.image)}");`,
  });
}

/** FUN_0003bcf0 item cell as a view: bevelled cell, icon, count badge; `empty` fills an empty cell */
export function cellView(fs: FieldScene, it: Item | null | undefined, opts: { sel?: boolean; on?: KeyAct; cls?: string; empty?: VChild; shade?: VChild; anchor?: VChild } = {}): VNode {
  return h('div.tb-cell', { cls: [opts.cls, opts.sel && 'v-sel'].filter(Boolean).join(' '), on: opts.on },
    it ? itemIcon(fs, it) : opts.empty,
    it && opts.shade,
    it && fs.db.showsCount(it) && h('span.tb-count', null, String(it.count)),
    opts.anchor);
}

/** stat option line (text 1972 + id, "%d" / "%%") */
function optionText(t: string[], id: number, v: number): string {
  return (t[1972 + id] ?? '').replace('%d', String(v)).replace('%%', '%');
}

/** an option difference: "+-3" of the formatted text becomes "-3" */
function optionDiffText(t: string[], id: number, d: number): string {
  return optionText(t, id, d).replace('+-', '-').replace('--', '-');
}

/**
 * 비교 (not in the original): the gear item against the one worn in its slot — main stat, every option and the
 * sockets, green for a gain and red for a loss. Nothing when it is the worn item itself or not gear.
 */
export function compareView(fs: FieldScene, it: Item): VChild {
  if (it.type >= 0x10) return null;
  const worn = fs.inv.equip[equipSlot(it)] ?? null;
  if (worn === it) return null;
  const t = fs.db.a.text, d = compareGear(it, worn);
  const label = it.type < 3 ? 0x1ad2 : it.type < 15 ? 0x1ad4 : 0x1ad6;
  const sign = (v: number) => (v > 0 ? `+${v}` : String(v));
  const pen = (v: number) => (v > 0 ? 0x07e0 : 0xf800);
  return [
    h('div.v-rule'),
    gt(worn ? `착용 중: ${worn.name}` : '착용 중인 장비 없음', { pen: 0xc618, cls: 'tb-ellipsis' }),
    gt(`${t[label] ?? ''} ${d.base === 0 ? '±0' : `${sign(d.base)} ${d.base > 0 ? '▲' : '▼'}`}`, { pen: d.base === 0 ? 0xc618 : pen(d.base) }),
    d.enh && d.enh[1] !== 0 && gt(`강화 ${optionDiffText(t, d.enh[0], d.enh[1])} ${d.enh[1] > 0 ? '▲' : '▼'}`, { pen: pen(d.enh[1]) }),
    d.options.map(([id, v]) => gt(`${optionDiffText(t, id, v)} ${v > 0 ? '▲' : '▼'}`, { pen: pen(v) })),
    (d.gems[1] || d.socketsOld[1]) ? gt(`소켓 ${d.gems[0]}/${d.gems[1]} (착용 중 ${d.socketsOld[0]}/${d.socketsOld[1]})`, { pen: 0xc618 }) : null,
  ];
}

/** main-stat change against the worn item, for the inventory name bar */
function baseDelta(fs: FieldScene, it: Item | undefined): VChild {
  if (!it || it.type >= 0x10) return null;
  const worn = fs.inv.equip[equipSlot(it)] ?? null;
  if (worn === it) return null;
  const v = compareGear(it, worn).base;
  if (v === 0) return h('span.tb-delta', null, '±0');
  return h(`span.tb-delta.${v > 0 ? 'up' : 'down'}`, null, `${v > 0 ? '▲' : '▼'}${Math.abs(v)}`);
}

/** ◀ / ▶ arrow (t.pxl 0,0x13 15x19) that presses LEFT / RIGHT */
function arrow(right: boolean): VNode {
  return h('span.tb-arrow', { on: () => [right ? AVK.RIGHT : AVK.LEFT] }, sprite('t', 0, 0x13, 0xf, 0x13, { flip: right }));
}

/**
 * Item action popup (FUN_00055820 / FUN_000552e0 / FUN_00055004): a column of keycaps attached to
 * the selected cell by CSS (beside it, sliding in), not at computed coordinates. `side` / `up`
 * choose the direction so it stays inside the window.
 */
export class ActionPopup {
  sel = 0;
  private c = 0;
  constructor(private ctx: GameContext, readonly entries: number[], private side: 'left' | 'right' = 'right', private up = false) {}
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
  /** per frame: the opening frames gate input (as the original slide-in) and taps elsewhere close it */
  draw(u: Ui): void {
    this.c = this.c < 10 ? this.c + 1 : 3;
    u.hit(-1000, -1000, 3000, 3000, () => [AVK.CLR]);
  }
  /** the menu, to be placed inside the selected cell (cellView opts.anchor) */
  anchor(): VNode {
    const t = this.ctx.assets.text;
    return h(`div.tb-anchor.${this.side}${this.up ? '.up' : ''}`, null,
      h('div.v-col.tb-actions', null, this.entries.map((v, i) => button(gt(t[v === 0x1c ? 0x1bca : v === 0x14 ? 0x198 : 0x171 + v] ?? ''), {
        sel: i === this.sel, on: () => { this.sel = i; return [AVK.OK]; },
      }))));
  }
  /** over the screen's view, under the menu: a tap outside closes it */
  backdrop(): VNode {
    return h('div.v-modal.tb-backdrop', { on: () => [AVK.CLR] });
  }
}

/**
 * Item detail (MENUPOP 1, FUN_00032344 + FUN_0002ae5c), simplified: no sets or sockets. A view over
 * the 220 window (0, 23, 220, 196); `footer` adds a button row, `overlay` floats over the body.
 */
export function itemDetailView(fs: FieldScene, it: Item, footer?: VChild, overlay?: VChild): VNode {
  if (it.type === 0x19) return recipeDetailView(fs, it, footer, overlay);
  const t = fs.db.a.text, gear = it.type < 0x10;
  const lines = detailLines(fs.db.a, it);
  const desc = t[fs.db.descId(it.type, it.sub, it.grade)] ?? '';
  return h('div.u-window.v-col.v-fill.tb-detail', null,
    h('div.v-box.v-row.tb-detail-head', null,
      cellView(fs, it),
      h('div.v-col.v-grow', { style: 'gap:1px' },
        h('div.v-row', { style: 'gap:4px' },
          gt(it.name, { cls: 'v-grow tb-ellipsis' })),                   // the name already carries "+N" (renameEnh)
        gear && h('div.v-row.tb-sub', null,
          h('span.v-grow', null, `${t[0x24] ?? 'REQUIRE LV'} ${it.reqLevel}`),
          it.type < 15 && gt(t[0x5d + (it.type % 3)] ?? '', { pen: 0x9e7f })))),
    h('div.v-box.v-col.v-grow.v-scroll.tb-detail-body', null,
      gt(desc),
      gear && h('div.v-rule'),
      gear && lines.enh && gt(lines.enh),                               // FUN_0002ae5c: enhanced armour, above the options
      gear && lines.stat && gt(lines.stat),                             // "공격력 : N |i+ 강화 보너스" (FUN_0004eea0)
      gear && it.options.filter(([id]) => id !== 0xff).map(([id, v]) => gt(optionText(t, id, v), { pen: 0x9e7f })),
      gear && compareView(fs, it)),
    footer,
    overlay);
}

/**
 * Recipe detail (FUN_00032344 type 0x19 branch, text buffers from FUN_000390f0): the product's icon,
 * name, REQUIRE LV and its own description (0xa50 + model(product)), then the three materials. The
 * "%s를 만들기 위한 제작서" texts (0xc33..) are never shown by the original (only a dead load in FUN_0003ab88).
 */
function recipeDetailView(fs: FieldScene, it: Item, footer?: VChild, overlay?: VChild): VNode {
  const db = fs.db, t = db.a.text, pt = it.sub >> 4, ps = it.sub & 15;
  const pr = db.iconRect(db.icon(pt, ps));
  const needs = combineNeeds(db.a, it).map((n) => {
    const have = countOf(fs.inv, n.type, n.sub), r = db.iconRect(db.icon(n.type, n.sub));
    const s = (t[have < n.count ? 0x1b16 : 0x1a6f] ?? '%d/%d').replace('%d', String(have)).replace('%d', String(n.count));
    return h('div.v-row.tb-need', { cls: have < n.count && 'short' },
      h('div.tb-cell', null, sprite(r.image, r.sx, r.sy, 16, 16)),
      gt(t[0x7fc + db.model(n.type, n.sub, 0)] ?? '', { cls: 'v-grow tb-ellipsis' }),
      gt(s));
  });
  return h('div.u-window.v-col.v-fill.tb-detail', null,
    h('div.v-box.v-row.tb-detail-head', null,
      h('div.tb-cell', null, sprite(pr.image, pr.sx, pr.sy, 16, 16)),
      h('div.v-col.v-grow', { style: 'gap:1px' },
        gt(it.name, { cls: 'tb-ellipsis' }),
        h('div.v-row.tb-sub', null, `${t[0x24] ?? 'REQUIRE LV'} ${it.level}`))),
    h('div.v-box.v-col.v-grow.v-scroll.tb-detail-body', null,
      gt(t[db.descId(pt, ps, it.grade)] ?? ''),
      h('div.v-rule'),
      needs),
    footer,
    overlay);
}

/** Item detail drawn as a view over the 220 window (shop and equipment tab) */
export function drawItemDetail(u: Ui, fs: FieldScene, it: Item): void {
  u.mount('tab-over', 'itemDetail', itemDetailView(fs, it));
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
  /** messages, confirmations and the drop flow over the tab */
  private readonly overlays = new OverlayStack();
  /** popup 0x7D (bag expansion without coupons) confirmed: the menu opens the coupon shop */
  toCoupons = false;
  /** shop screen opened from the inventory (enhance / decompose / combine) */
  private shop: ShopScreen | null = null;
  /** gem picker in the item detail ('0'): gem inventory indexes and the cursor */
  private gems: { list: number[]; cur: number } | null = null;
  /** 가방 관리 panel ('#') */
  private tools: BagTools | null = null;
  /** bag column scroll (up to BAG_COUNT bags, 5 in view) */
  private bagScroll: ScrollRef = { y: 0 };

  constructor(private ctx: GameContext, private fs: FieldScene) {}

  get busy(): boolean { return !!(this.action || this.detail || this.quick || this.overlays.size || this.shop || this.tools); }
  /** the quick-slot picker is open (its slot keys must not page the menu) */
  get picking(): boolean { return !!this.quick; }

  private get idx(): number { return this.bag * 16 + this.sel; }

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
        else if (k === AVK.POUND) this.tools = new BagTools(this.ctx, this.fs);   // 가방정리 → 가방 관리 (both foci)
        else return false;                                            // common tab keys
      } else {
        const before = this.sel;
        if (k === AVK.LEFT && this.sel > 0) this.sel--;
        else if (k === AVK.RIGHT && this.sel < 15) this.sel++;
        else if (k === AVK.UP && this.sel >= 4) this.sel -= 4;
        else if (k === AVK.DOWN) this.sel = Math.min(this.sel + 4, 15);
        else if (k === AVK.OK) { if (inv.items[this.idx]) this.openActions(); }
        else if (k === AVK.POUND) this.tools = new BagTools(this.ctx, this.fs);
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
    const qty = new QtyPopup(this.ctx, it.count);
    const machine = quantityFlow.provide({ actions: { commit: (_, { n }) => {
      if (!stack) inv.remove(idx);
      else { if (it.count > n) it.count -= n; else inv.remove(idx); inv.remapQuick(); }
      this.fs.recompute();
    } } });
    const popup = (id: number, answer: (r: 'yes' | 'no' | 'ok') => QuantityEvent) => (): Step<QuantityEvent> => {
      const p = new Popup(this.ctx, id);
      return { handle: (k) => { const r = p.handle(k); return r && answer(r); }, draw: () => p.draw() };
    };
    this.overlays.open(flowOverlay(machine, { held: it.count, stack, tooManyBack: true }, {
      qty: () => ({
        handle: (k): QuantityEvent | null => { const r = qty.handle(k); return r === 'cancel' ? { type: 'cancel' } : r === 'ok' ? { type: 'qty', n: qty.qty } : null; },
        draw: () => qty.draw(),
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
    if (it.type < 0x10) e.push(ACTION.DECOMPOSE);
    if (it.type === 0x11 || (it.type === 0x1b && QUICK_1B.has(it.sub))) e.push(ACTION.QUICK);   // FUN_00036d24 (jump table 0x102F30)
    e.push(ACTION.DROP);
    if (it.type < 0x10) e.push(ACTION.SOCKET);
    e.push(ACTION.CANCEL);
    const col = this.sel % 4;
    this.action = new ActionPopup(this.ctx, e, col > 1 ? 'left' : 'right', Math.trunc(this.sel / 4) > 1);
  }

  private run(action: number): void {
    const inv = this.fs.inv, idx = this.idx, it = inv.items[idx];
    if (!it) return;
    const has = (t: number, sub: number) => countOf(inv, t, sub) > 0;
    if (action === ACTION.DETAIL) this.detail = it;
    else if (action === ACTION.USE && it.type === 0x19) {                   // recipe: the blacksmith combine screen
      if (inv.unlocked(10)) this.shop = new ShopScreen(this.ctx, this.fs, 2, { mode: 'combine', idx });
      else this.askCoupon(3, idx);
    } else if (action === ACTION.USE) this.fs.useItem(idx);
    else if (action === ACTION.ENHANCE) {                                    // needs the enhance scroll (0x1b, 0x0c)
      if (has(0x1b, 0x0c)) this.shop = new ShopScreen(this.ctx, this.fs, 2, { mode: 'enhance', idx });
      else this.askCoupon(2, idx);
    } else if (action === ACTION.DECOMPOSE) {                                // needs the magic dismantler (0x1b, 9: unlock bit)
      if (inv.unlocked(9)) this.shop = new ShopScreen(this.ctx, this.fs, 2, { mode: 'decompose', idx });
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
      this.shop = new ShopScreen(this.ctx, this.fs, 2, { mode: act === 2 ? 'enhance' : act === 3 ? 'combine' : 'decompose', idx });
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

  /** FUN_0005b744 -> FUN_00058890: bag column, 4x4 grid, name bar (FUN_00058740), gold (FUN_0004c550) */
  draw(u: Ui): void {
    if (this.shop) return;
    if (this.detail) { this.drawDetail(u, this.detail); return; }
    u.mount('tab', 'inv', this.mainView());
    if (this.tools) u.mount('tab-over', 'bagTools', this.tools.view());
    if (this.quick) this.drawQuick(u);
  }

  private mainView(): VNode {
    const fs = this.fs, inv = fs.inv, t = this.ctx.assets.text, bags = inv.bags + 3;
    // the owned bags and the locked ones up to the next one to buy (5 at least, as the original's column)
    const shown = Math.min(BAG_COUNT, Math.max(5, bags + 1));
    this.bagScroll.follow = this.bag;
    const bagButtons = Array.from({ length: shown }, (_, i) => {
      if (i >= bags) {                                          // locked bag: popup 0x7E (25 coupons, FUN_00047488)
        return button([sprite('t', 15, 24, 16, 16), sprite('c', 208, 63, 7, 9, { cls: 'tb-lock' })], {
          sel: i === this.bag, glow: this.focus === 0, cls: 'tb-bag locked', on: () => this.askBag(),
        });
      }
      const n = Math.max(0, Math.min(16, inv.items.length - 16 * i));   // FUN_0004c514 "n/16"
      return button(h('div.v-col.v-center', null, sprite('t', 15, 24, 16, 16), h('span.tb-bag-n', null, `${n}${t[80] ?? '/'}16`)), {
        sel: i === this.bag, glow: this.focus === 0, cls: 'tb-bag',
        on: () => { this.focus = 0; if (this.bag !== i) { this.bag = i; this.sel = 0; } },
      });
    });
    const cells = Array.from({ length: 16 }, (_, k) => {
      const it = inv.items[this.bag * 16 + k];
      let shade: VChild = null;
      if (it && it.type === 0x11 && it.enh) {                    // FUN_000226b0 cooldown shade
        const max = it.sub < 14 ? 100 : 900;
        if (it.enh < 4) shade = h('span.tb-shade', { style: `background:#fff;opacity:${(it.enh * 8) / 32}` });
        else if (it.enh >= max - 1) shade = h('span.tb-shade', { style: 'background:#000;opacity:0.5' });
      }
      return cellView(fs, it, {
        sel: this.focus === 1 && k === this.sel, shade, anchor: this.focus === 1 && k === this.sel && this.action?.anchor(),
        on: () => { if (this.focus === 1 && this.sel === k) return [AVK.OK]; this.focus = 1; this.sel = k; this.f = 0; },
      });
    });
    const cur = this.focus === 1 ? inv.items[this.idx] : undefined;
    return h('div.v-row.v-fill.tb-inv', null,
      this.action?.backdrop(),
      h('div.v-col.v-scroll.v-bagcol.tb-bags', { scroll: this.bagScroll }, bagButtons),
      h('div.v-col.v-grow', { style: 'gap:4px' },
        h('div.v-box.v-heading.tb-name', null, cur && gt(cur.name, { cls: 'tb-ellipsis' }), baseDelta(fs, cur)),
        h('div.v-box.v-grow.tb-grid', null, cells),
        h('div.v-row', { style: 'gap:6px' },
          h('div.v-box.v-row.v-grow.tb-gold', null, sprite('t', 38, 24, 12, 12), h('span.v-grow', null, inv.gold.toLocaleString('en-US'))),
          button([gt(t[0x1a1d] ?? ''), padBadge(this.ctx.input, AVK.POUND, 'v-pad-corner')], { cls: 'tb-wide', on: () => [AVK.POUND] }))));   // 가방정리 '#'
  }

  /** locked bag: popup 0x7E (25 coupons, FUN_00047488) */
  private askBag(): void {
    this.ask(new Popup(this.ctx, 0x7e), () => this.say(buyBag(this.ctx, this.fs)));
  }

  /** item detail with the gem buttons ('0' attach, '#' extract) and the gem list (FUN_000441e4) */
  private drawDetail(u: Ui, it: Item): void {
    const fs = this.fs, inv = fs.inv;
    u.hit(-200, -200, 700, 700, () => (this.gems ? [AVK.CLR] : [AVK.OK]));
    let footer: VChild = null, overlay: VChild = null;
    if (it.type < 0x10) {
      const empty = it.sockets.filter((g) => g !== 0xff).length < it.count;
      const extract = it.sockets.some((g) => g !== 0xff) && countOf(inv, 0x1b, 0x0b) > 0;
      footer = h('div.v-row.tb-detail-foot', null,
        button([gt(this.ctx.assets.text[0x19e6] ?? ''), padBadge(this.ctx.input, AVK.STAR, 'v-pad-corner')], { cls: `tb-wide${empty ? '' : ' off'}`, on: () => [AVK.K0] }),
        button([gt(this.ctx.assets.text[0x19e7] ?? ''), padBadge(this.ctx.input, AVK.POUND, 'v-pad-corner')], { cls: `tb-wide${extract ? '' : ' off'}`, on: () => [AVK.POUND] }));
      if (this.gems) {
        const g = this.gems, top = Math.max(0, Math.min(g.cur - 3, g.list.length - 4));
        const cells = Array.from({ length: 4 }, (_, k) => {
          const gi = g.list[top + k];
          return cellView(fs, gi !== undefined ? inv.items[gi] : null, {
            sel: gi !== undefined && top + k === g.cur,
            on: gi !== undefined ? () => { if (g.cur === top + k) return [AVK.OK]; g.cur = top + k; } : undefined,
          });
        });
        overlay = h('div.v-box.v-row.tb-gems', null,
          arrow(false),
          h('div.v-row.v-grow.v-center', { style: 'gap:9px' }, g.list.length ? cells : '-'),
          arrow(true));
      }
    }
    u.mount('tab-over', 'itemDetail', itemDetailView(fs, it, footer, overlay));
  }

  /** Quick slot register overlay (FUN_00028a48): six touch slots left of the window, the cursor slot pulsing. */
  private drawQuick(u: Ui): void {
    const q = this.quick!, inv = this.fs.inv, fs = this.fs;
    const slots = Array.from({ length: 6 }, (_, i) => {
      const s = inv.quick[i], cur = i === q.cur;
      const reg = cur ? inv.items[q.idx] : undefined;
      return h('div.tb-qslot', { on: () => { if (q.cur === i) return [AVK.OK]; q.cur = i; } },
        sprite('touch', 0, 18, 31, 31, cur ? {
          cls: 'v-tint tb-pulse', style: `--tint:rgb(255,255,153);--mask:url("${imageUrl('touch')}");`,
        } : {}),
        !cur && s.kind === 2 && inv.items[s.id] && itemIcon(fs, inv.items[s.id], 'tb-qicon dim'),
        !cur && s.kind === 1 && sprite('sIcon', (s.id % 10) * 24, fs.model.cls * 24, 24, 24, { cls: 'tb-qskill dim' }),
        reg && itemIcon(fs, reg, 'tb-qicon'),
        reg && fs.db.showsCount(reg) && h('span.tb-count', null, String(reg.count)),
        padBadge(this.ctx.input, QUICK_KEYS[i], 'v-pad-slot'));                // the slot's own button picks it
    });
    u.view('invQuick', -50, 15, 31, 6 * 35, h('div.v-col', { style: 'gap:4px' }, slots));
  }

  drawOverlay(u: Ui): void {
    this.action?.draw(u);
  }

  drawPopups(): void {
    if (this.shop) { this.shop.drawOverlay(); return; }
    this.tools?.drawPopup();
    this.overlays.draw();
  }
}

/** Equipment tab 0x1F (FUN_0005b4b8, keys FUN_00057174) with candidate select 0x2F (FUN_0005d948). */
export class EquipTab {
  private slot = 0;
  private t = 0;
  private action: ActionPopup | null = null;
  private detail: Item | null = null;
  private pick: { cands: number[]; cur: number } | null = null;
  /** not in the original: DROP of a worn item asks first (popup 0xB, as for a bag item) */
  private readonly overlays = new OverlayStack();

  constructor(private ctx: GameContext, private fs: FieldScene, private playerCmf: Cmf) {}

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
        const e = eq ? [ACTION.DETAIL, ACTION.EQUIP, ACTION.UNEQUIP, ACTION.DROP, ACTION.CANCEL] : [ACTION.EQUIP, ACTION.CANCEL];
        const s = this.slot;
        this.action = new ActionPopup(this.ctx, e, s & 1 ? 'left' : 'right', (s >> 1) === 2);
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

  /** FUN_0005b4b8: six slots around the character preview, the slot's item name, stats */
  draw(u: Ui): void {
    const fs = this.fs;
    if (this.detail) { drawItemDetail(u, fs, this.detail); u.hit(-200, -200, 700, 700, () => [AVK.OK]); return; }
    if (this.pick) { this.drawPick(u); return; }
    u.mount('tab', 'equip', this.mainView());
    // the animated character preview stays a cmf frame (with its multiply shadow), between the slot columns
    u.alpha = 20;
    u.image('shadow', 120, 0, 36, 20, 92, 96, 14 << 8);           // multiply
    u.alpha = 32;
    const f = (Math.trunc(this.t / 2) % 6) + 0;                    // idle frames 0..5 (facing down)
    u.frame(`cmf_c${fs.model.cls}`, this.playerCmf, f, 110, 102, undefined, undefined, fs.player.equip);   // worn look (ui-tabs.md 캐릭터)
  }

  private mainView(): VNode {
    const fs = this.fs, inv = fs.inv, a = this.ctx.assets, t = a.text;
    const slot = (i: number) => cellView(fs, inv.equip[i], {
      cls: 'eq', sel: i === this.slot, empty: cSprite(a, 12 + i), anchor: i === this.slot && this.action?.anchor(),
      on: () => { if (this.slot === i) return [AVK.OK]; this.slot = i; },
    });
    const st = fs.stats;
    const vals = [st.D[6], st.D[7], st.D[8], st.D[9], st.atk, st.def];
    const labels = [t[0x15], t[0x16], t[0x17], t[0x18], t[0x4e] ?? 'DMG', t[0x4f] ?? 'DEF'];
    const cur = inv.equip[this.slot];
    return h('div.v-col.v-fill.v-tab.tb-equip', null,
      this.action?.backdrop(),
      h('div.tb-slots', null, [0, 1, 2].map((r) => [slot(2 * r), h('span'), slot(2 * r + 1)])),
      h('div.v-box.v-heading.tb-name', null, cur && gt(cur.name, { cls: 'tb-ellipsis' })),
      h('div.v-box.tb-stats', null, [0, 3, 4, 1, 2, 5].map((i) =>               // original 3x2 placement
        h('div.v-row.v-kv', null, h('span.v-grow.tb-stat-label', null, labels[i] ?? ''), String(vals[i])))));
  }

  /** 0x2F candidate select (FUN_0005d948), simplified comparison (main stat only). */
  private drawPick(u: Ui): void {
    u.hit(-200, -200, 700, 700, () => [AVK.CLR]);              // tap outside the list closes
    u.mount('tab', 'equipPick', this.pickView());
  }

  private pickView(): VNode {
    const fs = this.fs, inv = fs.inv, p = this.pick!, a = this.ctx.assets, t = a.text;
    const top = Math.max(0, p.cur - 3);
    const strip = Array.from({ length: 4 }, (_, k) => {
      const idx = p.cands[top + k];
      return cellView(fs, idx !== undefined ? inv.items[idx] : null, {
        cls: 'eq', sel: idx !== undefined && top + k === p.cur, empty: cSprite(a, 12 + this.slot),
        on: idx !== undefined ? () => { if (p.cur === top + k) return [AVK.OK]; p.cur = top + k; } : undefined,
      });
    });
    let info: VChild;
    if (!p.cands.length) info = h('div.v-grow.v-row.v-center', null, gt(t[0x1a1e] ?? ''));
    else {
      const it = inv.items[p.cands[p.cur]], old = inv.equip[this.slot];
      const label = t[this.slot === 0 ? 0x1ad2 : this.slot === 5 ? 0x1ad6 : 0x1ad4] ?? '';
      const d = it.base - (old?.base ?? 0);
      const cmp = d > 0 ? `${label} ${it.base}(|e+${d}|b)` : d < 0 ? `${label} ${it.base}|b(|c${d}|b)` : `${label} ${it.base}`;
      info = [
        h('div.v-row', { style: 'gap:6px' }, cellView(fs, it, { cls: 'eq' }), gt(it.name, { cls: 'v-grow tb-ellipsis' })),
        h('div.v-row.tb-sub', null, h('span.v-grow'), `${t[0x24] ?? 'REQUIRE LV'} ${it.reqLevel}`),
        h('div.v-rule'),
        gt(cmp),
        it.options.filter(([id]) => id !== 0xff).map(([id, v]) => gt(optionText(t, id, v), { pen: 0x9e7f })),
      ];
    }
    return h('div.v-col.v-fill.v-tab.tb-pick', null,
      h('div.v-row.v-center', { style: 'gap:6px' },
        arrow(false),
        h('div.v-box.v-row.tb-strip', null, strip),
        arrow(true)),
      h('div.v-box.v-col.v-grow.v-scroll.tb-pick-info', null, info));
  }

  drawOverlay(u: Ui): void {
    this.action?.draw(u);
  }

  drawPopups(): void { this.overlays.draw(); }
}
