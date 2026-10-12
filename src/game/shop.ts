// NPC shop / blacksmith screens (analysis/features/shop.md §1): function menu 0x16, list 0x15
// (buy / sell / enhance / potion craft list), item action popup kind 1, quantity popup 0x0C,
// confirm / progress / result popups, blacksmith combine·decompose and potion detail 0x2B,
// enhance 0x2C and the decompose result window. Drawn on the 1.3x layer in C220 coordinates.
// Not ported: the dark merchant (kind 3, needs the darkness phase), touch zones, the -10 % flag.
import { stringWidth } from '../text';
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import type { Item } from './items';
import { Popup } from './popup';
import type { GameContext } from './scene';
import {
  auxNeeded, buyCost, combine, combineNeeds, countOf, craftPotion, decompose, decomposeCost, enhBonus,
  enhGold, enhRate, enhStones, enhance, genStock, haveNeeds, potionNeeds, priceOf, sellValue, shopRegion,
  shownBuyPrice, shownSellPrice, darkGroup, type Need,
} from './shopRules';
import { ActionPopup, drawItemCell, drawItemDetail } from './tabs';
import { tri, type Ui } from './ui';

const CELL_EDGE = 0x354e73;
const EQUIP_FILL = 0x20252c;
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

type Screen = 'menu' | 'list' | 'craft' | 'enhance';

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
  private qtyOpen = false;
  private popup: { p: Popup; yes?: () => void; ok?: () => void; no?: () => void } | null = null;
  private progress: { p: Popup; n: number; run: () => void } | null = null;
  /** 0x2B: combine (recipes), decompose (equipment) or the potion detail */
  private c2b = { list: [] as number[], cur: 0, focus: 0 as 0 | 1, scroll: 0, potion: -1 };
  /** 0x2C */
  private enh = { idx: 0, focus: 0 as 0 | 1, aux: false, protect: false };
  private result: { gains: [number, number, number][] } | null = null;

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
    void ctx.ui13.layer.preload(['t', 'c', 'touch', 'sIcon', 'i0', 'i1', 'i2', 'i3']);
  }

  private get a() { return this.ctx.assets; }
  private text(id: number): string { return this.a.text[id] ?? ''; }
  private verb(action = this.action): string { return this.kind === 1 && action === 3 ? this.text(0x1a37) : this.text(0x17b + action); }
  private get inv() { return this.fs.inv; }
  private get region(): number { return shopRegion(this.fs.field.map.header.zone, this.fs.field.mapId); }
  private get bags(): number { return this.action === 1 || this.action === 2 ? 3 : Math.max(1, Math.ceil(this.stock.length / 16)); }
  private get idx(): number { return this.bag * 16 + this.sel; }
  private listItem(): Item | undefined { return this.action === 1 || this.action === 2 ? this.inv.items[this.idx] : this.stock[this.idx]; }

  private msg(id: number, body?: string, ok?: () => void): void {
    this.popup = { p: new Popup(this.ctx, id, 0, body !== undefined ? () => josa(body) : undefined), ok };
  }
  private ask(id: number, body: string, yes: () => void): void {
    this.popup = { p: new Popup(this.ctx, id, 0, () => josa(body)), yes };
  }
  private run(id: number, f: () => void): void { this.progress = { p: new Popup(this.ctx, id), n: 0, run: f }; }

  /** inventory decompose: popup 0x12, no fee, result window, back to the inventory */
  private startInvDecompose(idx: number): void {
    const it = this.inv.items[idx];
    this.ask(0x12, ` ${this.verb(4)}하시겠습니까?`, () => this.run(0x3b, () => {
      const g = decompose(this.fs.db, this.inv, idx, this.fs.rng, false);
      if (!g) { this.msg(0x7b, undefined, () => { this.closed = true; }); return; }
      this.fs.achieve({ k: 'dismantle' });
      this.fs.recompute(); this.fs.autosave();
      this.result = { gains: g };
    }));
    this.popup!.no = () => { this.closed = true; };
    void it;
  }

  /** 'close' when the player leaves the shop */
  update(presses: number[]): 'close' | null {
    if (this.closed) return 'close';
    this.t++;
    if (this.progress) {                                   // "제작중..." etc.: 20 frames, then the action
      if (++this.progress.n > 0x13) { const r = this.progress.run; this.progress = null; r(); }
      return null;
    }
    if (this.popup) {
      const r = this.popup.p.handle(presses);
      if (r) {
        const { yes, ok, no } = this.popup;
        this.popup = null;
        if (r === 'yes') yes?.(); else if (r === 'ok') ok?.();
        if (r === 'no') { this.qty = 0; no?.(); }
      }
      return null;
    }
    if (this.qtyOpen) { this.qtyKeys(presses); return null; }
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
    }
    return null;
  }

  // ---- 0x16 ----
  private menuKeys(presses: number[]): 'close' | null {
    const menu = MENU[this.kind];
    for (const k of presses) {
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
        if (this.kind === 2) { this.c2b = { list: [], cur: 0, focus: 0, scroll: 0, potion: -1 }; this.screen = 'craft'; this.build2B(); }
        else { this.stock = genStock(db, rng, 1, this.region, true); this.screen = 'list'; }
        break;
      case 4: this.c2b = { list: [], cur: 0, focus: 0, scroll: 0, potion: -1 }; this.screen = 'craft'; this.build2B(); break;
    }
  }

  // ---- 0x15 ----
  private listKeys(presses: number[]): void {
    for (const k of presses) {
      if (this.focus === 0) {
        if (k === AVK.UP || k === AVK.DOWN) { this.bag = (this.bag + (k === AVK.DOWN ? 1 : this.bags - 1)) % this.bags; this.sel = 0; }
        else if (k === AVK.OK) this.focus = 1;
        else if (k === AVK.CLR) { this.screen = 'menu'; this.c2b.potion = -1; }
      } else {
        if (k === AVK.LEFT && this.sel > 0) this.sel--;
        else if (k === AVK.RIGHT && this.sel < 15) this.sel++;
        else if (k === AVK.UP && this.sel >= 4) this.sel -= 4;
        else if (k === AVK.DOWN) this.sel = Math.min(this.sel + 4, 15);
        else if (k === AVK.CLR) { if (this.action === 1 || this.action === 2) this.screen = 'menu'; else this.focus = 0; }
        else if (k === AVK.OK) this.pick();
      }
    }
  }

  private pick(): void {
    const it = this.listItem();
    if (!it) return;
    if (this.action === 3 && this.kind === 1) {              // potion craft detail (0x2B)
      this.c2b = { list: [], cur: 0, focus: 0, scroll: 0, potion: it.sub };
      this.screen = 'craft';
      return;
    }
    if (this.action === 2 && it.type >= 0x10) return;
    if (this.action === 2 && it.type === 0x0f) return;        // accessories: no popup
    const e = [9];
    if (this.action !== 1 || it.type !== 0x1b) e.push(10 + this.action);
    e.push(6);
    const col = this.sel % 4, row = this.sel >> 2;
    this.actionPopup = new ActionPopup(this.ctx, e, 130 + (col > 1 ? 31 : 84) + 29 * col, 50 + (row > 1 ? -10 : 50) + 28 * row);
  }

  private runAction(v: number): void {
    const it = this.listItem();
    if (!it) return;
    if (v === 9) { this.detail = it; return; }
    const stack = this.fs.db.stackable(it.type, it.sub) && it.type !== 0x18;
    if (v === 10) {                                          // buy
      if (it.type === 0x18 && countOf(this.inv, 0x18, it.sub) > 0) { this.msg(0x56); return; }
      if (stack && this.kind !== 3) this.openQty(9999); else { this.qty = 1; this.confirmBuy(it); }
    } else if (v === 11) {                                   // sell
      if (stack) this.openQty(it.count); else { this.qty = 1; this.confirmSell(it); }
    } else if (v === 12) {                                   // enhance -> 0x2C
      this.enh = { idx: this.idx, focus: 0, aux: false, protect: false };
      this.screen = 'enhance';
    }
  }

  // ---- quantity popup 0x0C ----
  private openQty(max: number): void { this.qty = 0; this.qtyMax = max; this.qtyOpen = true; }
  private qtyKeys(presses: number[]): void {
    const it = this.listItem();
    for (const k of presses) {
      if (k === AVK.RIGHT) this.qty = (this.qty + 1) % (this.qtyMax + 1);
      else if (k === AVK.LEFT) this.qty = (this.qty + this.qtyMax) % (this.qtyMax + 1);
      else if (k === AVK.UP) this.qty = Math.min(this.qty + 100, this.qtyMax);
      else if (k === AVK.DOWN) this.qty = this.qty < 100 ? 0 : this.qty - 100;
      else if (k === AVK.CLR) { this.qty = 0; this.qtyOpen = false; }
      else if (k === AVK.OK && it) {
        if (this.qty === 0) { this.msg(0x0d); return; }
        this.qtyOpen = false;
        if (this.action === 0) this.confirmBuy(it);
        else if (it.count < this.qty) this.msg(0x58);
        else this.confirmSell(it);
        return;
      }
    }
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

  private confirmBuy(it: Item): void {
    const stack = this.fs.db.stackable(it.type, it.sub) && it.type !== 0x18;
    const verb = `${this.verb()}${this.text(0x19f).replace(/^%s %s/, '')}`;
    const body = stack
      ? this.text(0x1b1).replace('%s', it.name).replace('%d', String(this.qty)).replace('%d', String(priceOf(this.a, it) * this.qty)) + verb
      : this.text(0x1b0).replace('%s', it.name).replace(/\|b$/, '|b ') + verb;
    this.ask(0x0e, body, () => {
      const c = this.precheck(0, it);
      if (c !== 8) { this.fail(c, it, 1); return; }
      this.buy(it);
    });
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

  private confirmSell(it: Item): void {
    const stack = this.fs.db.stackable(it.type, it.sub) && it.type !== 0x18;
    const verb = `${this.verb()}${this.text(0x19f).replace(/^%s %s/, '')}`;
    const body = stack
      ? this.text(0x1b1).replace('%s', it.name).replace('%d', String(this.qty)).replace('%d', String(Math.trunc(priceOf(this.a, it) / 5) * this.qty)) + verb
      : this.text(0x1b0).replace('%s', it.name).replace(/\|b$/, '|b ') + verb;
    const idx = this.idx;
    this.ask(0x0f, body, () => {
      const c = this.precheck(1, it);
      if (c !== 8) { this.fail(c, it); return; }
      const inv = this.inv, v = sellValue(this.fs.db, it, this.qty);
      inv.gain(0x1c, v, 0, 1, this.fs.rng);
      if (it.type >= 0x10 && it.type !== 0x18 && it.count - this.qty > 0) it.count -= this.qty; else inv.remove(idx);
      this.qty = 0;
      this.fs.quests.onItems();
      this.fs.recompute();
    });
  }

  // ---- 0x2C enhance ----
  private enhanceKeys(presses: number[]): void {
    const it = this.inv.items[this.enh.idx];
    if (!it) { this.screen = 'list'; return; }
    const N = enhStones(this.a, it), ok = it.enh < 20 && (this.fromInv === 'enhance' || countOf(this.inv, 0x16, 0) >= N);
    if (!ok) this.enh.focus = 1;
    for (const k of presses) {
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
          this.msg(r.ok ? 0x2f : 0x30, undefined, after);
          // type 10 layout (FUN_0005f948 case 10): item cell (41,65), name, red "파괴되었습니다." when destroyed
          const shown = { ...it }, destroyed = !r.ok && r.destroyed;
          this.popup!.p.h = Math.max(this.popup!.p.h, 136);
          this.popup!.p.extra = (u, w) => {
            u.bevel(41, 65, 26, 26, CELL_EDGE, 0);
            const ic = this.fs.db.iconRect(shown.icon);
            u.image(ic.image, ic.sx, ic.sy, 16, 16, 46, 70);
            if (stringWidth(shown.name) < 120) u.string(shown.name, 75, 70);
            else { u.string(shown.name.slice(0, 10), 75, 65); u.string(shown.name.slice(10), 90, 80); }
            if (destroyed) u.textId(0x1a29, (w >> 1) + 15, 90, 'center', { pen: 0xf800 });
          };
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
      if ((k === AVK.K1 || k === AVK.K3) && this.c2b.potion < 0) {
        const n = this.c2b.list.length;
        if (n) this.c2b.cur = (this.c2b.cur + (k === AVK.K3 ? 1 : n - 1)) % n;
        this.c2b.scroll = 0;
      } else if (k === AVK.LEFT || k === AVK.RIGHT) this.c2b.focus = ok ? ((this.c2b.focus ^ 1) as 0 | 1) : 1;
      else if (k === AVK.UP) this.c2b.scroll = Math.max(0, this.c2b.scroll - 12);
      else if (k === AVK.DOWN) this.c2b.scroll += 12;
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
    if (this.fromInv !== 'decompose') u.window(0, 24, 220, 196);
    if (this.fromInv === 'decompose') { /* popups / result only */ }
    else if (this.detail) { drawItemDetail(u, this.fs, this.detail); u.hit(-200, -200, 700, 700, () => [AVK.OK]); }
    else if (this.screen === 'menu') this.drawMenu(u);
    else if (this.screen === 'list') this.drawList(u);
    else if (this.screen === 'craft') this.drawCraft(u);
    else this.drawEnhance(u);
    u.pop();
    u.closeButton(26);
    if (this.actionPopup) this.actionPopup.draw(u);
    if (this.qtyOpen) this.drawQty(u);
    if (this.result) this.drawResult(u);
    (this.progress?.p ?? this.popup?.p)?.draw();
  }

  /** gold(v, x, y) FUN_0004c550: 9 digits, coin left of them */
  private gold(u: Ui, v: number, x: number, y: number): void {
    u.number(v, x - 6, y, 1, 2, 9);
    u.image('t', 38, 24, 12, 12, x - 5 - 9 * 6 - 12, y);
  }

  private drawMenu(u: Ui): void {
    u.textId(0x1c0 + this.kind, 0, 0);
    MENU[this.kind].forEach((v, i) => {
      const on = v === this.action;
      if (on) u.glow(16, 36 * i + 34, 188, 26, this.t);
      u.button(18, 36 * (i + 1), 184, 22, 3, on ? 1 : 0);
      u.hit(18, 36 * (i + 1) - 4, 184, 30, () => { if (this.action === v) return [AVK.OK]; this.menuCur = i; this.action = v; });
      u.string(this.kind === 1 && v === 3 ? this.text(0x1a37) : this.text(0x17b + v), 110, 36 * i + 38, 'center');
    });
    u.roundFill(8, 195, 204, 16, 0, 1);
    u.textId(this.kind === 1 && this.action === 3 ? 0x1a38 : 0x1c4 + this.action, 110, 197, 'center');
  }

  private drawList(u: Ui): void {
    const fs = this.fs, inv = this.inv, sellMode = this.action === 1 || this.action === 2;
    u.alpha = 16; u.roundFill(4, 1, 211, 19, 0, 1); u.alpha = 32;
    const cur = this.listItem();
    if (this.focus === 1 && cur) {
      u.string(cur.name, 10, 3);
      if (this.action === 0) this.gold(u, this.kind === 3 ? priceOf(this.a, cur) * (cur.type < 0x10 ? 15 : 10) : shownBuyPrice(this.a, cur), 210, 5);
      else if (this.action === 1) this.gold(u, shownSellPrice(this.a, cur), 210, 5);
    }
    u.roundFill(55, 35, 150, 154, 0, 1);
    for (let k = 0; k < 16; k++) {
      const x = (k & 3) * 36 + 63, y = (k >> 2) * 35 + 47;
      if (this.focus === 1 && k === this.sel) u.glow(x - 2, y - 2, 30, 30, this.t);
      u.bevel(x, y, 26, 26, CELL_EDGE, 0);
      u.hit(x - 4, y - 4, 34, 34, () => { if (this.focus === 1 && this.sel === k) return [AVK.OK]; this.focus = 1; this.sel = k; });
      const it = sellMode ? inv.items[this.bag * 16 + k] : this.stock[this.bag * 16 + k];
      if (!it) continue;
      if (sellMode) drawItemCell(u, fs, it, x + 1, y + 1);
      else { const r = fs.db.iconRect(it.icon); u.image(r.image, r.sx, r.sy, 16, 16, x + 5, y + 5); }
      if (this.action === 2 && it.type > 0x0e) { u.alpha = 16; u.fill(x, y, 26, 26, 0); u.alpha = 32; }
    }
    if (this.focus === 0) u.glow(6, this.bag * 35 + 30, 34, 34, this.t);
    for (let i = 0; i < this.bags && i < 4; i++) {
      u.button(8, 32 + 35 * i, 30, 30, 3, i === this.bag ? 1 : 0);
      u.hit(6, 30 + 35 * i, 34, 34, () => { this.focus = 0; if (this.bag !== i) { this.bag = i; this.sel = 0; } });
      u.image('t', 15, 24, 16, 16, 15, 38 + 35 * i);
    }
    if (!sellMode) {
      u.button(8, 180, 30, 30, 3, 2);
      u.string(`${inv.items.length}/${inv.cap}`, 23, 186, 'center');
    }
    u.roundFill(55, 194, 82, 16, 0, 1);
    this.gold(u, inv.gold, 137, 196);
    if (sellMode) { u.button(152, 192, 62, 22, 3, 0); u.textId(0x1a1d, 183, 194, 'center'); }
  }

  private needLines(u: Ui, needs: Need[], y0: number, gap: number, withName = true): void {
    const db = this.fs.db;
    needs.forEach((n, i) => {
      const y = y0 + gap * i;
      u.bevel(13, y, 26, 26, CELL_EDGE, 0);
      const r = db.iconRect(db.icon(n.type, n.sub));
      u.image(r.image, r.sx, r.sy, 16, 16, 18, y + 5);
      if (withName) u.string(this.a.text[0x7fc + db.model(n.type, n.sub, 0)] ?? '', 48, y + 5);
      const have = countOf(this.inv, n.type, n.sub);
      const s = (have < n.count ? this.text(0x1b16) : this.text(0x1a6f)).replace('%d', String(have)).replace('%d', String(n.count));
      u.string(s, 200, y + 5, 'right');
    });
  }

  private drawCraft(u: Ui): void {
    const fs = this.fs, s = this.c2b.scroll;
    u.alpha = 16; u.roundFill(4, 1, 211, 19, 0, 1); u.alpha = 32;
    if (this.c2b.potion >= 0) {                              // §1.7 potion detail
      const it = fs.db.create(0x11, this.c2b.potion, 0, fs.rng);
      u.string(it.name, 10, 3);
      u.roundFill(10, 30, 200, 42, 0, 1);
      u.bevel(16, 38, 26, 26, CELL_EDGE, 0);
      drawItemCell(u, fs, it, 17, 39);
      u.paragraph(this.text(0xa38 + fs.db.model(0x11, this.c2b.potion, 0)), 128, 44, 156);
      u.roundFill(10, 76, 200, 113, 0, 1);
      this.needLines(u, potionNeeds(this.a, this.c2b.potion), 82, 32);
    } else {
      const it = this.c2bItem();
      if (it) { u.string(it.name, 10, 3); if (this.action === 4) this.gold(u, decomposeCost(it), 210, 5); }
      u.image('t', 0, 19, 15, 19, 17, 35);
      u.roundFill(41, 28, 138, 32, 0, 1);
      u.image('t', 0, 19, 15, 19, 189, 35, 1);
      u.hit(7, 28, 34, 32, () => [AVK.K1]);
      u.hit(181, 28, 34, 32, () => [AVK.K3]);
      u.hit(7, 62, 206, 63, () => [AVK.UP]);
      u.hit(7, 125, 206, 63, () => [AVK.DOWN]);
      const top = Math.max(0, Math.min(this.c2b.cur - 3, this.c2b.list.length - 4));
      for (let k = 0; k < 4; k++) {
        const n = top + k, x = 34 * k + 46, item = this.inv.items[this.c2b.list[n]];
        if (n === this.c2b.cur && item) u.glow(34 * k + 43, 29, 30, 30, this.t);
        if (item) u.hit(x - 4, 28, 32, 32, () => { this.c2b.cur = n; this.c2b.scroll = 0; });
        u.bevel(x, 32, 24, 24, CELL_EDGE, EQUIP_FILL);
        if (item) drawItemCell(u, fs, item, x, 32);
      }
      u.roundFill(7, 62, 206, 126, 0, 1);
      if (!it) u.textId(this.action === 3 ? 0x1a31 : 0x1a32, 110, 110, 'center');
      else {
        const y0 = 66 - s, innerType = this.action === 3 ? it.sub >> 4 : it.type, innerSub = this.action === 3 ? it.sub & 15 : it.sub;
        if (y0 >= 62) {
          u.cfont(this.text(0x24), 20, y0);
          u.number(this.action === 3 ? it.level : it.reqLevel, 85, y0, 0, 2);
          if (innerType !== 0x0f && innerType !== 0x10) u.cfont(this.text(0x5d + (innerType % 3)), 160, y0);
        }
        const desc = this.text(0xa50 + fs.db.model(innerType, innerSub, 0));
        const lines = u.paragraph(desc, 110, 96 - s, 180);
        const e = (lines - 1) * 7;
        u.fill(11, e - s + 126, 189, 1, 0x9ecad7);
        if (this.action === 3) this.needLines(u, combineNeeds(this.a, it), e - s + 136, 30);
        else {
          let y = e - s + 140;
          u.string(`${this.text(it.type < 3 ? 0x1ad2 : it.type < 15 ? 0x1ad4 : 0x1ad6)} ${it.base}`, 110, y, 'center');
          for (const [id, v] of it.options) { if (id === 0xff) continue; y += 15; u.string(this.text(1972 + id).replace('%d', String(v)).replace('%%', '%'), 110, y, 'center'); }
        }
      }
    }
    const ok = this.c2bOk(), f = ok ? this.c2b.focus : 1;
    u.glow(f ? 150 : 4, 190, 66, 26, this.t);
    u.button(6, 192, 62, 22, 3, ok ? (f === 0 ? 1 : 0) : 3);
    u.button(152, 192, 62, 22, 3, f === 1 ? 1 : 0);
    u.hit(4, 188, 66, 28, () => { if (!ok) return; this.c2b.focus = 0; return [AVK.OK]; });
    u.hit(150, 188, 66, 28, () => { this.c2b.focus = 1; return [AVK.OK]; });
    u.textId(this.c2b.potion >= 0 ? 0x1a2a : this.action === 3 ? 0x1a33 : 0x1a34, 37, 194, 'center');
    u.textId(0x1a2b, 183, 194, 'center');
  }

  private drawEnhance(u: Ui): void {
    const it = this.inv.items[this.enh.idx];
    if (!it) return;
    const a = this.a, N = enhStones(a, it), G = enhGold(a, it), aux = auxNeeded(N);
    const have = countOf(this.inv, 0x16, 0), ok = it.enh < 20 && (this.fromInv === 'enhance' || have >= N);
    u.roundFill(7, 30, 206, 37, 0, 1);
    u.bevel(23, 36, 24, 24, CELL_EDGE, EQUIP_FILL);
    drawItemCell(u, this.fs, it, 23, 36);
    if (stringWidth(it.name) < 120) u.string(it.name, 70, 42); else u.string(it.name, 80, 35);
    u.roundFill(7, 70, 206, 116, 0, 1);
    if (it.type < 15) {
      const atk = it.type < 3, label = atk ? '공격력' : '방어력';
      const cur = `|b${label} |d${it.base}|b |i+ ${enhBonus(it, 0)}`, next = `|b${label} |d${it.base}|b |i+ ${enhBonus(it, 1)}`;
      u.string(cur, 24, 75);
      u.alpha = Math.min(32, (tri(this.t, 32) + 1) * 2);
      u.string(next, stringWidth(cur) + 50, 75);
      u.alpha = 32;
    }
    if (!this.fromInv) u.string(`${this.text(0x9ee)} ${have < N ? `|c${have}|b` : have}/${N}`, 85, 95, 'center');
    const auxHave = countOf(this.inv, 0x16, 1), protHave = countOf(this.inv, 0x1b, 0);
    [[this.enh.aux, auxHave, aux, 0x9ef, 113, 118], [this.enh.protect, protHave, 1, 0xa0c, 138, 140]].forEach(([on, h, need, name, by, ty]) => {
      u.string(`${this.text(name as number)} ${h}/${need}`, 85, ty as number, 'center', on ? undefined : { pen: 0x9cf3 });
      u.button(150, by as number, 62, 22, 3, on ? 1 : (h as number) > 0 ? 0 : 3);
      u.hit(150, by as number, 62, 22, () => [name === 0x9ef ? AVK.STAR : AVK.POUND]);
      u.string(on ? '미사용' : '사용', 181, (by as number) + 3, 'center');
    });
    u.fill(11, 165, 189, 1, 0x9ecad7);
    const rate = Math.min(100, enhRate(a, it.enh) + (this.enh.aux ? Math.trunc(enhRate(a, it.enh) / 10) : 0));
    u.string(this.text(0x1b26).replace('%s', this.text(0x1b27)).replace('%d', String(rate)).replace('%%', '%'), 15, 170);
    this.gold(u, G, 203, 172);
    const f = ok ? this.enh.focus : 1;
    u.glow((f & 3) * 132 + 11, 189, 66, 26, this.t);
    u.button(13, 191, 62, 22, 3, ok ? (f === 0 ? 1 : 0) : 3);
    u.hit(11, 188, 66, 28, () => { if (!ok) return; this.enh.focus = 0; return [AVK.OK]; });
    u.hit(143, 188, 66, 28, () => { this.enh.focus = 1; return [AVK.OK]; });
    u.textId(0x1a30, 44, 193, 'center');
    u.button(145, 191, 62, 22, 3, f === 1 ? 1 : 0);
    u.textId(0x1a2b, 176, 193, 'center');
  }

  /** quantity popup 0x0C (type 7), touch build width 164 */
  private drawQty(u: Ui): void {
    const w = 164, h = 94;
    u.push((480 - w) >> 1, (320 - h) >> 1);
    u.hit(-1000, -1000, 3000, 3000, () => []);
    u.fill(0, 0, w, 74, 0xd5d5d5);
    u.hit(0, 20, 40, 40, () => [AVK.LEFT]);
    u.hit(80, 20, 30, 40, () => [AVK.RIGHT]);
    u.hit(41, 0, 40, 26, () => [AVK.UP]);
    u.hit(41, 48, 40, 26, () => [AVK.DOWN]);
    u.hit(110, 18, 50, 40, () => [AVK.OK]);
    u.alpha = 20; u.roundFill(3, 3, w - 4, 70, 0x111111, 2); u.alpha = 32;
    u.image('t', 0, 19, 15, 19, 12, 28);
    u.cfont(this.text(0x52), 43, 35);
    u.number(this.qty, 68, 35, 0, 2, 4);
    u.image('t', 0, 19, 15, 19, 84, 28, 1);
    u.image('touch', 0, 0, 31, 18, 41, 6); u.cfont(this.text(0x55), 45, 11); u.number(100, 52, 11, 0, 0);
    u.image('touch', 0, 0, 31, 18, 41, 51); u.cfont(this.text(0x56), 45, 56); u.number(100, 52, 56, 0, 0);
    u.button(113, 23, 40, 30, 3, 1);
    u.textId(0x1a00, 119, 33);
    u.pop();
  }

  /** decompose result window FUN_0005bd10 */
  private drawResult(u: Ui): void {
    const g = this.result!.gains, db = this.fs.db;
    u.push((480 - 214) >> 1, (320 - 138) >> 1);
    u.window(0, 0, 214, 138);
    u.hit(-1000, -1000, 3000, 3000, () => [AVK.OK]);
    u.alpha = 16; u.button(4, 4, 206, 16, 0, 0); u.alpha = 32;
    u.textId(0x1a35, 103, 5, 'center', { pen: 0xffe0 });
    let y = 24 + (g.length < 3 ? (3 - g.length) * 15 : 0);
    for (const [t, s, n] of g) {
      u.bevel(27, y, 25, 25, CELL_EDGE, 0);
      const r = db.iconRect(db.icon(t, s));
      u.image(r.image, r.sx, r.sy, 16, 16, 32, y + 4);
      const name = this.a.text[0x7fc + db.model(t, s, 0)] ?? '';
      u.string(name, 95, y + 6);
      u.string(`${this.text(0x1a36)} `, stringWidth(name) + 93, y + 6, 'center');
      u.number(n, stringWidth(name) + 100, y + 7, 1, 0);
      y += 28;
    }
    u.glow(70, 108, 66, 26, this.t);
    u.button(72, 110, 62, 22, 3, 1);
    u.textId(0x1a00, 103, 114, 'center');
    u.pop();
  }
}

