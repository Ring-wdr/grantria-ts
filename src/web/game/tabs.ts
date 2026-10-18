// Inventory tab (0x1E) and equipment tab (0x1F, candidate select 0x2F) on the 1.3x layer,
// ported from analysis/features/ui-tabs.md §0.4 / §0.5 (C220 coordinates unless noted).
// Enhance / decompose / combine from the inventory open the shop screens (shop.md §2.9); socket reset
// and gem attach / detach follow shop.md §2.8. Bag purchase: locked bag -> popup 0x7E (community.ts). 가방정리 ('#') opens
// 가방 관리 (bagTools.ts, not in the original): 정렬 (the original FUN_0003b3a8(0), Inventory.sortBag), 일괄 버리기, 일괄 분해.
// The state and keys are core/menu/tabs.ts; this draws them.
import type { Cmf } from '../../core/data/assets';
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { QUICK_KEYS } from '../../core/keys';
import { BAG_COUNT, type Item } from '../../core/rules/items';
import { popupPaint } from './popup';
import { BagTools } from './bagTools';
import { ShopScreen } from './shop';
import { combineNeeds, countOf, detailLines } from '../../core/rules/shopRules';
import type { GameContext } from './scene';
import type { Ui } from '../render/ui';
import { button, cmfFrame, cSprite, gt, h, padBadge, sprite, TAB_BODY, type KeyAct, type VChild, type VNode } from '../render/view';
import { clipImage } from '../render/sprites';
import { ActionPopup } from '../../core/menu/actionPopup';
import { ACTION, InventoryTabLogic, EquipTabLogic } from '../../core/menu/tabs';
import '../styles/tabs.css';
import { compareGear, equipSlot } from '../../core/rules/compare';
import '../styles/convenience.css';
import { platform } from '../../core/platform';

/** URL of an image under assets/images (resolved per call: the platform is installed at boot) */
const imageUrl = (name: string) => platform().assets.url(`images/${name}.png`);

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

/** FUN_0003bcf0 item cell as a view: bevelled cell, icon, count badge, a padlock on a 잠금 item (not in the original);
 *  `empty` fills an empty cell */
export function cellView(fs: FieldScene, it: Item | null | undefined, opts: { sel?: boolean; on?: KeyAct; cls?: string; empty?: VChild; shade?: VChild; anchor?: VChild } = {}): VNode {
  return h('div.tb-cell', { cls: [opts.cls, opts.sel && 'v-sel'].filter(Boolean).join(' '), on: opts.on },
    it ? itemIcon(fs, it) : opts.empty,
    it && opts.shade,
    it && fs.db.showsCount(it) && h('span.tb-count', null, String(it.count)),
    it?.lock && h('span.tb-lock'),
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

/** per frame: the action popup's opening frames, and a tap elsewhere closes it */
export function drawAction(u: Ui, a: ActionPopup): void {
  a.frame();
  u.hit(-1000, -1000, 3000, 3000, () => [AVK.CLR]);
}

/** actions with no game text (잠금, not in the original) */
const ACTION_LABEL: Record<number, string> = { [ACTION.LOCK]: '잠금', [ACTION.UNLOCK]: '잠금 해제' };

/** the action menu as keycaps, attached to the selected cell by CSS (cellView opts.anchor: beside it, sliding in), not
 *  at computed coordinates */
export function actionAnchor(t: string[], a: ActionPopup): VNode {
  return h(`div.tb-anchor.${a.side}${a.up ? '.up' : ''}`, null,
    h(`div.v-col.tb-actions${a.entries.length > 7 ? '.dense' : ''}`, null, a.entries.map((v, i) => button(gt(ACTION_LABEL[v] ?? t[v === 0x1c ? 0x1bca : v === 0x14 ? 0x198 : 0x171 + v] ?? ''), {
      sel: i === a.sel, on: () => { a.sel = i; return [AVK.OK]; },
    }))));
}

/** over the screen's view, under the action menu: a tap outside closes it */
export function actionBackdrop(): VNode {
  return h('div.v-modal.tb-backdrop', { on: () => [AVK.CLR] });
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
export class InventoryTab extends InventoryTabLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  declare protected shop: ShopScreen | null;
  declare protected tools: BagTools | null;

  constructor(ctx: GameContext, fs: FieldScene) { super(ctx, fs); }

  protected newShop(kind: number, inv: { mode: 'enhance' | 'decompose' | 'combine'; idx: number }): ShopScreen { return new ShopScreen(this.ctx, this.fs, kind, inv); }
  protected newBagTools(): BagTools { return new BagTools(this.ctx, this.fs); }

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
        sel: this.focus === 1 && k === this.sel, shade, anchor: this.focus === 1 && k === this.sel && (this.action && actionAnchor(this.ctx.assets.text, this.action)),
        on: () => { if (this.focus === 1 && this.sel === k) return [AVK.OK]; this.focus = 1; this.sel = k; this.f = 0; },
      });
    });
    const cur = this.focus === 1 ? inv.items[this.idx] : undefined;
    return h('div.v-row.v-fill.tb-inv', null,
      this.action && actionBackdrop(),
      h('div.v-col.v-scroll.v-bagcol.tb-bags', { scroll: this.bagScroll }, bagButtons),
      h('div.v-col.v-grow', { style: 'gap:4px' },
        h('div.v-box.v-heading.tb-name', null, cur && gt(cur.name, { cls: 'tb-ellipsis' }), baseDelta(fs, cur)),
        h('div.v-box.v-grow.tb-grid', null, cells),
        h('div.v-row', { style: 'gap:6px' },
          h('div.v-box.v-row.v-grow.tb-gold', null, sprite('t', 38, 24, 12, 12), h('span.v-grow', null, inv.gold.toLocaleString('en-US'))),
          button([gt(t[0x1a1d] ?? ''), padBadge(this.ctx.input, AVK.POUND, 'v-pad-corner')], { cls: 'tb-wide', on: () => [AVK.POUND] }))));   // 가방정리 '#'
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
    if (this.action) drawAction(u, this.action);
  }

  drawPopups(): void {
    if (this.shop) { this.shop.drawOverlay(); return; }
    this.tools?.drawPopup();
    this.overlays.draw(popupPaint(this.ctx));
  }
}

/** Equipment tab 0x1F (FUN_0005b4b8, keys FUN_00057174) with candidate select 0x2F (FUN_0005d948). */
export class EquipTab extends EquipTabLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  constructor(ctx: GameContext, fs: FieldScene, private playerCmf: Cmf) { super(ctx, fs); }

  /** FUN_0005b4b8: six slots around the character preview, the slot's item name, stats */
  draw(u: Ui): void {
    const fs = this.fs;
    if (this.detail) { drawItemDetail(u, fs, this.detail); u.hit(-200, -200, 700, 700, () => [AVK.OK]); return; }
    if (this.pick) { this.drawPick(u); return; }
    u.mount('tab', 'equip', this.mainView());
  }

  /** the animated character preview between the slot columns (multiply shadow, idle frames 0..5 facing down, worn
   *  look: ui-tabs.md 캐릭터). In the view, under the action menu: drawn on the canvas it covered the menu. Window
   *  (110, 102) / shadow (92, 96) less the tab body origin. */
  private figureView(): VNode {
    const fs = this.fs, a = this.ctx.assets, name = `cmf_c${fs.model.cls}`, cmf = this.playerCmf, look = fs.player.equip;
    const x = 110 - TAB_BODY.x, y = 102 - TAB_BODY.y;
    return h('div.tb-figure', null,
      sprite('shadow', 120, 0, 36, 20, { style: `position:absolute;left:${92 - TAB_BODY.x}px;top:${96 - TAB_BODY.y}px;mix-blend-mode:multiply;opacity:${20 / 32}` }),
      cmfFrame(cmf, Math.trunc(this.t / 2) % 6, x, y, (c) => clipImage(a, name, cmf, c, 0, look)));
  }

  private mainView(): VNode {
    const fs = this.fs, inv = fs.inv, a = this.ctx.assets, t = a.text;
    const slot = (i: number) => cellView(fs, inv.equip[i], {
      cls: 'eq', sel: i === this.slot, empty: cSprite(a, 12 + i), anchor: i === this.slot && (this.action && actionAnchor(this.ctx.assets.text, this.action)),
      on: () => { if (this.slot === i) return [AVK.OK]; this.slot = i; },
    });
    const st = fs.stats;
    const vals = [st.D[6], st.D[7], st.D[8], st.D[9], st.atk, st.def];
    const labels = [t[0x15], t[0x16], t[0x17], t[0x18], t[0x4e] ?? 'DMG', t[0x4f] ?? 'DEF'];
    const cur = inv.equip[this.slot];
    return h('div.v-col.v-fill.v-tab.tb-equip', null,
      this.figureView(),
      this.action && actionBackdrop(),
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
    if (this.action) drawAction(u, this.action);
  }

  drawPopups(): void { this.overlays.draw(popupPaint(this.ctx)); }
}
