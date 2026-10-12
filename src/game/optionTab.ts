// Option tab 0x23 (FUN_0005ad88 / keys FUN_000567e8) and settings 0x27 (FUN_0005abac -> FUN_0002de7c,
// keys FUN_00055f94 -> FUN_00045ea4), analysis/features/ui-tabs.md §0.9.
// Help 0x26 (FUN_0005d890) and the monster book 0x32 / 0x33 (FUN_000598ac / FUN_0005cda8), misc-systems.md §8.
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import { OPTION_COUNTS, OPTION_KEYS, saveOptions } from './options';
import type { GameContext } from './scene';
import type { Ui } from './ui';

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
  private scroll = 0;

  constructor(private ctx: GameContext, private fs?: FieldScene) {}

  get busy(): boolean { return this.setting || this.help >= 0 || this.book >= 0; }

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
      if (k === AVK.UP) this.scroll = Math.max(0, this.scroll - 12);
      else if (k === AVK.DOWN) this.scroll += 12;
      else if (k === AVK.OK || k === AVK.CLR) this.bookDetail = false;
      return;
    }
    if (k === AVK.UP) this.book = (this.book + 39) % 40;
    else if (k === AVK.DOWN) this.book = (this.book + 1) % 40;
    else if (k === AVK.LEFT) this.book = Math.max(0, this.book - 6);
    else if (k === AVK.RIGHT) this.book = Math.min(39, this.book + 6);
    else if (k === AVK.OK && this.fs!.story.book[this.book]) { this.bookDetail = true; this.scroll = 0; }
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
    } else if (k === AVK.CLR) {
      saveOptions(o);
      this.setting = false;
    }
  }

  draw(u: Ui): void {
    if (this.help >= 0) { this.drawHelp(u); return; }
    if (this.book >= 0) { if (this.bookDetail) this.drawBookDetail(u); else this.drawBook(u); return; }
    if (this.setting) { this.drawSetting(u); return; }
    u.glow(16, this.sel * 32 + 42, 188, 26, this.t);
    for (let i = 0; i < 5; i++) {
      u.button(18, 44 + 32 * i, 184, 22, 3, i === this.sel ? 1 : 0);
      u.hit(18, 42 + 32 * i, 184, 28, () => { if (this.sel === i) return [AVK.OK]; this.sel = i; });
      u.textId(0x14f + i, 110, 47 + 32 * i, 'center');
    }
    u.roundFill(8, 195, 204, 16, 0, 1);
    u.textId(0x13f + this.sel, 110, 197, 'center');
  }

  private drawSetting(u: Ui): void {
    const o = this.ctx.options;
    u.roundFill(14, 33, 193, 18, 0, 1);
    u.textId(0xdf, 90, 35);
    u.roundFill(14, 53, 193, 156, 0, 1);
    for (let i = 0; i < 5; i++) {
      const y = 68 + 26 * i, v = o[OPTION_KEYS[i]];
      u.hit(14, y - 6, 100, 26, () => { this.cur = i; });
      u.hit(114, y - 6, 46, 26, () => { this.cur = i; return [AVK.LEFT]; });
      u.hit(160, y - 6, 47, 26, () => { this.cur = i; return [AVK.RIGHT]; });
      u.textId(0x164 + i, 37, y, 'center');
      if (i === 2) {
        u.textId(0x1b67 + v, 133, y, 'center', { pen: this.cur === i ? 0xffff : GREY565 });
      } else {
        const t = this.ctx.assets.text;
        for (let k = 0; k < 2; k++) {
          const rgb = v === k ? 0xffffff : 0x666666;
          u.cfontCenter(t[0x1b + k] ?? '', k ? 154 : 104, y + 2, 1,
            { tint: [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255], amount: 32 });
        }
      }
      if (this.cur === i) { u.cSprite(9, 71, y + 1); u.cSprite(-9, 189, y + 1); }
    }
  }

  /** help page: title text 0xe7 + page (24 = 0x1c20), body text 0x115 + page */
  private drawHelp(u: Ui): void {
    const t = this.ctx.assets.text, p = this.help;
    u.roundFill(14, 33, 193, 18, 0, 1);
    u.string(t[p === 24 ? 0x1c20 : 0xe7 + p] ?? '', 110, 35, 'center');
    u.roundFill(14, 53, 193, 140, 0, 1);
    u.hit(0, 30, 110, 180, () => [AVK.LEFT]);
    u.hit(110, 30, 110, 180, () => [AVK.RIGHT]);
    u.paragraph(t[0x115 + p] ?? '', 18, 60, 186, 'left');
    u.string(`${p + 1}/25`, 110, 197, 'center');
  }

  /** 0x32: 6 rows per page, names text 0x3e4 + i, unknown "???" (0x1a3a) */
  private drawBook(u: Ui): void {
    const t = this.ctx.assets.text, book = this.fs!.story.book, page = Math.floor(this.book / 6);
    u.string((t[0x1a6f] ?? '%d / %d').replace('%d', String(page + 1)).replace('%d', '7'), 110, 197, 'center');
    for (let r = 0; r < 6; r++) {
      const i = page * 6 + r;
      if (i >= 40) break;
      if (i === this.book) u.glow(16, 0x21 + 26 * r, 188, 26, this.t);
      u.button(18, 0x23 + 26 * r, 184, 22, 3, i === this.book ? 1 : 0);
      u.hit(18, 0x21 + 26 * r, 184, 26, () => { if (this.book === i) return [AVK.OK]; this.book = i; });
      u.string(book[i] ? t[0x3e4 + i] ?? '' : t[0x1a3a] ?? '???', 0x6e, 0x26 + 26 * r, 'center');
    }
  }

  /** 0x33: habitat, drop material, attribute, description, kills, deaths */
  private drawBookDetail(u: Ui): void {
    const fs = this.fs!, a = this.ctx.assets, t = a.text, i = this.book, b = fs.story.book[i]!, s = this.scroll;
    u.roundFill(14, 33, 193, 18, 0, 1);
    u.string(t[0x3e4 + i] ?? '', 110, 35, 'center');
    u.roundFill(14, 53, 193, 140, 0, 1);
    u.hit(0, 30, 220, 80, () => [AVK.UP]);
    u.hit(0, 110, 220, 100, () => [AVK.DOWN]);
    let y = 60 - s;
    const line = (label: string, value: string) => { if (y >= 55 && y < 185) { u.string(label, 20, y); u.string(value, 200, y, 'right'); } y += 16; };
    line('서식지', t[470 + b.z] ?? '');
    const drop = a.s8(0x23e3b + i);
    line('드랍재료템', drop < 0 ? '없음.' : t[0x7fc + fs.db.model(0x12, drop, 0)] ?? '');
    line('몬스터 속성', t[0x4a8 + (a.d8(0x251a3 + (i + 3) * 12) || 0)] ?? '');
    line('퇴치한 횟수', String(b.k));
    line('죽은 횟수', String(b.d));
    u.fill(18, y, 184, 1, 0x9ecad7);
    y += 6;
    if (y < 185) u.paragraph(t[0x453 + i] ?? '', 20, y, 180, 'left');
  }

  drawOverlay(): void { /* no absolute-coordinate overlays */ }
}
