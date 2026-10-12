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
    for (const k of presses) {
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
      const u = this.ctx.ui, rows = this.sorted();
      u.pushCenter220();
      if (this.state === 0x35) {                                      // FUN_00034028 / FUN_00033dcc
        for (let i = 0; i < 3; i++) {
          const y = 22 + 66 * i, sl = this.slots[i];
          u.window(0, 24 + 66 * i, 219, 63);
          if (this.cur === i) u.slotGlow(2, y + 5, 0xd6, 0x39, this.t);
          u.hit(0, 24 + 66 * i, 219, 63, () => { if (this.cur === i) return [AVK.OK]; this.cur = i; });
          if (!sl) { u.cfont('EMPTY SPACE', 0x56, y + 0x1b, 0); continue; }
          const cmfName = `cmf_c${sl.cls}`;
          u.frame(cmfName, this.ctx.cmfs[cmfName], this.t % 6, sl.cls === 2 ? 0x23 : 0x26, y + (sl.cls === 2 ? 0x3a : 0x30));
          u.textId(0x3e1 + sl.cls, 77, y + 8);
          if ((loadGamedata().lap[i] ?? 0) === 2) u.textId(6716, 110, y + 8, 'left', { pen: 0xf800 });
          u.textId(6717, 172, y + 8);
          u.number(sl.level, 187, y + 8, 1);
          u.textId(0x1d6 + (sl.zone ?? 0), 145, y + 30, 'center');
          u.string(playTime(sl.playTicks), 218, y + 46, 'right');
        }
      } else if (this.state === 0x36) {                               // FUN_00031a44
        u.window(0, 0, 0xdc, 0xe8);
        u.textId(6617, 110, 5, 'center');
        u.button(158, 0, 62, 22, 3, 1); u.textId(this.mine ? 6639 : 6638, 189, 4, 'center'); u.hit(158, 0, 62, 22, () => [AVK.K0]);
        const pages = Math.max(1, Math.ceil(rows.length / 3));
        for (let i = 0; i < 3; i++) {
          const e = rows[this.page * 3 + i], y = 30 + 62 * i;
          u.window(4, y, 0xd4, 58);
          if (i === this.sel) u.slotGlow(6, y + 2, 0xd0, 54, this.t);
          u.hit(4, y, 0xd4, 58, () => { if (this.sel === i) return [AVK.OK]; this.sel = i; });
          if (!e) continue;
          u.textId(6727, 12, y + 6); u.number(this.page * 3 + i + 1, 50, y + 6, 1);
          u.textId(0x3e1 + e.cls, 80, y + 6);
          u.textId(6717, 150, y + 6); u.number(e.level, 165, y + 6, 1);
          u.textId(6728, 12, y + 22); u.string(String(e.score), 208, y + 22, 'right', { pen: 0xffe0 });
          u.textId(6729, 12, y + 38); u.string(String(e.dmg), 90, y + 38, 'right');
          u.textId(6730, 110, y + 38); u.string(String(e.def), 200, y + 38, 'right');
        }
        u.string(`${this.page + 1}/${pages}`, 110, 226 - 50, 'center');
      } else {                                                        // FUN_0003177c
        const e = rows[this.page * 3 + this.sel];
        u.window(0, 0, 0xdc, 0xe8);
        u.textId(6640, 110, 5, 'center');
        if (e) {
          u.textId(0x3e1 + e.cls, 15, 30); u.textId(6717, 150, 30); u.number(e.level, 165, 30, 1);
          u.textId(6731, 15, 50); u.string(String(e.hp), 90, 50, 'right');
          u.textId(6732, 110, 50); u.string(String(e.mp), 200, 50, 'right');
          u.textId(6729, 15, 66); u.string(String(e.dmg), 90, 66, 'right');
          u.textId(6730, 110, 66); u.string(String(e.def), 200, 66, 'right');
          e.stats.forEach((v, k) => { u.textId(21 + k, 15 + 70 * (k & 1), 105 + 15 * (k >> 1)); u.number(v, 60 + 70 * (k & 1), 105 + 15 * (k >> 1), 0); });
          u.button(145, 110, 62, 22, 3, this.skillView ? 1 : 0); u.textId(6641, 176, 114, 'center'); u.hit(145, 110, 62, 22, () => [AVK.K0]);
          e.equip.forEach((it, k) => {
            const x = 13 + 34 * k;
            u.bevel(x, 140, 26, 26, 0x354e73, 0);
            if (k === this.eq) u.glow(x - 2, 138, 30, 30, this.t);
            u.hit(x, 140, 26, 26, () => { this.eq = k; });
            if (it) { const r = this.db.iconRect(it.icon); u.image(r.image, r.sx, r.sy, 16, 16, x + 5, 145); }
          });
          const it = e.equip[this.eq];
          if (it) u.string(it.name, 110, 179, 'center');
          if (this.skillView) {                                       // FUN_00027218 skill view
            u.window(10, 40, 200, 150);
            (e.skills ?? []).forEach((lv, k) => u.string(`${k < 9 ? 'A' : 'P'}${k < 9 ? k + 1 : k - 8}  LV ${lv}`, 20 + 95 * (k >> 3), 50 + 16 * (k & 7)));
          }
        }
      }
      u.pop();
      u.closeButton();
    }, this.popup ? () => this.popup!.p.draw() : undefined);
  }
}
