// 가방 관리 (not in the original): the inventory's 가방정리 button ('#') opens 정렬 (the original 가방정리, FUN_0003b3a8(0)),
// 일괄 버리기, 조합서 버리기 (recipes 0x19 up to a grade) and 일괄 분해. Both bulk orders take what 일괄 판매 takes (core/rules/bulkSell.ts: plain equipment up to a
// grade, never premium / quest items or materials). 일괄 분해 works like the inventory's single decompose: it needs the
// 마법 해체기 (0x1b sub 9, a coupon-shop item kept as an unlock bit) and costs no gold; without it popup 0x49 offers it for
// coupons first, as the single decompose does (tabs.ts askCoupon).
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { Popup, openPopup, popupPaint } from './popup';
import { OverlayStack } from '../../core/ui/overlays';
import { coupons } from './community';
import { josa } from './shop';
import { cfmt } from '../../core/data/skillDetail';
import { RECIPE_GRADE_MAX, bulkRecipePick, bulkSellPick } from '../../core/rules/bulkSell';
import { BAG_MAX } from '../../core/rules/items';
import { consume, decomposeMany } from '../../core/rules/shopRules';
import type { GameContext } from './scene';
import { button, gt, h, sprite, type ScrollRef, type VNode } from '../render/view';

/** the coupon tool of an inventory action: 2 강화석 ×10 (10 coupons), 3 대장장이의 모루 / 4 마법 해체기 (15, permanent) */
export type CouponTool = 2 | 3 | 4;

/** popup 0x49 (FUN_0005446c): "buy <tool> for <cost> coupons?" */
export function couponToolPopup(ctx: GameContext, fs: FieldScene, act: CouponTool): Popup {
  const t = ctx.assets.text, sub = act === 2 ? 0x0c : act === 3 ? 10 : 9, cost = act === 2 ? 10 : 15;
  const name = t[0x7fc + fs.db.model(0x1b, sub, 0)] ?? '';
  const what = cfmt(t[act === 2 ? 0x1b32 : 0x1b33] ?? '', name);
  const head = cfmt(t[0x1d0] ?? '', name, what);
  return new Popup(ctx, 0x49, 0, (s) => josa(cfmt(s, head, t[0x17b] ?? '', '', cost)));
}

/** popup 0x49 yes (FUN_00053ca0 case 0x18): too few coupons -> 0x7D, no room for 10 stones -> 0x6A; else the coupons go and
 *  the tool is granted (sub 9 / 10 set the permanent unlock bit). Returns the refusal popup, or null when bought. */
export function buyCouponTool(ctx: GameContext, fs: FieldScene, act: CouponTool): Popup | null {
  const inv = fs.inv, t = ctx.assets.text, sub = act === 2 ? 0x0c : act === 3 ? 10 : 9, cost = act === 2 ? 10 : 15;
  if (coupons(fs) < cost) return new Popup(ctx, 0x7d);
  const st = inv.items.find((x) => x.type === 0x1b && x.sub === 0x0c);       // FUN_0003632c(0x1b, 0xc, 0, 10) for all three
  if (st ? st.count + 10 > 9999 : inv.items.length >= inv.cap) return new Popup(ctx, 0x6a, 0, () => t[inv.bags < BAG_MAX ? 0x4f7 : 0x507] ?? '');
  consume(inv, 0x1b, 0x1b, cost);
  inv.gain(0x1b, sub, 0, act === 2 ? 10 : 1, fs.rng);
  fs.autosave();
  return null;
}

const MENU = ['정렬', '일괄 버리기', '조합서 버리기', '일괄 분해', '닫기'] as const;
const HELP = [
  '종류별로 모아 가방을 정리합니다.',
  '강화·보석 없는 장비를 등급별로 한 번에 버립니다.',
  '조합서를 등급별로 한 번에 버립니다.',
  '강화·보석 없는 장비를 등급별로 한 번에 분해합니다. 마법 해체기가 필요합니다.',
  '가방으로 돌아갑니다.',
];

export class BagTools {
  private screen: 'menu' | 'drop' | 'recipes' | 'decompose' = 'menu';
  private cur = 0;
  private grade = 0;
  /** bulk screen buttons: 0 run, 1 back */
  private focus: 0 | 1 = 0;
  private list: ScrollRef = { y: 0 };
  /** popups over the panel */
  private readonly overlays = new OverlayStack();
  /** 0x7D (too few coupons) was confirmed: the menu owner opens the coupon shop */
  toCoupons = false;

  constructor(private ctx: GameContext, private fs: FieldScene) {}

  private picks(): number[] {
    return this.screen === 'recipes' ? bulkRecipePick(this.fs.inv.items, this.grade) : bulkSellPick(this.fs.inv.items, this.grade);
  }
  /** grades the bulk screen cycles through: equipment 0..4, recipes 0..3 */
  private get grades(): number { return this.screen === 'recipes' ? RECIPE_GRADE_MAX + 1 : 5; }
  /** what the bulk screen lists */
  private get noun(): string { return this.screen === 'recipes' ? '조합서' : '장비'; }

  /** false once closed */
  update(presses: number[]): boolean {
    if (this.overlays.update(presses)) return !this.toCoupons;
    for (const k of presses) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (this.screen === 'menu') {
        if (k === AVK.UP) this.cur = (this.cur + MENU.length - 1) % MENU.length;
        else if (k === AVK.DOWN) this.cur = (this.cur + 1) % MENU.length;
        else if (k === AVK.CLR || k === AVK.POUND || (k === AVK.OK && this.cur === MENU.length - 1)) return false;
        else if (k === AVK.OK && this.cur === 0) { this.fs.inv.sortBag(); return false; }   // 가방정리 FUN_0003b3a8(0), back to the bag
        else if (k === AVK.OK) this.choose();
      } else {
        if (k === AVK.UP || k === AVK.DOWN) { this.grade = (this.grade + (k === AVK.UP ? 1 : this.grades - 1)) % this.grades; this.list.y = 0; }
        else if (k === AVK.LEFT || k === AVK.RIGHT) this.focus ^= 1;
        else if (k === AVK.CLR || (k === AVK.OK && this.focus === 1)) this.screen = 'menu';
        else if (k === AVK.OK) this.confirm();
      }
    }
    return true;
  }

  /** popup p (yes: its affirmative answer); 0x7D once closed sends the panel back for the coupon shop */
  private say(p: Popup, yes?: () => void): void {
    openPopup(this.overlays, p, yes, { on: { close: () => { if (p.id === 0x7d) this.toCoupons = true; } } });
  }

  private choose(): void {
    const fs = this.fs;
    const open = (s: 'drop' | 'recipes' | 'decompose') => { this.screen = s; this.grade = 0; this.focus = 0; this.list.y = 0; };
    if (this.cur === 1) { open('drop'); return; }
    if (this.cur === 2) { open('recipes'); return; }
    if (fs.inv.unlocked(9)) { open('decompose'); return; }
    if (!fs.canSave) { this.say(new Popup(this.ctx, 0x6d)); return; }   // the coupon offer only where saving is allowed
    this.say(couponToolPopup(this.ctx, fs, 4), () => {
      const refused = buyCouponTool(this.ctx, fs, 4);
      if (refused) this.say(refused);
      else open('decompose');
    });
  }

  private msg(body: string): void { this.say(new Popup(this.ctx, 0x18, 0, () => josa(body))); }

  private confirm(): void {
    const picks = this.picks(), drop = this.screen !== 'decompose', verb = drop ? '버리' : '분해하', noun = this.noun;
    if (!picks.length) { this.msg(`${drop ? '버릴' : '분해할'} ${noun}가 없습니다.`); return; }
    const p = new Popup(this.ctx, 0x0f, 0, () => josa(`${noun} ${picks.length}개를 ${verb}시겠습니까?`));
    p.sel = 1;                                                         // a bulk order starts on 아니오
    this.say(p, () => (drop ? this.dropAll(picks) : this.decomposeAll(picks)));
  }

  private dropAll(picks: number[]): void {
    const fs = this.fs;
    for (const i of [...picks].sort((a, b) => b - a)) fs.inv.remove(i);
    fs.quests.onItems();
    fs.recompute();
    this.msg(`${this.noun} ${picks.length}개를 버렸습니다.`);
  }

  private decomposeAll(picks: number[]): void {
    const fs = this.fs, t = this.ctx.assets.text;
    const r = decomposeMany(fs.db, fs.inv, picks, fs.rng, () => fs.achieve({ k: 'dismantle' }));
    if (r.done) { fs.quests.onItems(); fs.recompute(); fs.autosave(); }
    if (!r.done) { this.say(new Popup(this.ctx, 0x6a, 0, () => t[fs.inv.bags < BAG_MAX ? 0x4f7 : 0x507] ?? '')); return; }
    const got = r.gains.map(([ty, s, c]) => `${t[0x7fc + fs.db.model(ty, s, 0)] ?? ''} ${c}개`).join('|@');
    this.msg(`장비 ${r.done}개를 분해했습니다.${r.full ? `|@가방이 부족해 ${picks.length - r.done}개는 남겼습니다.` : ''}|@${got}`);
  }

  /** the panel over the inventory window */
  view(): VNode {
    if (this.screen === 'menu') {
      return h('div.u-window.v-col.v-fill.tb-detail.tb-tools', { on: () => [] },
        h('div.v-box.v-heading', null, gt('가방 관리', { pen: 0xffe0 })),
        h('div.v-col.v-grow.v-menu-list', null, MENU.map((label, i) => button(gt(label), {
          sel: i === this.cur, on: () => { if (this.cur === i) return [AVK.OK]; this.cur = i; },
        }))),
        h('div.v-box.v-note', null, gt(HELP[this.cur])));
    }
    const fs = this.fs, inv = fs.inv, picks = this.picks(), drop = this.screen !== 'decompose', noun = this.noun;
    const f = picks.length ? this.focus : 1;
    return h('div.u-window.v-col.v-fill.tb-detail.tb-tools', { on: () => [] },
      h('div.v-box.v-heading', null, gt(this.screen === 'recipes' ? '조합서 버리기' : drop ? '일괄 버리기' : '일괄 분해', { pen: 0xffe0 })),
      h('div.v-row.v-center.shop-bulk-grade', null,
        h('span.tb-arrow', { on: () => [AVK.DOWN] }, sprite('t', 0, 0x13, 0xf, 0x13)),
        h('span.v-grow', { style: 'text-align:center' }, `등급 0 ~ ${this.grade} · ${picks.length}개`),
        h('span.tb-arrow', { on: () => [AVK.UP] }, sprite('t', 0, 0x13, 0xf, 0x13, { flip: true }))),
      h('div.v-box.v-col.v-grow.v-scroll.shop-bulk-list', { scroll: this.list },
        picks.length ? picks.map((i) => {
          const it = inv.items[i], r = fs.db.iconRect(it.icon);
          return h('div.v-row.shop-bulk-row', null, h('div.tb-cell', null, sprite(r.image, r.sx, r.sy, 16, 16)), gt(it.name, { cls: 'v-grow tb-ellipsis' }));
        }) : h('div.v-center', { style: 'padding-top:30px' }, `해당하는 ${noun}가 없습니다.`)),
      h('div.v-row.tb-detail-foot', null,
        button(gt(drop ? '버리기' : '분해'), { cls: `tb-wide${picks.length ? '' : ' off'}`, sel: f === 0, on: () => { if (!picks.length) return; this.focus = 0; return [AVK.OK]; } }),
        button(gt('취소'), { cls: 'tb-wide', sel: f === 1, on: () => { this.focus = 1; return [AVK.OK]; } })));
  }

  drawPopup(): void { this.overlays.draw(popupPaint(this.ctx)); }
}
