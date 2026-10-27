// Option tab 0x23 (FUN_0005ad88 / keys FUN_000567e8) and settings 0x27 (FUN_0005abac -> FUN_0002de7c,
// keys FUN_00055f94 -> FUN_00045ea4), analysis/features/ui-tabs.md §0.9.
// Help 0x26 (FUN_0005d890) and the monster book 0x32 / 0x33 (FUN_000598ac / FUN_0005cda8), misc-systems.md §8.
// Not in the original: the 몬스터도감 row is 기록실, a list of the monster book and the archive pages (archive.ts).
// State and keys; the host draws it (web/game/optionTab.ts).
import type { FieldGame } from '../field/fieldGame';
import { AVK } from '../keys';
import { OPTION_COUNTS, OPTION_KEYS, saveOptions } from '../save/options';
import { vibrate } from '../vibrate';
import type { Host } from '../host';
import { dev } from '../rules/dev';
import { platform } from '../platform';
import type { ScrollRef } from '../render';
import { RECORD_ROWS, type ArchivePanelLogic, type Launch } from './archive';
import type { ConveniencePanelLogic } from './convenience';

/** a settings sub panel: false from update once closed */
export interface SubPanel {
  update(presses: number[]): boolean;
}

export abstract class OptionTabLogic {
  protected sel = 0;
  /** settings screen 0x27 open, with its row cursor */
  protected setting = false;
  protected cur = 0;
  protected t = 0;
  /** request for the menu owner: save (popup 8) or quit (popup 10) */
  request: 'save' | 'quit' | null = null;
  /** sub screens: help page, monster book list cursor / detail */
  protected help = -1;
  protected book = -1;
  protected bookDetail = false;
  protected scroll: ScrollRef = { y: 0 };
  /** 키 설정 sub panel (keyboard / pad only) */
  protected keys: SubPanel | null = null;
  /** 편의 설정 sub panel */
  protected conv: ConveniencePanelLogic | null = null;
  /** 개발자 모드 sub panel (the row shows once unlocked, core/rules/dev.ts) */
  protected devp: SubPanel | null = null;
  /** 기록실 list cursor (-1 closed), the archive page opened from it, and what it asks the play scene to start */
  protected records = -1;
  protected archive: ArchivePanelLogic | null = null;
  launch: Launch | null = null;

  constructor(protected readonly ctx: Host, protected readonly fs?: FieldGame) {}

  /** the host's sub panels: 키 설정 and 개발자 모드 are the host's own (its key bindings, its perf log) */
  protected abstract newKeys(): SubPanel;
  protected abstract newConvenience(): ConveniencePanelLogic;
  protected abstract newDev(): SubPanel;
  protected abstract newArchive(page: number): ArchivePanelLogic;

  get busy(): boolean { return this.setting || this.help >= 0 || this.book >= 0 || this.records >= 0; }

  /** extra settings rows after the five options: 편의 설정, 풀스크린 on a touch-first screen or a host with OS
   *  fullscreen (desktop), 키 설정 unless the player is on touch, 개발자 모드 once unlocked */
  protected get extraRows(): ('conv' | 'full' | 'keys' | 'dev')[] {
    const r: ('conv' | 'full' | 'keys' | 'dev')[] = ['conv'];
    if (platform().touchFirst() || platform().fullscreen) r.push('full');
    if (this.ctx.input.device !== 'touch') r.push('keys');
    if (dev().unlocked) r.push('dev');
    return r;
  }
  private get settingRows(): number { return 5 + this.extraRows.length; }

  /** open the settings screen directly (title state 0x0C) */
  openSettings(): this { this.setting = true; this.cur = 0; return this; }
  /** open the help pages directly (title state 0x0D) */
  openHelp(): this { this.help = 0; return this; }

  update(presses: number[]): boolean {
    this.t++;
    if (this.keys) { if (!this.keys.update(presses)) this.keys = null; return true; }
    if (this.conv) { if (!this.conv.update(presses)) this.conv = null; return true; }
    if (this.devp) {                                                  // closed; the row is gone when the mode was hidden
      if (!this.devp.update(presses)) { this.devp = null; if (!dev().unlocked) this.cur = 5; }
      return true;
    }
    if (this.archive) {                                                // back to the 기록실 list when closed
      if (!this.archive.update(presses)) this.archive = null;
      else if (this.archive.launch) { this.launch = this.archive.launch; this.archive.launch = null; }
      return true;
    }
    for (const k of presses) {
      if (this.help >= 0) { this.helpKey(k); continue; }
      if (this.book >= 0) { this.bookKey(k); continue; }
      if (this.records >= 0) { this.recordsKey(k); continue; }
      if (this.setting) this.settingKey(k);
      else if (k === AVK.UP) this.sel = (this.sel + 4) % 5;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 5;
      else if (k === AVK.OK) {
        if (this.sel === 0) this.request = 'save';
        else if (this.sel === 1) this.help = 0;
        else if (this.sel === 2) { this.setting = true; this.cur = 0; }
        else if (this.sel === 3 && this.fs) this.records = 0;
        else if (this.sel === 4) this.request = 'quit';
      } else return false;
    }
    return true;
  }

  private helpKey(k: number): void {
    if (k === AVK.LEFT) this.help = (this.help + 24) % 25;
    else if (k === AVK.RIGHT || k === AVK.OK) this.help = (this.help + 1) % 25;
    else if (k === AVK.CLR) this.help = -1;
  }

  /** 기록실: 몬스터 도감 (the original book screens) or an archive page; Esc there comes back here */
  private recordsKey(k: number): void {
    const n = RECORD_ROWS.length;
    if (k === AVK.UP) this.records = (this.records + n - 1) % n;
    else if (k === AVK.DOWN) this.records = (this.records + 1) % n;
    else if (k === AVK.OK && this.records === 0) { this.book = 0; this.bookDetail = false; }
    else if (k === AVK.OK) this.archive = this.newArchive(this.records - 1);
    else if (k === AVK.CLR) this.records = -1;
  }

  private bookKey(k: number): void {
    if (this.bookDetail) {
      if (k === AVK.UP) this.scroll.y = Math.max(0, this.scroll.y - 12);
      else if (k === AVK.DOWN) this.scroll.y += 12;                       // the renderer clamps at the end
      else if (k === AVK.OK || k === AVK.CLR) this.bookDetail = false;
      return;
    }
    if (k === AVK.UP) this.book = (this.book + 39) % 40;
    else if (k === AVK.DOWN) this.book = (this.book + 1) % 40;
    else if (k === AVK.LEFT) this.book = Math.max(0, this.book - 6);
    else if (k === AVK.RIGHT) this.book = Math.min(39, this.book + 6);
    else if (k === AVK.OK && this.fs!.story.book[this.book]) { this.bookDetail = true; this.scroll.y = 0; }
    else if (k === AVK.CLR) this.book = -1;
  }

  private settingKey(k: number): void {
    const o = this.ctx.options, n0 = this.settingRows;
    if (this.cur >= n0) this.cur = 0;
    if (k === AVK.UP) this.cur = (this.cur + n0 - 1) % n0;
    else if (k === AVK.DOWN) this.cur = (this.cur + 1) % n0;
    else if (this.cur >= 5 && this.extraRows[this.cur - 5] !== 'full') {
      if (k === AVK.OK || k === AVK.RIGHT) {
        const kind = this.extraRows[this.cur - 5];
        if (kind === 'keys') this.keys = this.newKeys();
        else if (kind === 'dev') this.devp = this.newDev();
        else this.conv = this.newConvenience();
      }
      else if (k === AVK.CLR) { saveOptions(o); this.setting = false; }
    }
    else if (this.cur >= 5 && (k === AVK.LEFT || k === AVK.RIGHT || k === AVK.OK)) {   // 풀스크린 on / off
      o.fullscreen ^= 1;
      o.fullscreenSet = 1;                                             // the player's choice from now on (not the touch default)
      this.ctx.applyOptions();
      vibrate(o.vibration);
    }
    else if (k === AVK.LEFT || k === AVK.RIGHT || k === AVK.OK) {
      const key = OPTION_KEYS[this.cur], n = OPTION_COUNTS[this.cur];
      o[key] = (o[key] + (k === AVK.LEFT ? n - 1 : 1)) % n;
      this.ctx.applyOptions();
      vibrate(o.vibration);                                            // FUN_00045ea4: after every value change
    } else if (k === AVK.CLR) {
      saveOptions(o);
      this.setting = false;
    }
  }
}
