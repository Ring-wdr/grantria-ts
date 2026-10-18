// 가방 관리 (not in the original): the inventory's 가방정리 button ('#') opens 정렬 (the original 가방정리, FUN_0003b3a8(0)),
// 일괄 버리기, 조합서 버리기 (recipes 0x19 up to a grade) and 일괄 분해. Both bulk orders take what 일괄 판매 takes (core/rules/bulkSell.ts: plain equipment up to a
// grade, never premium / quest items or materials). 일괄 분해 works like the inventory's single decompose: it needs the
// 마법 해체기 (0x1b sub 9, a coupon-shop item kept as an unlock bit) and costs no gold; without it popup 0x49 offers it for
// coupons first, as the single decompose does (tabs.ts askCoupon).
// State and keys; the host draws it (web/game/bagTools.ts).
import type { FieldGame } from '../field/fieldGame';
import { AVK } from '../keys';
import { Popup, openPopup } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';
import { coupons } from './community';
import { josa } from '../text';
import { cfmt } from '../data/skillDetail';
import { RECIPE_GRADE_MAX, bulkRecipePick, bulkSellPick } from '../rules/bulkSell';
import { BAG_MAX } from '../rules/items';
import { consume, decomposeMany } from '../rules/shopRules';
import type { Host } from '../host';
import type { ScrollRef } from '../render';

/** the coupon tool of an inventory action: 2 강화석 ×10 (10 coupons), 3 대장장이의 모루 / 4 마법 해체기 (15, permanent) */
export type CouponTool = 2 | 3 | 4;

/** popup 0x49 (FUN_0005446c): "buy <tool> for <cost> coupons?" */
export function couponToolPopup(ctx: Host, fs: FieldGame, act: CouponTool): Popup {
  const t = ctx.assets.text, sub = act === 2 ? 0x0c : act === 3 ? 10 : 9, cost = act === 2 ? 10 : 15;
  const name = t[0x7fc + fs.db.model(0x1b, sub, 0)] ?? '';
  const what = cfmt(t[act === 2 ? 0x1b32 : 0x1b33] ?? '', name);
  const head = cfmt(t[0x1d0] ?? '', name, what);
  return new Popup(ctx, 0x49, 0, (s) => josa(cfmt(s, head, t[0x17b] ?? '', '', cost)));
}

/** popup 0x49 yes (FUN_00053ca0 case 0x18): too few coupons -> 0x7D, no room for 10 stones -> 0x6A; else the coupons go and
 *  the tool is granted (sub 9 / 10 set the permanent unlock bit). Returns the refusal popup, or null when bought. */
export function buyCouponTool(ctx: Host, fs: FieldGame, act: CouponTool): Popup | null {
  const inv = fs.inv, t = ctx.assets.text, sub = act === 2 ? 0x0c : act === 3 ? 10 : 9, cost = act === 2 ? 10 : 15;
  if (coupons(fs) < cost) return new Popup(ctx, 0x7d);
  const st = inv.items.find((x) => x.type === 0x1b && x.sub === 0x0c);       // FUN_0003632c(0x1b, 0xc, 0, 10) for all three
  if (st ? st.count + 10 > 9999 : inv.items.length >= inv.cap) return new Popup(ctx, 0x6a, 0, () => t[inv.bags < BAG_MAX ? 0x4f7 : 0x507] ?? '');
  consume(inv, 0x1b, 0x1b, cost);
  inv.gain(0x1b, sub, 0, act === 2 ? 10 : 1, fs.rng);
  fs.autosave();
  return null;
}

export const MENU = ['정렬', '일괄 버리기', '조합서 버리기', '일괄 분해', '닫기'] as const;
export const HELP = [
  '종류별로 모아 가방을 정리합니다.',
  '강화·보석 없는 장비를 등급별로 한 번에 버립니다.',
  '조합서를 등급별로 한 번에 버립니다.',
  '강화·보석 없는 장비를 등급별로 한 번에 분해합니다. 마법 해체기가 필요합니다.',
  '가방으로 돌아갑니다.',
];

export class BagToolsLogic {
  protected screen: 'menu' | 'drop' | 'recipes' | 'decompose' = 'menu';
  protected cur = 0;
  protected grade = 0;
  /** bulk screen buttons: 0 run, 1 back */
  protected focus: 0 | 1 = 0;
  protected list: ScrollRef = { y: 0 };
  /** popups over the panel */
  protected readonly overlays = new OverlayStack();
  /** 0x7D (too few coupons) was confirmed: the menu owner opens the coupon shop */
  toCoupons = false;

  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

  protected picks(): number[] {
    return this.screen === 'recipes' ? bulkRecipePick(this.fs.inv.items, this.grade) : bulkSellPick(this.fs.inv.items, this.grade);
  }
  /** grades the bulk screen cycles through: equipment 0..4, recipes 0..3 */
  private get grades(): number { return this.screen === 'recipes' ? RECIPE_GRADE_MAX + 1 : 5; }
  /** what the bulk screen lists */
  protected get noun(): string { return this.screen === 'recipes' ? '조합서' : '장비'; }

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
    const fs = this.fs, t = this.ctx.assets.text, name = (ty: number, sub: number) => t[0x7fc + fs.db.model(ty, sub, 0)] ?? '';
    const r = decomposeMany(fs.db, fs.inv, picks, fs.rng, () => fs.achieve({ k: 'dismantle' }));
    if (r.done) { fs.quests.onItems(); fs.recompute(); fs.autosave(); }
    // why it stopped: a material at 9999 (every decompose gives 소울라이트, so one full stack stops them all), or no slot
    const why = r.stop?.kind === 'stack' ? `${name(r.stop.type, r.stop.sub)}|] 9999개라 더 받을 수 없습니다.`
      : r.stop ? '가방이 부족합니다.' : '';
    if (!r.done) {
      if (r.stop?.kind === 'stack') this.msg(`${why}|@${name(r.stop.type, r.stop.sub)}|{ 쓰거나 판 뒤 분해해 주세요.`);
      else this.say(new Popup(this.ctx, 0x6a, 0, () => t[fs.inv.bags < BAG_MAX ? 0x4f7 : 0x507] ?? ''));
      return;
    }
    const got = r.gains.map(([ty, s, c]) => `${name(ty, s)} ${c}개`).join('|@');
    this.msg(`장비 ${r.done}개를 분해했습니다.${r.stop ? `|@${why} ${picks.length - r.done}개는 남겼습니다.` : ''}|@${got}`);
  }
}
