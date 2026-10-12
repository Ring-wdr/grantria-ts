// Game menu (state 0x1C, FUN_0005929c) and tab screens (0x1D..0x24, frame FUN_00059600, tab bar
// FUN_0004b9dc, character page 0 FUN_0005c560), drawn on the 1.3x layer L1
// (analysis/features/ui-screens.md §0.8–0.10, tools/grantria_ui.py screen_gamemenu / tab_frame /
// screen_tab_char). Tab bodies other than character page 0 are placeholders until ui-tabs.md.
import { stringWidth } from '../text';
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import { expNeed } from './rules';
import type { GameContext } from './scene';
import { EquipTab, InventoryTab } from './tabs';
import { SkillTab } from './skillTab';
import { OptionTab } from './optionTab';
import { QuestTab } from './questTab';
import { MapTab } from './mapTab';
import { CommunityTab } from './community';
import { tri, type Ui } from './ui';

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
  readonly community: CommunityTab;

  constructor(private ctx: GameContext, private field: FieldScene) {
    this.inventory = new InventoryTab(ctx, field);
    this.equipment = new EquipTab(ctx, field, field.player.cmf);
    this.skill = new SkillTab(ctx, field);
    this.option = new OptionTab(ctx, field);
    this.quest = new QuestTab(ctx, field);
    this.map = new MapTab(ctx, field);
    this.community = new CommunityTab(ctx, field);
    const L = ctx.ui13.layer;
    void L.preload([...['touch', 'shadow', 'sIcon', 'i0', 'i1', 'i2', 'i3', 'map', 'dungeon'],
      ...L.allImages(field.player.cmfName, field.player.cmf, 0, field.player.equip)]);
  }

  /** open a tab directly (MAP key -6 → map tab) */
  openTab(type: number): this { this.type = type; this.inTab = true; this.page = 0; this.f = 12; return this; }

  /** the active tab body, when it has its own key handling */
  private get body(): InventoryTab | EquipTab | SkillTab | QuestTab | MapTab | OptionTab | CommunityTab | null {
    return this.type === 1 ? this.inventory : this.type === 2 ? this.equipment : this.type === 3 ? this.skill
      : this.type === 4 ? this.quest : this.type === 5 ? this.map : this.type === 6 ? this.option : this.type === 7 ? this.community : null;
  }

  update(input: number[]): MenuResult {
    let presses = input;
    this.t++;
    if (!this.inTab) {
      this.f++;
      if (this.f < 12) return null;
      for (const k of presses) {
        if (k === AVK.LEFT || k === AVK.UP) this.type = (this.type + 7) & 7;
        else if (k === AVK.RIGHT || k === AVK.DOWN) this.type = (this.type + 1) & 7;
        else if (k === AVK.OK) { this.inTab = true; this.page = 0; }
        else if (k === AVK.CLR) return 'close';
      }
      return null;
    }
    const body = this.body;
    if (body) {
      if (body.busy) { body.update(presses); return null; }
      // tab bodies consume their keys; the rest falls through to the common tab keys
      const rest: number[] = [];
      for (const k of presses) if (!body.update([k])) rest.push(k);
      presses = rest;
      const req = body === this.option ? this.option.request : null;
      if (req) { this.option.request = null; return req === 'save' ? 'save' : 'title'; }
    }
    if (this.titles) { for (const k of presses) if (this.titles) this.titleKey(k); return null; }
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

  private pages(): number {
    return this.type === 0 ? 6 : 1;
  }

  /** title list 0x31 (FUN_0005b804 / keys FUN_00051b10): 12 pages × 5, detail MENUPOP 10 */
  private titles: { page: number; sel: number; detail: boolean } | null = null;

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

  private drawTitles(u: Ui): void {
    const tl = this.titles!, fs = this.field, t = this.ctx.assets.text;
    u.glow(16, tl.sel * 28 + 54, 188, 26, this.t);
    for (let i = 0; i < 5; i++) {
      const id = tl.page * 5 + i;
      if (id > 55) break;
      u.button(18, 56 + 28 * i, 184, 22, 3, i === tl.sel ? 1 : 0);
      u.hit(18, 56 + 28 * i, 184, 22, () => { if (tl.sel === i) return [AVK.OK]; tl.sel = i; });
      const owned = fs.story.titles.has(id);
      u.string(owned ? t[0xcff + id] ?? '' : t[0x1b63] ?? '???', 110, 59 + 28 * i, 'center', fs.story.title === id ? { pen: 0xffe0 } : undefined);
    }
    u.string(`${tl.page + 1}/12`, 110, 36, 'center');
    u.hit(0, 190, 60, 27, () => [AVK.LEFT]); u.hit(160, 190, 60, 27, () => [AVK.RIGHT]);
    if (tl.detail) {                                                  // MENUPOP 10: name, condition (0xD37 + n)
      const id = tl.page * 5 + tl.sel, owned = fs.story.titles.has(id);
      u.window(10, 70, 200, 100);
      u.string(owned ? t[0xcff + id] ?? '' : t[0x1b63] ?? '???', 110, 78, 'center', { pen: 0xffe0 });
      u.paragraph(t[0xd37 + id] ?? '', 110, 100, 180);
      if (owned) u.string(fs.story.title === id ? '[5] 해제' : '[5] 장착', 110, 150, 'center');
      u.hit(10, 70, 200, 100, () => [AVK.OK]);
    }
  }

  /** Character page 0: 2x2 stat buttons, '5' spends a stat point (applied at once here). */
  private charKey(k: number): void {
    if (k === AVK.K0) { this.titles = { page: 0, sel: 0, detail: false }; return; }   // title list 0x31
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
    u.button(0x56, 0x56, 0x3c, 0x1e, 3, 1);
    u.hit(0x56, 0x56, 0x3c, 0x1e, () => [AVK.OK]);
    if (k === 8) u.textId(0x147 + this.type, 0x75, 0x5c, 'center');
    u.pop();
    u.closeButton();
  }

  /** FUN_00059600 tab frame + FUN_0004b9dc tab bar. */
  private drawFrame(u: Ui): void {
    u.pushCenter220();
    u.window(0, 0x18, 0xdc, 0xc4);
    if (this.type === 0) {                                  // mode 0: page indicator (mode 1 tabs have none)
      const page = `${this.page + 1}/${this.pages()}`;
      const tw = stringWidth(page), b = tri(this.t >> 1, 0xf);
      u.image('t', 0, 0x13, 0xf, 0x13, (0x55 - (tw >> 1)) - b, 0xc2);
      u.image('t', 0, 0x13, 0xf, 0x13, (tw >> 1) + 0x78 + b, 0xc2, 1);
      u.string(page, 0x6e, 0xc4, 'center');
      u.hit(0x30, 0xbc, 0x30, 0x1c, () => [AVK.STAR]);
      u.hit(0x78, 0xbc, 0x30, 0x1c, () => [AVK.POUND]);
    }
    let off = 0;
    for (let i = 0; i < 8; i++) {
      u.hit(i * 0x20 - 0x14 + (i > this.type ? 8 : 0), -10, 0x20, 0x22, () => { if (this.type !== i) { this.type = i; this.page = 0; } });
      if (i === this.type) {
        const x = i * 0x20 - 0x14;
        u.glow(x + 1, -10, 0x22, 0x22, this.t);
        u.button(x + 3, -8, 0x1e, 0x1e, 3, 1);
        u.image('t', i << 4, 0x57, 0x10, 0x10, i * 0x20 + 1 - 0xb, -3);
        off = 8;
      } else {
        u.button(1 - 0x14 + off + i * 0x20, -6, 0x1a, 0x1a, 3, 0);
        u.image('t', i << 4, 0x57, 0x10, 0x10, i * 0x20 + 1 - 0xf + off, -1);
      }
    }
    u.button(0xe6, 0x1a, 0x22, 0x22, 3, 0);
    u.image('c', 0xa4, 0x3a, 0x12, 0x11, 0xec, 0x20);
    u.hit(0xe0, 0x14, 0x2e, 0x2e, () => [AVK.CLR]);
    u.pop();
  }

  private drawTab(u: Ui): void {
    this.drawFrame(u);
    u.pushCenter220();
    const body = this.body;
    if (body) { body.draw(u); body.drawOverlay(u); }
    else if (this.type === 0 && this.page === 0 && this.titles) this.drawTitles(u);
    else if (this.type === 0 && this.page === 0) this.drawCharPage0(u);
    else {
      u.textId(0x147 + this.type, 0x6e, 0x50, 'center');
      u.string('준비 중', 0x6e, 0x70, 'center', { pen: 0x9cd3 });
    }
    u.pop();
    const b = this.body;
    if (b && 'drawPopups' in b) b.drawPopups();
  }

  /** FUN_0005c560 character page 0. */
  private drawCharPage0(u: Ui): void {
    const fs = this.field, m = fs.model, v = fs.vitals, st = fs.stats, a = this.ctx.assets;
    u.button(8, 0x20, 0x3e, 0x16, 3, 1);
    u.textId(0x1a14, 0x25, 0x22, 'center');                                     // 칭호
    u.roundFill(0x4c, 0x23, 0x88, 0x10, 0, 1);
    const worn = fs.story.title;                                                   // worn title (+0x2eb8), 없음 when none
    if (worn === 0xff) u.textId(0x1a15, 0x90, 0x24, 'center', { pen: 0x37ff });      // 없음 (cyan 0x33FFFF)
    else u.textId(0xcff + worn, 0x90, 0x24, 'center', { pen: 0x37ff });
    u.hit(0x4c, 0x23, 0x88, 0x10, () => [AVK.K0]);                                  // tap: title list 0x31
    u.image(`face_s_${m.cls}`, 0, 0, 0x38, 0x38, 10, 0x39);
    const lv = `LV ${m.level}`;
    u.string(lv, 0x8c, 0x3a);
    u.textId(0x3e1 + m.cls, 0x8c + stringWidth(lv), 0x3a);
    u.cfont('HP', 0x47, 0x4b);
    u.cfont('MP', 0x47, 0x57);
    u.cfont('EXP', 0x44, 0x65);
    const lo = expNeed(m.level - 1), hi = expNeed(m.level);
    const bars: [number, number, number][] = [
      [0x4c, 10, Math.trunc(Math.max(0, v.hp) * 0x7b / Math.max(1, st.maxHp))],
      [0x58, 0x10, Math.trunc(Math.max(0, v.mp) * 0x7b / Math.max(1, st.maxMp))],
      [100, 0x16, Math.trunc(Math.max(0, v.exp - lo) * 0x7b / Math.max(1, hi - lo))],
    ];
    bars.forEach(([y, sy, w], k) => {
      u.image('t', 0x42, 0, 0x7d, 10, 0x58, 0x4a + k * 0xc);
      u.image('t', 0x42, sy, w, 6, 0x59, y);
    });
    const nums = [`${v.hp}/${st.maxHp}`, `${v.mp}/${st.maxMp}`, `${v.exp - lo}/${hi - lo}`];
    nums.forEach((s, k) => u.string(s, 0xd2, 0x4d + k * 0xc, 'right'));
    const c = this.statCur;
    u.glow((c & 1) * 0x46 + 8, (c >> 1) * 0x20 + 0x72, 0x42, 0x1a, this.t);
    for (let i = 0; i < 4; i++) {
      const x = (i & 1) * 0x46, y = (i >> 1) * 0x20;
      u.alpha = i === c ? 32 : 0x18;
      u.button(x + 10, y + 0x74, 0x3e, 0x16, 3, i === c ? 1 : 0);
      u.hit(x + 10, y + 0x74, 0x3e, 0x16, () => { if (this.statCur === i) return [AVK.OK]; this.statCur = i; });
      u.string(`${a.text[0x15 + i] ?? ''} ${m.stats[i]}`, x + 0x29, y + 0x78, 'center');
      u.alpha = 32;
    }
    u.button(0x96, 0x74, 0x3e, 0x16, 3, 1);
    u.textId(0x1a16, 0xb5, 0x78, 'center');                                     // 퀵슬롯해제
    u.roundFill(0x9a, 0x99, 0x36, 0x10, 0, 1);
    u.image('c', 0xb7, 0x58, 0xe, 0xe, 0x9e, 0x9a);
    u.string(String(fs.statPoints), 200, 0x9b, 'right');
    u.roundFill(8, 0xaf, 0xcc, 0x10, 0, 1);
    u.textId(STAT_HELP[c], 0x6e, 0xb0, 'center');
  }
}
