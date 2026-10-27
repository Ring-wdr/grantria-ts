// Menu screens drawn with the original art (analysis/features/ui-screens.md §0.3–0.7, ported
// from tools/grantria_ui.py): logo (0x05) -> rating (0x06) -> title (0x08/0x09) -> slot select
// (0x0A) -> character select (0x0B, popup 0) -> field (0x10), game over (0x1B).
// Ranking is local (ranking.ts); the Kakao button is removed. The title settings / help rows open the option
// screens, the info button opens the data screen (0x3B); hardcore mode, revival and the game menu live elsewhere.
// The state and keys are core/scenes/title.ts and play.ts; this draws them and makes the scenes (WebScreens).
import { FieldScene } from './fieldScene';
import { GameMenu } from './menu';
import { CouponShop } from './community';
import { countOf } from '../../core/rules/shopRules';
import { ShopScreen } from './shop';
import { popupPaint } from './popup';
import { VIEW_H as H, VIEW_W as W } from '../render/field';
import { AVK } from '../input/input';
import { loadGamedata, type SaveData } from '../../core/save/save';
import type { GameContext, Scene } from './scene';
import { tri, type Ui } from '../render/ui';
import type { Piece } from '../render/domUi';
import { equipLook } from '../../core/render';
import { button, gt, h, slot, win } from '../render/view';
import { greyUniform, setGrey } from '../render/sprites';
import { RankingScene } from './ranking';
import { DataScene } from './dataScene';
import { OptionTab } from './optionTab';
import { keyHint } from '../input/keyHints';
import { drawBacklog } from './backlog';
import { SandboxScene } from './sandbox';
import { ReplayListScene } from './replay';
import { MusicRoomScene } from './musicRoom';
import { ExpeditionScene } from '../expedition/expedition';
import type { Screens } from '../../core/scenes/host';
import { CLASS_KEY, CharSelectLogic, LogoLogic, RatingLogic, SLOT_KEY, SlotLogic, TITLE_DATA, TITLE_EXTRA, TITLE_EXTRA_ITEMS, TITLE_ITEMS, TITLE_NONE, TITLE_PAD, TitleLogic, TitleOptionLogic, playTime } from '../../core/scenes/title';
import { PlayLogic } from '../../core/scenes/play';

export const MENU_IMAGES = ['c', 't', 'f', 'logo', 'h_logo', 'title_bg', 'title_bg2', 'char_slot'];
export const MENU_CMFS = ['cmf_title', 'cmf_c0', 'cmf_c1', 'cmf_c2'];

export function fillScreen(u: Ui, rgb: number): void {
  u.fill(0, 0, W, H, rgb);
}

/** title clouds: the 0xf0 × 0x77 tile and its mirror on top, both turned upside down below (flags as image()) */
const CLOUD_PIECES: Piece[] = [
  [0, 0x69, 0xf0, 0x77, 0, 0x77, 0x09], [0, 0x69, 0xf0, 0x77, 0, 0, 0x00],
  [0, 0x69, 0xf0, 0x77, 0xf0, 0x77, 0x08], [0, 0x69, 0xf0, 0x77, 0xf0, 0, 0x01],
];

/** the logo and the island sit this far right of the original's centre, leaving the left for the menu column */
const ART_DX = 56;

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
    u.image('title_bg2', 0, 0, 0x17c, 0x104, W / 2 - 0xbe + ART_DX, H - rise + bob);   // island
    // clouds, blend 1 (lighten): two 0xf0 tiles every 0x1e0, from past the left edge to past the right one (in
    // fullscreen the title reaches u.bleed into the side margins). The four mirrored / turned quarters are baked into
    // one image and drawn as a single repeating strip: as separate transformed elements their edges showed as a grid
    // once scaled. The loop is the fallback while it is being made.
    if (!u.strip('title-clouds', 'title_bg', 0x1e0, 0xee, CLOUD_PIECES, -u.bleed, H - cy, W + 2 * u.bleed, cx, 1)) {
      for (let ox = cx - Math.ceil((cx + u.bleed) / 0x1e0) * 0x1e0; ox < W + u.bleed; ox += 0x1e0) {
        for (const [sx, sy, w, h, x, y, f] of CLOUD_PIECES) u.image('title_bg', sx, sy, w, h, ox + x, H - cy + y, 0x100 | f!);
      }
    }
  }
  const f = (t >> 2) % cyc;
  u.pushCenter220();
  u.frame('cmf_title', ctx.cmfs.cmf_title, f + base, 0x73 + ART_DX, 0x6e);
  u.pop();
  if (f === 0x10) u.fill(W / 2 - 1 + ART_DX, 0, 2, H, 0xffffff);
  else if (f > 0x10 && f < 0x18 && base === 0) {
    u.alpha = (0x17 - f) * 8;
    fillScreen(u, 0xffffff);
    u.alpha = 32;
  }
}

/** title menu (not the original's button row): a text column at the left, top to bottom (core/scenes/title.ts TITLE_ITEMS) */
const TITLE_MENU = { x: 22, y: 138, w: 132, row: 28 };
/** the 엑스트라 submenu: a small panel at the right of its row */
const TITLE_SUB = { x: TITLE_MENU.x + TITLE_MENU.w + 4, w: 96, y: TITLE_MENU.y + TITLE_MENU.row * TITLE_ITEMS.findIndex(([k]) => k === TITLE_EXTRA) };
/** the top-right info icon (FUN_00035988's third; its settings / help icons are menu rows now): key, x */
const TITLE_ICONS: [key: number, x: number][] = [[TITLE_DATA, 0x1b6]];

/** the menu column's fade-in (ms); timed here, not by a CSS animation: the logo frames draw a varying number of
 *  pieces, which moves the menu's element in the DOM and would restart one */
const TITLE_MENU_IN = 400;

/** Title menu: the text column (k = its fade-in, 0..1), the 엑스트라 submenu (sub = its row, -1 closed), the
 *  top-right info icon and the copyright */
function titleButtons(u: Ui, sel = 0, sub = -1, k = 1): void {
  const { x, y, w, row } = TITLE_MENU;
  u.alpha = Math.round(32 * k);
  u.view('titleMenu', x - Math.round(12 * (1 - k) ** 2), y, w, row * TITLE_ITEMS.length, h('div.v-col.tm-list', null,
    TITLE_ITEMS.map(([key, label], i) => h(`div.tm-item${i === sel ? (sub >= 0 ? '.open' : '.sel') : ''}`, { style: `height:${row}px` },
      key === TITLE_EXTRA ? [label, h('span.tm-more', null, '▸')] : label))));
  if (sub >= 0) u.view('titleExtra', TITLE_SUB.x, TITLE_SUB.y, TITLE_SUB.w, row * TITLE_EXTRA_ITEMS.length, h('div.v-col.tm-list.tm-sub', null,
    TITLE_EXTRA_ITEMS.map(([, label], i) => h(`div.tm-item${i === sub ? '.sel' : ''}`, { style: `height:${row}px` }, label))));
  u.alpha = 32;
  u.image('t', 0x20, 0xda, 0x20, 0x21, 0x1b6, 7);           // info -> data management (backup / original saves)
  // the original's left at (97, 303) cleared the Kakao button at the right; it is gone, so centred
  u.string('Copyright ENERVE Co., Ltd. All rights reserved.', W / 2, 0x12f, 'center');
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
}

/** State 0x05: company logo on white, 21 frames (FUN_0002c4b4). */
export class LogoScene extends LogoLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext) { super(ctx); ctx.input.uiMode = false; ctx.input.zones = []; }

  readonly wide = true;
  readonly backdrop = 0xffffff;                                       // the logo sits on white, so does the page
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

const RATING_BG = 0xfff7ff;

/** State 0x06: rating notice (h_logo lower half), 80 frames (FUN_00035c4c). */
class RatingScene extends RatingLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext) { super(ctx); }

  readonly wide = true;
  /** the notice's own paper colour (h_logo is #FFF7FF, not white): on a wider screen a white page around it showed
   *  the 480 × 320 middle as a pink box */
  readonly backdrop = RATING_BG;
  draw(): void {
    render(this.ctx, () => {
      fillScreen(this.ctx.ui, RATING_BG);
      this.ctx.ui.image('h_logo', 0, 320, 480, 320, 0, 0);
    });
  }
}

/** States 0x08 (110-frame intro) and 0x09 (menu). */
export class TitleScene extends TitleLogic {
  declare protected readonly ctx: GameContext;

  readonly wide = true;                                               // fullscreen: sky and clouds across the margins
  private badgeUntil = performance.now() + 3500;   // rating badge for 3.5 s (FUN_00035b80)
  /** when the menu appeared (state 9), for its fade-in */
  private menuAt = performance.now();

  constructor(ctx: GameContext, intro = false) {
    super(ctx, intro);
    ctx.input.uiMode = false;
    this.setZones();
  }

  /** touchdata[9]'s 게임시작 / 게임순위 zones became the menu rows (and the open submenu's); the info icon keeps its
   *  zone. A press on the left half that misses the menu does nothing (else Input takes it for the move stick,
   *  x < 231, and the stick's repeats run the menu cursor up and down); it closes the submenu */
  private setZones(): void {
    const { x, y, w, row } = TITLE_MENU;
    this.ctx.input.zones = [
      ...(this.sub >= 0 ? TITLE_EXTRA_ITEMS.map(([key], i) => ({ x: TITLE_SUB.x, y: TITLE_SUB.y + i * row, w: TITLE_SUB.w, h: row, key })) : []),
      ...TITLE_ITEMS.map(([key], i) => ({ x, y: y + i * row, w, h: row, key })),
      ...TITLE_ICONS.map(([key, ix]) => ({ x: ix, y: 7, w: 32, h: 33, key })),
      { x: -W, y: 0, w: W + 231, h: H, key: TITLE_NONE }];
  }

  override update(presses: number[]): void {
    const intro = this.state === 8, open = this.sub >= 0;
    super.update(presses);
    if (open !== this.sub >= 0) this.setZones();
    if (intro && this.state === 9) this.menuAt = performance.now();
    if (!intro && presses.length) frozenTick = this.t;               // the frame at the confirming tick
  }

  draw(): void {
    render(this.ctx, () => {
      titleBackground(this.ctx, this.t, this.state);
      if (performance.now() < this.badgeUntil) this.ctx.ui.image('title_bg', 0xf0, 0, 0x66, 0x78, W - 0x66, 0);
      if (this.state === 9) titleButtons(this.ctx.ui, this.sel, this.sub, Math.min(1, (performance.now() - this.menuAt) / TITLE_MENU_IN));
      const inp = this.ctx.input;
      if (this.state === 9) for (const [pad, key] of TITLE_PAD) {
        const x = TITLE_ICONS.find(([k]) => k === key)?.[1];
        const k = x !== undefined && keyHint(inp, pad);
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

/** State 0x0A slot select (FUN_00034040 + FUN_00033dcc), C220 coordinates. */
export class SlotScene extends SlotLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    super(ctx);
    // touch (C220 + (80,40)): slot rows -> select/start, delete (277,190,97,42), close (275,30,57,57)
    ctx.input.uiMode = false; ctx.input.zones = [
      { x: 357, y: 230, w: 97, h: 42, key: AVK.POUND },
      { x: 357, y: 184, w: 97, h: 42, key: AVK.STAR },
      { x: 355, y: 70, w: 57, h: 57, key: AVK.CLR },
      ...[0, 1, 2].map((i) => ({ x: 130, y: 72 + i * 66, w: 220, h: 64, key: SLOT_KEY + i })),
    ];
  }

  override update(presses: number[]): void {
    this.ctx.input.uiMode = this.overlays.size > 0;                  // taps reach the popup buttons
    super.update(presses);
  }

  readonly wide = true;                                               // over the title backdrop
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
        u.frame(cmfName, this.ctx.cmfs[cmfName], t % 6, sl.cls === 2 ? 0x23 : 0x26, iy + (sl.cls === 2 ? 0x3a : 0x30), undefined, undefined, equipLook(sl.inv?.equip));
        u.textId(0x3e1 + sl.cls, 0x4d, iy + 8);
        u.textId(0x1a3d, 0xac, iy + 8);
        u.number(sl.level, 0xbb, iy + 8, 1);
        u.textId(0x1d6 + (sl.zone ?? 0), 0x91, iy + 0x1e, 'center');
        u.string(String(sl.gold), 0xda, iy + 0x2e, 'right');
        u.string(playTime(sl.playTicks), 0x4d, iy + 0x2e);
        if (this.laps[i] >= 2) u.textId(0x1a3c, 0xda, iy + 0x1e, 'right', { pen: 0xf800 });   // red "Hard" (3회차 is hard too)
        // 회차 (not in the original): 1 normal (lap 0 / 1), 2 hard (2 / 3), 3 the third run (4); dimmed with the slot
        const run = this.laps[i] >= 4 ? 3 : this.laps[i] >= 2 ? 2 : 1;
        u.view(`slotLap${i}`, 7, iy + 8, 30, 10, h('div.slot-lap', { style: this.cur === i ? '' : 'opacity:0.5' }, `${run}회차`));
        u.alpha = 32;
      }
      const tx = this.ctx.assets.text, full = 'width:100%;height:100%';
      if (this.slots[this.cur] && (this.laps[this.cur] === 1 || this.laps[this.cur] === 3))   // 하드코어 (FUN_00034040); 3회차 on a cleared hard slot
        u.view('slotHard', 0xf0, 0x90, 0x44, 0x16, button(gt(this.laps[this.cur] === 3 ? '3회차' : tx[0x19d6] ?? ''), { sel: true, glow: false, style: full }));
      u.view('slotDelete', 0xf0, 0xbe, 0x44, 0x16, button(gt(tx[0x19d7] ?? ''), {   // 슬롯삭제 (variant 3 when empty)
        sel: !!this.slots[this.cur], glow: false, cls: this.slots[this.cur] ? '' : 'off', style: full,
      }));
      u.pop();
      if (!this.overlays.size) u.closeButton();
    }, this.overlays.size ? () => this.overlays.draw(popupPaint(this.ctx)) : undefined);
  }
}

/** State 0x0B character select (FUN_0002eef8), confirmation popup 0. */
export class CharSelectScene extends CharSelectLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext, slot: number, cls = 0) {
    super(ctx, slot, cls);
    // touch (C220 + (80,40)): arrows (99,165) / (178,165) 39x23, 3 cards (49,33,223,130), close
    ctx.input.uiMode = false; ctx.input.zones = [
      { x: 179, y: 205, w: 39, h: 23, key: AVK.LEFT },
      { x: 258, y: 205, w: 39, h: 23, key: AVK.RIGHT },
      { x: 355, y: 70, w: 57, h: 57, key: AVK.CLR },
      ...[0, 1, 2].map((i) => ({ x: 130 + i * 75, y: 73, w: 74, h: 130, key: CLASS_KEY + i })),
    ];
  }

  override update(presses: number[]): void {
    this.ctx.input.uiMode = this.overlays.size > 0;
    super.update(presses);
  }

  readonly wide = true;
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
      if (!this.overlays.size) u.closeButton();
    }, this.overlays.size ? () => this.overlays.draw(popupPaint(this.ctx)) : undefined);
  }
}

/** Title settings (state 0x0C) and help (state 0x0D): the option tab's views in a window over a dark backdrop. */
class TitleOptionScene extends TitleOptionLogic {
  declare protected readonly ctx: GameContext;
  declare protected tab: OptionTab;

  constructor(ctx: GameContext, mode: 'settings' | 'help') {
    super(ctx, mode);
    ctx.input.uiMode = true; ctx.input.zones = [];
  }

  protected newOptionTab(): OptionTab { return new OptionTab(this.ctx); }

  override update(presses: number[]): void {
    for (const t of this.ctx.input.takeTaps()) { const k = this.ctx.ui13.tapAt(t.x, t.y); if (k) presses = [...presses, ...k]; }
    super.update(presses);
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
export class PlayScene extends PlayLogic {
  declare protected readonly ctx: GameContext;
  declare readonly field: FieldScene;
  declare protected menu: GameMenu | null;
  declare protected shop: ShopScreen | null;
  /** the menu whose blurred backdrop is frozen in the compositor */
  private backdropFor: GameMenu | null = null;

  private constructor(ctx: GameContext, slot: number, field: FieldScene) { super(ctx, slot, field); }

  protected newMenu(): GameMenu { return new GameMenu(this.ctx, this.field); }
  protected newShop(kind: number): ShopScreen { return new ShopScreen(this.ctx, this.field, kind); }
  protected newCouponShop(): CouponShop { return new CouponShop(this.ctx, this.field); }
  protected startRush(): void { void SandboxScene.rush(this.ctx, this); }

  override update(presses: number[]): void {
    // touch (UI mode): taps run the topmost area registered while drawing (menus / popups first, then the field UI)
    const f = this.field, o = this.overlays, input = this.ctx.input;
    input.uiMode = !!(this.log || f.ending || o.size || this.menu || this.shop || f.busyTalking || f.dead);
    input.padField = !input.uiMode;
    // touch: dialogue / event / popup on the field keeps a confirm button under the right thumb (fieldHud confirmControls)
    input.confirm = input.device === 'touch' && !this.log && !this.menu && !this.shop && !o.kindOpen('shop') && !o.kindOpen('pause')
      && !f.ending && !f.warpListOpen && !!(f.busyTalking || o.kindOpen('popup'));
    for (const t of input.takeTaps()) {
      const keys = this.ctx.ui13.tapAt(t.x, t.y) ?? this.ctx.ui.tapAt(t.x, t.y) ?? this.ctx.hud.tapAt(t.x, t.y);
      if (keys) presses = [...presses, ...keys];
    }
    super.update(presses);
  }

  static async start(ctx: GameContext, slot: number, save: SaveData): Promise<void> {
    ctx.go(new LoadingScene(ctx));
    ctx.go(new PlayScene(ctx, slot, await FieldScene.create(ctx, save, loadGamedata().lap[slot] ?? 0)));
  }

  draw(): void {
    const dead = this.field.dead;
    if (this.field.ending) {                                  // black screen with the popup
      this.ctx.ui.begin(); this.ctx.ui.fill(0, 0, W, H, 0); this.ctx.ui.end();
      this.drawOverlays();
      this.ctx.compositor.show();
      return;
    }
    // game over: the field (map + status bar, no touch buttons) turns grey over 16 frames
    // (SetGray(min(aac, 32)), FUN_000336a8), then the menu is drawn in colour on top
    setGrey(dead ? Math.min(1, this.overTicks / 16) : 0);
    this.ctx.hud.grey = greyUniform.grey.value;
    this.field.showButtons = !this.menu && !this.shop && !this.overlays.size;
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
    if (this.log) { this.ctx.ui.begin(); drawBacklog(this.ctx.ui, this.log, this.ctx.input); this.ctx.ui.end(); }
    this.drawOverlays();
    this.ctx.compositor.show();
  }

  private drawOverlays(): void {
    if (!this.overlays.size) return;
    this.ctx.ui13.begin();
    const paint = popupPaint(this.ctx);
    this.overlays.draw((o) => (o.model instanceof CouponShop ? this.drawOverShop(o.model) : paint(o)));
    this.ctx.ui13.end();
  }

  /** the game over's coupon shop in a window, its body mounted in the 'tab' slot */
  private drawOverShop(shop: CouponShop): void {
    const u = this.ctx.ui13;
    u.pushCenter220();
    u.view('overShop', 0, 0x1e, 0xdc, 0xb4, win('.v-col.v-fill', { style: 'padding:4px' }, slot('tab')));
    shop.draw(u);
    u.pop();
    if (!shop.overlays.size) u.closeButton();                            // touch: back to the game over menu (CLR)
    shop.drawPopups();
  }

  debugLine(): string {
    return `슬롯 ${this.slot + 1} · ${this.field.debugLine()}`;
  }

  dispose(): void { if (!this.suspended) { this.gone = true; this.field.dispose(); } }
}

/** the core flow's screen changes (core/scenes/host.ts) as this host's scenes */
export class WebScreens implements Screens {
  constructor(private ctx: GameContext) {}
  rating(): void { this.ctx.go(new RatingScene(this.ctx)); }
  title(intro = false): void { this.ctx.go(new TitleScene(this.ctx, intro)); }
  slots(): void { this.ctx.go(new SlotScene(this.ctx)); }
  charSelect(slot: number): void { this.ctx.go(new CharSelectScene(this.ctx, slot)); }
  play(slot: number, save: SaveData): void { void PlayScene.start(this.ctx, slot, save); }
  titleOption(mode: 'settings' | 'help'): void { this.ctx.go(new TitleOptionScene(this.ctx, mode)); }
  ranking(): void { this.ctx.go(new RankingScene(this.ctx)); }
  replays(): void { this.ctx.go(new ReplayListScene(this.ctx)); }
  musicRoom(): void { this.ctx.go(new MusicRoomScene(this.ctx)); }
  data(): void { this.ctx.go(new DataScene(this.ctx)); }
  expedition(): void { this.ctx.go(new ExpeditionScene(this.ctx)); }
}

class LoadingScene implements Scene {
  constructor(private ctx: GameContext) {}
  update(): void { /* waiting for assets */ }
  draw(): void {
    render(this.ctx, () => fillScreen(this.ctx.ui, 0));
  }
}
