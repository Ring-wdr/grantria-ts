// Local ranking (title 게임순위, online.md §6): the original registered a slot on the server (net 1)
// and paged a server list (0x36) with a detail view (0x37). Here registrations are kept locally per
// slot and ranked by the original score formula FUN_00061864.
import { AVK } from './input';
import { ItemDb, type Item } from './items';
import { Popup } from './popup';
import { derive, type Derived } from './rules';
import { SLOT_COUNT, loadGamedata, loadSlot, type SaveData } from './save';
import type { GameContext, Scene } from './scene';
import { frozenTitle, playTime, render, TitleScene } from './screens';
import type { Ui } from './ui';
import { button, gt, h, padBadge, sprite, type VNode } from './view';
import './css/screens-misc.css';

export interface RankEntry {
  slot: number;
  cls: 0 | 1 | 2;
  level: number;
  lap: number;
  score: number;
  dmg: number;
  def: number;
  hp: number;
  mp: number;
  stats: number[];
  equip: (Item | null)[];
  skills?: number[];
  at: number;
}

const KEY = 'grantria.ranking';
export function loadRanking(): RankEntry[] {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) as RankEntry[] : []; } catch { return []; }
}
function saveRanking(list: RankEntry[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

/** FUN_00061864: Σ equipment (grade·10 + level) + 3·dimension clears + 3·Vermut kills + 10 per title + 100 on lap >= 2 (+300 above) */
export function rankScore(equip: (Item | null)[], lap: number, titles: number, clears = 0, vermut = 0): number {
  let s = 3 * clears + 3 * vermut;
  for (const it of equip) if (it) s += it.grade * 10 + it.level;
  if (lap >= 2) s += 100;
  if (lap > 2) s += 300;
  return s + titles * 10;
}

export class RankingScene implements Scene {
  private state: 0x35 | 0x36 | 0x37 = 0x35;
  private cur = 0;
  private page = 0;
  private sel = 0;
  private t = 0;
  private slots: (SaveData | null)[] = [];
  private list: RankEntry[] = loadRanking();
  private popup: { p: Popup; yes?: () => void } | null = null;
  private mine = false;
  private eq = 0;
  private skillView = false;
  private db: ItemDb;
  private ready = false;

  constructor(private ctx: GameContext) {
    ctx.input.uiMode = true; ctx.input.zones = [];
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i));
    this.db = new ItemDb(ctx.assets);
    void this.db.init().then(() => { this.ready = true; });
  }

  private sorted(): RankEntry[] { return [...this.list].sort((a, b) => b.score - a.score || a.at - b.at); }

  /** net 1 replaced: derive the slot's stats from its save and keep the entry */
  private register(i: number): void {
    const s = this.slots[i]!;
    const equip = s.inv?.equip ?? [];
    const d: Derived = derive({ cls: s.cls, level: s.level, stats: s.stats, skills: s.skills, equip }, this.db.equipTables());
    const lap = loadGamedata().lap[i] ?? 0;
    const titles = s.story?.titles?.length ?? 0;
    const e: RankEntry = { slot: i, cls: s.cls, level: s.level, lap, score: rankScore(equip, lap, titles, s.story?.dimClears ?? 0, s.story?.counters?.vermutKills ?? 0), dmg: d.atk, def: d.def,
      hp: d.maxHp, mp: d.maxMp, stats: s.stats, equip, skills: s.skills, at: Date.now() };
    this.list = [...this.list.filter((x) => x.slot !== i), e];
    saveRanking(this.list);
    const pos = this.sorted().indexOf(e);
    this.state = 0x36; this.page = Math.floor(pos / 3); this.sel = pos % 3;
  }

  update(presses: number[]): void {
    this.t++;
    for (const tap of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(tap.x, tap.y); if (k) presses = [...presses, ...k]; }
    if (this.popup) { const r = this.popup.p.handle(presses); if (r) { const p = this.popup; this.popup = null; if (r === 'yes') p.yes?.(); } return; }
    const rows = this.sorted(), pages = Math.max(1, Math.ceil(rows.length / 3));
    // '0' (list / 1위부터·내랭킹 / skill view) has no pad button: △ / Y stands in for it on these screens
    for (const k of presses.map((k) => (k === AVK.K3 ? AVK.K0 : k))) {
      if (this.state === 0x35) {                                      // FUN_00041b20
        if (k === AVK.UP) this.cur = (this.cur + 2) % 3;
        else if (k === AVK.DOWN) this.cur = (this.cur + 1) % 3;
        else if (k === AVK.OK && this.ready) {
          if (!this.slots[this.cur]) this.popup = { p: new Popup(this.ctx, 0x4f) };
          else { const i = this.cur; this.popup = { p: new Popup(this.ctx, 2), yes: () => this.register(i) }; }
        } else if (k === AVK.K0) { this.state = 0x36; this.page = 0; this.sel = 0; }
        else if (k === AVK.CLR) this.ctx.go(new TitleScene(this.ctx));
      } else if (this.state === 0x36) {                               // FUN_00043b04
        if (k === AVK.POUND) this.page = (this.page + 1) % pages;
        else if (k === AVK.STAR) this.page = (this.page + pages - 1) % pages;
        else if (k === AVK.K0) {                                      // 1위부터 <-> 내랭킹 (net 7)
          this.mine = !this.mine;
          const pos = this.mine ? rows.findIndex((e) => e.slot === this.cur) : 0;
          this.page = Math.max(0, Math.floor(pos / 3)); this.sel = Math.max(0, pos % 3);
        }
        else if (k === AVK.UP) this.sel = (this.sel + 2) % 3;
        else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 3;
        else if (k === AVK.OK && rows[this.page * 3 + this.sel]) { this.state = 0x37; this.eq = 0; this.skillView = false; }
        else if (k === AVK.CLR) this.ctx.go(new TitleScene(this.ctx));
      } else {                                                        // 0x37 FUN_00043a2c
        if (k === AVK.K0) this.skillView = !this.skillView;
        else if (k === AVK.LEFT) this.eq = (this.eq + 5) % 6;
        else if (k === AVK.RIGHT) this.eq = (this.eq + 1) % 6;
        else if (k === AVK.CLR || k === AVK.OK) { if (this.skillView) this.skillView = false; else this.state = 0x36; }
      }
    }
  }

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
    }, this.popup ? () => this.popup!.p.draw() : undefined);
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
        (laps[i] ?? 0) === 2 && gt(t[6716] ?? '', { pen: 0xf800 }),
        h('span.v-grow'),
        gt(t[6717] ?? ''), h('span.sm-num', null, String(sl.level))),
      h('div.v-grow.v-center.v-row', null, gt(t[0x1d6 + (sl.zone ?? 0)] ?? '')),
      h('div.sm-time', null, playTime(sl.playTicks)))));
    u.view('rank-slots', 0, 24, 219, 3 * 66 - 3, h('div.v-col.v-fill', { style: 'gap:3px' }, cards));
    // '0' opens the list without registering; the original had no button for it (keypad only)
    u.view('rank-open', 0, 0, 219, 20, h('div.v-row', { style: 'height:100%;justify-content:flex-end' },
      button([gt('순위 보기'), padBadge(this.ctx.input, AVK.K3, 'v-pad-corner')], { glow: false, style: 'height:18px;padding:0 8px', on: () => [AVK.K0] })));
    for (let i = 0; i < 3; i++) {
      const y = 22 + 66 * i, sl = this.slots[i];
      if (!sl) { u.cfont('EMPTY SPACE', 0x56, y + 0x1b, 0); continue; }
      const cmfName = `cmf_c${sl.cls}`;
      u.frame(cmfName, this.ctx.cmfs[cmfName], this.t % 6, sl.cls === 2 ? 0x23 : 0x26, y + (sl.cls === 2 ? 0x3a : 0x30));
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
