// NPC shop / blacksmith screens (analysis/features/shop.md §1): function menu 0x16, list 0x15
// (buy / sell / enhance / potion craft list), item action popup kind 1, quantity popup 0x0C,
// confirm / progress / result popups, blacksmith combine·decompose and potion detail 0x2B,
// enhance 0x2C and the decompose result window. Drawn on the 1.3x layer in C220 coordinates as
// declarative views (view.ts, css/shop.css); item icons stay the original sprites.
// The dark merchant (kind 3) sells its night stock at price × 10. The quantity popup's touch areas
// (FUN_0004690c) are its five buttons; the -10 % buy text flag DAT_003d1b09 is buff slot 25 (청명의 비약).
// Not in the original (편의 기능): the quantity popup's 최대 / ±10, and in shops that buy items 일괄 판매 (plain
// equipment up to a grade, core/rules/bulkSell.ts) and 되사기 (what was sold during this visit, at the price paid).
import '../styles/shop.css';
import '../styles/convenience.css';
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { BAG_COUNT, type Item } from '../../core/rules/items';
import { Popup, drawPopup, openPopup, popupOverlay, popupPaint } from './popup';
import { OverlayStack } from '../../core/ui/overlays';
import { flowOverlay, type Step } from '../../core/ui/flow';
import { quantityFlow, type QuantityEvent } from '../../core/ui/flows/quantityFlow';
import type { GameContext } from './scene';
import {
  auxNeeded, buyCost, combine, combineNeeds, countOf, craftPotion, decompose, decomposeCost, enhBonus,
  enhGold, enhRate, enhStones, enhance, genStock, haveNeeds, potionNeeds, priceOf, sellValue, shopRegion,
  shownBuyPrice, shownSellPrice, darkGroup, type Need,
} from '../../core/rules/shopRules';
import { ActionPopup, drawItemDetail } from './tabs';
import type { Ui } from '../render/ui';
import { button, gt, h, padBadge, slot, sprite, win, type KeyAct, type ScrollRef, type VChild, type VNode } from '../render/view';
import { platform } from '../../core/platform';
import { bulkSellPick } from '../../core/rules/bulkSell';

/** URL of an image under assets/images (resolved per call: the platform is installed at boot) */
const imageUrl = (name: string) => platform().assets.url(`images/${name}.png`);
const YELLOW565 = 0xffe0;
const GREY565 = 0x9cf3;
/** menu table d.dat 0x3F81E4 (action v × kind): which actions each shop offers */
const MENU: number[][] = [[0, 1, 7], [0, 1, 3, 7], [2, 3, 4, 7], [0, 7]];

/** josa codes (text-rendering.md §0.6): |[ 는/은, |] 가/이, |{ 를/을, |} 로/으로, |( 와/과 */
export function josa(s: string): string {
  return s.replace(/\|([[\]{}(])/g, (_m, c: string, off: number) => {
    let i = off - 1;
    while (i >= 1 && s[i - 1] === '|') i -= 2;
    const ch = s.charCodeAt(i);
    const hangul = ch >= 0xac00 && ch <= 0xd7a3;
    const jong = hangul ? (ch - 0xac00) % 28 : 1;
    const has = jong !== 0;
    switch (c) {
      case '[': return has ? '은' : '는';
      case ']': return has ? '이' : '가';
      case '{': return has ? '을' : '를';
      case '}': return has && jong !== 8 ? '으로' : '로';
      default: return has ? '과' : '와';
    }
  });
}

type Screen = 'menu' | 'list' | 'craft' | 'enhance' | 'bulk' | 'buyback';
/** menu actions not in the original: 일괄 판매, 되사기 */
const BULK = 8, BUYBACK = 9;
const BUYBACK_MAX = 20;

export class ShopScreen {
  private screen: Screen = 'menu';
  private menuCur = 0;
  private action = 0;
  private t = 0;
  /** list 0x15: stock (buy / craft list) or the inventory (sell / enhance) */
  private stock: Item[] = [];
  private bag = 0;
  private focus: 0 | 1 = 0;
  private sel = 0;
  private actionPopup: ActionPopup | null = null;
  private detail: Item | null = null;
  private qty = 0;
  private qtyMax = 0;
  /** popups, "제작중..." progress and the buy / sell quantity flow over the shop */
  private readonly overlays = new OverlayStack();
  /** 0x2B: combine (recipes), decompose (equipment) or the potion detail */
  private c2b = { list: [] as number[], cur: 0, focus: 0 as 0 | 1, scroll: { y: 0 } as ScrollRef, potion: -1 };
  /** 0x2C */
  private enh = { idx: 0, focus: 0 as 0 | 1, aux: false, protect: false };
  private result: { gains: [number, number, number][] } | null = null;
  /** 되사기: items sold during this visit (newest first) with the gold they brought */
  private sold: { it: Item; qty: number; value: number }[] = [];
  private bbSel = 0;
  /** list 0x15 bag column scroll (up to BAG_COUNT bags) */
  private bagScroll: ScrollRef = { y: 0 };
  /** 일괄 판매: highest grade taken, focus 0 = sell, 1 = cancel */
  private bulk = { grade: 0, focus: 0 as 0 | 1 };

  /** opened from the inventory (returnState 0x1E, shop.md §2.9): enhance / decompose / combine one item */
  readonly fromInv: 'enhance' | 'decompose' | 'combine' | null;
  private closed = false;

  constructor(private ctx: GameContext, private fs: FieldScene, readonly kind: number,
    inv?: { mode: 'enhance' | 'decompose' | 'combine'; idx: number }) {
    this.action = kind === 2 ? 2 : 0;
    this.fromInv = inv?.mode ?? null;
    if (inv?.mode === 'enhance') { this.action = 2; this.enh = { idx: inv.idx, focus: 0, aux: false, protect: false }; this.screen = 'enhance'; }
    else if (inv?.mode === 'combine') { this.action = 3; this.screen = 'craft'; this.build2B(); this.c2b.cur = Math.max(0, this.c2b.list.indexOf(inv.idx)); }
    else if (inv?.mode === 'decompose') { this.action = 4; this.startInvDecompose(inv.idx); }
    void ctx.ui13.preload(['t', 'c', 'touch', 'sIcon', 'i0', 'i1', 'i2', 'i3']);
  }

  private get a() { return this.ctx.assets; }
  private text(id: number): string { return this.a.text[id] ?? ''; }
  private verb(action = this.action): string {
    if (action === BULK) return '일괄 판매';
    if (action === BUYBACK) return '되사기';
    return this.kind === 1 && action === 3 ? this.text(0x1a37) : this.text(0x17b + action);
  }
  /** the shop's menu (MENU) with 일괄 판매 / 되사기 before 나가기 where the shop buys items */
  private get menu(): number[] {
    const m = MENU[this.kind];
    return m.includes(1) ? [...m.slice(0, -1), BULK, BUYBACK, m[m.length - 1]] : m;
  }
  private get inv() { return this.fs.inv; }
  private get region(): number { return shopRegion(this.fs.field.map.header.zone, this.fs.field.mapId); }
  /** sell / enhance list the player's bags (3 + purchased, up to BAG_COUNT), buy lists the stock pages */
  private get bags(): number { return this.action === 1 || this.action === 2 ? this.inv.bags + 3 : Math.max(1, Math.ceil(this.stock.length / 16)); }
  private get idx(): number { return this.bag * 16 + this.sel; }
  private listItem(): Item | undefined { return this.action === 1 || this.action === 2 ? this.inv.items[this.idx] : this.stock[this.idx]; }

  private msg(id: number, body?: string, ok?: () => void): Popup {
    return openPopup(this.overlays, new Popup(this.ctx, id, 0, body !== undefined ? () => josa(body) : undefined), ok);
  }
  /** a yes / no question; no clears the amount */
  private ask(id: number, body: string, yes: () => void, no?: () => void): void {
    this.overlays.open(popupOverlay(new Popup(this.ctx, id, 0, () => josa(body))), { on: { yes, no: () => { this.qty = 0; no?.(); } } });
  }
  /** "제작중..." etc.: popup id for 20 frames (keys ignored), then f */
  private run(id: number, f: () => void): void {
    const p = new Popup(this.ctx, id);
    let n = 0;
    this.overlays.open({ handle: () => (++n > 0x13 ? 'yes' : null), draw: () => drawPopup(this.ctx, p) }, { on: { yes: f } });
  }

  /** inventory decompose: popup 0x12, no fee, result window, back to the inventory */
  private startInvDecompose(idx: number): void {
    const it = this.inv.items[idx];
    this.ask(0x12, ` ${this.verb(4)}하시겠습니까?`, () => this.run(0x3b, () => {
      const g = decompose(this.fs.db, this.inv, idx, this.fs.rng, false);
      if (!g) { this.msg(0x7b, undefined, () => { this.closed = true; }); return; }
      this.fs.achieve({ k: 'dismantle' });
      this.fs.recompute(); this.fs.autosave();
      this.result = { gains: g };
    }), () => { this.closed = true; });
    void it;
  }

  /** 'close' when the player leaves the shop */
  update(presses: number[]): 'close' | null {
    if (this.closed) return 'close';
    this.t++;
    if (this.overlays.update(presses)) return null;
    if (this.result) { if (presses.includes(AVK.OK) || presses.includes(AVK.CLR)) { this.result = null; if (this.fromInv) return 'close'; this.build2B(); } return null; }
    if (this.detail) { if (presses.includes(AVK.OK) || presses.includes(AVK.CLR)) this.detail = null; return null; }
    if (this.actionPopup) {
      const r = this.actionPopup.handle(presses);
      if (r !== null) { this.actionPopup = null; if (r) this.runAction(r); }
      return null;
    }
    switch (this.screen) {
      case 'menu': return this.menuKeys(presses);
      case 'list': this.listKeys(presses); break;
      case 'craft': this.craftKeys(presses); break;
      case 'enhance': this.enhanceKeys(presses); break;
      case 'bulk': this.bulkKeys(presses); break;
      case 'buyback': this.buybackKeys(presses); break;
    }
    return null;
  }

  // ---- 0x16 ----
  private menuKeys(presses: number[]): 'close' | null {
    const menu = this.menu;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (k === AVK.UP || k === AVK.DOWN) {
        this.menuCur = (this.menuCur + (k === AVK.DOWN ? 1 : menu.length - 1)) % menu.length;
        this.action = menu[this.menuCur];
      } else if (k === AVK.CLR || (k === AVK.OK && this.action === 7)) return 'close';
      else if (k === AVK.OK) this.enter();
    }
    return null;
  }

  private enter(): void {
    this.bag = 0; this.sel = 0; this.focus = 0;
    const rng = this.fs.rng, db = this.fs.db;
    switch (this.action) {
      case 0:
        if (this.kind === 3) {                               // dark merchant: the 4 slots of this map
          const g = darkGroup(this.fs.field.mapId);
          this.stock = g < 0 ? [] : this.fs.darkStock.slice(g * 4, g * 4 + 4).map((x) => x ?? (null as unknown as Item));
        } else this.stock = genStock(db, rng, this.kind, this.region);
        this.screen = 'list';
        break;
      case 1: case 2: this.screen = 'list'; this.focus = 1; break;
      case 3:
        if (this.kind === 2) { this.c2b = { list: [], cur: 0, focus: 0, scroll: { y: 0 } as ScrollRef, potion: -1 }; this.screen = 'craft'; this.build2B(); }
        else { this.stock = genStock(db, rng, 1, this.region, true); this.screen = 'list'; }
        break;
      case 4: this.c2b = { list: [], cur: 0, focus: 0, scroll: { y: 0 } as ScrollRef, potion: -1 }; this.screen = 'craft'; this.build2B(); break;
      case BULK: this.bulk = { grade: 0, focus: 0 }; this.screen = 'bulk'; break;
      case BUYBACK: this.bbSel = 0; this.screen = 'buyback'; break;
    }
  }

  // ---- 일괄 판매 / 되사기 (not in the original) ----
  private bulkPicks(): number[] { return bulkSellPick(this.inv.items, this.bulk.grade); }
  private bulkKeys(presses: number[]): void {
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (k === AVK.UP || k === AVK.DOWN) this.bulk.grade = (this.bulk.grade + (k === AVK.UP ? 1 : 4)) % 5;
      else if (k === AVK.LEFT || k === AVK.RIGHT) this.bulk.focus ^= 1;
      else if (k === AVK.CLR || (k === AVK.OK && this.bulk.focus === 1)) this.screen = 'menu';
      else if (k === AVK.OK) this.confirmBulk();
    }
  }
  private confirmBulk(): void {
    const picks = this.bulkPicks(), db = this.fs.db;
    if (!picks.length) { this.msg(0x18, '판매할 장비가 없습니다.'); return; }
    const total = picks.reduce((n, i) => n + sellValue(db, this.inv.items[i], 1), 0);
    this.ask(0x0f, `장비 ${picks.length}개를 ${total.toLocaleString('en-US')} 골드에 판매하시겠습니까?`, () => {
      for (const i of [...picks].sort((a, b) => b - a)) {
        const it = this.inv.items[i];
        if (!it) continue;
        const v = sellValue(db, it, 1);
        this.inv.gain(0x1c, v, 0, 1, this.fs.rng);
        this.remember(it, 1, v);
        this.inv.remove(i);
      }
      this.fs.quests.onItems();
      this.fs.recompute();
      this.msg(0x18, `장비 ${picks.length}개를 판매했습니다. 되사기에서 다시 살 수 있습니다.`);
    });
  }
  private remember(it: Item, qty: number, value: number): void {
    const stack = this.fs.db.stackable(it.type, it.sub) && it.type !== 0x18;   // a pickaxe keeps its uses
    // the sale takes qty off a counted item instead of removing it (commitSell): only that much comes back
    const partial = it.type >= 0x10 && it.type !== 0x18 && it.count - qty > 0;
    const copy: Item = { ...it, count: stack || partial ? qty : it.count, options: it.options.map((o) => [...o] as [number, number]), sockets: [...it.sockets] };
    this.sold.unshift({ it: copy, qty, value });
    if (this.sold.length > BUYBACK_MAX) this.sold.length = BUYBACK_MAX;
  }
  private buybackKeys(presses: number[]): void {
    const n = this.sold.length;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (k === AVK.UP && n) this.bbSel = (this.bbSel + n - 1) % n;
      else if (k === AVK.DOWN && n) this.bbSel = (this.bbSel + 1) % n;
      else if (k === AVK.CLR) this.screen = 'menu';
      else if (k === AVK.OK && this.sold[this.bbSel]) this.confirmBuyback(this.bbSel);
    }
  }
  private confirmBuyback(i: number): void {
    const e = this.sold[i];
    this.ask(0x0e, `${e.it.name}${e.qty > 1 ? ` ${e.qty}개` : ''}|{ ${e.value.toLocaleString('en-US')} 골드에 다시 사시겠습니까?`, () => {
      const inv = this.inv;
      if (inv.gold < e.value) { this.fail(0, e.it); return; }
      if (e.it.type === 0x18 && countOf(inv, 0x18, e.it.sub) > 0) { this.msg(0x56); return; }   // one pickaxe, as when buying
      const stack = this.fs.db.stackable(e.it.type, e.it.sub) && e.it.type !== 0x18;
      const ok = stack ? inv.gain(e.it.type, e.it.sub, e.it.grade, e.qty, this.fs.rng) : inv.gain(e.it.type, e.it.sub, e.it.grade, 1, this.fs.rng, e.it);
      if (!ok) { this.msg(0x6a, this.text(0x507)); return; }
      inv.gold -= e.value;
      this.sold.splice(i, 1);
      this.bbSel = Math.max(0, Math.min(this.bbSel, this.sold.length - 1));
      this.fs.quests.onItems();
    });
  }

  // ---- 0x15 ----
  private listKeys(presses: number[]): void {
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (this.focus === 0) {
        if (k === AVK.UP || k === AVK.DOWN) { this.bag = (this.bag + (k === AVK.DOWN ? 1 : this.bags - 1)) % this.bags; this.sel = 0; }
        else if (k === AVK.OK) this.focus = 1;
        else if (k === AVK.POUND && (this.action === 1 || this.action === 2)) this.inv.sortBag();   // 가방정리 FUN_0003b3a8(0)
        else if (k === AVK.CLR) { this.screen = 'menu'; this.c2b.potion = -1; }
      } else {
        // sell / enhance lists start on the grid and CLR leaves them: LEFT from the first column reaches the bag column
        if (k === AVK.LEFT && (this.action === 1 || this.action === 2) && (this.sel & 3) === 0) this.focus = 0;
        else if (k === AVK.LEFT && this.sel > 0) this.sel--;
        else if (k === AVK.RIGHT && this.sel < 15) this.sel++;
        else if (k === AVK.UP && this.sel >= 4) this.sel -= 4;
        else if (k === AVK.DOWN) this.sel = Math.min(this.sel + 4, 15);
        else if (k === AVK.CLR) { if (this.action === 1 || this.action === 2) this.screen = 'menu'; else this.focus = 0; }
        else if (k === AVK.OK) this.pick();
        else if (k === AVK.POUND && (this.action === 1 || this.action === 2)) this.inv.sortBag();
      }
    }
  }

  private pick(): void {
    const it = this.listItem();
    if (!it) return;
    if (this.action === 3 && this.kind === 1) {              // potion craft detail (0x2B)
      this.c2b = { list: [], cur: 0, focus: 0, scroll: { y: 0 } as ScrollRef, potion: it.sub };
      this.screen = 'craft';
      return;
    }
    if (this.action === 2 && it.type >= 0x10) return;
    if (this.action === 2 && it.type === 0x0f) return;        // accessories: no popup
    const e = [9];
    if (this.action !== 1 || it.type !== 0x1b) e.push(10 + this.action);
    e.push(6);
    const col = this.sel % 4, row = this.sel >> 2;
    this.actionPopup = new ActionPopup(this.ctx, e, col > 1 ? 'left' : 'right', row > 1);
  }

  private runAction(v: number): void {
    const it = this.listItem();
    if (!it) return;
    if (v === 9) { this.detail = it; return; }
    const stack = this.fs.db.stackable(it.type, it.sub) && it.type !== 0x18;
    if (v === 10) {                                          // buy
      if (it.type === 0x18 && countOf(this.inv, 0x18, it.sub) > 0) { this.msg(0x56); return; }
      this.trade(it, true, stack && this.kind !== 3);
    } else if (v === 11) {                                   // sell
      this.trade(it, false, stack);
    } else if (v === 12) {                                   // enhance -> 0x2C
      this.enh = { idx: this.idx, focus: 0, aux: false, protect: false };
      this.screen = 'enhance';
    }
  }

  // ---- buy / sell flow: quantity popup 0x0C, then confirm 0x0E / 0x0F (flows/quantityFlow.ts) ----
  /** a stack asks the amount first (0 -> 0x0D, back to the amount; selling more than held -> 0x58, out); the amount
   *  is this.qty, cleared when the flow ends without a sale */
  private trade(it: Item, buy: boolean, stack: boolean): void {
    this.qty = stack ? 0 : 1;
    this.qtyMax = buy ? 9999 : it.count;
    const idx = this.idx, u = this.ctx.ui13;
    const message = (id: number) => (): Step<QuantityEvent> => {
      const p = new Popup(this.ctx, id);
      return { handle: (k) => (p.handle(k) ? { type: 'ok' } : null), draw: () => drawPopup(this.ctx, p) };
    };
    this.overlays.open(flowOverlay(quantityFlow, { held: buy ? Infinity : it.count, stack, tooManyBack: false }, {
      qty: () => ({ handle: (k) => this.qtyKeys(k, it), draw: () => u.view('shopQty', 0, 0, 480, 320, this.qtyView()) }),
      none: message(0x0d),
      tooMany: message(0x58),
      confirm: (): Step<QuantityEvent> => {
        const p = new Popup(this.ctx, buy ? 0x0e : 0x0f, 0, () => josa(buy ? this.buyBody(it) : this.sellBody(it)));
        return { handle: (k) => { const r = p.handle(k); return r === 'yes' ? { type: 'yes' } : r ? { type: 'no' } : null; }, draw: () => drawPopup(this.ctx, p) };
      },
    }), { on: { yes: () => (buy ? this.commitBuy(it) : this.commitSell(it, idx)), close: (r) => { if (r !== 'yes') this.qty = 0; } } });
  }

  private qtyKeys(presses: number[], it: Item): QuantityEvent | null {
    for (const k of presses) {
      if (k === AVK.RIGHT) this.qty = (this.qty + 1) % (this.qtyMax + 1);
      else if (k === AVK.LEFT) this.qty = (this.qty + this.qtyMax) % (this.qtyMax + 1);
      else if (k === AVK.UP) this.qty = Math.min(this.qty + 100, this.qtyMax);
      else if (k === AVK.DOWN) this.qty = this.qty < 100 ? 0 : this.qty - 100;
      else if (k === AVK.K9) this.qty = Math.min(this.qty + 10, this.qtyMax);          // 편의: ±10, 최대
      else if (k === AVK.K7) this.qty = Math.max(0, this.qty - 10);
      else if (k === AVK.STAR) this.qty = this.qtyLimit(it);
      else if (k === AVK.CLR) return { type: 'cancel' };
      else if (k === AVK.OK) return { type: 'qty', n: this.qty };
    }
    return null;
  }

  /** 최대: what the gold and the stack (9999) allow when buying, the whole stack when selling */
  private qtyLimit(it: Item): number {
    if (this.action !== 0) return Math.min(this.qtyMax, it.count);
    const unit = priceOf(this.a, it) * (it.type === 0x19 ? 20 : 1);
    const have = this.inv.items.find((x) => x.type === it.type && x.sub === it.sub && x.grade === it.grade);
    return Math.max(0, Math.min(this.qtyMax, Math.floor(this.inv.gold / Math.max(1, unit)), 9999 - (have?.count ?? 0)));
  }

  // ---- buy / sell (FUN_0004e6d8 -> FUN_0003f9ec) ----
  private fail(code: number, it: Item, n = 1): void {
    const ids = [0x1a1, 0x1a2, 0x1a3, 0x1a4, 0x1a5, 0x1a6, 0x1a7, 0x1a8];
    let s = this.text(ids[code] ?? 0x1a1).replace('%s', code >= 5 ? it.name : this.verb()).replace('%d', String(n));
    if (code === 7) s = this.text(0x1a8).replace('%s', it.name).replace('%s', this.verb());
    this.msg(0x18, s);
  }

  /** FUN_0004e6d8 for buy / sell / enhance / decompose: 8 = pass, else the failure code */
  private precheck(action: number, it: Item): number {
    const inv = this.inv, db = this.fs.db;
    if (action === 0) {
      const mul = it.type < 0x10 ? 10 : it.type === 0x19 ? 20 : 1;
      if (inv.gold < priceOf(this.a, it) * Math.max(this.qty, 1) * mul) return 0;
      const stack = db.stackable(it.type, it.sub) && it.type !== 0x18;
      const have = inv.items.find((x) => x.type === it.type && x.sub === it.sub && x.grade === it.grade);
      if (!stack || !have) { if (inv.items.length >= inv.cap) return 2; }
      if (stack && have && have.count + this.qty > 9999) return 5;
    }
    if (action === 2) { if (inv.gold < enhGold(this.a, it)) return 0; if (it.enh >= 20) return 6; }
    if (action === 4) { if (inv.gold < decomposeCost(it)) return 0; if (inv.items.length + 2 >= inv.cap) return 2; if (it.type >= 0x10) return 7; }
    if (action === 1 && (it.type === 0x1a || it.type === 0x1b || it.type === 0x1d)) return 7;
    return 8;
  }

  /** FUN_0004d18c: unit price in the buy text (kind 3 × 10); DAT_003d1b09 is the active flag of buff slot 25
   *  (청명의 비약), which takes 10 % off the shown price only — the charge stays the same (original) */
  private shownUnit(it: Item): number {
    let unit = priceOf(this.a, it) * (this.kind === 3 ? 10 : 1);
    if (this.fs.buffs.isOn(25)) unit += Math.trunc(unit / -10);
    return unit;
  }

  private buyBody(it: Item): string {
    const stack = this.fs.db.stackable(it.type, it.sub) && it.type !== 0x18;
    const verb = `${this.verb()}${this.text(0x19f).replace(/^%s %s/, '')}`;
    return stack
      ? this.text(0x1b1).replace('%s', it.name).replace('%d', String(this.qty)).replace('%d', String(this.shownUnit(it) * this.qty)) + verb
      : this.text(0x1b0).replace('%s', it.name).replace(/\|b$/, '|b ') + verb;
  }

  private commitBuy(it: Item): void {
    const c = this.precheck(0, it);
    if (c !== 8) { this.fail(c, it, 1); return; }
    this.buy(it);
  }

  private buy(it: Item): void {
    const inv = this.inv, rng = this.fs.rng, cost = this.kind === 3 ? priceOf(this.a, it) * 10 : buyCost(this.a, it, this.qty);
    let ok: boolean;
    if (it.type < 0x10) {
      const copy: Item = { ...it, options: it.options.map((o) => [...o] as [number, number]), sockets: [...it.sockets] };
      ok = inv.gain(it.type, it.sub, it.grade, 1, rng, copy);
    } else {
      const n = it.type === 0x18 ? 20 : this.qty;
      ok = inv.gain(it.type, it.sub, it.grade, n, rng);
    }
    if (!ok) { this.msg(0x6a, this.text(0x507)); return; }
    inv.gold = cost < inv.gold ? inv.gold - cost : 0;
    if (this.kind === 3) {                                   // sold out: the slot is emptied
      const g = darkGroup(this.fs.field.mapId), j = this.stock.indexOf(it);
      if (g >= 0 && j >= 0) { this.fs.darkStock[g * 4 + j] = null; this.stock[j] = null as unknown as Item; }
    }
    this.qty = 0;
    this.fs.quests.onItems();
    if (this.kind !== 3 && it.type < 0x10 && (it.type === 0x0f || it.type % 3 === this.fs.model.cls)) {
      this.ask(0x14, this.text(0x1a0).replace('%s', this.verb()), () => {
        const i = inv.items.length - 1;
        if (inv.usable(inv.items[i], this.fs.model.level, this.fs.model.cls)) { inv.equipFrom(i); this.fs.recompute(); }
      });
    }
  }

  private sellBody(it: Item): string {
    const stack = this.fs.db.stackable(it.type, it.sub) && it.type !== 0x18;
    const verb = `${this.verb()}${this.text(0x19f).replace(/^%s %s/, '')}`;
    return stack
      ? this.text(0x1b1).replace('%s', it.name).replace('%d', String(this.qty)).replace('%d', String(Math.trunc(priceOf(this.a, it) / 5) * this.qty)) + verb
      : this.text(0x1b0).replace('%s', it.name).replace(/\|b$/, '|b ') + verb;
  }

  private commitSell(it: Item, idx: number): void {
    const c = this.precheck(1, it);
    if (c !== 8) { this.fail(c, it); return; }
    const inv = this.inv, v = sellValue(this.fs.db, it, this.qty);
    inv.gain(0x1c, v, 0, 1, this.fs.rng);
    this.remember(it, this.qty, v);
    if (it.type >= 0x10 && it.type !== 0x18 && it.count - this.qty > 0) it.count -= this.qty; else inv.remove(idx);
    this.qty = 0;
    this.fs.quests.onItems();
    this.fs.recompute();
  }

  // ---- 0x2C enhance ----
  private enhanceKeys(presses: number[]): void {
    const it = this.inv.items[this.enh.idx];
    if (!it) { this.screen = 'list'; return; }
    const N = enhStones(this.a, it), ok = it.enh < 20 && (this.fromInv === 'enhance' || countOf(this.inv, 0x16, 0) >= N);
    if (!ok) this.enh.focus = 1;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (k === AVK.LEFT || k === AVK.RIGHT) this.enh.focus = ok ? ((this.enh.focus ^ 1) as 0 | 1) : 1;
      else if (k === AVK.STAR) {
        if (this.enh.aux) this.enh.aux = false;
        else if (countOf(this.inv, 0x16, 1) >= auxNeeded(N)) this.ask(0x3c, this.text(0x9ef) + '|{ 추가 하시겠습니까?', () => { this.enh.aux = true; });
      } else if (k === AVK.POUND) {
        if (this.enh.protect) this.enh.protect = false;
        else if (countOf(this.inv, 0x1b, 0) > 0) this.ask(0x3c, this.text(0xa0c) + '|{ 추가 하시겠습니까?', () => { this.enh.protect = true; });
        else this.msg(0x46, this.text(0xa0c) + '|] 없습니다.');
      } else if (k === AVK.CLR || (k === AVK.OK && this.enh.focus === 1)) { if (this.fromInv) this.closed = true; else this.screen = 'list'; }
      else if (k === AVK.OK) {
        const c = this.precheck(2, it);
        if (c !== 8) { this.fail(c, it); return; }
        const body = this.text(0x1af).replace('%s', `${it.name}|{ ${this.verb(2)}하시겠습니까?`).replace('%s', this.verb(2));
        this.ask(0x10, body, () => this.run(0x3d, () => {
          const r = enhance(this.fs.db, this.inv, it, this.fs.rng, this.enh.aux, this.enh.protect, this.fromInv === 'enhance');
          this.fs.achieve({ k: 'enhanceTry' });
          if (r.ok) this.fs.achieve({ k: 'enhanceOk', enh: it.enh });
          this.enh.aux = this.enh.protect = false;
          this.fs.recompute();
          this.fs.autosave();
          const after = () => { if (this.fromInv) this.closed = true; else this.screen = 'list'; };
          const p = this.msg(r.ok ? 0x2f : 0x30, undefined, after);
          // type 10 layout (FUN_0005f948 case 10): item cell (41,65), name, red "파괴되었습니다." when destroyed
          const shown = { ...it }, destroyed = !r.ok && r.destroyed;
          // the cell, then the name (wraps) and the red line beside it, above the body text
          p.content = () => h('div.v-row.v-center.shop-enh-res', null,
            this.cell(shown, { plain: true }),
            h('div.v-col.shop-enh-res-text', null,
              gt(shown.name),
              destroyed && gt(this.text(0x1a29), { pen: 0xf800 })));
        }));
      }
    }
  }

  // ---- 0x2B combine / decompose / potion detail ----
  private build2B(): void {
    if (this.screen !== 'craft' || this.c2b.potion >= 0) return;
    const items = this.inv.items;
    this.c2b.list = items.map((x, i) => [x, i] as const)
      .filter(([x]) => (this.action === 3 ? x.type === 0x19 : x.type < 0x10)).map(([, i]) => i);
    this.c2b.cur = Math.min(this.c2b.cur, Math.max(0, this.c2b.list.length - 1));
  }
  private c2bItem(): Item | undefined { return this.inv.items[this.c2b.list[this.c2b.cur]]; }
  private c2bNeeds(): Need[] {
    if (this.c2b.potion >= 0) return potionNeeds(this.a, this.c2b.potion);
    const it = this.c2bItem();
    return it && this.action === 3 ? combineNeeds(this.a, it) : [];
  }
  private c2bOk(): boolean {
    if (this.c2b.potion >= 0 || this.action === 3) return this.c2b.potion >= 0 || this.c2bItem() ? haveNeeds(this.inv, this.c2bNeeds()) : false;
    return !!this.c2bItem();
  }

  private craftKeys(presses: number[]): void {
    const ok = this.c2bOk();
    if (!ok) this.c2b.focus = 1;
    const back = () => {
      if (this.c2b.potion >= 0) { this.c2b.potion = -1; this.screen = 'list'; } else if (this.fromInv) this.closed = true; else this.screen = 'menu';
    };
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if ((k === AVK.K1 || k === AVK.K3) && this.c2b.potion < 0) {
        const n = this.c2b.list.length;
        if (n) this.c2b.cur = (this.c2b.cur + (k === AVK.K3 ? 1 : n - 1)) % n;
        this.c2b.scroll.y = 0;
      } else if (k === AVK.LEFT || k === AVK.RIGHT) this.c2b.focus = ok ? ((this.c2b.focus ^ 1) as 0 | 1) : 1;
      else if (k === AVK.UP) this.c2b.scroll.y = Math.max(0, this.c2b.scroll.y - 12);
      else if (k === AVK.DOWN) this.c2b.scroll.y += 12;                 // the browser clamps at the end
      else if (k === AVK.CLR || (k === AVK.OK && this.c2b.focus === 1)) back();
      else if (k === AVK.OK) this.craftRun();
    }
  }

  private craftRun(): void {
    const inv = this.inv, db = this.fs.db, rng = this.fs.rng;
    if (this.c2b.potion >= 0) {                              // potion crafting
      if (!this.c2bOk()) { this.msg(inv.items.length < inv.cap ? 0x53 : 0x52, this.text(0x1a2).replace('%s', this.verb())); return; }
      const sub = this.c2b.potion;
      this.ask(0x11, ` ${this.verb()}하시겠습니까?`, () => this.run(0x39, () => {
        const r = craftPotion(db, inv, sub, rng);
        if (r === 'full') this.msg(0x7b);
        else if (r === 'ok') { this.fs.achieve({ k: 'craft' }); this.msg(0x3a, `${db.create(0x11, sub, 0, rng).name} |b제작을 완료하였습니다.`); this.fs.autosave(); }
      }));
      return;
    }
    const it = this.c2bItem();
    if (!it) return;
    if (this.action === 3) {                                 // combine
      if (!this.c2bOk()) { this.msg(inv.items.length < inv.cap ? 0x53 : 0x52, this.text(0x1a2).replace('%s', this.verb())); return; }
      if (inv.items.length >= inv.cap) { this.msg(0x52); return; }
      const idx = this.c2b.list[this.c2b.cur];
      this.ask(0x11, ` ${this.verb()}하시겠습니까?`, () => this.run(0x39, () => {
        const made = combine(db, inv, idx, rng);
        this.build2B();
        this.fs.autosave();
        if (made) { this.fs.achieve({ k: 'combine' }); this.msg(0x3a, `${made.name} |b제작을 완료하였습니다.`); }
        else this.fail(1, it);
      }));
      return;
    }
    const c = this.precheck(4, it);                          // decompose
    if (c !== 8) { this.fail(c, it, 3); return; }
    const idx = this.c2b.list[this.c2b.cur];
    const body = this.text(0x1b2).replace('%s', it.name).replace('%d', String(decomposeCost(it))) + ` ${this.verb(4)}하시겠습니까?`;
    this.ask(0x12, body, () => this.run(0x3b, () => {
      const g = decompose(db, inv, idx, rng, true);
      if (!g) { this.msg(0x7b); return; }
      this.fs.achieve({ k: 'dismantle' });
      this.fs.recompute();
      this.fs.autosave();
      this.result = { gains: g };
    }));
  }

  // ---------------- drawing ----------------
  drawBackground(u: Ui): void { u.alpha = 20; u.fill(0, 0, 480, 320, 0); u.alpha = 32; }

  drawOverlay(): void {
    const u = this.ctx.ui13;
    u.pushCenter220();
    if (this.fromInv === 'decompose') { /* popups / result only */ }
    else if (this.detail) {                                     // the window stays, the detail covers it
      u.view('shop', 0, 0, 220, 220, this.frame(null, null));
      drawItemDetail(u, this.fs, this.detail);
      u.hit(-200, -200, 700, 700, () => [AVK.OK]);
    } else {
      const body = this.screen === 'menu' ? this.menuView() : this.screen === 'list' ? this.listView()
        : this.screen === 'craft' ? this.craftView() : this.screen === 'bulk' ? this.bulkView()
        : this.screen === 'buyback' ? this.buybackView() : this.enhanceView();
      u.view('shop', 0, 0, 220, 220, body ?? this.frame(null, null));
    }
    u.pop();
    u.closeButton(26);
    if (this.actionPopup) this.actionPopup.draw(u);
    if (this.result) u.view('shopResult', 0, 0, 480, 320, this.resultView());
    this.overlays.draw(popupPaint(this.ctx));
  }

  // ---- view helpers ----

  /** an overlay (action popup, quantity, result, popups) owns the input: the screen below is inert */
  private get covered(): boolean {
    return !!(this.actionPopup || this.result || this.overlays.size);
  }

  /**
   * The shop frame inside the 220 box: the name / price bar above the window (roundFill 4,1,211,19
   * at alpha 16) and the body inside the window (28..216).
   */
  private frame(head: VChild, side: VChild, ...body: VChild[]): VNode {
    return h('div.v-fill.shop', { cls: this.covered && 'shop-inert' },
      h('div.v-row.v-box.soft.shop-head', { cls: !(head || side) && 'empty' }, h('div.v-grow.shop-head-name', null, head), side),
      win('.v-col.shop-window', null, h('div.v-col.shop-body', null, ...body), slot('tab-over')));
  }

  /** gold(v, x, y) FUN_0004c550: the coin sprite, then the amount */
  private gold(v: number, cls = ''): VNode {
    return h('span.v-row.shop-gold', { cls }, sprite('t', 38, 24, 12, 12), h('span.shop-num', null, v.toLocaleString('en-US')));
  }

  /** item icon (16x16 original art); `tint` = the red tint 12 of unusable items (FUN_0003bcf0) */
  private icon(type: number, sub: number, iconId?: number, tint = false): VNode {
    const db = this.fs.db, r = db.iconRect(iconId ?? db.icon(type, sub));
    return sprite(r.image, r.sx, r.sy, 16, 16, tint ? {
      cls: 'shop-tint', style: `--mask:url("${imageUrl(r.image)}");--mpos:${-r.sx}px ${-r.sy}px;`,
    } : {});
  }

  /**
   * FUN_0007ab44 bevelled cell + FUN_0003bcf0 item cell: icon, count badge top right, red tint when
   * unusable. `plain` = icon only (buy stock, needs, results); `equip` = the 24 px equipment cell.
   */
  private cell(it: Item | null | undefined, o: { plain?: boolean; equip?: boolean; sel?: boolean; dim?: boolean; on?: KeyAct; anchor?: VChild } = {}): VNode {
    const fs = this.fs;
    const tint = !!it && !o.plain && !fs.inv.usable(it, fs.model.level, fs.model.cls);
    return h('div.shop-cell', {
      cls: [o.equip && 'equip', o.sel && 'cur v-sel', o.dim && 'dim'].filter(Boolean).join(' '), on: o.on,
    },
    it && this.icon(it.type, it.sub, it.icon, tint),
    it && !o.plain && fs.db.showsCount(it) && h('span.shop-count', null, String(it.count)),
    o.anchor);
  }

  /** keycap button; off = variant 3 (unavailable) */
  private btn(label: string, o: { sel?: boolean; off?: boolean; on?: KeyAct; glow?: boolean; cls?: string } = {}): VNode {
    return button(gt(label), { sel: o.sel && !o.off, glow: o.glow, on: o.on, cls: ['shop-btn', o.off && 'off', o.cls].filter(Boolean).join(' ') });
  }

  /** ◀ / ▶ arrow (t.pxl 0,19 15x19) */
  private arrow(right: boolean, on: KeyAct): VNode {
    return h('span.shop-arrow', { on }, sprite('t', 0, 19, 15, 19, { flip: right }));
  }

  /** "REQUIRE LV n" (c-font text 0x24) and the class (0x5d + type % 3) */
  private reqLine(level: number, type: number): VNode {
    return h('div.v-row.shop-req', null,
      h('span.shop-label', null, this.text(0x24) || 'REQUIRE LV'),
      h('span.shop-num', null, String(level)),
      h('span.v-grow'),
      type !== 0x0f && type !== 0x10 && type < 15 && h('span.shop-label', null, this.text(0x5d + (type % 3))));
  }

  /** base value (0x1ad2 / 0x1ad4 / 0x1ad6) and the option lines (1972 + id) */
  private statLines(it: Item): VNode {
    return h('div.v-col.shop-stats', null,
      gt(`${this.text(it.type < 3 ? 0x1ad2 : it.type < 15 ? 0x1ad4 : 0x1ad6)} ${it.base}`, { pen: YELLOW565 }),
      it.options.filter(([id]) => id !== 0xff).map(([id, v]) => gt(this.text(1972 + id).replace('%d', String(v)).replace('%%', '%'))));
  }

  /** material lines: cell, name, have / need (0x1b16 when short, else 0x1a6f) */
  private needLines(needs: Need[], withName = true): VNode {
    const db = this.fs.db;
    return h('div.v-col.shop-needs', null, needs.map((n) => {
      const have = countOf(this.inv, n.type, n.sub);
      const s = (have < n.count ? this.text(0x1b16) : this.text(0x1a6f)).replace('%d', String(have)).replace('%d', String(n.count));
      return h('div.v-row.shop-need', { cls: have < n.count && 'short' },
        h('div.shop-cell', null, this.icon(n.type, n.sub)),
        withName && gt(this.a.text[0x7fc + db.model(n.type, n.sub, 0)] ?? '', { cls: 'v-grow' }),
        gt(s, { cls: 'shop-num' }));
    }));
  }

  // ---- screens ----

  /** function menu 0x16: title, one keycap per action, the action's help line */
  private menuView(): VNode {
    return this.frame(gt(this.text(0x1c0 + this.kind), { pen: YELLOW565 }), null,
      // 일괄 판매 / 되사기 (not in the original) make six rows: tighter (.dense) so the note keeps its line
      h('div.v-col.v-grow.shop-menu', { cls: this.menu.length > 4 && 'dense' }, this.menu.map((v, i) => this.btn(this.verb(v), {
        sel: v === this.action, on: () => { if (this.action === v) return [AVK.OK]; this.menuCur = i; this.action = v; },
      }))),
      h('div.v-box.v-note', null, gt(this.action === BULK ? '강화·보석 없는 장비를 등급별로 팝니다.'
        : this.action === BUYBACK ? '이번에 판 아이템을 판 값에 되삽니다.'
          : this.text(this.kind === 1 && this.action === 3 ? 0x1a38 : 0x1c4 + this.action))));
  }

  /** 일괄 판매: ◀ grade ▶, the items it takes and their total, sell / cancel */
  private bulkView(): VNode {
    const picks = this.bulkPicks(), db = this.fs.db;
    const total = picks.reduce((n, i) => n + sellValue(db, this.inv.items[i], 1), 0);
    return this.frame(gt('일괄 판매', { pen: YELLOW565 }), this.gold(total),
      h('div.v-row.v-center.shop-bulk-grade', null,
        this.arrow(false, () => [AVK.DOWN]),
        h('span.v-grow', null, `등급 0 ~ ${this.bulk.grade} · ${picks.length}개`),
        this.arrow(true, () => [AVK.UP])),
      h('div.v-box.v-col.v-grow.v-scroll.shop-bulk-list', null,
        picks.length ? picks.map((i) => h('div.v-row.shop-bulk-row', null,
          h('div.shop-cell', null, this.icon(this.inv.items[i].type, this.inv.items[i].sub, this.inv.items[i].icon)),
          gt(this.inv.items[i].name, { cls: 'v-grow tb-ellipsis' }),
          h('span.shop-num', null, sellValue(db, this.inv.items[i], 1).toLocaleString('en-US'))))
          : h('div.v-center', { style: 'padding-top:30px' }, '해당하는 장비가 없습니다.')),
      this.okCancel(picks.length > 0, this.bulk.focus, 0x17c, (f) => { this.bulk.focus = f; }));
  }

  /** 되사기: sold items of this visit, newest first, with the price to pay back */
  private buybackView(): VNode {
    return this.frame(gt('되사기', { pen: YELLOW565 }), null,
      h('div.v-box.v-col.v-grow.v-scroll.shop-bulk-list', null,
        this.sold.length ? this.sold.map((e, i) => h(`div.v-row.shop-bulk-row${i === this.bbSel ? '.cur' : ''}`,
          { on: () => { if (this.bbSel === i) return [AVK.OK]; this.bbSel = i; } },
          h('div.shop-cell', null, this.icon(e.it.type, e.it.sub, e.it.icon)),
          gt(`${e.it.name}${e.qty > 1 ? ` x${e.qty}` : ''}`, { cls: 'v-grow tb-ellipsis' }),
          h('span.shop-num', null, e.value.toLocaleString('en-US'))))
          : h('div.v-center', { style: 'padding-top:30px' }, '이번 방문에서 판 아이템이 없습니다.')),
      h('div.v-row.shop-foot', null,
        h('div.v-box.v-row.shop-gold-box', null, this.gold(this.inv.gold)),
        h('span.v-grow'),
        this.btn(this.text(0x1a2b), { on: () => [AVK.CLR] })));
  }

  /** list 0x15: bag keycaps | 4x4 item grid, gold (and the inventory count in buy mode) */
  private listView(): VNode {
    const inv = this.inv, sellMode = this.action === 1 || this.action === 2, cur = this.listItem();
    const price = this.focus === 1 && cur && (this.action === 0
      ? this.gold(this.kind === 3 ? priceOf(this.a, cur) * (cur.type < 0x10 ? 15 : 10) : shownBuyPrice(this.a, cur))
      : this.action === 1 ? this.gold(shownSellPrice(this.a, cur)) : null);
    this.bagScroll.follow = this.bag;
    const bags = Array.from({ length: Math.min(this.bags, BAG_COUNT) }, (_, i) => button(sprite('t', 15, 24, 16, 16), {
      sel: i === this.bag, glow: this.focus === 0, cls: 'shop-bag',
      on: () => { this.focus = 0; if (this.bag !== i) { this.bag = i; this.sel = 0; } },
    }));
    const cells = Array.from({ length: 16 }, (_, k) => {
      const it = sellMode ? inv.items[this.bag * 16 + k] : this.stock[this.bag * 16 + k];
      return this.cell(it, {
        plain: !sellMode, sel: this.focus === 1 && k === this.sel, anchor: this.focus === 1 && k === this.sel && this.actionPopup?.anchor(), dim: !!it && this.action === 2 && it.type > 0x0e,
        on: () => { if (this.focus === 1 && this.sel === k) return [AVK.OK]; this.focus = 1; this.sel = k; },
      });
    });
    return this.frame(this.focus === 1 && cur && gt(cur.name), price,
      h('div.v-row.v-grow.shop-list', null,
        h('div.v-col.shop-bags', null, h('div.v-col.v-scroll.v-bagcol.shop-bag-list', { scroll: this.bagScroll }, bags),
          !sellMode && h('div.v-box.shop-count-box', null, `${inv.items.length}/${inv.cap}`)),
        h('div.v-box.shop-grid', null, cells)),
      h('div.v-row.shop-foot', null,
        h('div.v-box.v-row.shop-gold-box', null, this.gold(inv.gold)),
        h('span.v-grow'),
        sellMode && button([gt(this.text(0x1a1d)), padBadge(this.ctx.input, AVK.POUND, 'v-pad-corner')], { cls: 'shop-btn', on: () => [AVK.POUND] })));   // 가방정리 '#'
  }

  /** ok / cancel row of 0x2B and 0x2C: ok is variant 3 when unavailable; the glow follows focus */
  private okCancel(ok: boolean, focus: number, label: number, setFocus: (f: 0 | 1) => void): VNode {
    const f = ok ? focus : 1;
    return h('div.v-row.shop-foot', null,
      this.btn(this.text(label), { sel: f === 0, off: !ok, on: () => { if (!ok) return; setFocus(0); return [AVK.OK]; } }),
      h('span.v-grow'),
      this.btn(this.text(0x1a2b), { sel: f === 1, on: () => { setFocus(1); return [AVK.OK]; } }));
  }

  /** 0x2B: potion detail (§1.7), or the combine / decompose carousel with the item's details */
  private craftView(): VNode {
    const fs = this.fs, setFocus = (f: 0 | 1) => { this.c2b.focus = f; };
    const foot = this.okCancel(this.c2bOk(), this.c2b.focus,
      this.c2b.potion >= 0 ? 0x1a2a : this.action === 3 ? 0x1a33 : 0x1a34, setFocus);
    if (this.c2b.potion >= 0) {
      const it = fs.db.create(0x11, this.c2b.potion, 0, fs.rng);
      return this.frame(gt(it.name), null,
        h('div.v-box.v-row.shop-potion', null,
          this.cell(it),
          gt(this.text(0xa38 + fs.db.model(0x11, this.c2b.potion, 0)), { cls: 'v-grow' })),
        h('div.v-box.v-col.v-grow.v-scroll.shop-panel', null, this.needLines(potionNeeds(this.a, this.c2b.potion))),
        foot);
    }
    const it = this.c2bItem(), list = this.c2b.list;
    const top = Math.max(0, Math.min(this.c2b.cur - 3, list.length - 4));
    const cells = Array.from({ length: 4 }, (_, k) => {
      const n = top + k, item = this.inv.items[list[n]];
      return this.cell(item, {
        equip: true, sel: n === this.c2b.cur && !!item,
        on: item ? () => { this.c2b.cur = n; this.c2b.scroll.y = 0; } : undefined,
      });
    });
    let detail: VChild;
    if (!it) detail = h('div.v-col.v-center.v-fill', null, gt(this.text(this.action === 3 ? 0x1a31 : 0x1a32)));
    else {
      const innerType = this.action === 3 ? it.sub >> 4 : it.type, innerSub = this.action === 3 ? it.sub & 15 : it.sub;
      detail = h('div.v-col.shop-scroller', null,
        this.reqLine(this.action === 3 ? it.level : it.reqLevel, innerType),
        gt(this.text(fs.db.descId(innerType, innerSub, 0)), { cls: 'shop-desc' }),
        h('div.v-rule'),
        this.action === 3 ? this.needLines(combineNeeds(this.a, it)) : this.statLines(it));
    }
    return this.frame(it && gt(it.name), it && this.action === 4 && this.gold(decomposeCost(it)),
      h('div.v-row.shop-carousel', null,
        this.arrow(false, () => [AVK.K1]),
        h('div.v-box.v-row.v-grow.shop-strip', null, cells),
        this.arrow(true, () => [AVK.K3])),
      // native scroll (UP / DOWN 12 px, wheel, touch)
      h('div.v-box.v-grow.v-scroll.shop-panel.shop-detail', { scroll: this.c2b.scroll }, detail),
      foot);
  }

  /** enhance 0x2C: item, current -> next value, stones, aux / protect toggles, rate and fee */
  private enhanceView(): VNode | null {
    const it = this.inv.items[this.enh.idx];
    if (!it) return null;
    const a = this.a, N = enhStones(a, it), G = enhGold(a, it), aux = auxNeeded(N);
    const have = countOf(this.inv, 0x16, 0), ok = it.enh < 20 && (this.fromInv === 'enhance' || have >= N);
    const auxHave = countOf(this.inv, 0x16, 1), protHave = countOf(this.inv, 0x1b, 0);
    let stat: VChild = null;
    if (it.type < 15) {
      const label = it.type < 3 ? '공격력' : '방어력';
      stat = h('div.v-row.shop-enh-stat', null,
        gt(`|b${label} |d${it.base}|b |i+ ${enhBonus(it, 0)}`),
        h('span.shop-enh-to', null, '▶'),
        gt(`|b${label} |d${it.base}|b |i+ ${enhBonus(it, 1)}`, { cls: 'shop-blink' }));
    }
    const toggle = (on: boolean, h0: number, need: number, name: number, key: number) =>
      h('div.v-row.shop-toggle', null,
        gt(`${this.text(name)} ${h0}/${need}`, { cls: 'v-grow', pen: on ? undefined : GREY565 }),
        this.btn(on ? '미사용' : '사용', { sel: on, glow: false, off: !on && h0 <= 0, on: () => [key] }));
    const rate = Math.min(100, enhRate(a, it.enh) + (this.enh.aux ? Math.trunc(enhRate(a, it.enh) / 10) : 0));
    return this.frame(null, null,
      h('div.v-box.v-row.shop-enh-item', null,
        this.cell(it, { equip: true }),
        gt(it.name, { cls: 'v-grow' })),
      h('div.v-box.v-col.v-grow.shop-panel.shop-enh', null,
        stat,
        !this.fromInv && h('div.shop-enh-stones', null, gt(`${this.text(0x9ee)} ${have < N ? `|c${have}|b` : have}/${N}`)),
        toggle(this.enh.aux, auxHave, aux, 0x9ef, AVK.STAR),
        toggle(this.enh.protect, protHave, 1, 0xa0c, AVK.POUND),
        h('span.v-grow'),
        h('div.v-rule'),
        h('div.v-row.shop-enh-rate', null,
          gt(this.text(0x1b26).replace('%s', this.text(0x1b27)).replace('%d', String(rate)).replace('%%', '%'), { cls: 'v-grow' }),
          this.gold(G))),
      this.okCancel(ok, this.enh.focus, 0x1a30, (f) => { this.enh.focus = f; }));
  }

  /** quantity popup 0x0C (type 7): ◀ [+100 / count / -100] ▶ and OK; the backdrop is modal */
  private qtyView(): VNode {
    const step = (label: number, key: number) => h('span.shop-step', { on: () => [key] }, `${this.text(label)}100`);
    return h('div.v-modal', { on: () => [] },
      h('div.v-popup.v-pop-fade.v-row.shop-qty.shop-qty-wide', null,
        this.arrow(false, () => [AVK.LEFT]),
        h('div.v-col.v-center.shop-qty-mid', null,
          step(0x55, AVK.UP),
          h('div.v-row.shop-qty-value', null, h('span.shop-label', null, this.text(0x52)), h('span.shop-num', null, String(this.qty).padStart(4, '0'))),
          step(0x56, AVK.DOWN)),
        this.arrow(true, () => [AVK.RIGHT]),
        h('div.v-col.shop-qty-extra', null,                                   // 편의: -10 / +10 / 최대
          h('div.v-row', { style: 'gap:2px' },
            h('span.shop-step', { on: () => [AVK.K7] }, '-10'),
            h('span.shop-step', { on: () => [AVK.K9] }, '+10')),
          h('span.shop-step', { on: () => [AVK.STAR] }, '최대')),
        this.btn(this.text(0x1a00), { sel: true, on: () => [AVK.OK], cls: 'shop-qty-ok' })));
  }

  /** decompose result window FUN_0005bd10: title, gained materials ×n, OK */
  private resultView(): VNode {
    const db = this.fs.db;
    return h('div.v-modal', { on: () => [AVK.OK] },
      h('div.u-window.v-col.v-pop-grow.shop-result', null,
        h('div.u-btn.s0.v0.shop-result-bar', null, gt(this.text(0x1a35), { pen: YELLOW565 })),
        h('div.v-col.v-grow.shop-result-list', null, this.result!.gains.map(([t, s, n]) =>
          h('div.v-row.shop-result-row', null,
            h('div.shop-cell', null, this.icon(t, s)),
            gt(this.a.text[0x7fc + db.model(t, s, 0)] ?? '', { cls: 'v-grow' }),
            h('span.shop-num', null, `${this.text(0x1a36)} ${n}`)))),
        h('div.v-row.v-center', null, this.btn(this.text(0x1a00), { sel: true, on: () => [AVK.OK] }))));
  }
}
