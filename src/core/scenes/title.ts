// The flow before play (analysis/features/ui-screens.md §0.3–0.7): logo (0x05) -> rating (0x06) -> title (0x08/0x09)
// -> slot select (0x0A) -> character select (0x0B, popup 0) -> field (0x10), and the title's settings / help (0x0C /
// 0x0D). State and keys; the host draws them (web/game/screens.ts) and goes to the next screen through Screens.
// Plain fields, no constructor parameter properties: node's type stripping loads this file in tests/scenes.test.ts.
import { Story } from '../data/story';
import { AVK } from '../keys';
import { SLOT_COUNT, deleteSlot, loadGamedata, loadSlot, newGame, saveSlot, setLap, type SaveData } from '../save/save';
import { OverlayStack } from '../ui/overlays';
import { Popup, openPopup } from '../ui/popup';
import type { OptionTabLogic } from '../menu/optionTab';
import type { SceneHost } from './host';

/** State 0x05: company logo on white, 21 frames (FUN_0002c4b4). */
export class LogoLogic {
  private t = 0;
  protected readonly ctx: SceneHost;
  constructor(ctx: SceneHost) { this.ctx = ctx; }
  update(presses: number[]): void {
    if (++this.t >= 21 || presses.length) this.ctx.screens.rating();
  }
}

/** State 0x06: rating notice (h_logo lower half), 80 frames (FUN_00035c4c). */
export class RatingLogic {
  private t = 0;
  protected readonly ctx: SceneHost;
  constructor(ctx: SceneHost) { this.ctx = ctx; }
  update(presses: number[]): void {
    if (++this.t >= 80 || presses.length) { this.ctx.audio.playBgm(0); this.ctx.screens.title(true); }
  }
}

/** title menu keys (the host's touch rows and icons send them too): the four rows, the three top-right icons, and a
 *  press on the left half that misses the menu (does nothing) */
export const TITLE_START = -45, TITLE_RANKING = -40, TITLE_REPLAY = -44, TITLE_MUSIC = -46;
export const TITLE_DATA = -41, TITLE_OPTION = -42, TITLE_HELP = -43, TITLE_NONE = -47;
/** title menu (not the original's button row): a column of rows, top to bottom */
export const TITLE_ITEMS: [key: number, label: string][] = [[TITLE_START, '게임시작'], [TITLE_RANKING, '게임순위'], [TITLE_REPLAY, '회상'], [TITLE_MUSIC, '음악감상']];
/** pad key -> title icon key: 옵션 (□/X = '1'), 도움말 (△/Y = '3'), 데이터 (L2 = '*') */
export const TITLE_PAD: [pad: number, key: number][] = [[AVK.K1, TITLE_OPTION], [AVK.K3, TITLE_HELP], [AVK.STAR, TITLE_DATA]];

/** the title menu row last chosen, kept while the game runs: coming back from a screen keeps it */
let titleSel = 0;

/** States 0x08 (110-frame intro) and 0x09 (menu). */
export class TitleLogic {
  protected t = 0;
  protected state: 8 | 9;
  /** title menu row (TITLE_ITEMS): 0 게임시작, 1 게임순위, 2 회상, 3 음악감상 (the last two not in the original) */
  protected sel = titleSel;
  protected readonly ctx: SceneHost;
  constructor(ctx: SceneHost, intro = false) {
    this.ctx = ctx;
    this.state = intro ? 8 : 9;
    if (!intro) this.t = 200;
    ctx.audio.playBgm(0);
  }
  update(presses: number[]): void {
    this.t++;
    if (this.state === 8) {
      if (this.t > 0x6e || presses.length) { this.state = 9; this.t = Math.max(this.t, 0x71); }   // any key or a menu row
      return;
    }
    const n = TITLE_ITEMS.length;
    for (const k of presses) {
      if (k === AVK.UP || k === AVK.LEFT) this.sel = (this.sel + n - 1) % n;
      else if (k === AVK.DOWN || k === AVK.RIGHT) this.sel = (this.sel + 1) % n;
    }
    // OK picks the selected row; a tapped row is picked at once (and becomes the selected one)
    presses = presses.map((k) => (k === AVK.OK ? TITLE_ITEMS[this.sel][0] : k));
    const tapped = TITLE_ITEMS.findIndex(([key]) => presses.includes(key));
    if (tapped >= 0) this.sel = tapped;
    titleSel = this.sel;
    // the three top-right icons are touch zones only; a pad reaches them with □ / △ / L2 (TITLE_PAD)
    presses = presses.map((k) => TITLE_PAD.find(([key]) => key === k)?.[1] ?? k);
    if (presses.includes(TITLE_DATA)) { this.ctx.screens.data(); return; }
    if (presses.includes(TITLE_OPTION)) { this.ctx.screens.titleOption('settings'); return; }   // state 0x0C
    if (presses.includes(TITLE_HELP)) { this.ctx.screens.titleOption('help'); return; }         // state 0x0D
    if (presses.includes(TITLE_RANKING)) { this.ctx.screens.ranking(); return; }
    if (presses.includes(TITLE_REPLAY)) { this.ctx.screens.replays(); return; }
    if (presses.includes(TITLE_MUSIC)) { this.ctx.screens.musicRoom(); return; }
    if (presses.includes(TITLE_START)) this.ctx.screens.slots();
  }
}

/** "%02d:%02d:%02d" play time (text 0x1B28); the web port counts 20 ticks per second. */
export function playTime(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':');
}

/** slot row keys (the host's touch rows send SLOT_KEY + row) */
export const SLOT_KEY = 0x100;

/** State 0x0A slot select (FUN_00034040 + FUN_00033dcc). */
export class SlotLogic {
  protected t = 0;
  protected cur = 0;
  protected slots: (SaveData | null)[] = [];
  protected laps = [0, 0, 0];
  /** popup 0x5D (convert to hardcore / 3회차) and popup 1 (delete the slot) */
  protected readonly overlays = new OverlayStack();
  protected readonly ctx: SceneHost;
  constructor(ctx: SceneHost) {
    this.ctx = ctx;
    this.refresh();
  }
  private refresh(): void {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i));
    this.laps = loadGamedata().lap;
  }
  update(presses: number[]): void {
    this.t++;
    if (this.overlays.update(presses)) return;
    for (const k of presses) {
      if (k === AVK.STAR && this.slots[this.cur] && this.laps[this.cur] === 1) { this.askConvert(new Popup(this.ctx, 0x5d)); this.ctx.audio.playSfx(0x1f); return; }
      if (k === AVK.STAR && this.slots[this.cur] && this.laps[this.cur] === 3) {   // 3회차 (not in the original)
        this.askConvert(new Popup(this.ctx, 0x5d, 0, () => '3회차를 시작하시겠습니까?|@레벨·아이템·스킬은 그대로이고 이야기는 처음부터 다시 시작합니다.|@몬스터가 더 강해지고(HP ×1.5, 공격 ×1.25) 경험치가 1.5배가 됩니다.'));
        this.ctx.audio.playSfx(0x1f); return;
      }
      if (k >= SLOT_KEY && k < SLOT_KEY + 3) { if (this.cur === k - SLOT_KEY) this.choose(); else this.cur = k - SLOT_KEY; }
      else if (k === AVK.UP) this.cur = (this.cur + 2) % 3;
      else if (k === AVK.DOWN) this.cur = (this.cur + 1) % 3;
      else if (k === AVK.OK) this.choose();
      else if (k === AVK.POUND && this.slots[this.cur]) {                // popup 1: delete this slot?
        openPopup(this.overlays, new Popup(this.ctx, 1), () => { deleteSlot(this.cur); this.refresh(); });
        return;
      }
      else if (k === AVK.CLR) this.ctx.screens.title();
    }
  }
  /** popup 0x5D yes: a cleared slot (lap 1) goes hardcore, a cleared hard slot (lap 3) starts the 3회차 */
  private askConvert(p: Popup): void {
    openPopup(this.overlays, p, () => this.convert(this.cur, this.laps[this.cur] === 3 ? 4 : 2));
  }

  /** FUN_00053510 case 0x36 (hardmode.md §3.2): keep level, items, gold, skills; reset the story */
  private convert(i: number, lap = 2): void {
    const s = this.slots[i];
    if (!s) return;
    const fresh = Story.fresh(s.cls).toJSON();
    const old = s.story;
    // achievement counters / title flags +0x2df4..+0x2ebb, challenges +0x2c64, 차원의 문 clears +0x3100 and the fortune
    // day +0x3291 are not cleared (hardmode.md §3.2 / §3.3), so nothing already earned pops up or pays again;
    // the web's quest tracking toggles (qhide*) go with the quests
    const kept = Object.fromEntries(Object.entries(old?.counters ?? {}).filter(([k]) => !k.startsWith('qhide')));
    s.story = { ...fresh, book: old?.book, gather: old?.gather, titles: old?.titles, title: old?.title,
      counters: { ...(fresh.counters ?? {}), ...kept }, challenges: old?.challenges, dimClears: old?.dimClears,
      fortuneDay: old?.fortuneDay, fortuneHold: old?.fortuneHold };   // event bits, quests, visited maps, keys, chests reset
    s.buffs = undefined; s.day = 0;                                    // the return zone +0x3104 is kept
    if (s.inv) { s.inv.items = s.inv.items.filter((it) => it.type !== 0x1a); s.inv.keys = []; }   // key store wiped (FUN_00036180)
    saveSlot(i, s);
    setLap(i, lap);
    this.refresh();
  }

  private choose(): void {
    const s = this.slots[this.cur];
    if (s) this.ctx.screens.play(this.cur, s);
    else this.ctx.screens.charSelect(this.cur);
  }
}

/** class card keys (the host's touch cards send CLASS_KEY + class) */
export const CLASS_KEY = 0x110;

/** State 0x0B character select (FUN_0002eef8), confirmation popup 0. */
export class CharSelectLogic {
  protected t = 0;
  /** popup 0: start with this class? */
  protected readonly overlays = new OverlayStack();
  protected readonly ctx: SceneHost;
  private readonly slot: number;
  protected cls: number;
  constructor(ctx: SceneHost, slot: number, cls = 0) { this.ctx = ctx; this.slot = slot; this.cls = cls; }
  update(presses: number[]): void {
    this.t++;
    if (this.overlays.update(presses)) return;
    for (const k of presses) {
      if (k >= CLASS_KEY && k < CLASS_KEY + 3) { if (this.cls === k - CLASS_KEY) { this.choose(); return; } this.cls = k - CLASS_KEY; }
      else if (k === AVK.LEFT) this.cls = (this.cls + 2) % 3;
      else if (k === AVK.RIGHT) this.cls = (this.cls + 1) % 3;
      else if (k === AVK.OK) { this.choose(); return; }
      else if (k === AVK.CLR) { this.ctx.screens.slots(); return; }
    }
  }
  private choose(): void {
    openPopup(this.overlays, new Popup(this.ctx, 0, this.cls), () => {
      const save = newGame(this.cls as 0 | 1 | 2);
      setLap(this.slot, 0);
      saveSlot(this.slot, save);
      this.ctx.screens.play(this.slot, save);
    });
  }
}

/**
 * Title settings (state 0x0C) and help (state 0x0D): the in-game settings / help of the option tab over the title;
 * −16 (or leaving the screen) returns to the title. The title's sixth setting "게임 데이터 관리" (→ 0x3B) is the
 * info button's data screen here.
 */
export abstract class TitleOptionLogic {
  protected tab: OptionTabLogic;
  protected readonly ctx: SceneHost;
  constructor(ctx: SceneHost, mode: 'settings' | 'help') {
    this.ctx = ctx;
    const tab = this.newOptionTab();
    this.tab = mode === 'help' ? tab.openHelp() : tab.openSettings();
  }
  /** the host's view of the option tab (no field: 기록실 stays closed) */
  protected abstract newOptionTab(): OptionTabLogic;
  update(presses: number[]): void {
    this.tab.update(presses);
    if (!this.tab.busy) this.ctx.screens.title();
  }
}
