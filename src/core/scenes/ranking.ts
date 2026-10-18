// Local ranking (title 게임순위, online.md §6): the original registered a slot on the server (net 1)
// and paged a server list (0x36) with a detail view (0x37). Here registrations are kept locally per
// slot and ranked by the original score formula FUN_00061864.
// State and keys; the host draws it (web/game/ranking.ts).
import { AVK } from '../keys';
import { ItemDb, type Item } from '../rules/items';
import { Popup, openPopup } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';
import { derive, type Derived } from '../rules/rules';
import { SLOT_COUNT, loadGamedata, loadSlot, type SaveData } from '../save/save';
import type { SceneHost } from './host';
import { loadJson, saveJson } from '../platform';

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
  return loadJson<RankEntry[]>(KEY) ?? [];
}
function saveRanking(list: RankEntry[]): void {
  saveJson(KEY, list);
}

/** FUN_00061864: Σ equipment (grade·10 + level) + 3·dimension clears + 3·Vermut kills + 10 per title + 100 on lap >= 2 (+300 above: 3회차, lap 4) */
export function rankScore(equip: (Item | null)[], lap: number, titles: number, clears = 0, vermut = 0): number {
  let s = 3 * clears + 3 * vermut;
  for (const it of equip) if (it) s += it.grade * 10 + it.level;
  if (lap >= 2) s += 100;
  if (lap >= 4) s += 300;                                         // the original's lap > 2: here 3회차 (lap 3 = hard ending seen)
  return s + titles * 10;
}

export class RankingLogic {
  protected state: 0x35 | 0x36 | 0x37 = 0x35;
  protected cur = 0;
  protected page = 0;
  protected sel = 0;
  protected t = 0;
  protected slots: (SaveData | null)[] = [];
  private list: RankEntry[] = loadRanking();
  /** popup 0x4F (empty slot) and popup 2 (register this slot?) */
  protected readonly overlays = new OverlayStack();
  protected mine = false;
  protected eq = 0;
  protected skillView = false;
  protected db: ItemDb;
  private ready = false;

  constructor(protected readonly ctx: SceneHost) {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i));
    this.db = new ItemDb(ctx.assets);
    void this.db.init().then(() => { this.ready = true; });
  }

  protected sorted(): RankEntry[] { return [...this.list].sort((a, b) => b.score - a.score || a.at - b.at); }

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
    if (this.overlays.update(presses)) return;
    const rows = this.sorted(), pages = Math.max(1, Math.ceil(rows.length / 3));
    // '0' (list / 1위부터·내랭킹 / skill view) has no pad button: △ / Y stands in for it on these screens
    for (const k of presses.map((k) => (k === AVK.K3 ? AVK.K0 : k))) {
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
      if (this.state === 0x35) {                                      // FUN_00041b20
        if (k === AVK.UP) this.cur = (this.cur + 2) % 3;
        else if (k === AVK.DOWN) this.cur = (this.cur + 1) % 3;
        else if (k === AVK.OK && this.ready) {
          if (!this.slots[this.cur]) openPopup(this.overlays, new Popup(this.ctx, 0x4f));
          else { const i = this.cur; openPopup(this.overlays, new Popup(this.ctx, 2), () => this.register(i)); }
        } else if (k === AVK.K0) { this.state = 0x36; this.page = 0; this.sel = 0; }
        else if (k === AVK.CLR) this.ctx.screens.title();
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
        else if (k === AVK.CLR) this.ctx.screens.title();
      } else {                                                        // 0x37 FUN_00043a2c
        if (k === AVK.K0) this.skillView = !this.skillView;
        else if (k === AVK.LEFT) this.eq = (this.eq + 5) % 6;
        else if (k === AVK.RIGHT) this.eq = (this.eq + 1) % 6;
        else if (k === AVK.CLR || k === AVK.OK) { if (this.skillView) this.skillView = false; else this.state = 0x36; }
      }
    }
  }
}
