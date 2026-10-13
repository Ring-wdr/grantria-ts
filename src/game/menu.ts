// Game menu (state 0x1C, FUN_0005929c) and tab screens (0x1D..0x24, frame FUN_00059600, tab bar
// FUN_0004b9dc, character page 0 FUN_0005c560), drawn on the 1.3x layer L1
// (analysis/features/ui-screens.md §0.8–0.10, tools/grantria_ui.py screen_gamemenu / tab_frame /
// screen_tab_char). Tab bodies other than character page 0 are placeholders until ui-tabs.md.
import { cmfImages } from '../sprites';
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import { padGlyph } from './gamepad';
import { expNeed } from './rules';
import type { GameContext } from './scene';
import { EquipTab, InventoryTab } from './tabs';
import { SkillTab } from './skillTab';
import { OptionTab } from './optionTab';
import { QuestTab } from './questTab';
import { MapTab } from './mapTab';
import { CommunityTab } from './community';
import type { Ui } from './ui';
import { button, gt, h, menuList, slot, sprite, win } from './view';

const STAT_HELP = [0x1a18, 0x1a19, 0x1a1a, 0x1a1b, 0x1a1c];

export type MenuResult = 'close' | 'title' | 'save' | null;

export class GameMenu {
  /** open counter g_Menu.frame (input accepted from 12) */
  private f = 0;
  private t = 0;
  /** selected ring icon / tab (g_Menu.type) */
  private type = 0;
  /** inside a tab screen (states 0x1D + type) */
  private inTab = false;
  private page = 0;
  /** character page 0 stat cursor (0..3 = STR AGI VIT INT) */
  private statCur = 0;

  private inventory: InventoryTab;
  private equipment: EquipTab;
  private skill: SkillTab;
  private option: OptionTab;
  private quest: QuestTab;
  private map: MapTab;
  community: CommunityTab;

  constructor(private ctx: GameContext, private field: FieldScene) {
    this.inventory = new InventoryTab(ctx, field);
    this.equipment = new EquipTab(ctx, field, field.player.cmf);
    this.skill = new SkillTab(ctx, field);
    this.option = new OptionTab(ctx, field);
    this.quest = new QuestTab(ctx, field);
    this.map = new MapTab(ctx, field);
    this.community = new CommunityTab(ctx, field);
    void ctx.ui13.preload([...['touch', 'shadow', 'sIcon', 'i0', 'i1', 'i2', 'i3', 'map', 'dungeon'],
      ...cmfImages(ctx.assets, field.player.cmfName, field.player.cmf, 0, field.player.equip)]);
  }

  /** open a tab directly (MAP key -6 → map tab) */
  openTab(type: number): this { this.type = type; this.inTab = true; this.page = 0; this.f = 12; return this; }

  /** the active tab body, when it has its own key handling */
  private get body(): InventoryTab | EquipTab | SkillTab | QuestTab | MapTab | OptionTab | CommunityTab | null {
    return this.type === 1 ? this.inventory : this.type === 2 ? this.equipment : this.type === 3 ? this.skill
      : this.type === 4 ? this.quest : this.type === 5 ? this.map : this.type === 6 ? this.option : this.type === 7 ? this.community : null;
  }

  update(input: number[]): MenuResult {
    // L1 / R1 (TAB_L / TAB_R) page the tabs; the pad also sent their quick-slot keys K7 / K9, dropped here
    const paging = input.some((k) => k === AVK.TAB_L || k === AVK.TAB_R);
    let presses = paging ? input.filter((k) => k !== AVK.K7 && k !== AVK.K9) : input;
    this.t++;
    if (!this.inTab) {
      this.f++;
      if (this.f < 12) return null;
      for (const k of presses) {
        if (k === AVK.LEFT || k === AVK.UP || k === AVK.TAB_L) this.type = (this.type + 7) & 7;
        else if (k === AVK.RIGHT || k === AVK.DOWN || k === AVK.TAB_R) this.type = (this.type + 1) & 7;
        else if (k === AVK.OK) { this.inTab = true; this.page = 0; }
        else if (k === AVK.CLR) return 'close';
      }
      return null;
    }
    if (paging) {
      // from anywhere inside a tab, sub screens and popups included: those are dropped
      for (const k of presses) if (k === AVK.TAB_L || k === AVK.TAB_R) this.goTab((this.type + (k === AVK.TAB_L ? 7 : 1)) & 7);
      presses = presses.filter((k) => k !== AVK.TAB_L && k !== AVK.TAB_R);
    }
    const body = this.body;
    if (body) {
      if (body.busy) { body.update(presses); this.couponDetour(); return null; }
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
        if (k === AVK.LEFT) r.cur = (r.cur + 5) % 6;
        else if (k === AVK.RIGHT) r.cur = (r.cur + 1) % 6;
        else if (k === AVK.OK) { this.field.inv.clearQuick(r.cur); this.release = null; }
        else if (k === AVK.CLR) this.release = null;
      }
      return null;
    }
    for (const k of presses) {
      if (k === AVK.K1) { this.type = (this.type + 7) & 7; this.page = 0; }      // FUN_00056198
      else if (k === AVK.K3) { this.type = (this.type + 1) & 7; this.page = 0; }
      else if (k === AVK.STAR) this.page = (this.page + this.pages() - 1) % this.pages();
      else if (k === AVK.POUND) this.page = (this.page + 1) % this.pages();
      else if (k === AVK.CLR) { this.inTab = false; }
      else if (this.type === 0 && this.page === 0) this.charKey(k);
    }
    if (this.type !== 5 || !this.inTab) this.map.leaveFloor();
    return null;
  }

  /** inventory bag expansion short of coupons (popup 0x7D confirmed) -> the coupon shop of the community tab */
  private couponDetour(): void {
    if (!this.inventory.toCoupons) return;
    this.inventory.toCoupons = false;
    this.type = 7;
    this.community.open('coupon');
  }

  /** L1 / R1 or a tab click: go to tab `type` from anywhere; a tab left in a sub screen or popup starts fresh */
  private goTab(type: number): void {
    if (type === this.type) return;
    const ctx = this.ctx, fs = this.field;
    if (this.body?.busy) {
      if (this.type === 1) { this.inventory = new InventoryTab(ctx, fs); fs.recompute(); }
      else if (this.type === 2) this.equipment = new EquipTab(ctx, fs, fs.player.cmf);
      else if (this.type === 3) this.skill = new SkillTab(ctx, fs);
      else if (this.type === 4) this.quest = new QuestTab(ctx, fs);
      else if (this.type === 5) this.map = new MapTab(ctx, fs);
      else if (this.type === 6) this.option = new OptionTab(ctx, fs);
      else if (this.type === 7) this.community = new CommunityTab(ctx, fs);
    }
    this.titles = null;
    this.release = null;
    this.type = type;
    this.page = 0;
  }

  private pages(): number {
    return this.type === 0 ? 6 : 1;
  }

  /** title list 0x31 (FUN_0005b804 / keys FUN_00051b10): 12 pages × 5, detail MENUPOP 10 */
  private titles: { page: number; sel: number; detail: boolean } | null = null;
  /** quick-slot release overlay (character page '7', DAT_003b3c52 from 0x1D: FUN_000560c4 -> FUN_00037118) */
  private release: { cur: number } | null = null;

  private titleKey(k: number): void {
    const tl = this.titles!, fs = this.field, id = tl.page * 5 + tl.sel;
    if (tl.detail) {
      if (k === AVK.OK && fs.story.titles.has(id)) { fs.story.title = fs.story.title === id ? 0xff : id; fs.recompute(); }   // wear / take off
      if (k === AVK.OK || k === AVK.CLR) tl.detail = false;
      return;
    }
    if (k === AVK.LEFT) { tl.page = (tl.page + 11) % 12; if (tl.page * 5 + tl.sel > 55) tl.sel = 0; }
    else if (k === AVK.RIGHT) { tl.page = (tl.page + 1) % 12; if (tl.page * 5 + tl.sel > 55) tl.sel = 0; }
    else if (k === AVK.UP) tl.sel = (tl.sel + 4) % 5;
    else if (k === AVK.DOWN) tl.sel = (tl.sel + 1) % 5;
    else if (k === AVK.OK) { if (id <= 55) tl.detail = true; }
    else if (k === AVK.CLR) this.titles = null;
    if (this.titles && this.titles.page * 5 + this.titles.sel > 55) this.titles.sel = 55 - this.titles.page * 5;
  }

  /** title list 0x31: 5 rows per page, the worn title in yellow; detail MENUPOP 10 over the list */
  private drawTitles(u: Ui): void {
    const tl = this.titles!, fs = this.field, t = this.ctx.assets.text;
    const name = (id: number) => (fs.story.titles.has(id) ? t[0xcff + id] ?? '' : t[0x1b63] ?? '???');
    const rows = [];
    for (let i = 0; i < 5 && tl.page * 5 + i <= 55; i++) {
      const id = tl.page * 5 + i;
      rows.push(button(gt(name(id), fs.story.title === id ? { pen: 0xffe0 } : {}), {
        sel: i === tl.sel, on: () => { if (tl.sel === i) return [AVK.OK]; tl.sel = i; },
      }));
    }
    const id = tl.page * 5 + tl.sel, owned = fs.story.titles.has(id);
    // the detail goes to the 'tab-over' slot: inside the list it sat under the (positioned) rows
    const detail = tl.detail && h('div.v-modal.v-fill', { style: 'background:rgba(0,0,0,0.55)', on: () => [AVK.OK] },
      win('.v-col.v-detail', null,
        gt(name(id), { pen: 0xffe0 }),
        gt(t[0xd37 + id] ?? '', { cls: 'v-grow' }),
        owned && h('div.v-dim-note', null, fs.story.title === id ? '[5] 해제' : '[5] 장착')));
    u.mount('tab', 'titles', menuList([...rows, ...Array.from({ length: 5 - rows.length }, () => h('div.v-menu-gap'))], undefined,
      [h('div.v-row.v-pager', null,
        h('span.v-page-btn', { on: () => [AVK.LEFT] }, '◀'), `${tl.page + 1}/12`, h('span.v-page-btn', { on: () => [AVK.RIGHT] }, '▶'))]));
    if (detail) u.mount('tab-over', 'titleDetail', detail);
  }

  /** Character page 0: 2x2 stat buttons, '5' spends a stat point (applied at once here). */
  private charKey(k: number): void {
    if (k === AVK.K0) { this.titles = { page: 0, sel: 0, detail: false }; return; }   // title list 0x31
    if (k === AVK.K7) { this.release = { cur: 0 }; return; }                          // 퀵슬롯해제 overlay
    if (k === AVK.LEFT || k === AVK.RIGHT) this.statCur ^= 1;
    else if (k === AVK.UP || k === AVK.DOWN) this.statCur ^= 2;
    else if (k === AVK.OK && this.field.statPoints > 0) {
      this.field.model.stats[this.statCur]++;
      this.field.statPoints--;
      this.field.recompute();
    }
  }

  drawOverlay(): void {
    const u = this.ctx.ui13;
    if (this.inTab) this.drawTab(u); else this.drawRing(u);
  }

  private drawRing(u: Ui): void {
    u.pushCenter220();
    const k = Math.min(this.f + 2, 8);
    const a = (k >> 1) << 3;
    let ang = 0x154 - 0x14 * k;
    for (let i = 0; i < 8; i++) {
      const sel = i === this.type;
      const sin = Math.round(Math.sin((ang * Math.PI) / 180) * 1024), cos = Math.round(Math.cos((ang * Math.PI) / 180) * 1024);
      const dx = Math.trunc((sin * 10) / 1024) * k, dy = Math.trunc((cos * 10) / 1024) * k;
      if (sel) {
        u.alpha = 32;
        u.glow(dx + 0x65, dy + 0x56, 0x22, 0x22, this.t);
        u.button(dx + 0x67, dy + 0x58, 0x1e, 0x1e, 3, 1);
      } else {
        u.alpha = Math.min(a, 0x14);
        u.button(dx + 0x67, dy + 0x58, 0x1e, 0x1e, 3, 0);
      }
      if (k === 8) u.hit(dx + 0x63, dy + 0x54, 0x26, 0x26, () => { if (this.type === i) return [AVK.OK]; this.type = i; });
      u.image('t', i << 4, 0x57, 0x10, 0x10, dx + 0x6e, dy + 0x5f);
      ang -= 0x2d;
    }
    u.alpha = 32;
    u.view('ringCentre', 0x56, 0x56, 0x3c, 0x1e, button(k === 8 && gt(this.ctx.assets.text[0x147 + this.type] ?? ''), {
      sel: true, glow: false, style: 'width:100%;height:100%', on: () => [AVK.OK],
    }));
    u.pop();
    u.closeButton();
  }

  /** FUN_00059600 tab frame + FUN_0004b9dc tab bar. */
  /**
   * FUN_00059600 tab frame + FUN_0004b9dc tab bar as one CSS grid view (ui.css .mf): the tab bar
   * over the window, the window with its 'tab' slot (tab bodies mount there) and 'tab-over' slot
   * (detail overlays), the page indicator of mode 0 and the close button beside the window.
   */
  private drawFrame(u: Ui): void {
    u.pushCenter220();
    const tabs = Array.from({ length: 8 }, (_, i) => {
      const sel = i === this.type;
      return button(sprite('t', i << 4, 0x57, 0x10, 0x10), {
        sel, cls: 'mf-tab', on: () => this.goTab(i),
      });
    });
    const pager = this.type === 0 && h('div.v-row.mf-pager', null,                        // mode 0: page indicator
      h('span.mf-arrow.left', { on: () => [AVK.STAR] }, sprite('t', 0, 0x13, 0xf, 0x13)),
      `${this.page + 1}/${this.pages()}`,
      h('span.mf-arrow.right', { on: () => [AVK.POUND] }, sprite('t', 0, 0x13, 0xf, 0x13, { flip: true })));
    const inp = this.ctx.input, pad = (b: 'l1' | 'r1') => inp.device === 'pad'
      && h(`span.u-pad.wide.mf-pad.${b}.${inp.padKind}`, null, padGlyph(inp.padKind, b));     // L1 / R1 page the tabs
    u.view('menuFrame', -24, -12, 294, 234, h('div.mf', { cls: (this.body?.busy || this.titles?.detail || this.release) && 'mf-inert' },
      h('div.v-row.mf-tabs', null, tabs, pad('l1'), pad('r1')),
      win('.v-col.mf-window', null, slot('tab'), pager, slot('tab-over')),
      button(sprite('c', 0xa4, 0x3a, 0x12, 0x11), { cls: 'mf-close', glow: false, on: () => [AVK.CLR] })));
    u.pop();
  }

  private drawTab(u: Ui): void {
    this.drawFrame(u);
    u.pushCenter220();
    const body = this.body;
    if (body) { body.draw(u); body.drawOverlay(u); }
    else if (this.type === 0 && this.page === 0 && this.titles) this.drawTitles(u);
    else if (this.type === 0 && this.page === 0) { this.drawCharPage0(u); if (this.release) this.drawRelease(u); }
    else u.mount('tab', 'soon', h('div.v-col.v-fill.v-center', { style: 'gap:16px' },
      gt(this.ctx.assets.text[0x147 + this.type] ?? ''), gt('준비 중', { pen: 0x9cd3 })));
    u.pop();
    const b = this.body;
    if (b && 'drawPopups' in b) b.drawPopups();
  }

  /** quick-slot release overlay left of the window: the six HUD slots with what they hold, cursor pulsing */
  private drawRelease(u: Ui): void {
    const r = this.release!, fs = this.field, inv = fs.inv;
    const slots = Array.from({ length: 6 }, (_, i) => {
      const q = inv.quick[i], it = q.kind === 2 ? inv.items[q.id] : undefined, ir = it && fs.db.iconRect(it.icon);
      return h(`div.cq-slot${i === r.cur ? '.cur' : ''}`, { on: () => { if (r.cur === i) return [AVK.OK]; r.cur = i; } },
        sprite('touch', 0, 18, 31, 31),
        q.kind === 1 && sprite('sIcon', (q.id % 10) * 24, fs.model.cls * 24, 24, 24, { cls: 'cq-icon skill' }),
        ir && sprite(ir.image, ir.sx, ir.sy, 16, 16, { cls: 'cq-icon' }));
    });
    u.view('charRelease', -50, 15, 31, 6 * 35, h('div.v-col', { style: 'gap:4px' }, slots));
  }

  /** FUN_0005c560 character page 0: title, portrait with level / bars, stats 2x2, points, help line. */
  private drawCharPage0(u: Ui): void {
    const fs = this.field, m = fs.model, v = fs.vitals, st = fs.stats, a = this.ctx.assets, t = a.text;
    const worn = fs.story.title;                                                   // worn title (+0x2eb8), 없음 when none
    const lo = expNeed(m.level - 1), hi = expNeed(m.level);
    const bar = (label: string, cls: string, cur: number, max: number) =>
      h('div.v-row.v-stat-bar', null,
        h('span.v-bar-label', null, label),
        h(`div.v-bar.${cls}`, { style: `--p:${Math.max(0, Math.min(1, cur / Math.max(1, max))).toFixed(3)}` }),
        h('span.v-bar-value', null, `${cur}/${max}`));
    const c = this.statCur;
    const stats = Array.from({ length: 4 }, (_, i) => button(`${t[0x15 + i] ?? ''} ${m.stats[i]}`, {
      sel: i === c, on: () => { if (this.statCur === i) return [AVK.OK]; this.statCur = i; },
    }));
    u.mount('tab', 'char', h('div.v-col.v-fill.v-tab.v-char', null,
      h('div.v-row', { style: 'gap:6px' },
        button(gt(t[0x1a14] ?? ''), { sel: true, glow: false, style: 'width:62px' }),             // 칭호
        h('div.v-box.v-grow.v-title-box', { on: () => [AVK.K0] },                                 // tap: title list 0x31
          gt(worn === 0xff ? t[0x1a15] ?? '' : t[0xcff + worn] ?? '', { pen: 0x37ff }))),
      h('div.v-row', { style: 'gap:8px;align-items:flex-start' },
        sprite(`face_s_${m.cls}`, 0, 0, 0x38, 0x38, { cls: 'v-portrait' }),
        h('div.v-col.v-grow', { style: 'gap:3px' },
          h('div.v-row', { style: 'gap:6px' }, `LV ${m.level}`, gt(t[0x3e1 + m.cls] ?? '')),
          bar('HP', 'hp', v.hp, st.maxHp),
          bar('MP', 'mp', v.mp, st.maxMp),
          bar('EXP', 'exp', v.exp - lo, hi - lo))),
      h('div.v-row', { style: 'gap:6px;align-items:stretch' },
        h('div.v-stat-grid.v-grow', null, stats),
        h('div.v-col', { style: 'gap:6px;width:62px' },
          button(gt(t[0x1a16] ?? ''), { sel: true, glow: false, on: () => [AVK.K7] }),            // 퀵슬롯해제 = '7'
          h('div.v-box.v-row.v-points', null, sprite('c', 0xb7, 0x58, 0xe, 0xe), h('span.v-grow', { style: 'text-align:right' }, String(fs.statPoints))))),
      h('div.v-box.v-note', null, gt(t[STAT_HELP[c]] ?? ''))));
  }
}
