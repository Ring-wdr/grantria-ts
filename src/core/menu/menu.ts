// Game menu (state 0x1C, FUN_0005929c) and tab screens (0x1D..0x24, frame FUN_00059600, tab bar
// FUN_0004b9dc, character page 0 FUN_0005c560), drawn on the 1.3x layer L1
// (analysis/features/ui-screens.md §0.8–0.10, tools/grantria_ui.py screen_gamemenu / tab_frame /
// screen_tab_char). Tab bodies live in tabs.ts, skillTab.ts, questTab.ts, mapTab.ts, optionTab.ts and community.ts.
// State and keys; the host draws it (web/game/menu.ts).
import type { Launch } from './archive';
import type { FieldGame } from '../field/fieldGame';
import { AVK, slotPickerKey } from '../keys';
import type { Host } from '../host';
import type { CommunityTabLogic } from './community';
import type { MapTabLogic } from './mapTab';
import type { OptionTabLogic } from './optionTab';
import type { QuestTabLogic } from './questTab';
import type { SkillTabLogic } from './skillTab';
import type { EquipTabLogic, InventoryTabLogic } from './tabs';
import { Popup, popupOverlay } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';

export type MenuResult = 'close' | 'title' | 'save' | 'launch' | null;

export abstract class GameMenuLogic {
  /** 기록실 request (보스 러시), taken once by the play scene */
  takeLaunch(): Launch | null { const l = this.option.launch; this.option.launch = null; return l; }

  /** open counter g_Menu.frame (input accepted from 12) */
  protected f = 0;
  protected t = 0;
  /** selected ring icon / tab (g_Menu.type) */
  protected type = 0;
  /** keyboard / pad ring turn (DAT_003b3beb): 1 = LEFT (the tab before comes to the top), -1 = RIGHT; 0 = still.
   *  spinT counts its frames: 1..3 turn 10° each, 4 commits the new type (FUN_0005929c, g_Menu.frame 12..15) */
  protected spin = 0;
  protected spinT = 0;
  /** inside a tab screen (states 0x1D + type) */
  protected inTab = false;
  protected page = 0;
  /** character page 0 stat cursor (0..3 = STR AGI VIT INT) */
  protected statCur = 0;
  /** character pages 3..5 (collections) cursor 0..9 (FUN_0004a418, 2 rows × 5) */
  protected collCur = 0;
  /** character page 0 d-pad focus: the stat grid, the title box above it ('0') or 퀵슬롯해제 to its right ('7') */
  protected charFocus: 'stats' | 'title' | 'release' = 'stats';
  /** stats and points before the first point spent here (DAT_0041596c / DAT_003b3c7e, flag DAT_003b3c7c) */
  private statBackup: { stats: number[]; points: number } | null = null;
  /** popup 0x73 "설정한 스탯을 저장하시겠습니까?" (askStats) */
  protected readonly overlays = new OverlayStack();

  protected inventory: InventoryTabLogic;
  protected equipment: EquipTabLogic;
  protected skill: SkillTabLogic;
  protected option: OptionTabLogic;
  protected quest: QuestTabLogic;
  protected map: MapTabLogic;
  community: CommunityTabLogic;

  constructor(protected readonly ctx: Host, protected readonly field: FieldGame) {
    this.inventory = this.newInventory();
    this.equipment = this.newEquipment();
    this.skill = this.newSkill();
    this.option = this.newOption();
    this.quest = this.newQuest();
    this.map = this.newMap();
    this.community = this.newCommunity();
  }

  /** the host's views of the tab bodies (a tab left in a sub screen starts fresh: goTab makes a new one) */
  protected abstract newInventory(): InventoryTabLogic;
  protected abstract newEquipment(): EquipTabLogic;
  protected abstract newSkill(): SkillTabLogic;
  protected abstract newOption(): OptionTabLogic;
  protected abstract newQuest(): QuestTabLogic;
  protected abstract newMap(): MapTabLogic;
  protected abstract newCommunity(): CommunityTabLogic;

  /** open a tab directly (MAP key -6 → map tab) */
  openTab(type: number): this { this.type = type; this.inTab = true; this.page = 0; this.f = 12; return this; }

  /** the active tab body, when it has its own key handling */
  protected get body(): InventoryTabLogic | EquipTabLogic | SkillTabLogic | QuestTabLogic | MapTabLogic | OptionTabLogic | CommunityTabLogic | null {
    return this.type === 1 ? this.inventory : this.type === 2 ? this.equipment : this.type === 3 ? this.skill
      : this.type === 4 ? this.quest : this.type === 5 ? this.map : this.type === 6 ? this.option : this.type === 7 ? this.community : null;
  }

  update(input: number[]): MenuResult {
    // L1 / R1 (TAB_L / TAB_R) page the tabs; the pad also sent their quick-slot keys K7 / K9, dropped here.
    // In a quick-slot picker L1 / R1 stay slot keys (slots 3 / 4) and do not page.
    const picking = this.inTab && !!(this.release || this.skill.picking || this.inventory.picking);
    const tabKey = (k: number) => k === AVK.TAB_L || k === AVK.TAB_R;
    const paging = !picking && input.some(tabKey);
    let presses = paging ? input.filter((k) => k !== AVK.K7 && k !== AVK.K9) : picking ? input.filter((k) => !tabKey(k)) : input;
    this.t++;
    if (!this.inTab) {
      this.f++;
      if (this.f < 12) return null;
      if (this.spin) {                                                 // keys wait for the turn (FUN_00057668: only at frame 12)
        if (++this.spinT >= 4) { this.type = (this.type + 8 - this.spin) & 7; this.spin = 0; }
        return presses.includes(AVK.CLR) ? 'close' : null;
      }
      // keyboard / pad: the ring turns so the chosen tab sits at the top; touch: the ring stays and the cursor moves
      const turn = this.ctx.input.device !== 'touch';
      for (const k of presses) {
        const d = k === AVK.LEFT || k === AVK.UP || k === AVK.TAB_L ? 1 : k === AVK.RIGHT || k === AVK.DOWN || k === AVK.TAB_R ? -1 : 0;
        if (d && turn) { this.spin = d; this.spinT = 1; break; }
        if (d) this.type = (this.type + 8 - d) & 7;
        else if (k === AVK.OK) { this.inTab = true; this.page = 0; }
        else if (k === AVK.CLR) return 'close';
      }
      return null;
    }
    if (this.overlays.update(presses)) return null;
    if (paging) {
      // from anywhere inside a tab, sub screens and popups included: those are dropped
      for (const k of presses) if (k === AVK.TAB_L || k === AVK.TAB_R) this.goTab((this.type + (k === AVK.TAB_L ? 7 : 1)) & 7);
      presses = presses.filter((k) => k !== AVK.TAB_L && k !== AVK.TAB_R);
    }
    const body = this.body;
    if (body) {
      if (body.busy) { body.update(presses); this.couponDetour(); this.backFromCoupons(); return body === this.option && this.option.launch ? 'launch' : null; }
      // tab bodies consume their keys; the rest falls through to the common tab keys
      const rest: number[] = [];
      for (const k of presses) if (!body.update([k])) rest.push(k);
      presses = rest;
      const req = body === this.option ? this.option.request : null;
      if (req) { this.option.request = null; return req === 'save' ? 'save' : 'title'; }
    }
    if (this.titles) { for (const k of presses) if (this.titles) this.titleKey(k); return null; }
    if (this.release) {
      for (const k of presses) {
        const r = this.release;
        if (!r) break;
        const m = slotPickerKey(k, r.cur);
        if (m) r.cur = m.cur;
        if (m?.pick || k === AVK.OK) { this.field.inv.clearQuick(r.cur); this.release = null; }
        else if (k === AVK.CLR) this.release = null;
      }
      return null;
    }
    for (const k of presses) {
      // FUN_000573c8: after a point was spent, any key but '5' on the stats and the arrows asks first
      const statKey = k === AVK.UP || k === AVK.DOWN || k === AVK.LEFT || k === AVK.RIGHT || (k === AVK.OK && this.charFocus === 'stats');
      if (this.statBackup && this.type === 0 && this.page === 0 && !statKey) {
        this.askStats(() => this.tabKey(k));
        break;
      }
      this.tabKey(k);
    }
    if (this.type !== 5 || !this.inTab) this.map.leaveFloor();
    return null;
  }

  /** FUN_0005e23c popup 0x73 (DAT_003b3c78): yes keeps the points spent here, no restores them; then the key or tab
   *  that raised it runs */
  private askStats(replay: () => void): void {
    this.overlays.open(popupOverlay(new Popup(this.ctx, 0x73)), { on: { close: (r) => {
      const b = this.statBackup!;
      if (r === 'no') { this.field.model.stats.splice(0, 4, ...b.stats); this.field.statPoints = b.points; this.field.recompute(); }
      this.statBackup = null;
      replay();
    } } });
  }

  private tabKey(k: number): void {
    if (k === AVK.K1) { this.type = (this.type + 7) & 7; this.page = 0; }      // FUN_00056198
    else if (k === AVK.K3) { this.type = (this.type + 1) & 7; this.page = 0; }
    else if (k === AVK.STAR) { this.page = (this.page + this.pages() - 1) % this.pages(); this.collCur = 0; }
    else if (k === AVK.POUND) { this.page = (this.page + 1) % this.pages(); this.collCur = 0; }
    else if (k === AVK.CLR) { this.inTab = false; }
    else if (this.type === 0 && this.page === 0) this.charKey(k);
    else if (this.type === 0 && this.page >= 3) this.collectKey(k);
  }

  /** inventory bag expansion short of coupons (popup 0x7D confirmed) -> the coupon shop of the community tab */
  /** a coupon shop opened from the inventory returns there when closed */
  private backFromCoupons(): void {
    const t = this.community.wantTab;
    if (t === null) return;
    this.community.wantTab = null;
    this.goTab(t);
  }

  private couponDetour(): void {
    if (!this.inventory.toCoupons) return;
    this.inventory.toCoupons = false;
    this.type = 7;
    this.community.open('coupon', 1);                                  // back to the inventory afterwards
  }

  /** L1 / R1 or a tab click: go to tab `type` from anywhere; a tab left in a sub screen or popup starts fresh */
  protected goTab(type: number): void {
    if (type === this.type) return;
    if (this.statBackup && !this.overlays.size) { this.askStats(() => this.goTab(type)); return; }   // FUN_000425bc
    if (this.body?.busy) {
      if (this.type === 1) { this.inventory = this.newInventory(); this.field.recompute(); }
      else if (this.type === 2) this.equipment = this.newEquipment();
      else if (this.type === 3) this.skill = this.newSkill();
      else if (this.type === 4) this.quest = this.newQuest();
      else if (this.type === 5) this.map = this.newMap();
      else if (this.type === 6) this.option = this.newOption();
      else if (this.type === 7) this.community = this.newCommunity();
    }
    this.titles = null;
    this.release = null;
    this.type = type;
    this.page = 0;
  }

  protected pages(): number {
    return this.type === 0 ? 6 : 1;
  }

  /** title list 0x31 (FUN_0005b804 / keys FUN_00051b10): 12 pages × 5, detail MENUPOP 10; btn = DAT_00407c0a
   *  (0 칭호장착 / 칭호해제, 1 취소) */
  protected titles: { page: number; sel: number; detail: boolean; btn: number } | null = null;
  /** quick-slot release overlay (character page '7', DAT_003b3c52 from 0x1D: FUN_000560c4 -> FUN_00037118) */
  protected release: { cur: number } | null = null;

  private titleKey(k: number): void {
    const tl = this.titles!, fs = this.field, id = tl.page * 5 + tl.sel;
    if (tl.detail) {                                 // MENUPOP 10: owned -> 칭호장착/해제 | 취소, else 확 인
      const owned = fs.story.titles.has(id);
      if (owned && (k === AVK.LEFT || k === AVK.RIGHT)) { tl.btn ^= 1; return; }
      if (k === AVK.OK && owned && tl.btn === 0) { fs.story.title = fs.story.title === id ? 0xff : id; fs.recompute(); }   // wear / take off
      if (k === AVK.OK || k === AVK.CLR) tl.detail = false;
      return;
    }
    if (k === AVK.LEFT) { tl.page = (tl.page + 11) % 12; if (tl.page * 5 + tl.sel > 55) tl.sel = 0; }
    else if (k === AVK.RIGHT) { tl.page = (tl.page + 1) % 12; if (tl.page * 5 + tl.sel > 55) tl.sel = 0; }
    else if (k === AVK.UP) tl.sel = (tl.sel + 4) % 5;
    else if (k === AVK.DOWN) tl.sel = (tl.sel + 1) % 5;
    else if (k === AVK.OK) { if (id <= 55) { tl.detail = true; tl.btn = 0; } }
    else if (k === AVK.CLR) this.titles = null;
    if (this.titles && this.titles.page * 5 + this.titles.sel > 55) this.titles.sel = 55 - this.titles.page * 5;
  }

  /**
   * Character page 0: 2x2 stat buttons, '5' spends a stat point (popup 0x73 before leaving keeps or restores them); '0' title list,
   * '7' 퀵슬롯해제. A pad has no '0' and its '7' (L1) pages the tabs, so the d-pad also walks to the
   * title box (UP from the top stat row) and the 퀵슬롯해제 button (RIGHT from the right column), OK opens them.
   */
  private charKey(k: number): void {
    if (k === AVK.K0) { this.titles = { page: 0, sel: 0, detail: false, btn: 0 }; return; }   // title list 0x31
    if (k === AVK.K7) { this.release = { cur: 0 }; return; }                          // 퀵슬롯해제 overlay
    const f = this.charFocus, c = this.statCur;
    if (f === 'title') {
      if (k === AVK.DOWN) this.charFocus = 'stats';
      else if (k === AVK.RIGHT) this.charFocus = 'release';
      else if (k === AVK.OK) this.titles = { page: 0, sel: 0, detail: false, btn: 0 };
      return;
    }
    if (f === 'release') {
      if (k === AVK.LEFT || k === AVK.DOWN) { this.charFocus = 'stats'; this.statCur = k === AVK.DOWN ? 3 : c | 1; }
      else if (k === AVK.UP) this.charFocus = 'title';
      else if (k === AVK.OK) this.release = { cur: 0 };
      return;
    }
    if (k === AVK.UP && c < 2) this.charFocus = 'title';
    else if (k === AVK.RIGHT && c & 1) this.charFocus = 'release';
    else if (k === AVK.LEFT || k === AVK.RIGHT) this.statCur ^= 1;
    else if (k === AVK.UP || k === AVK.DOWN) this.statCur ^= 2;
    else if (k === AVK.OK && this.field.statPoints > 0) {
      this.statBackup ??= { stats: this.field.model.stats.slice(0, 4), points: this.field.statPoints };
      this.field.model.stats[this.statCur]++;
      this.field.statPoints--;
      this.field.recompute();
    }
  }

  /** FUN_00049134 on the 5 × 2 collection grid (pages 3..5) */
  private collectKey(k: number): void {
    const c = this.collCur;
    if (k === AVK.LEFT) this.collCur = c % 5 ? c - 1 : c + 4;
    else if (k === AVK.RIGHT) this.collCur = c % 5 < 4 ? c + 1 : c - 4;
    else if (k === AVK.UP || k === AVK.DOWN) this.collCur = (c + 5) % 10;
  }
}
