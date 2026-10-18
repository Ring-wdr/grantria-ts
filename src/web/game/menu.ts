// Game menu (state 0x1C, FUN_0005929c) and tab screens (0x1D..0x24, frame FUN_00059600, tab bar
// FUN_0004b9dc, character page 0 FUN_0005c560), drawn on the 1.3x layer L1
// (analysis/features/ui-screens.md §0.8–0.10, tools/grantria_ui.py screen_gamemenu / tab_frame /
// screen_tab_char). Tab bodies live in tabs.ts, skillTab.ts, questTab.ts, mapTab.ts, optionTab.ts and community.ts.
// The state and keys are core/menu/menu.ts; this draws them.
import { cmfImages } from '../render/sprites';
import type { FieldScene } from './fieldScene';
import { AVK } from '../input/input';
import { QUICK_KEYS } from '../../core/keys';
import { expNeed } from '../../core/rules/rules';
import { titleEffectText } from '../../core/rules/achievements';
import { rankScore } from '../../core/scenes/ranking';
import { cellView } from './tabs';
import type { GameContext } from './scene';
import { EquipTab, InventoryTab } from './tabs';
import { SkillTab } from './skillTab';
import { OptionTab } from './optionTab';
import { QuestTab } from './questTab';
import { MapTab } from './mapTab';
import { CommunityTab } from './community';
import type { Ui } from '../render/ui';
import { popupPaint } from './popup';
import { button, cSprite, gt, h, menuList, padBadge, slot, sprite, win, type VChild, type VNode } from '../render/view';
import { tabHint } from '../input/keyHints';
import { GameMenuLogic } from '../../core/menu/menu';

/** FUN_0005c560 help line per stat cursor: 0x1a18 공격력, 0x1a19 아무 효과 없음, 0x1a1a 적중·크리, 0x1a1b 체력, 0x1a1c 마력.
 *  Class 1 (엘) attacks with INT, so its STR line is "no effect" and its INT line is the attack one. */
const statHelp = (cur: number, cls: number): number =>
  cur === 1 ? 0x1a1a : cur === 2 ? 0x1a1b : cur === 0 ? (cls === 1 ? 0x1a19 : 0x1a18) : cls === 1 ? 0x1a18 : 0x1a1c;

export class GameMenu extends GameMenuLogic {
  declare protected readonly ctx: GameContext;
  declare protected readonly field: FieldScene;

  declare protected inventory: InventoryTab;
  declare protected equipment: EquipTab;
  declare protected skill: SkillTab;
  declare protected option: OptionTab;
  declare protected quest: QuestTab;
  declare protected map: MapTab;
  declare community: CommunityTab;
  protected override get body(): InventoryTab | EquipTab | SkillTab | QuestTab | MapTab | OptionTab | CommunityTab | null {
    return super.body as InventoryTab | EquipTab | SkillTab | QuestTab | MapTab | OptionTab | CommunityTab | null;
  }

  constructor(ctx: GameContext, field: FieldScene) {
    super(ctx, field);
    void ctx.ui13.preload([...['touch', 'shadow', 'sIcon', 'i0', 'i1', 'i2', 'i3', 'map', 'dungeon'],
      ...cmfImages(ctx.assets, field.player.cmfName, field.player.cmf, 0, field.player.equip)]);
  }

  protected newInventory(): InventoryTab { return new InventoryTab(this.ctx, this.field); }
  protected newEquipment(): EquipTab { return new EquipTab(this.ctx, this.field, this.field.player.cmf); }
  protected newSkill(): SkillTab { return new SkillTab(this.ctx, this.field); }
  protected newOption(): OptionTab { return new OptionTab(this.ctx, this.field); }
  protected newQuest(): QuestTab { return new QuestTab(this.ctx, this.field); }
  protected newMap(): MapTab { return new MapTab(this.ctx, this.field); }
  protected newCommunity(): CommunityTab { return new CommunityTab(this.ctx, this.field); }

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
    // MENUPOP 10 (FUN_00029e1c): name, condition 0xD37+n, a rule, 장착효과 / 기본효과 (FUN_0004f6a8 case 10), then
    // 칭호장착·칭호해제 + 취소 when owned, else 확 인. In the 'tab-over' slot: inside the list it sat under the rows
    const fx = titleEffectText(this.ctx.assets, id);
    const pick = (b: number) => () => { if (tl.btn === b) return [AVK.OK]; tl.btn = b; };
    const detail = tl.detail && h('div.v-modal.v-fill', { style: 'background:rgba(0,0,0,0.55)', on: () => [AVK.CLR] },
      win('.v-col.v-detail', { on: () => [] },
        gt(name(id), { pen: 0xffe0 }),
        gt(t[0xd37 + id] ?? ''),
        h('div.v-rule', { style: 'width:100%' }),
        h('div.v-row', { style: 'width:100%' },
          h('div.v-col.v-grow', null, gt(t[0x19de] ?? ''), gt(fx.worn)),
          h('div.v-col.v-grow', null, gt(t[0x19df] ?? ''), gt(fx.owned))),
        h('div.v-row', { style: 'gap:8px' }, owned
          ? [button(gt(t[fs.story.title === id ? 0x4d0 : 0x4cf] ?? ''), { sel: tl.btn === 0, on: pick(0) }),
             button(gt(t[0x195] ?? ''), { sel: tl.btn === 1, on: pick(1) })]
          : button(gt(t[0x1a00] ?? ''), { sel: true, on: () => [AVK.OK] }))));
    u.mount('tab', 'titles', menuList([...rows, ...Array.from({ length: 5 - rows.length }, () => h('div.v-menu-gap'))], undefined,
      [h('div.v-row.v-pager', null,
        h('span.v-page-btn', { on: () => [AVK.LEFT] }, '◀'), `${tl.page + 1}/12`, h('span.v-page-btn', { on: () => [AVK.RIGHT] }, '▶'))]));
    if (detail) u.mount('tab-over', 'titleDetail', detail);
  }

  drawOverlay(): void {
    const u = this.ctx.ui13;
    if (this.inTab) this.drawTab(u); else this.drawRing(u);
    this.overlays.draw(popupPaint(this.ctx));
  }

  private drawRing(u: Ui): void {
    u.pushCenter220();
    const k = Math.min(this.f + 2, 8);
    const a = (k >> 1) << 3;
    // keyboard / pad (DAT_003b3b48 == 0): slot i holds tab type + i, so the selected tab is the top one, and a turn
    // offsets the angle by 10° a frame; touch: slot i is tab i and the selected one glows where it is
    const turn = this.ctx.input.device !== 'touch';
    let ang = 0x154 - 0x14 * k - this.spin * 10 * this.spinT;
    for (let s = 0; s < 8; s++) {
      const i = turn ? (s + this.type) & 7 : s;
      const sel = turn ? s === 0 && !this.spin : i === this.type;
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
      if (k === 8) u.hit(dx + 0x63, dy + 0x54, 0x26, 0x26, () => { if (this.spin) return; if (this.type === i) return [AVK.OK]; this.type = i; });
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
    const inp = this.ctx.input, pad = (b: 'l1' | 'r1') => {                                  // L1 / R1 (Q / E) page the tabs
      const k = tabHint(inp, b);
      return k && h(`span.u-pad.wide.mf-pad.${b}.${k.cls.split(' ').join('.')}`, null, k.glyph);
    };
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
    else if (this.type === 0) u.mount('tab', `char${this.page}`, this.page <= 2 ? this.charStatsView(this.page) : this.collectView(this.page));
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
        ir && sprite(ir.image, ir.sx, ir.sy, 16, 16, { cls: 'cq-icon' }),
        padBadge(this.ctx.input, QUICK_KEYS[i], 'v-pad-slot'));
    });
    u.view('charRelease', -50, 15, 31, 6 * 35, h('div.v-col', { style: 'gap:4px' }, slots));
  }

  /**
   * Character pages 1 / 2 (FUN_00058cd8; D[i] = DAT_003d1b6c + 4i). Page 1: the three element values
   * D[12..14] (c.pxl 8 + icon 3+k), 채집레벨 with its gauge (exp·123 / need, full at level 5; need d+0x21588),
   * ATK D[0] / DEF D[2], then 적중률 D[5], 회피율 D[26] ("%d.5%%" while 재빠른 움직임's level is odd: its
   * trunc(lv/2) dropped half a percent), 크리티컬 D[4], 크리티컬 데미지 D[44]. Page 2: 장비획득율 D[17],
   * 골드획득율 D[16], 중독 D[34] / 기절 D[35] / 암흑 D[33] / 슬로우 D[32] 내성, 업적 점수 FUN_00061864.
   */
  private charStatsView(page: number): VNode {
    const fs = this.field, a = this.ctx.assets, t = a.text, D = fs.stats.D;
    // sprintf: '%s', '%d', then '%%' -> '%'
    const fmt = (f: string, label: number, v: number | string) => f.replace('%s', t[label] ?? '').replace('%d', String(v)).replace('%%', '%');
    const pct = (id: number, v: number) => gt(fmt(t[0x1ae5] ?? '%s %d%%', id, v));
    const num = (id: number, v: number) => gt((t[0x1a74] ?? '%s %d').replace('%s', t[id] ?? '').replace('%d', String(v)));
    if (page === 2) {
      const st = fs.story, score = rankScore(fs.inv.equip, fs.lap, st.titles.size, st.dimClears ?? 0, st.counters.vermutKills ?? 0);
      return h('div.v-col.v-fill.v-tab.ch-stats', null,
        h('div.v-col.ch-lines.ch-fixed.ch-top', null, pct(0x1aeb, D[17]), pct(0x1aec, D[16])),     // y 38 / 54
        h('div.v-rule'),
        h('div.v-col.ch-lines.ch-fixed', null, num(0x1aef, D[34]), num(0x1af0, D[35]), num(0x1af1, D[33]), num(0x1af2, D[32]), num(0x1af3, score)));
    }
    const g = fs.story.gather, need = a.d16(0x21588 + 2 * g.lv);
    const p = g.lv === 5 ? 1 : Math.min(1, g.exp / Math.max(1, need));
    const lv = fs.skills[9 + 6] ?? 0, odd = lv >= 1 && (lv + D[53]) % 2 === 1;
    const evade = odd ? gt(fmt(t[0x1ae7] ?? '%s %d.5%%', 0x1ae8, D[26] < 0 ? D[26] + 1 : D[26]))
      : pct(0x1ae8, D[26]);
    return h('div.v-col.v-fill.v-tab.ch-stats', null,
      h('div.v-row.ch-elems', null, [0, 1, 2].map((k) => h('div.v-row.ch-elem', null,
        h('span.ch-elem-icon', null, cSprite(a, 8), cSprite(a, 3 + k, 'ch-elem-fg')), h('span.ch-num', null, String(D[12 + k]))))),
      h('div.v-row.v-stat-bar.ch-gather', null,
        gt(t[0x1a4e] ?? ''), h('span.ch-num', null, String(g.lv + 1)),
        h('div.v-bar.exp', { style: `--p:${p.toFixed(3)}` }),
        h('span.v-bar-value', null, `${g.exp}/${need}`)),
      h('div.v-rule'),
      h('div.v-col.ch-atk', null, num(0x1aed, D[0]), num(0x1aee, D[2])),
      h('div.v-rule'),
      h('div.v-col.ch-lines.v-grow', null, pct(0x1ae6, D[5]), evade, pct(0x1ae9, D[4]), pct(0x1aea, D[44])));
  }

  /**
   * Character pages 3..5 (FUN_0005c24c): title 0x1A0B + page over a 5 × 2 grid, then the name (0x7FC + model)
   * and description of the cursor's entry. 3 키아이템: type 0x1D collection bits (+0x3171; +0x3173 dims),
   * desc 0xC82 + i. 4 퀘스트아이템: the key store (records 106.. = type 0x1A items; the web keeps them in the
   * bag, so its type 0x1A items in order), desc 0xC37 + sub. 5 귀속아이템: d.dat 0x4031A9 ids (0x1B; 0xFF = none),
   * dimmed / grey text while not owned (+0x32A5 bit i), desc 0xC48 + id.
   */
  private collectView(page: number): VNode {
    const fs = this.field, a = this.ctx.assets, t = a.text, db = fs.db, st = fs.story;
    const keys = fs.inv.keys.slice(0, 10);
    const entry = (i: number): { icon: VChild; model: number; desc: number; dim: boolean } | null => {
      if (page === 3) {
        if (!st.collect.has(i)) return null;
        const r = db.iconRect(db.icon(0x1d, i));
        return { icon: sprite(r.image, r.sx, r.sy, 16, 16), model: db.model(0x1d, i, 0), desc: 0xc82 + i, dim: st.collectDim.has(i) };
      }
      if (page === 4) {
        const it = keys[i];
        return it ? { icon: cellView(fs, it, { cls: 'ch-item' }), model: db.model(0x1a, it.sub, 0), desc: 0xc37 + it.sub, dim: false } : null;
      }
      const id = a.d8(0x4031a9 - 0x3dc324 + i);
      if (id === 0xff) return null;
      const r = db.iconRect(db.icon(0x1b, id));
      return { icon: sprite(r.image, r.sx, r.sy, 16, 16), model: db.model(0x1b, id, 0), desc: 0xc48 + id, dim: !fs.inv.unlocked(id) };
    };
    const cells = Array.from({ length: 10 }, (_, i) => {
      const e = entry(i);
      return h(`div.ch-cell${i === this.collCur ? '.v-sel' : ''}${e?.dim ? '.dim' : ''}`, {
        on: () => { this.collCur = i; },
      }, e?.icon);
    });
    const cur = entry(this.collCur);
    return h('div.v-col.v-fill.v-tab.ch-coll', null,
      h('div.v-box.v-col.ch-coll-box', null,
        gt(t[0x1a0b + page] ?? '', { cls: 'ch-coll-title' }),
        h('div.ch-grid', null, cells)),
      h('div.v-box.v-col.v-grow.ch-coll-info', null,
        cur && gt(t[0x7fc + cur.model] ?? '', { pen: 0xffe0 }),
        cur && gt(t[cur.desc] ?? '', { pen: page === 5 && cur.dim ? 0x3186 : undefined, cls: 'v-left' })));
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
    const cf = this.charFocus;
    const stats = Array.from({ length: 4 }, (_, i) => button(`${t[0x15 + i] ?? ''} ${m.stats[i]}`, {
      sel: cf === 'stats' && i === c, on: () => { this.charFocus = 'stats'; if (this.statCur === i) return [AVK.OK]; this.statCur = i; },
    }));
    u.mount('tab', 'char', h('div.v-col.v-fill.v-tab.v-char', null,
      h('div.v-row', { style: 'gap:6px' },
        button(gt(t[0x1a14] ?? ''), { sel: true, glow: false, style: 'width:62px' }),             // 칭호
        h(`div.v-box.v-grow.v-title-box${cf === 'title' ? '.v-sel' : ''}`, { on: () => [AVK.K0] },   // tap / d-pad OK: title list 0x31
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
          button(gt(t[0x1a16] ?? ''), { sel: true, glow: cf === 'release', on: () => [AVK.K7] }),   // 퀵슬롯해제 = '7' (d-pad: RIGHT)
          h('div.v-box.v-row.v-points', null, sprite('c', 0xb7, 0x58, 0xe, 0xe), h('span.v-grow', { style: 'text-align:right' }, String(fs.statPoints))))),
      h('div.v-box.v-note', null, gt(t[statHelp(c, m.cls)] ?? ''))));
  }
}
