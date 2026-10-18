// Option tab 0x23 (FUN_0005ad88 / keys FUN_000567e8) and settings 0x27 (FUN_0005abac -> FUN_0002de7c,
// keys FUN_00055f94 -> FUN_00045ea4), analysis/features/ui-tabs.md §0.9.
// Help 0x26 (FUN_0005d890) and the monster book 0x32 / 0x33 (FUN_000598ac / FUN_0005cda8), misc-systems.md §8.
// Not in the original: the 몬스터도감 row is 기록실, a list of the monster book and the archive pages (archive.ts).
// The state and keys are core/menu/optionTab.ts; this draws them.
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { OPTION_KEYS } from '../../core/save/options';
import type { GameContext } from './scene';
import type { Ui } from '../render/ui';
import { button, cmfFrame, cSprite, gt, h, menuList, sprite, type VChild, type VNode } from '../render/view';
import { clipImage, DEFAULT_EQUIP } from '../render/sprites';
import type { Cmf } from '../../core/data/assets';
import { KeyMapPanel } from './keyMap';
import { ConveniencePanel } from './convenience';
import { DevPanel } from './devPanel';
import { ArchivePanel } from './archive';
import { RECORD_ROWS } from '../../core/menu/archive';
import { OptionTabLogic } from '../../core/menu/optionTab';

const GREY565 = 0x632c;          // 0x666666

export class OptionTab extends OptionTabLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly fs: FieldScene;

  declare protected keys: KeyMapPanel | null;
  declare protected conv: ConveniencePanel | null;
  declare protected devp: DevPanel | null;
  declare protected archive: ArchivePanel | null;

  constructor(ctx: GameContext, fs?: FieldScene) {
    super(ctx, fs);
    void ctx.assets.cmf('cmf_status').then((c) => { this.statusCmf = c; });
  }

  protected newKeys(): KeyMapPanel { return new KeyMapPanel(this.ctx); }
  protected newConvenience(): ConveniencePanel { return new ConveniencePanel(this.ctx); }
  protected newDev(): DevPanel { return new DevPanel(); }
  protected newArchive(page: number): ArchivePanel { return new ArchivePanel(this.ctx, this.fs!, page); }

  /** cmf_status for the status-effect help page (loaded on first use) */
  private statusCmf: Cmf | null = null;

  draw(u: Ui): void {
    const view = this.keys ? this.keys.view() : this.conv ? this.conv.view() : this.devp ? this.devp.view() : this.archive ? this.archive.view() : this.help >= 0 ? this.helpView()
      : this.book >= 0 ? (this.bookDetail ? this.bookDetailView() : this.bookView())
      : this.records >= 0 ? this.recordsView() : this.setting ? this.settingView() : this.mainView();
    u.mount('tab', 'option', view);
  }

  private mainView(): VNode {
    const t = this.ctx.assets.text;
    const label = (i: number) => (i === 3 ? '기록실' : t[0x14f + i] ?? '');      // 몬스터도감 → 기록실 (not in the original)
    return menuList(Array.from({ length: 5 }, (_, i) => button(gt(label(i)), {
      sel: i === this.sel, on: () => { if (this.sel === i) return [AVK.OK]; this.sel = i; },
    })), gt(this.sel === 3 ? '도감·보스 기록·도전과제·출석을 봅니다.' : t[0x13f + this.sel] ?? ''));
  }

  private recordsView(): VNode {
    const help = ['몬스터별 처치 기록과 정보를 봅니다.', '얻은 적 있는 아이템을 봅니다.', '보스 처치 기록과 보스 러시입니다.',
      '원본과 추가 도전과제를 봅니다.', '출석 보상과 심연 기록을 봅니다.'];
    return menuList(RECORD_ROWS.map((name, i) => button(gt(name), {
      sel: i === this.records, on: () => { if (this.records === i) return [AVK.OK]; this.records = i; },
    })), gt(help[this.records] ?? ''));
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
    this.extraRows.forEach((kind, j) => {
      const i = 5 + j, cur = this.cur === i;
      if (kind !== 'full') {
        rows.push(h(`div.v-row.v-opt-set${cur ? '.cur' : ''}`, { on: () => { if (this.cur === i) return [AVK.OK]; this.cur = i; } },
          gt(kind === 'keys' ? '키 설정' : kind === 'dev' ? '개발자 모드' : '편의 설정', { cls: 'v-opt-label' }),
          h('div.v-row.v-grow.v-center', null, h('span.v-opt-value.on', null,
            kind === 'keys' ? '키보드 / 패드 ▶' : kind === 'dev' ? '경험치 · 드랍 배율 ▶' : '대사 · 소리 · 화면 ▶'))));
        return;
      }
      // 풀스크린: the same on / off values (0x1b / 0x1c) as the original rows
      rows.push(h(`div.v-row.v-opt-set${cur ? '.cur' : ''}`, { on: () => { this.cur = i; } },
        gt('풀스크린', { cls: 'v-opt-label' }),
        h('div.v-row.v-grow.v-center', { style: 'gap:10px' },
          h('span.v-opt-arrow', { on: () => { this.cur = i; return [AVK.LEFT]; } }, cur && cSprite(a, 9)),
          h('div.v-row.v-grow.v-center', { style: 'gap:14px' }, [0, 1].map((k) =>
            h(`span.v-opt-value${o.fullscreen === k ? '.on' : ''}`, { on: () => { this.cur = i; if (o.fullscreen !== k) return [AVK.RIGHT]; } }, t[0x1b + k] ?? ''))),
          h('span.v-opt-arrow', { on: () => { this.cur = i; return [AVK.RIGHT]; } }, cur && cSprite(a, -9)))));
    });
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px' },
      h('div.v-box.v-heading', null, gt(t[0xdf] ?? '')),
      h(`div.v-box.v-col.v-grow${rows.length > 7 ? '.v-opt-dense' : ''}`, { style: 'padding:6px 8px;justify-content:space-around' }, rows));
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
      case 22: return h('div.v-col.v-center.v-grow', null, para(0x4e4));   // centred in the body (a .v-fill, absolute, covered the pager)
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
