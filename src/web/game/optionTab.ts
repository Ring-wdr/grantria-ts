// Option tab 0x23 (FUN_0005ad88 / keys FUN_000567e8) and settings 0x27 (FUN_0005abac -> FUN_0002de7c,
// keys FUN_00055f94 -> FUN_00045ea4), analysis/features/ui-tabs.md §0.9.
// Help 0x26 (FUN_0005d890) and the monster book 0x32 / 0x33 (FUN_000598ac / FUN_0005cda8), misc-systems.md §8.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { OPTION_COUNTS, OPTION_KEYS, saveOptions } from '../../core/save/options';
import { vibrate } from '../vibrate';
import type { GameContext } from './scene';
import type { Ui } from '../render/ui';
import { button, cmfFrame, cSprite, gt, h, menuList, sprite, type ScrollRef, type VChild, type VNode } from '../render/view';
import { clipImage, DEFAULT_EQUIP } from '../render/sprites';
import type { Cmf } from '../../core/data/assets';

const GREY565 = 0x632c;          // 0x666666

export class OptionTab {
  private sel = 0;
  /** settings screen 0x27 open, with its row cursor */
  private setting = false;
  private cur = 0;
  private t = 0;
  /** request for the menu owner: save (popup 8) or quit (popup 10) */
  request: 'save' | 'quit' | null = null;
  /** sub screens: help page, monster book list cursor / detail */
  private help = -1;
  private book = -1;
  private bookDetail = false;
  private scroll: ScrollRef = { y: 0 };

  /** cmf_status for the status-effect help page (loaded on first use) */
  private statusCmf: Cmf | null = null;

  constructor(private ctx: GameContext, private fs?: FieldScene) {
    void ctx.assets.cmf('cmf_status').then((c) => { this.statusCmf = c; });
  }

  get busy(): boolean { return this.setting || this.help >= 0 || this.book >= 0; }

  /** open the settings screen directly (title state 0x0C) */
  openSettings(): this { this.setting = true; this.cur = 0; return this; }
  /** open the help pages directly (title state 0x0D) */
  openHelp(): this { this.help = 0; return this; }

  update(presses: number[]): boolean {
    this.t++;
    for (const k of presses) {
      if (this.help >= 0) { this.helpKey(k); continue; }
      if (this.book >= 0) { this.bookKey(k); continue; }
      if (this.setting) this.settingKey(k);
      else if (k === AVK.UP) this.sel = (this.sel + 4) % 5;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 5;
      else if (k === AVK.OK) {
        if (this.sel === 0) this.request = 'save';
        else if (this.sel === 1) this.help = 0;
        else if (this.sel === 2) { this.setting = true; this.cur = 0; }
        else if (this.sel === 3 && this.fs) { this.book = 0; this.bookDetail = false; }
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

  private bookKey(k: number): void {
    if (this.bookDetail) {
      if (k === AVK.UP) this.scroll.y = Math.max(0, this.scroll.y - 12);
      else if (k === AVK.DOWN) this.scroll.y += 12;                       // the browser clamps at the end
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
    const o = this.ctx.options;
    if (k === AVK.UP) this.cur = (this.cur + 4) % 5;
    else if (k === AVK.DOWN) this.cur = (this.cur + 1) % 5;
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

  draw(u: Ui): void {
    const view = this.help >= 0 ? this.helpView() : this.book >= 0 ? (this.bookDetail ? this.bookDetailView() : this.bookView())
      : this.setting ? this.settingView() : this.mainView();
    u.mount('tab', 'option', view);
  }

  private mainView(): VNode {
    const t = this.ctx.assets.text;
    return menuList(Array.from({ length: 5 }, (_, i) => button(gt(t[0x14f + i] ?? ''), {
      sel: i === this.sel, on: () => { if (this.sel === i) return [AVK.OK]; this.sel = i; },
    })), gt(t[0x13f + this.sel] ?? ''));
  }

  /** settings 0x27: label, then the values (the current one bright), arrows on the cursor row */
  private settingView(): VNode {
    const o = this.ctx.options, a = this.ctx.assets, t = a.text;
    const rows = Array.from({ length: 5 }, (_, i) => {
      const v = o[OPTION_KEYS[i]], cur = this.cur === i;
      const values = i === 2
        ? [gt(t[0x1b67 + v] ?? '', { pen: cur ? 0xffff : GREY565 })]
        : [0, 1].map((k) => h(`span.v-opt-value${v === k ? '.on' : ''}`, { on: () => { this.cur = i; if (o[OPTION_KEYS[i]] !== k) return [AVK.RIGHT]; } }, t[0x1b + k] ?? ''));
      return h(`div.v-row.v-opt-set${cur ? '.cur' : ''}`, { on: () => { this.cur = i; } },
        gt(t[0x164 + i] ?? '', { cls: 'v-opt-label' }),
        h('div.v-row.v-grow.v-center', { style: 'gap:10px' },
          h('span.v-opt-arrow', { on: () => { this.cur = i; return [AVK.LEFT]; } }, cur && cSprite(a, 9)),
          h('div.v-row.v-grow.v-center', { style: 'gap:14px' }, values),
          h('span.v-opt-arrow', { on: () => { this.cur = i; return [AVK.RIGHT]; } }, cur && cSprite(a, -9))));
    });
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px' },
      h('div.v-box.v-heading', null, gt(t[0xdf] ?? '')),
      h('div.v-box.v-col.v-grow', { style: 'padding:6px 8px;justify-content:space-around' }, rows));
  }

  /**
   * help page (FUN_0005d890): title 0xe7 + page; page 23 shows 0xe8 + page (게임심의정보, 게임문의 is
   * skipped) and page 24 0x1c20 (운영정책안내). The body follows FUN_000337f4.
   */
  private helpView(): VNode {
    const t = this.ctx.assets.text, p = this.help;
    const title = p < 23 ? 0xe7 + p : p === 23 ? 0xe8 + p : 0x1c20;
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px' },
      h('div.v-box.v-heading', null, gt(t[title] ?? '')),
      h('div.v-box.v-grow.v-scroll.help-body', null, this.helpBody(p)),
      h('div.v-row.v-pager', null,
        h('span.v-page-btn', { on: () => [AVK.LEFT] }, '◀'), `${p + 1}/25`, h('span.v-page-btn', { on: () => [AVK.RIGHT] }, '▶')));
  }

  /** FUN_000337f4 body of help page i */
  private helpBody(i: number): VChild {
    const a = this.ctx.assets, t = a.text, frame = this.t;
    const para = (id: number) => gt(t[id] ?? '', { cls: 'help-text' });
    switch (i) {
      case 1:                                                      // controls: the touch text 0x13c in touch mode
        return para(this.ctx.input.device === 'touch' ? 0x13c : 0x116);
      case 2: case 3: case 4: {                                    // character: idle animation, name, description 0x129 + i
        const name = `cmf_c${i - 2}`, cmf = this.ctx.cmfs[name];
        return [
          h('div.v-row.help-char', null,
            h('div.help-sprite', null, cmf && cmfFrame(cmf, frame % 6, 30, 58, (c) => clipImage(a, name, cmf, c, 0, DEFAULT_EQUIP))),
            h('div.v-grow.v-center.v-col', null, gt(t[0x115 + i] ?? ''))),
          para(0x129 + i),
        ];
      }
      case 8:                                                      // points: AP / SP / trait icons beside their paragraphs
        return h('div.help-icons', null,
          [[0xb7, 0x58, 15], [0xc5, 0x58, 65], [0xef, 0x3f, 115]].map(([sx, sy, y]) =>
            sprite('c', sx, sy, 14, 14, { style: `position:absolute;left:0;top:${y}px` })),
          para(0x11d));
      case 9: {                                                    // status effects: the character with each status icon
        const sc = this.statusCmf, cls = this.fs?.model.cls ?? 0, name = `cmf_c${cls}`, cmf = this.ctx.cmfs[name];
        // the original lines each 4-line entry of 0x11e up with a sprite row 0x34 apart; here each entry
        // ('|@|@'-separated) sits beside its sprite so the font's line height cannot shift them
        const entries = (t[0x11e] ?? '').replace(/^\|@/, '').split('|@|@');
        return h('div.v-col.help-status', null, entries.slice(0, 4).map((e, k) => h('div.v-row', { style: 'gap:6px' },
          h('div.help-sprite.small', null,
            cmf && cmfFrame(cmf, frame % 4, 22, 40, (c) => clipImage(a, name, cmf, c, 0, DEFAULT_EQUIP)),
            sc && cmfFrame(sc, 6 * k + (frame % 6), 22, 40, () => 'es')),   // FUN_00024a5c: status frames from image 0x2F es
          gt(e, { cls: 'help-text v-grow' }))));
      }
      case 10:                                                     // resistances: text, then the three icons with their labels
        return [para(0x11f), h('div.v-col.help-resist', null, [0, 1, 2].map((k) =>
          h('div.v-row', { style: 'gap:8px' }, cSprite(a, 3 + k), gt((t[0x12f] ?? '').split('|@|@')[k] ?? ''))))];
      case 22: return h('div.v-col.v-center.v-fill', null, para(0x4e4));
      case 23:                                                     // 게임심의정보: the rating table 0x130..0x13b
        return h('div.help-table', null, [0, 1, 2, 3, 4, 5].map((r) =>
          [gt(t[0x130 + 2 * r] ?? ''), gt(t[0x131 + 2 * r] ?? '')]));
      case 24: return para(0x1c21);
      default: return para(0x115 + i);
    }
  }

  /** 0x32: 6 rows per page, names text 0x3e4 + i, unknown "???" (0x1a3a) */
  private bookView(): VNode {
    const t = this.ctx.assets.text, book = this.fs!.story.book, page = Math.floor(this.book / 6);
    const rows = [];
    for (let r = 0; r < 6 && page * 6 + r < 40; r++) {
      const i = page * 6 + r;
      rows.push(button(gt(book[i] ? t[0x3e4 + i] ?? '' : t[0x1a3a] ?? '???'), {
        sel: i === this.book, on: () => { if (this.book === i) return [AVK.OK]; this.book = i; },
      }));
    }
    return h('div.v-col.v-fill.v-tab', null,
      h('div.v-col.v-grow', { style: 'gap:4px;padding:2px 6px' }, rows),
      h('div.v-row.v-pager', null,
        h('span.v-page-btn', { on: () => [AVK.LEFT] }, '◀'),
        gt((t[0x1a6f] ?? '%d / %d').replace('%d', String(page + 1)).replace('%d', '7')),
        h('span.v-page-btn', { on: () => [AVK.RIGHT] }, '▶')));
  }

  /** 0x33: habitat, drop material, attribute, description, kills, deaths (UP / DOWN scroll 12 px) */
  private bookDetailView(): VNode {
    const fs = this.fs!, a = this.ctx.assets, t = a.text, i = this.book, b = fs.story.book[i]!;
    const drop = a.s8(0x23e3b + i);
    const line = (label: string, value: string) => h('div.v-row.v-kv', null, h('span.v-grow', null, label), gt(value));
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px', on: () => [AVK.OK] },
      h('div.v-box.v-heading', null, gt(t[0x3e4 + i] ?? '')),
      h('div.v-box.v-grow.v-scroll', { style: 'padding:6px 8px', scroll: this.scroll },
        h('div.v-col', null,
          line('서식지', t[470 + b.z] ?? ''),
          line('드랍재료템', drop < 0 ? '없음.' : t[0x7fc + fs.db.model(0x12, drop, 0)] ?? ''),
          line('몬스터 속성', t[0x4a8 + (a.d8(0x251a3 + (i + 3) * 12) || 0)] ?? ''),
          line('퇴치한 횟수', String(b.k)),
          line('죽은 횟수', String(b.d)),
          h('div.v-rule'),
          gt(t[0x453 + i] ?? '', { cls: 'v-left' }))));
  }

  drawOverlay(): void { /* no absolute-coordinate overlays */ }
}
