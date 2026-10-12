// Local ranking (title 게임순위, online.md §6): the original registered a slot on the server (net 1)
// and paged a server list (0x36) with a detail view (0x37). Here registrations are kept locally per
// slot and ranked by the original score formula FUN_00061864.
import { AVK } from './input';
import { ItemDb, type Item } from './items';
import { Popup } from './popup';
import { derive, type Derived } from './rules';
import { SLOT_COUNT, loadGamedata, loadSlot, type SaveData } from './save';
import type { GameContext, Scene } from './scene';
import { frozenTitle, render, TitleScene } from './screens';

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
      hp: d.maxHp, mp: d.maxMp, stats: s.stats, equip, at: Date.now() };
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
        else if (k === AVK.UP) this.sel = (this.sel + 2) % 3;
        else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 3;
        else if (k === AVK.OK && rows[this.page * 3 + this.sel]) this.state = 0x37;
        else if (k === AVK.CLR) this.state = 0x35;
      } else if (k === AVK.CLR || k === AVK.OK) this.state = 0x36;   // 0x37 detail
    }
  }

  draw(): void {
    render(this.ctx, () => {
      frozenTitle(this.ctx);
      const u = this.ctx.ui, t = this.ctx.assets.text, rows = this.sorted();
      u.pushCenter220();
      if (this.state === 0x35) {
        u.window(0x48, 0, 0x4c, 0x16);
        u.textId(0xe1, 0x6e, 5, 'center');
        for (let i = 0; i < 3; i++) {
          const y = 0x18 + i * 0x42, iy = 0x16 + i * 0x42, sl = this.slots[i];
          u.window(0, y, 0xdb, 0x3f);
          if (this.cur === i) u.slotGlow(2, iy + 5, 0xd6, 0x39, this.t);
          u.hit(0, y, 0xdb, 0x3f, () => { if (this.cur === i) return [AVK.OK]; this.cur = i; });
          if (!sl) { u.cfont('EMPTY SPACE', 0x56, iy + 0x1b, 0); continue; }
          u.textId(0x3e1 + sl.cls, 0x4d, iy + 8);
          u.textId(0x1a3d, 0xac, iy + 8);
          u.number(sl.level, 0xbb, iy + 8, 1);
          const e = this.list.find((x) => x.slot === i);
          u.string(e ? `SCORE ${e.score}` : '미등록', 0xda, iy + 0x2e, 'right', { pen: e ? 0xffe0 : 0x9cd3 });
        }
        u.button(0x48, 0xd6, 0x4c, 0x16, 3, 1); u.textId(0x19df, 0x6e, 0xd9, 'center'); u.hit(0x48, 0xd6, 0x4c, 0x16, () => [AVK.K0]);
      } else {
        u.window(0, 0, 0xdc, 0xd4);
        u.textId(this.state === 0x36 ? 6617 : 6640, 110, 5, 'center');
        if (this.state === 0x36) {
          const pages = Math.max(1, Math.ceil(rows.length / 3));
          for (let i = 0; i < 3; i++) {
            const e = rows[this.page * 3 + i], y = 24 + i * 58;
            u.window(4, y, 0xd4, 54);
            if (i === this.sel) u.slotGlow(6, y + 2, 0xd0, 50, this.t);
            u.hit(4, y, 0xd4, 54, () => { if (this.sel === i) return [AVK.OK]; this.sel = i; });
            if (!e) continue;
            u.string(`${t[6727] ?? 'RANK'} ${this.page * 3 + i + 1}`, 12, y + 6);
            u.textId(0x3e1 + e.cls, 70, y + 6);
            u.string(`LV ${e.level}`, 150, y + 6);
            u.string(`${t[6728] ?? 'SCORE'} ${e.score}`, 208, y + 24, 'right', { pen: 0xffe0 });
            u.string(`${t[6729] ?? 'DMG'} ${e.dmg}   ${t[6730] ?? 'DEF'} ${e.def}`, 12, y + 36);
          }
          u.string(`${this.page + 1}/${pages}`, 110, 0xc4, 'center');
        } else {
          const e = rows[this.page * 3 + this.sel];
          if (e) {
            u.textId(0x3e1 + e.cls, 20, 30); u.string(`LV ${e.level}`, 150, 30);
            u.string(`${t[6731] ?? 'HP'} ${e.hp}   ${t[6732] ?? 'MP'} ${e.mp}`, 20, 52);
            u.string(`${t[6729] ?? 'DMG'} ${e.dmg}   ${t[6730] ?? 'DEF'} ${e.def}`, 20, 70);
            e.stats.forEach((v, k) => u.string(`${t[21 + k] ?? ''} ${v}`, 15 + 70 * (k & 1), 105 + 15 * (k >> 1)));
            e.equip.forEach((it, k) => {
              if (!it) return;
              const r = this.db.iconRect(it.icon);
              u.image(r.image, r.sx, r.sy, 16, 16, 13 + 34 * k, 145);
            });
            u.string(`SCORE ${e.score}`, 110, 0xbc, 'center', { pen: 0xffe0 });
          }
        }
      }
      u.pop();
      u.closeButton();
    }, this.popup ? () => this.popup!.p.draw() : undefined);
  }
}
