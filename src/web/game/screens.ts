// Menu screens drawn with the original art (analysis/features/ui-screens.md §0.3–0.7, ported
// from tools/grantria_ui.py): logo (0x05) -> rating (0x06) -> title (0x08/0x09) -> slot select
// (0x0A) -> character select (0x0B, popup 0) -> field (0x10), game over (0x1B).
// Ranking is local (ranking.ts); the Kakao button is removed. The title settings / help buttons open the option
// screens, the info button opens the data screen (0x3B); hardcore mode, revival and the game menu live elsewhere.
import { FieldScene } from './fieldScene';
import { GameMenu } from './menu';
import { CouponShop, couponCard, coupons } from './community';
import { josa } from './shop';
import { consume, countOf } from '../../core/rules/shopRules';
import { ShopScreen } from './shop';
import { Popup } from './popup';
import { VIEW_H as H, VIEW_W as W } from '../render/field';
import { AVK } from '../input/input';
import { HUD } from '../../core/keys';
import { SLOT_COUNT, deleteSlot, loadGamedata, loadSlot, newGame, saveSlot, setLap, type SaveData } from '../../core/save/save';
import { Story } from '../../core/data/story';
import type { GameContext, Scene } from './scene';
import { tri, type Ui } from '../render/ui';
import { button, gt, slot, win } from '../render/view';
import { greyUniform, setGrey } from '../render/sprites';
import { RankingScene } from './ranking';
import { DataScene } from './dataScene';
import { OptionTab } from './optionTab';
import { keyHint } from '../input/keyHints';

export const MENU_IMAGES = ['c', 't', 'f', 'logo', 'h_logo', 'title_bg', 'title_bg2', 'char_slot'];
export const MENU_CMFS = ['cmf_title', 'cmf_c0', 'cmf_c1', 'cmf_c2'];

function fillScreen(u: Ui, rgb: number): void {
  u.fill(0, 0, W, H, rgb);
}

/** FUN_0002df9c title background (states 8/9); t = frame counter. */
function titleBackground(ctx: GameContext, t: number, state: 8 | 9): void {
  const u = ctx.ui;
  const early = state === 8 && t < 0x71;
  const [cyc, base, final] = early ? [0x1c, 0, false] : [8, 0x14, true];
  let clear = 0x0039b0;
  if (early && t % 0x1c < 6) clear = [0xe2c, 0xe2c, 0xe2c, 0xe2c, 0x1c58, 0x2b84][t % 0x1c];
  fillScreen(u, clear);
  if (final || t % cyc >= 6) {
    let cy: number, cx: number;
    if (final) { cy = 0x77; cx = t % 0x1e0; } else {
      cy = ((t >> 2) % cyc) * 10 - 0x32;
      cx = cy < 0x78 ? t % 0x1e0 : 0;
      cy = Math.min(cy, 0x77);
    }
    cy += cy >> 1;                                            // touch mode
    const rise = final ? 0x8c : Math.min(t * 2, 0x8c);
    const bob = Math.abs(5 - Math.trunc(t / 12) % 10);
    u.image('title_bg2', 0, 0, 0x17c, 0x104, W / 2 - 0xbe, H - rise + bob);   // island
    for (const ox of [cx, cx - 0x1e0]) {                        // clouds, blend 1 (lighten)
      u.image('title_bg', 0, 0x69, 0xf0, 0x77, ox, H + 0x77 - cy, 0x109);
      u.image('title_bg', 0, 0x69, 0xf0, 0x77, ox, H - cy, 0x100);
      u.image('title_bg', 0, 0x69, 0xf0, 0x77, ox + 0xf0, H + 0x77 - cy, 0x108);
      u.image('title_bg', 0, 0x69, 0xf0, 0x77, ox + 0xf0, H - cy, 0x101);
    }
  }
  const f = (t >> 2) % cyc;
  u.pushCenter220();
  u.frame('cmf_title', ctx.cmfs.cmf_title, f + base, 0x73, 0x6e);
  u.pop();
  if (f === 0x10) u.fill(W / 2 - 1, 0, 2, H, 0xffffff);
  else if (f > 0x10 && f < 0x18 && base === 0) {
    u.alpha = (0x17 - f) * 8;
    fillScreen(u, 0xffffff);
    u.alpha = 32;
  }
}

/** Title menu buttons (FUN_00035988): 게임시작 and 게임순위 (local ranking); the Kakao button is removed. */
function titleButtons(u: Ui, sel = 0): void {
  u.alpha = sel === 0 ? 32 : 0x1a;
  u.image('t', 0, 0xae, 99, 0x2c, 0xf5, 0x102);            // 게임시작
  u.alpha = 0x1a;
  u.image('t', 0x40, 0xda, 0x20, 0x21, 0x157, 7);           // settings
  u.alpha = sel === 1 ? 32 : 0x1a;
  u.image('t', 0x6f, 0xbe, 99, 0x2c, 0x87, 0x102);          // 게임순위 (local ranking)
  u.alpha = 0x1a;
  u.image('t', 0, 0xda, 0x20, 0x21, 0x187, 7);              // help
  u.alpha = 32;
  u.image('t', 0x20, 0xda, 0x20, 0x21, 0x1b6, 7);           // info -> data management (backup / original saves)
  u.alpha = 32;
  u.string('Copyright ENERVE Co., Ltd. All rights reserved.', 0x61, 0x12f);
}

/** Draw a full menu frame: screen layer, then the optional 1.3x overlay layer (popups). */
export function render(ctx: GameContext, drawUi: () => void, drawZoom?: () => void): void {
  ctx.ui.begin();
  drawUi();
  ctx.ui.endClear();
  if (drawZoom) {
    ctx.ui13.begin();
    drawZoom();
    ctx.ui13.end();
  }
  ctx.compositor.show();
  ctx.overlay.getContext('2d')!.clearRect(0, 0, W, H);
}

/** State 0x05: company logo on white, 21 frames (FUN_0002c4b4). */
export class LogoScene implements Scene {
  private t = 0;
  constructor(private ctx: GameContext) { ctx.input.uiMode = false; ctx.input.zones = []; }
  update(presses: number[]): void {
    if (++this.t >= 21 || presses.length) this.ctx.go(new RatingScene(this.ctx));
  }
  draw(): void {
    render(this.ctx, () => {
      const u = this.ctx.ui;
      fillScreen(u, 0xffffff);
      u.push(-W / 2, -H / 2);
      u.alpha = 0x18;
      u.image('logo', 0x15, 0x36, 0x21, 0x12, W + 0x2c, H - 0x28);
      u.image('logo', 0xc, 0x16, 0x2e, 0x20, W + 0x2b, H - 0x23);
      u.image('logo', 0, 0x27, 0x15, 0x21, W + 0x44, H - 0x27);
      u.alpha = 32;
      u.image('logo', 0, 0, 0x96, 0x16, W - 0x5a, H - 0x13);
      u.pop();
    });
  }
}

/** State 0x06: rating notice (h_logo lower half), 80 frames (FUN_00035c4c). */
class RatingScene implements Scene {
  private t = 0;
  constructor(private ctx: GameContext) {}
  update(presses: number[]): void {
    if (++this.t >= 80 || presses.length) { this.ctx.audio.playBgm(0); this.ctx.go(new TitleScene(this.ctx, true)); }
  }
  draw(): void {
    render(this.ctx, () => {
      fillScreen(this.ctx.ui, 0xffffff);
      this.ctx.ui.image('h_logo', 0, 320, 480, 320, 0, 0);
    });
  }
}

const TITLE_RANKING = -40, TITLE_DATA = -41, TITLE_OPTION = -42, TITLE_HELP = -43;
/** pad key -> title icon key, icon x: 옵션 (□/X = '1'), 도움말 (△/Y = '3'), 데이터 (L2 = '*') */
const TITLE_PAD: [number, number, number][] = [[AVK.K1, TITLE_OPTION, 0x157], [AVK.K3, TITLE_HELP, 0x187], [AVK.STAR, TITLE_DATA, 0x1b6]];

/** States 0x08 (110-frame intro) and 0x09 (menu). */
export class TitleScene implements Scene {
  private t = 0;
  private state: 8 | 9;
  private badgeUntil = performance.now() + 3500;   // rating badge for 3.5 s (FUN_00035b80)
  /** title menu type: 0 START, 1 게임순위 */
  private sel = 0;
  constructor(private ctx: GameContext, intro = false) {
    this.state = intro ? 8 : 9;
    if (!intro) this.t = 200;
    ctx.audio.playBgm(0);
    // touchdata[9]: 게임시작 (239,252,110,57)
    ctx.input.uiMode = false; ctx.input.zones = [{ x: 239, y: 252, w: 110, h: 57, key: AVK.OK }, { x: 135, y: 258, w: 99, h: 44, key: TITLE_RANKING },
      { x: 0x157, y: 7, w: 32, h: 33, key: TITLE_OPTION }, { x: 0x187, y: 7, w: 32, h: 33, key: TITLE_HELP }, { x: 0x1b6, y: 7, w: 32, h: 33, key: TITLE_DATA }];
  }
  update(presses: number[]): void {
    this.t++;
    if (this.state === 8) {
      if (this.t > 0x6e || presses.includes(AVK.OK)) { this.state = 9; this.t = Math.max(this.t, 0x71); }
      return;
    }
    for (const k of presses) if (k === AVK.LEFT || k === AVK.RIGHT) this.sel ^= 1;
    // the three top-right icons are touch zones only; a pad reaches them with □ / △ / L2 (TITLE_PAD)
    presses = presses.map((k) => TITLE_PAD.find(([key]) => key === k)?.[1] ?? k);
    if (presses.length) frozenTick = this.t;                         // the frame at the confirming tick
    if (presses.includes(TITLE_DATA)) { this.ctx.go(new DataScene(this.ctx)); return; }
    if (presses.includes(TITLE_OPTION)) { this.ctx.go(new TitleOptionScene(this.ctx, 'settings')); return; }   // state 0x0C
    if (presses.includes(TITLE_HELP)) { this.ctx.go(new TitleOptionScene(this.ctx, 'help')); return; }         // state 0x0D
    if (presses.includes(TITLE_RANKING) || (presses.includes(AVK.OK) && this.sel === 1)) { this.ctx.go(new RankingScene(this.ctx)); return; }
    if (presses.includes(AVK.OK)) this.ctx.go(new SlotScene(this.ctx));
  }
  draw(): void {
    render(this.ctx, () => {
      titleBackground(this.ctx, this.t, this.state);
      if (performance.now() < this.badgeUntil) this.ctx.ui.image('title_bg', 0xf0, 0, 0x66, 0x78, W - 0x66, 0);
      if (this.state === 9) titleButtons(this.ctx.ui, this.sel);
      const inp = this.ctx.input;
      if (this.state === 9) for (const [key, , x] of TITLE_PAD) {
        const k = keyHint(inp, key);
        if (k) this.ctx.ui.padHint(k.glyph, k.cls, x + 22, 7 + 24);
      }
    });
  }
}

/** DAT_003c39e8: TitleMenuKey (FUN_00046488) redraws the title backdrop at the confirming tick (FUN_0002df9c: island,
 *  clouds, logo frame — no buttons, no copyright) and keeps that frame behind the following screens. */
let frozenTick = 200;
export function frozenTitle(ctx: GameContext): void {
  titleBackground(ctx, frozenTick, 9);
}

/** "%02d:%02d:%02d" play time (text 0x1B28); the web port counts 20 ticks per second. */
export function playTime(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':');
}

/** State 0x0A slot select (FUN_00034040 + FUN_00033dcc), C220 coordinates. */
export class SlotScene implements Scene {
  private t = 0;
  private cur = 0;
  private slots: (SaveData | null)[] = [];
  private laps = [0, 0, 0];
  /** popup 0x5D: convert to hardcore */
  private popup: Popup | null = null;
  constructor(private ctx: GameContext) {
    this.refresh();
    // touch (C220 + (80,40)): slot rows -> select/start, delete (277,190,97,42), close (275,30,57,57)
    ctx.input.uiMode = false; ctx.input.zones = [
      { x: 357, y: 230, w: 97, h: 42, key: AVK.POUND },
      { x: 357, y: 184, w: 97, h: 42, key: AVK.STAR },
      { x: 355, y: 70, w: 57, h: 57, key: AVK.CLR },
      ...[0, 1, 2].map((i) => ({ x: 130, y: 72 + i * 66, w: 220, h: 64, key: 0x100 + i })),
    ];
  }
  private refresh(): void {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i));
    this.laps = loadGamedata().lap;
  }
  update(presses: number[]): void {
    this.t++;
    this.ctx.input.uiMode = !!this.popup;                            // taps reach the popup buttons
    if (this.popup) {
      const r = this.popup.handle(presses);
      if (r) {
        const id = this.popup.id;
        this.popup = null;
        if (r === 'yes' && id === 0x5d) this.convert(this.cur);
        if (r === 'yes' && id === 1) { deleteSlot(this.cur); this.refresh(); }
      }
      return;
    }
    for (const k of presses) {
      if (k === AVK.STAR && this.slots[this.cur] && this.laps[this.cur] === 1) { this.popup = new Popup(this.ctx, 0x5d); this.ctx.audio.playSfx(0x1f); return; }
      if (k >= 0x100 && k < 0x103) { if (this.cur === k - 0x100) this.choose(); else this.cur = k - 0x100; }
      else if (k === AVK.UP) this.cur = (this.cur + 2) % 3;
      else if (k === AVK.DOWN) this.cur = (this.cur + 1) % 3;
      else if (k === AVK.OK) this.choose();
      else if (k === AVK.POUND && this.slots[this.cur]) { this.popup = new Popup(this.ctx, 1); return; }   // popup 1: delete this slot?
      else if (k === AVK.CLR) this.ctx.go(new TitleScene(this.ctx));
    }
  }
  /** FUN_00053510 case 0x36 (hardmode.md §3.2): keep level, items, gold, skills; reset the story */
  private convert(i: number): void {
    const s = this.slots[i];
    if (!s) return;
    const fresh = Story.fresh(s.cls).toJSON();
    const book = s.story?.book;
    s.story = { ...fresh, book, gather: s.story?.gather, titles: s.story?.titles, title: s.story?.title };   // titles kept (hardmode.md §3.3)        // event bits, quests, visited maps, keys, chests reset; book / gather level kept
    s.buffs = undefined; s.day = 0;                                    // the return zone +0x3104 is kept
    if (s.inv) { s.inv.items = s.inv.items.filter((it) => it.type !== 0x1a); s.inv.keys = []; }   // key store wiped (FUN_00036180)
    saveSlot(i, s);
    setLap(i, 2);
    this.refresh();
  }

  private choose(): void {
    const s = this.slots[this.cur];
    if (s) void PlayScene.start(this.ctx, this.cur, s);
    else this.ctx.go(new CharSelectScene(this.ctx, this.cur));
  }
  draw(): void {
    render(this.ctx, () => {
      const u = this.ctx.ui, t = this.t;
      frozenTitle(this.ctx);
      u.pushCenter220();
      u.window(0x48, 0, 0x4c, 0x16);
      u.textId(0x19d5, 0x6e, 5, 'center');
      for (let i = 0; i < 3; i++) {
        const y = 0x18 + i * 0x42, iy = 0x16 + i * 0x42, sl = this.slots[i];
        if (!sl) {
          u.window(0, y, 0xdb, 0x3f);
          if (this.cur === i) u.slotGlow(2, iy + 5, 0xd6, 0x39, t);
          else u.alpha = 16;
          u.cfont('EMPTY SPACE', 0x56, iy + 0x1b, 0);
          u.alpha = 32;
          continue;
        }
        u.window(0, y, 0x45, 0x3f);
        u.window(0x45, y, 0x96, 0x3f);
        if (this.cur === i) { u.slotGlow(2, iy + 5, 0x42, 0x39, t); u.slotGlow(0x46, iy + 5, 0x92, 0x39, t); } else u.alpha = 16;
        const cmfName = `cmf_c${sl.cls}`;
        u.frame(cmfName, this.ctx.cmfs[cmfName], t % 6, sl.cls === 2 ? 0x23 : 0x26, iy + (sl.cls === 2 ? 0x3a : 0x30));
        u.textId(0x3e1 + sl.cls, 0x4d, iy + 8);
        u.textId(0x1a3d, 0xac, iy + 8);
        u.number(sl.level, 0xbb, iy + 8, 1);
        u.textId(0x1d6 + (sl.zone ?? 0), 0x91, iy + 0x1e, 'center');
        u.string(String(sl.gold), 0xda, iy + 0x2e, 'right');
        u.string(playTime(sl.playTicks), 0x4d, iy + 0x2e);
        if (this.laps[i] === 2) u.textId(0x1a3c, 0xda, iy + 0x1e, 'right', { pen: 0xf800 });   // red "Hard"
        u.alpha = 32;
      }
      const tx = this.ctx.assets.text, full = 'width:100%;height:100%';
      if (this.slots[this.cur] && this.laps[this.cur] === 1)            // 하드코어 (FUN_00034040)
        u.view('slotHard', 0xf0, 0x90, 0x44, 0x16, button(gt(tx[0x19d6] ?? ''), { sel: true, glow: false, style: full }));
      u.view('slotDelete', 0xf0, 0xbe, 0x44, 0x16, button(gt(tx[0x19d7] ?? ''), {   // 슬롯삭제 (variant 3 when empty)
        sel: !!this.slots[this.cur], glow: false, cls: this.slots[this.cur] ? '' : 'off', style: full,
      }));
      u.pop();
      if (!this.popup) u.closeButton();
    }, this.popup ? () => this.popup!.draw() : undefined);
  }
}

/** State 0x0B character select (FUN_0002eef8), confirmation popup 0. */
export class CharSelectScene implements Scene {
  private t = 0;
  private cls = 0;
  private popup: Popup | null = null;
  constructor(private ctx: GameContext, private slot: number) {
    // touch (C220 + (80,40)): arrows (99,165) / (178,165) 39x23, 3 cards (49,33,223,130), close
    ctx.input.uiMode = false; ctx.input.zones = [
      { x: 179, y: 205, w: 39, h: 23, key: AVK.LEFT },
      { x: 258, y: 205, w: 39, h: 23, key: AVK.RIGHT },
      { x: 355, y: 70, w: 57, h: 57, key: AVK.CLR },
      ...[0, 1, 2].map((i) => ({ x: 130 + i * 75, y: 73, w: 74, h: 130, key: 0x110 + i })),
    ];
  }
  update(presses: number[]): void {
    this.t++;
    this.ctx.input.uiMode = !!this.popup;
    if (this.popup) {
      const r = this.popup.handle(presses);
      if (r === 'yes') {
        const save = newGame(this.cls as 0 | 1 | 2);
        setLap(this.slot, 0);
        saveSlot(this.slot, save);
        void PlayScene.start(this.ctx, this.slot, save);
      } else if (r) this.popup = null;
      return;
    }
    for (const k of presses) {
      if (k >= 0x110 && k < 0x113) { if (this.cls === k - 0x110) this.popup = new Popup(this.ctx, 0, this.cls); else this.cls = k - 0x110; }
      else if (k === AVK.LEFT) this.cls = (this.cls + 2) % 3;
      else if (k === AVK.RIGHT) this.cls = (this.cls + 1) % 3;
      else if (k === AVK.OK) this.popup = new Popup(this.ctx, 0, this.cls);
      else if (k === AVK.CLR) this.ctx.go(new SlotScene(this.ctx));
    }
  }
  draw(): void {
    render(this.ctx, () => {
      const u = this.ctx.ui, t = this.t, cls = this.cls;
      frozenTitle(this.ctx);
      u.pushCenter220();
      u.window(0x48, 0, 0x4c, 0x16);
      u.textId(0x19d8, 0x6e, 5, 'center');
      for (let i = 0; i < 3; i++) {
        const x = i * 0x4b;
        u.window(x, 0x17, 0x4a, 0x82);
        if (cls === i) u.slotGlow(cls * 0x4b + 3, 0x1a, 0x44, 0x7c, t); else u.alpha = 16;
        u.image('char_slot', i * 0x42, 0, 0x42, 0x7a, x + 4, 0x1b);
        u.alpha = 32;
      }
      const tw = u.width(0x3e1 + cls), hw = tw >> 1;
      u.image('title_bg', 0xca, 0xe1, 0xf, 0x13, 0x46 - hw, 0x9d);
      u.image('title_bg', 0xca, 0xe1, 0xf, 0x13, hw + 0x87, 0x9d, 1);
      u.alpha = tri(t, 0x40);
      u.image('title_bg', 0xd9, 0xe1, 8, 0xd, 0x4a - hw, 0xa0);
      u.image('title_bg', 0xd9, 0xe1, 8, 0xd, hw + 0x8a, 0xa0, 1);
      u.alpha = 32;
      u.window(0x6e - ((tw + 0x1e) >> 1), 0x9b, tw + 0x1e, 0x16);
      u.textId(0x3e1 + cls, 0x6e - (cls === 1 ? 1 : 0), 0xa0, 'center');
      u.window(0x32, 0xb2, 0x78, 0x32);
      (this.ctx.assets.text[0x10a + cls] ?? '').split('|@').forEach((ln, i) => u.string(ln, 0x6e, 0xbe + i * 15, 'center'));
      u.pop();
      if (!this.popup) u.closeButton();
    }, this.popup ? () => this.popup!.draw() : undefined);
  }
}

/**
 * Title settings (state 0x0C) and help (state 0x0D): the in-game settings / help views of OptionTab
 * in a window over a dark backdrop; −16 (or leaving the screen) returns to the title. The title's
 * sixth setting "게임 데이터 관리" (→ 0x3B) is the info button's data screen here.
 */
class TitleOptionScene implements Scene {
  private tab: OptionTab;
  constructor(private ctx: GameContext, mode: 'settings' | 'help') {
    this.tab = mode === 'help' ? new OptionTab(ctx).openHelp() : new OptionTab(ctx).openSettings();
    ctx.input.uiMode = true; ctx.input.zones = [];
  }
  update(presses: number[]): void {
    for (const t of this.ctx.input.takeTaps()) { const k = this.ctx.ui13.tapAt(t.x, t.y); if (k) presses = [...presses, ...k]; }
    this.tab.update(presses);
    if (!this.tab.busy) this.ctx.go(new TitleScene(this.ctx));
  }
  draw(): void {
    render(this.ctx, () => { this.ctx.ui.alpha = 24; fillScreen(this.ctx.ui, 0x0a0f1a); this.ctx.ui.alpha = 32; }, () => {
      const u = this.ctx.ui13;
      u.pushCenter220();
      u.view('titleSub', 0, 24, 220, 196, win('.v-col.v-fill', { style: 'padding:4px' }, slot('tab')));
      this.tab.draw(u);
      u.pop();
      u.closeButton(26);
    });
  }
}

/** Field play bound to a save slot, with SAVE, a pause popup and the game-over menu (0x1B). */
/** HUD touch keys: the gate icon (156..188, 2..34) -> community 0x24, SHOP (-7) -> premium shop,
 *  the coupon button -> coupon shop 0x28 (FUN_00047488) */
export const HUD_COMMUNITY = HUD.COMMUNITY, HUD_SHOP = HUD.SHOP, HUD_COUPON = HUD.COUPON, HUD_QUEST = HUD.QUEST;

export class PlayScene implements Scene {
  private overSel = 0;
  private overTicks = 0;
  private notice: Popup | null = null;
  /** game menu 0x1C / tabs (Esc = MENU key -16) */
  private menu: GameMenu | null = null;
  /** the menu whose blurred backdrop is frozen in the compositor */
  private backdropFor: GameMenu | null = null;
  /** "go to the title?" popup 10 */
  private pause: Popup | null = null;
  /** NPC shop (states 0x16 / 0x15 / 0x2B / 0x2C) */
  private shop: ShopScreen | null = null;
  /** ending popup 0x5C (hardcore unlocked) */
  private endPopup: Popup | null = null;
  /** "save?" popup 8 from the option tab */
  private askSave: Popup | null = null;
  /** game-over popups (0x4E / 0x7D) and the coupon shop opened from there (DAT_003b3cc1) */
  private overPopup: { p: Popup; then?: (r: 'yes' | 'no' | 'ok') => void } | null = null;
  private overShop: CouponShop | null = null;

  private constructor(private ctx: GameContext, private slot: number, readonly field: FieldScene) {
    field.autosave = () => { saveSlot(slot, field.toSave()); };
    field.prevSave = () => loadSlot(slot);
    field.bindSlot(slot);
  }

  static async start(ctx: GameContext, slot: number, save: SaveData): Promise<void> {
    ctx.go(new LoadingScene(ctx));
    ctx.go(new PlayScene(ctx, slot, await FieldScene.create(ctx, save, loadGamedata().lap[slot] ?? 0)));
  }

  update(presses: number[]): void {
    // touch (UI mode): taps run the topmost area registered while drawing (menus / popups first, then the field UI)
    const f = this.field;
    this.ctx.input.uiMode = !!(this.field.ending || this.overShop || this.overPopup || this.menu || this.shop || this.pause || this.notice || this.askSave || f.popup || f.busyTalking || f.dead);
    this.ctx.input.padField = !this.ctx.input.uiMode;
    // touch: dialogue / event / popup on the field keeps a confirm button under the right thumb (fieldHud confirmControls)
    this.ctx.input.confirm = this.ctx.input.device === 'touch' && !this.menu && !this.shop && !this.overShop && !this.pause && !f.ending
      && !f.warpList && !!(f.busyTalking || f.popup || this.notice || this.askSave || this.overPopup);
    for (const t of this.ctx.input.takeTaps()) {
      const keys = this.ctx.ui13.tapAt(t.x, t.y) ?? this.ctx.ui.tapAt(t.x, t.y) ?? this.ctx.hud.tapAt(t.x, t.y);
      if (keys) presses = [...presses, ...keys];
    }
    if (this.field.ending) {                                  // state 0x3D: black, BGM 0, popup 0x5C unless hard
      if (!this.endPopup) {
        this.ctx.audio.playBgm(0);
        if (this.field.hard) { this.ctx.go(new TitleScene(this.ctx)); return; }
        this.endPopup = new Popup(this.ctx, 0x5c);
      }
      if (this.endPopup.handle(presses)) { setLap(this.slot, 1); this.ctx.go(new TitleScene(this.ctx)); }   // slot save not written
      return;
    }
    if (this.field.dead) {
      if (this.overTicks === 0) this.ctx.audio.playBgm(18);          // death BGM 0x12 (FUN_0001b06c)
      this.overTicks++;
      if (this.overTicks < 16) return;
      if (this.overShop) { if (this.overShop.update(presses) === 'close') this.overShop = null; return; }
      if (this.overPopup) { const r = this.overPopup.p.handle(presses); if (r) { const t = this.overPopup.then; this.overPopup = null; t?.(r); } return; }
      for (const k of presses) {
        if (k === AVK.UP) this.overSel = (this.overSel + 2) % 3;
        else if (k === AVK.DOWN) this.overSel = (this.overSel + 1) % 3;
        else if (k === AVK.OK) {
          if (this.overSel === 0 && f.dim) {                   // 차원의 문 나가기 (0x19E8): result popup, then reload
            this.overPopup = { p: f.dimResult(), then: () => { f.dead = false; f.leaveDimension(); } };
          } else if (this.overSel === 0) {                      // 이어하기: popup 0x1B, then reload the last save (none: popup 0x4F)
            this.overPopup = { p: new Popup(this.ctx, 0x1b), then: (r) => {
              if (r !== 'yes') return;
              const s = loadSlot(this.slot);
              if (s) void PlayScene.start(this.ctx, this.slot, s);
              else this.overPopup = { p: new Popup(this.ctx, 0x4f) };
            } };
          } else if (this.overSel === 2) {                      // 타이틀화면으로: popup 10 first
            this.overPopup = { p: new Popup(this.ctx, 10), then: (r) => { if (r === 'yes') this.ctx.go(new TitleScene(this.ctx)); } };
          }
          else this.reviveChoice();
        }
      }
      return;
    }
    if (this.notice) { if (this.notice.handle(presses)) this.notice = null; return; }
    if (this.askSave) {
      const r = this.askSave.handle(presses);
      if (r) this.askSave = null;
      if (r === 'yes') this.notice = new Popup(this.ctx, saveSlot(this.slot, this.field.toSave()) ? 9 : 0x0f);
      return;
    }
    if (this.pause) {
      const r = this.pause.handle(presses);
      if (r === 'yes') this.ctx.go(new TitleScene(this.ctx));
      else if (r) this.pause = null;
      return;
    }
    if (presses.includes(AVK.SAVE) && !this.field.busyTalking) {
      // HUD SAVE (misc-systems.md §7.2): popup 8 where saving is allowed, else "저장이 불가능한 지역입니다."
      if (this.field.canSave) this.askSave = new Popup(this.ctx, 8);
      else if (!this.field.inEvent) this.field.hud.message(this.ctx.assets.text[0x1a61] ?? '');   // during an event it fails silently
      return;
    }
    if (this.shop) { if (this.shop.update(presses) === 'close') this.shop = null; return; }
    if (this.menu) {
      const r = this.menu.update(presses);
      if (r === 'close' || this.field.closeMenu) { this.menu = null; this.field.closeMenu = false; }   // entering the dimension closes the menu
      else if (r === 'title') this.pause = new Popup(this.ctx, 10);
      else if (r === 'save' && this.field.canSave) this.askSave = new Popup(this.ctx, 8);   // menu save: silent where not allowed
      return;
    }
    if (presses.includes(AVK.CLR) && !this.field.busyTalking) { this.menu = new GameMenu(this.ctx, this.field); return; }
    if (presses.includes(AVK.MAP) && !this.field.busyTalking) { this.menu = new GameMenu(this.ctx, this.field).openTab(5); return; }
    if (presses.includes(HUD_QUEST) && !this.field.busyTalking) { this.menu = new GameMenu(this.ctx, this.field).openTab(4); return; }
    for (const [key, screen] of [[HUD_COMMUNITY, 'dimension'], [HUD_SHOP, 'premium'], [HUD_COUPON, 'coupon']] as const) {
      if (!presses.includes(key) || this.field.busyTalking) continue;
      const m = new GameMenu(this.ctx, this.field).openTab(7);
      if (screen) m.community.open(screen);
      this.menu = m;
      return;
    }
    this.field.update(presses);
    if (this.field.reloadRequest) {                                  // the dimension run ended: back to the save made before entering
      const s = loadSlot(this.slot);
      if (s) void PlayScene.start(this.ctx, this.slot, s); else this.ctx.go(new TitleScene(this.ctx));
      return;
    }
    if (this.field.shopRequest !== null) { this.shop = new ShopScreen(this.ctx, this.field, this.field.shopRequest); this.field.shopRequest = null; }
  }

  /** FUN_00044e98 choice 1: a revival scroll (0x1b, 3) revives in place; without one, 4+ coupons show
   *  popup 0x4E and then revive for 2 coupons (net 0x19 code 1, done locally), else 0x7D opens the coupon shop */
  private reviveChoice(): void {
    const f = this.field, inv = f.inv, t = this.ctx.assets.text;
    if (countOf(inv, 0x1b, 3) > 0) { consume(inv, 0x1b, 3, 1); f.countUse(3); f.revive(); this.overTicks = 0; return; }
    if (coupons(f) >= 4) {
      // 0x4E "부활 스크롤을 가지고 있지 않습니다." -> 0x4D: buy one with 2 coupons? (FUN_0005de24 case '0', FUN_00053ca0 0x1a)
      this.overPopup = { p: new Popup(this.ctx, 0x4e, 0, (s) => josa(s.replace('%s', t[0xa0c + 3] ?? ''))), then: () => {
        this.overPopup = { p: couponCard(this.ctx, f, 0x4d, 3, 2, f.db.create(0x1b, 3, 0, f.rng).name), then: (r) => {
          if (r !== 'yes') return;
          if (coupons(f) < 2) { this.overPopup = { p: new Popup(this.ctx, 0x6a, 0, () => t[0x508] ?? '') }; return; }
          consume(inv, 0x1b, 0x1b, 2); f.revive(); this.overTicks = 0;   // net 0x19 code 1 (FUN_000752bc), done locally
        } };
      } };
      return;
    }
    this.overPopup = { p: new Popup(this.ctx, 0x7d), then: () => { this.overShop = new CouponShop(this.ctx, f); } };
  }

  draw(): void {
    this.ctx.overlay.getContext('2d')!.clearRect(0, 0, W, H);
    const dead = this.field.dead;
    if (this.field.ending) {                                  // black screen with the popup
      this.ctx.ui.begin(); this.ctx.ui.fill(0, 0, W, H, 0); this.ctx.ui.end();
      if (this.endPopup) { this.ctx.ui13.begin(); this.endPopup.draw(); this.ctx.ui13.end(); }
      this.ctx.compositor.show();
      return;
    }
    // game over: the field (map + status bar, no touch buttons) turns grey over 16 frames
    // (SetGray(min(aac, 32)), FUN_000336a8), then the menu is drawn in colour on top
    setGrey(dead ? Math.min(1, this.overTicks / 16) : 0);
    this.ctx.hud.grey = greyUniform.grey.value;
    this.field.showButtons = !this.menu && !this.shop && !this.pause && !this.notice && !this.askSave;
    if (!this.menu) { this.field.draw(); this.backdropFor = null; }
    else if (this.backdropFor !== this.menu || this.ctx.compositor.backdropStale) { this.field.draw(); this.ctx.compositor.freezeBackdrop(); this.backdropFor = this.menu; }
    else this.ctx.compositor.drawBackdrop();                         // the blurred field is frozen while the menu is open
    if (this.menu) this.ctx.hud.hold();                              // the HUD stays under the menu, darkened and blurred by CSS
    setGrey(0);
    if (this.shop) {
      this.ctx.ui.begin();
      this.shop.drawBackground(this.ctx.ui);
      this.ctx.ui.end();
      this.ctx.ui13.begin();
      this.shop.drawOverlay();
      this.ctx.ui13.end();
    }
    if (this.menu) {
      this.ctx.ui13.begin();
      this.menu.drawOverlay();
      this.ctx.ui13.end();
    }
    if (dead && this.overTicks >= 16) {                              // game-over menu 0x1B (continue / revive / title)
      const u = this.ctx.ui, t = this.ctx.assets.text;
      u.begin();
      u.pushCenter220();
      const items = [this.field.dim ? t[0x19e8] : t[0x1d1], (t[0x1d2] ?? '').replace('%d', String(countOf(this.field.inv, 0x1b, 3))), t[0x1d3]];
      u.view('gameover', 0, 0x1e, 0xdc, 0xa0, win('.v-col.v-fill.v-center', { style: 'gap:18px;padding:12px 16px' },
        items.map((s, i) => button(gt(s ?? ''), {
          sel: this.overSel === i, style: 'width:100%',
          on: () => { if (this.overSel === i) return [AVK.OK]; this.overSel = i; },
        }))));
      u.pop();
      u.end();
    }
    if (dead && (this.overShop || this.overPopup)) {
      const u = this.ctx.ui13;
      u.begin();
      if (this.overShop) {                                         // coupon shop in a window, its body mounted in the 'tab' slot
        u.pushCenter220();
        u.view('overShop', 0, 0x1e, 0xdc, 0xb4, win('.v-col.v-fill', { style: 'padding:4px' }, slot('tab')));
        this.overShop.draw(u);
        u.pop();
        if (!this.overShop.popup) u.closeButton();                  // touch: back to the game over menu (CLR)
        this.overShop.drawPopups();
      }
      this.overPopup?.p.draw();
      u.end();
    }
    const pop = this.notice ?? this.askSave ?? this.pause;
    if (pop) {
      this.ctx.ui13.begin();
      pop.draw();
      this.ctx.ui13.end();
    }
    this.ctx.compositor.show();
  }

  debugLine(): string {
    return `슬롯 ${this.slot + 1} · ${this.field.debugLine()}`;
  }

  dispose(): void { this.field.dispose(); }
}

class LoadingScene implements Scene {
  constructor(private ctx: GameContext) {}
  update(): void { /* waiting for assets */ }
  draw(): void {
    render(this.ctx, () => fillScreen(this.ctx.ui, 0));
  }
}
