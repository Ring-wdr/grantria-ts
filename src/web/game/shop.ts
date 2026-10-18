// NPC shop / blacksmith screens (analysis/features/shop.md §1): function menu 0x16, list 0x15
// (buy / sell / enhance / potion craft list), item action popup kind 1, quantity popup 0x0C,
// confirm / progress / result popups, blacksmith combine·decompose and potion detail 0x2B,
// enhance 0x2C and the decompose result window. Drawn on the 1.3x layer in C220 coordinates as
// declarative views (view.ts, css/shop.css); item icons stay the original sprites.
// The dark merchant (kind 3) sells its night stock at price × 10. The quantity popup's touch areas
// (FUN_0004690c) are its five buttons; the -10 % buy text flag DAT_003d1b09 is buff slot 25 (청명의 비약).
// Not in the original (편의 기능): the quantity popup's 최대 / ±10, and in shops that buy items 일괄 판매 (plain
// equipment up to a grade, core/rules/bulkSell.ts) and 되사기 (what was sold during this visit, at the price paid).
// The state and keys are core/menu/shop.ts; this draws them.
import '../styles/shop.css';
import '../styles/convenience.css';
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { BAG_COUNT, type Item } from '../../core/rules/items';
import { popupPaint } from './popup';
import type { GameContext } from './scene';
import {
  auxNeeded, combineNeeds, countOf, decomposeCost, enhBonus, enhGold, enhRate, enhStones, potionNeeds, priceOf, sellValue,
  shownBuyPrice, shownSellPrice, type Need,
} from '../../core/rules/shopRules';
import { actionAnchor, drawAction, drawItemDetail } from './tabs';
import type { Ui } from '../render/ui';
import { button, gt, h, padBadge, slot, sprite, win, type KeyAct, type VChild, type VNode } from '../render/view';
import { platform } from '../../core/platform';
import { BUYBACK, BULK, ShopLogic } from '../../core/menu/shop';

/** URL of an image under assets/images (resolved per call: the platform is installed at boot) */
const imageUrl = (name: string) => platform().assets.url(`images/${name}.png`);
const YELLOW565 = 0xffe0;
const GREY565 = 0x9cf3;

export class ShopScreen extends ShopLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene, kind: number, inv?: { mode: 'enhance' | 'decompose' | 'combine'; idx: number }) {
    super(ctx, fs, kind, inv);
    void ctx.ui13.preload(['t', 'c', 'touch', 'sIcon', 'i0', 'i1', 'i2', 'i3']);
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
    if (this.actionPopup) drawAction(u, this.actionPopup);
    if (this.result) u.view('shopResult', 0, 0, 480, 320, this.resultView());
    const paint = popupPaint(this.ctx);                               // the quantity step's model is the shop itself
    this.overlays.draw((o) => (o.model === this ? u.view('shopQty', 0, 0, 480, 320, this.qtyView()) : paint(o)));
  }

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
    it && !o.plain && it.lock && h('span.tb-lock'),
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
        plain: !sellMode, sel: this.focus === 1 && k === this.sel, anchor: this.focus === 1 && k === this.sel && (this.actionPopup && actionAnchor(this.ctx.assets.text, this.actionPopup)), dim: !!it && this.action === 2 && it.type > 0x0e,
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
