// Local ranking (title 게임순위, online.md §6): the original registered a slot on the server (net 1)
// and paged a server list (0x36) with a detail view (0x37). Here registrations are kept locally per
// slot and ranked by the original score formula FUN_00061864.
// The state and keys are core/scenes/ranking.ts; this draws them.
import { AVK } from '../input/input';
import { popupPaint } from './popup';
import { loadGamedata } from '../../core/save/save';
import type { GameContext } from './scene';
import { frozenTitle, render } from './screens';
import type { Ui } from '../render/ui';
import { equipLook } from '../../core/render';
import { button, gt, h, padBadge, sprite, type VNode } from '../render/view';
import { playTime } from '../../core/scenes/title';
import { RankingLogic } from '../../core/scenes/ranking';
import '../styles/screens-misc.css';

export class RankingScene extends RankingLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    super(ctx);
    ctx.input.uiMode = true; ctx.input.zones = [];
  }

  override update(presses: number[]): void {
    for (const tap of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(tap.x, tap.y); if (k) presses = [...presses, ...k]; }
    super.update(presses);
  }

  readonly wide = true;                                               // over the title backdrop

  draw(): void {
    render(this.ctx, () => {
      frozenTitle(this.ctx);
      const u = this.ctx.ui;
      u.pushCenter220();
      if (this.state === 0x35) this.drawSlots(u);
      else if (this.state === 0x36) u.view('rank-list', 0, 0, 0xdc, 0xd4, this.listView());
      else u.view('rank-detail', 0, 0, 0xdc, 0xd4, this.detailView());
      u.pop();
      u.closeButton();
    }, this.overlays.size ? () => this.overlays.draw(popupPaint(this.ctx)) : undefined);
  }

  /** FUN_00034028 / FUN_00033dcc: three slot cards (class, lap mark, level, zone, play time); the
   *  walking character (cmf animation) and the EMPTY SPACE c-font stay original art on top. */
  private drawSlots(u: Ui): void {
    const t = this.ctx.assets.text, laps = loadGamedata().lap;
    const cards = this.slots.slice(0, 3).map((sl, i) => h(`div.sm-win.u-window.sm-slot${this.cur === i ? '.v-sel' : ''}`, {
      on: () => { if (this.cur === i) return [AVK.OK]; this.cur = i; },
    }, corners(), sl && h('div.v-col.sm-slot-info', null,
      h('div.v-row', { style: 'gap:6px' },
        gt(t[0x3e1 + sl.cls] ?? ''),
        (laps[i] ?? 0) >= 2 && gt((laps[i] ?? 0) >= 4 ? '3회차' : t[6716] ?? '', { pen: 0xf800 }),
        h('span.v-grow'),
        gt(t[6717] ?? ''), h('span.sm-num', null, String(sl.level))),
      h('div.v-grow.v-center.v-row', null, gt(t[0x1d6 + (sl.zone ?? 0)] ?? '')),
      h('div.sm-time', null, playTime(sl.playTicks)))));
    u.view('rank-slots', 0, 24, 219, 3 * 66 - 3, h('div.v-col.v-fill', { style: 'gap:3px' }, cards));
    // header like the list's (sm-head): '0' opens the list without registering — the original had no button
    // for it (keypad only), so it gets the list's own title 0x19D9 "랭킹 보기" as a side button
    u.view('rank-open', 0, 0, 219, 21, h('div.v-box.v-row.sm-head.sm-slot-head', null,
      gt('등록할 슬롯 선택', { pen: 0x9cd3, cls: 'v-grow v-left sm-head-hint' }),
      button([gt(t[0x19d9] ?? ''), padBadge(this.ctx.input, AVK.K3, 'v-pad-corner')], { sel: true, glow: false, cls: 'sm-head-side', on: () => [AVK.K0] })));
    for (let i = 0; i < 3; i++) {
      const y = 22 + 66 * i, sl = this.slots[i];
      if (!sl) { u.cfont('EMPTY SPACE', 0x56, y + 0x1b, 0); continue; }
      const cmfName = `cmf_c${sl.cls}`;
      u.frame(cmfName, this.ctx.cmfs[cmfName], this.t % 6, sl.cls === 2 ? 0x23 : 0x26, y + (sl.cls === 2 ? 0x3a : 0x30), undefined, undefined, equipLook(sl.inv?.equip));
    }
  }

  /** FUN_00031a44: title, 1위부터 / 내랭킹 toggle, three entries per page, page counter */
  private listView(): VNode {
    const t = this.ctx.assets.text, rows = this.sorted(), pages = Math.max(1, Math.ceil(rows.length / 3));
    const kv = (label: number, value: number, pen?: number) => h('div.v-row.sm-kv', null,
      gt(t[label] ?? '', { cls: 'v-grow' }), gt(String(value), { pen }));
    const cards = Array.from({ length: 3 }, (_, i) => {
      const e = rows[this.page * 3 + i];
      return h(`div.sm-win.u-window.sm-entry${i === this.sel ? '.v-sel' : ''}`, {
        on: () => { if (this.sel === i) return [AVK.OK]; this.sel = i; },
      }, corners(), e && h('div.v-col.sm-entry-body', null,
        h('div.v-row', { style: 'gap:6px' },
          h('span.sm-rank', null, gt(t[6727] ?? ''), h('span.sm-num', null, String(this.page * 3 + i + 1))),
          gt(t[0x3e1 + e.cls] ?? '', { cls: 'v-grow' }),
          gt(t[6717] ?? ''), h('span.sm-num', null, String(e.level))),
        kv(6728, e.score, 0xffe0),
        h('div.sm-pair', null, kv(6729, e.dmg), kv(6730, e.def))));
    });
    return h('div.sm-win.u-window.v-col.v-fill.sm-panel', null, corners(),
      h('div.v-row.sm-head', null,
        h('span.sm-head-side'),
        gt(t[6617] ?? '', { cls: 'v-grow sm-title' }),
        button([gt(t[this.mine ? 6639 : 6638] ?? ''), padBadge(this.ctx.input, AVK.K3, 'v-pad-corner')], { sel: true, glow: false, cls: 'sm-head-side', on: () => [AVK.K0] })),
      h('div.v-col.v-grow', { style: 'gap:4px' }, cards),
      h('div.v-row.v-pager', null,
        h('span.v-page-btn', { on: () => [AVK.STAR] }, '◀'), `${this.page + 1}/${pages}`, h('span.v-page-btn', { on: () => [AVK.POUND] }, '▶')));
  }

  /** FUN_0003177c: class / level, HP MP ATK DEF, base stats, skill button, six equipment cells, item name;
   *  FUN_00027218 skill list on top */
  private detailView(): VNode {
    const t = this.ctx.assets.text, e = this.sorted()[this.page * 3 + this.sel];
    const kv = (label: string, value: number) => h('div.v-row.sm-kv', null, gt(label, { cls: 'v-grow' }), gt(String(value)));
    const body = e && [
      h('div.v-box.v-row.sm-detail-head', null,
        gt(t[0x3e1 + e.cls] ?? '', { pen: 0xffe0, cls: 'v-grow' }), gt(t[6717] ?? ''), h('span.sm-num', null, String(e.level))),
      h('div.v-box.sm-pair.sm-block', null,
        kv(t[6731] ?? '', e.hp), kv(t[6732] ?? '', e.mp), kv(t[6729] ?? '', e.dmg), kv(t[6730] ?? '', e.def)),
      h('div.v-row', { style: 'gap:6px;align-items:stretch' },
        h('div.v-box.sm-pair.sm-block.v-grow', null, e.stats.map((v, k) => kv(t[21 + k] ?? '', v))),
        h('div.v-col.v-center', null, button([gt(t[6641] ?? ''), padBadge(this.ctx.input, AVK.K3, 'v-pad-corner')], { sel: this.skillView, glow: false, cls: 'sm-skill-btn', on: () => [AVK.K0] }))),
      h('div.v-row.sm-equips', null, e.equip.map((it, k) => {
        const r = it && this.db.iconRect(it.icon);
        return h(`div.sm-eq${k === this.eq ? '.v-sel.cur' : ''}`, { on: () => { this.eq = k; } }, r && sprite(r.image, r.sx, r.sy, 16, 16));
      })),
      h('div.v-box.v-note', null, gt(e.equip[this.eq]?.name ?? '')),
      this.skillView && h('div.v-modal', { on: () => [AVK.K0] },
        h('div.sm-win.u-window.sm-skills', null, corners(),
          (e.skills ?? []).map((lv, k) => h('div.v-row.sm-kv', null,
            h('span.v-grow', null, `${k < 9 ? 'A' : 'P'}${k < 9 ? k + 1 : k - 8}`), `LV ${lv}`)))),
    ];
    return h('div.sm-win.u-window.v-col.v-fill.sm-panel', null, corners(),
      h('div.v-row.sm-head', null, gt(t[6640] ?? '', { cls: 'v-grow sm-title' })),
      body);
  }
}

/** the four c.pxl corners of a window (FUN_000fb054), positioned by ui.css .u-window > .c0..c3 */
function corners(): VNode[] {
  return [0, 1, 2, 3].map((i) => sprite('c', 104, 37, 8, 8, { cls: `u-corner c${i}` }));
}
