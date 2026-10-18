// Field play bound to a save slot (state 0x10) with SAVE, the pause popup, the game menu, NPC shops, the 대사 로그,
// the ending (0x3D) and the game-over menu (0x1B). State and keys; the host draws it (web/game/screens.ts PlayScene),
// makes the menus and shops it opens, and starts a 보스 러시 on top of it.
import type { FieldGame } from '../field/fieldGame';
import { couponCard, coupons, type CouponShopLogic } from '../menu/community';
import type { GameMenuLogic } from '../menu/menu';
import type { ShopLogic } from '../menu/shop';
import { josa } from '../text';
import { consume, countOf } from '../rules/shopRules';
import { Popup, popupOverlay } from '../ui/popup';
import { OverlayStack, type OpenOpts } from '../ui/overlays';
import { AVK, HUD } from '../keys';
import { loadSlot, saveSlot, setLap } from '../save/save';
import { BacklogReader, backlog } from '../ui/backlog';
import { saveOptions } from '../save/options';
import type { SceneHost } from './host';

/** Field play bound to a save slot, with SAVE, a pause popup and the game-over menu (0x1B). */
export abstract class PlayLogic {
  protected overSel = 0;
  protected overTicks = 0;
  /** popups over the play (save 8 -> 9 / 0x0F, title 10, notices, the ending 0x5C, the game-over chains) and the
   *  coupon shop opened from the game over (DAT_003b3cc1); kinds: 'popup', 'pause' (popup 10), 'shop' */
  protected readonly overlays = new OverlayStack();
  /** game menu 0x1C / tabs (Esc = MENU key -16) */
  protected menu: GameMenuLogic | null = null;
  /** NPC shop (states 0x16 / 0x15 / 0x2B / 0x2C) */
  protected shop: ShopLogic | null = null;
  /** the ending popup 0x5C (hardcore unlocked) was opened */
  private endShown = false;
  /** 대사 로그 over the game */
  protected log: BacklogReader | null = null;
  /** 회상 / 보스 러시 run on top (sandbox.ts): the scene is kept instead of disposed */
  protected suspended = false;
  suspend(): void { this.suspended = true; }
  resume(): void { this.suspended = false; this.field.resumeFromSandbox(); }

  protected constructor(protected readonly ctx: SceneHost, protected readonly slot: number, readonly field: FieldGame) {
    backlog.clear();
    field.autosave = (partial = false) => { saveSlot(slot, field.toSave(partial)); };
    field.prevSave = () => loadSlot(slot);
    field.bindSlot(slot);
  }

  /** the host's views of what the play opens: the game menu, an NPC shop, the coupon shop of the game over */
  protected abstract newMenu(): GameMenuLogic;
  protected abstract newShop(kind: number): ShopLogic;
  protected abstract newCouponShop(): CouponShopLogic;
  /** 기록실 → 보스 기록: the host runs a 보스 러시 on a copy of the slot over this play (suspend / resume) */
  protected abstract startRush(): void;

  private ask(p: Popup, opts: OpenOpts = {}): void { this.overlays.open(popupOverlay(p), { kind: 'popup', ...opts }); }

  /** "save?" popup 8, then 9 (saved) or 0x0F (failed) */
  private askSave(): void {
    this.ask(new Popup(this.ctx, 8), { on: { yes: () => this.ask(new Popup(this.ctx, saveSlot(this.slot, this.field.toSave()) ? 9 : 0x0f)) } });
  }

  /** "go to the title?" popup 10 */
  private askTitle(): void {
    this.ask(new Popup(this.ctx, 10), { kind: 'pause', on: { yes: () => this.ctx.screens.title() } });
  }

  /** the coupon shop over the game over menu (the host draws it from the model); CLR closes it */
  private openOverShop(): void {
    const shop = this.newCouponShop();
    this.overlays.open({ handle: (presses) => (shop.update(presses) === 'close' ? 'cancel' : null), model: shop }, { kind: 'shop' });
  }

  update(presses: number[]): void {
    this.step(presses);
    if (!this.gone) this.field.flushSave();                         // FUN_00020960: a save requested this frame (not after a reload)
  }

  /** replaced by another scene (a reload, the title): its pending save request is dropped */
  protected gone = false;

  private step(presses: number[]): void {
    const f = this.field;
    if (this.field.ending) {                                  // state 0x3D: black, BGM 0, popup 0x5C unless hard
      if (!this.endShown) {
        this.endShown = true;
        this.ctx.audio.playBgm(0);
        if (this.field.hard) {
          if (this.field.lap === 2) setLap(this.slot, 3);              // 3회차 (not in the original): the hard ending opens it
          this.ctx.screens.title(); return;
        }
        this.overlays.clear();
        this.ask(new Popup(this.ctx, 0x5c), { on: { close: () => { setLap(this.slot, 1); this.ctx.screens.title(); } } });   // slot save not written
      }
      this.overlays.update(presses);
      return;
    }
    if (this.field.dead) {
      if (this.overTicks === 0) this.ctx.audio.playBgm(18);          // death BGM 0x12 (FUN_0001b06c)
      this.overTicks++;
      if (this.overTicks < 16) return;
      if (this.overlays.update(presses)) return;
      for (const k of presses) {
        if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
        if (k === AVK.UP) this.overSel = (this.overSel + 2) % 3;
        else if (k === AVK.DOWN) this.overSel = (this.overSel + 1) % 3;
        else if (k === AVK.OK) {
          if (this.overSel === 0 && f.dim) {                   // 차원의 문 나가기 (0x19E8): result popup, then reload
            this.ask(f.dimResult(), { on: { close: () => { f.dead = false; f.leaveDimension(); } } });
          } else if (this.overSel === 0) {                      // 이어하기: popup 0x1B, then reload the last save (none: popup 0x4F)
            this.ask(new Popup(this.ctx, 0x1b), { on: { yes: () => {
              const s = loadSlot(this.slot);
              if (s) this.ctx.screens.play(this.slot, s);
              else this.ask(new Popup(this.ctx, 0x4f));
            } } });
          } else if (this.overSel === 2) {                      // 타이틀화면으로: popup 10 first
            this.ask(new Popup(this.ctx, 10), { on: { yes: () => this.ctx.screens.title() } });
          }
          else this.reviveChoice();
        }
      }
      return;
    }
    if (this.log) { if (!this.log.update(presses)) this.log = null; return; }
    if (this.overlays.update(presses)) return;
    // 편의 기능: during a dialogue page the pad's □ / △ (keyboard 1 / 2) are LOG / AUTO; L (pad d-pad → on the field)
    // opens the log anywhere on the field, K toggles auto there too (said on the HUD when no dialogue shows the button)
    if (f.dialogueShown) presses = presses.map((k) => (k === AVK.K1 ? AVK.LOG : k === AVK.K3 ? AVK.AUTO : k));
    if (presses.includes(AVK.AUTO) && !this.shop && !this.menu && !f.overlays.size) {
      this.ctx.options.auto ^= 1; saveOptions(this.ctx.options);
      if (!f.dialogueShown) f.hud.message(`자동 진행 ${this.ctx.options.auto ? '켬' : '끔'}`);
    }
    if (presses.includes(AVK.LOG) && !this.shop && !this.menu && !f.overlays.size) { this.log = new BacklogReader(); return; }
    presses = presses.filter((k) => k !== AVK.LOG && k !== AVK.AUTO && k !== AVK.FAST);
    if (presses.includes(AVK.SAVE) && !this.field.busyTalking) {
      // HUD SAVE (misc-systems.md §7.2): popup 8 where saving is allowed, else "저장이 불가능한 지역입니다."
      if (this.field.canSave) this.askSave();
      else if (!this.field.inEvent) this.field.hud.message(this.ctx.assets.text[0x1a61] ?? '');   // during an event it fails silently
      return;
    }
    if (this.shop) { if (this.shop.update(presses) === 'close') this.shop = null; return; }
    if (!this.menu) this.field.closeMenu = false;                    // a return stone from a quick slot: no menu to close
    if (this.menu) {
      const r = this.menu.update(presses);
      if (r === 'close' || this.field.closeMenu) { this.menu = null; this.field.closeMenu = false; }   // entering the dimension or a return stone closes the menu
      else if (r === 'title') this.askTitle();
      else if (r === 'save' && this.field.canSave) this.askSave();   // menu save: silent where not allowed
      else if (r === 'launch') {                                     // 기록실 → 보스 기록: 보스 러시 on a copy of the slot (sandbox.ts)
        this.menu.takeLaunch();
        if (this.field.gardenMode !== 0 || this.field.inEvent) { this.ask(new Popup(this.ctx, 0x18, 0, () => '지금은 시작할 수 없습니다.')); return; }
        this.menu = null;
        this.startRush();
      }
      return;
    }
    if (presses.includes(AVK.CLR) && !this.field.busyTalking) { this.menu = this.newMenu(); return; }
    if (presses.includes(AVK.MAP) && !this.field.busyTalking) { this.menu = this.newMenu().openTab(5); return; }
    if (presses.includes(HUD.QUEST) && !this.field.busyTalking) { this.menu = this.newMenu().openTab(4); return; }
    for (const [key, screen] of [[HUD.COMMUNITY, 'dimension'], [HUD.SHOP, 'premium']] as const) {
      if (!presses.includes(key) || this.field.busyTalking) continue;
      const m = this.newMenu().openTab(7);
      if (screen) m.community.open(screen);
      this.menu = m;
      return;
    }
    this.field.update(presses);
    if (this.field.reloadRequest) {                                  // the dimension run ended: back to the save made before entering
      const s = loadSlot(this.slot);
      if (s) this.ctx.screens.play(this.slot, s); else this.ctx.screens.title();
      return;
    }
    if (this.field.shopRequest !== null) { this.shop = this.newShop(this.field.shopRequest); this.field.shopRequest = null; }
  }

  /** FUN_00044e98 choice 1: a revival scroll (0x1b, 3) revives in place; without one, 4+ coupons show
   *  popup 0x4E and then revive for 2 coupons (net 0x19 code 1, done locally), else 0x7D opens the coupon shop */
  private reviveChoice(): void {
    const f = this.field, inv = f.inv, t = this.ctx.assets.text;
    if (countOf(inv, 0x1b, 3) > 0) { consume(inv, 0x1b, 3, 1); f.countUse(3); f.revive(); this.overTicks = 0; return; }
    if (coupons(f) >= 4) {
      // 0x4E "부활 스크롤을 가지고 있지 않습니다." -> 0x4D: buy one with 2 coupons? (FUN_0005de24 case '0', FUN_00053ca0 0x1a)
      this.ask(new Popup(this.ctx, 0x4e, 0, (s) => josa(s.replace('%s', t[0xa0c + 3] ?? ''))), { on: { close: () => {
        this.ask(couponCard(this.ctx, f, 0x4d, 3, 2, f.db.create(0x1b, 3, 0, f.rng).name), { on: { yes: () => {
          if (coupons(f) < 2) { this.ask(new Popup(this.ctx, 0x6a, 0, () => t[0x508] ?? '')); return; }
          consume(inv, 0x1b, 0x1b, 2); f.revive(); this.overTicks = 0;   // net 0x19 code 1 (FUN_000752bc), done locally
        } } });
      } } });
      return;
    }
    this.ask(new Popup(this.ctx, 0x7d), { on: { close: () => this.openOverShop() } });
  }
}
