// Skill tab 0x20 (FUN_0005b160 -> grid FUN_0004c0bc, keys FUN_00056e4c), analysis/features/ui-tabs.md
// §0.6 and game-rules.md §4. Active / passive investment with the original checks; the third
// sub-tab invests account trait points (gamedata 0x35c, account.ts, account.md §2.2).
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import { QUICK_KEYS, slotPickerKey } from './keys';
import { Popup } from './popup';
import { account, traitCheck, traitCommit } from './account';
import { effectiveSkillLevel, rdiv } from './rules';
import { cfmt, skillDetail, skillReqLevel } from './skillDetail';
import type { GameContext } from './scene';
import type { Ui } from './ui';
import { button, cSprite, gt, h, padBadge, sprite, win, type VNode } from './view';
import './css/skill-quest.css';

const CELLS = [9, 7, 12];

/** Active skill record d+0x21160 + class*234 + s*26 (13 x u16). */
export function skillRec(fs: FieldScene, s: number): number[] {
  const a = fs.db.a, base = 0x21160 + fs.model.cls * 234 + s * 26;
  return Array.from({ length: 13 }, (_, i) => a.d16(base + i * 2));
}

/** Tab cell (tier*3 + group) -> action id / icon index (group*3 + tier); d+0x2558b is the inverse. */
export const actionOf = (idx: number) => (idx % 3) * 3 + Math.trunc(idx / 3);

/** Max cooldown when registering a skill (FUN_000379ac): class-0 record [5] minus cooldown-reduction %. */
export function skillMaxCd(fs: FieldScene, action: number): number {
  const s = fs.db.a.d8(0x2558b + action);
  return rdiv(fs.db.a.d16(0x2116a + 26 * s) * (100 - Math.min(75, fs.stats.D[45])), 100);
}

export class SkillTab {
  private sub = 0;
  private focus: 0 | 1 = 0;
  private sel = 0;              // 1-based, 0 = none
  private f = 0;
  private t = 0;
  private popup: { p: Popup; idx: number } | null = null;
  private quick: { cur: number; action: number } | null = null;

  constructor(private ctx: GameContext, private fs: FieldScene) {}

  /** skill detail MENUPOP 2 ('*' with a cell selected, FUN_0002daec) */
  private detail = false;

  get busy(): boolean { return !!(this.popup || this.quick || this.detail); }
  /** the quick-slot picker is open (its slot keys must not page the menu) */
  get picking(): boolean { return !!this.quick; }

  private learned(idx: number): number {
    return this.sub === 0 ? this.fs.skills[idx] : this.sub === 1 ? this.fs.skills[9 + idx] : account().traits[idx] ?? 0;
  }

  update(presses: number[]): boolean {
    this.t++;
    if (this.f < 15) this.f++;
    if (this.popup) {
      const r = this.popup.p.handle(presses);
      if (r === 'yes' && this.popup.p.id === 0x26) this.invest(this.popup.idx);
      if (r) this.popup = null;
      return true;
    }
    if (this.detail) {
      if (presses.some((k) => k === AVK.OK || k === AVK.CLR || k === AVK.STAR)) this.detail = false;
      return true;
    }
    if (this.quick) {
      for (const k of presses) {
        const m = slotPickerKey(k, this.quick.cur);
        if (m) this.quick.cur = m.cur;
        if (m?.pick || k === AVK.OK) { this.fs.inv.registerQuick(this.quick.cur, 1, this.quick.action, skillMaxCd(this.fs, this.quick.action)); this.quick = null; break; }
        else if (k === AVK.CLR) { this.quick = null; break; }
      }
      return true;
    }
    const n = CELLS[this.sub], cols = this.sub === 2 ? 4 : 3;
    for (const k of presses) {
      if (this.focus === 0) {
        if (k === AVK.LEFT) this.sub = (this.sub + 2) % 3;
        else if (k === AVK.RIGHT) this.sub = (this.sub + 1) % 3;
        else if (k === AVK.OK) { this.focus = 1; this.sel = 1; this.f = 0; }
        else return false;
      } else {
        const before = this.sel;
        if (k === AVK.LEFT && this.sel > 1) this.sel--;
        else if (k === AVK.RIGHT && this.sel < n) this.sel++;
        else if (k === AVK.UP) this.sel = Math.max(1, this.sel - cols);
        else if (k === AVK.DOWN) this.sel = Math.min(n, this.sel + cols);
        else if (k === AVK.OK) this.tryInvest(this.sel - 1);
        else if (k === AVK.STAR && this.sel) this.detail = true;              // '*' = 상세보기 (MENUPOP 2)
        else if (k === AVK.POUND && this.sub === 0 && this.learned(this.sel - 1) > 0) {
          this.quick = { cur: Math.max(0, this.fs.inv.quick.findIndex((q) => q.kind === 0)), action: actionOf(this.sel - 1) };
        } else if (k === AVK.CLR) { this.focus = 0; this.sel = 0; }
        else return false;
        if (this.sel !== before) this.f = 0;
      }
    }
    return true;
  }

  /** Checks of the investment (popups 0x28 / 0x27 / 0x2A / 0x29), then confirmation 0x26. */
  private tryInvest(idx: number): void {
    const fs = this.fs, ctx = this.ctx, t = ctx.assets.text;
    if (this.sub === 2) { this.popup = { p: new Popup(ctx, traitCheck(idx + 1)), idx }; return; }   // 0x28 / 0x27 / 0x26
    const lv = this.learned(idx);
    if (lv > 9) { this.popup = { p: new Popup(ctx, 0x28), idx }; return; }
    const cost = this.sub === 0 ? fs.db.a.d8(0x24695 + Math.trunc(idx / 3) * 10 + lv) : 1;
    if (fs.skillPoints < cost) { this.popup = { p: new Popup(ctx, 0x27), idx }; return; }
    if (this.sub === 0) {
      if (fs.model.level < skillReqLevel(fs.db.a, fs.model.cls, idx)) { this.popup = { p: new Popup(ctx, 0x2a), idx }; return; }
      if (idx >= 3 && fs.skills[idx - 3] < 5) {
        const name = t[0xc9c + fs.model.cls * 9 + idx - 3] ?? '';
        this.popup = { p: new Popup(ctx, 0x29, 0, (s) => s.replace('%s', name).replace('%d', '5')), idx };
        return;
      }
    }
    this.popup = { p: new Popup(ctx, 0x26), idx };
  }

  private invest(idx: number): void {
    const fs = this.fs, lv = this.learned(idx);
    if (this.sub === 2) { if (traitCheck(idx + 1) === 0x26) { const title = traitCommit(idx + 1); if (title !== null) fs.awardTitle(title); fs.recompute(); } return; }
    const cost = this.sub === 0 ? fs.db.a.d8(0x24695 + Math.trunc(idx / 3) * 10 + lv) : 1;
    if (fs.skillPoints < cost) return;
    fs.skillPoints -= cost;
    fs.skills[(this.sub === 0 ? 0 : 9) + idx]++;
    fs.recompute();
  }

  private icon(idx: number): [string, number, number] {
    const cls = this.fs.model.cls;
    if (this.sub === 0) return ['sIcon', actionOf(idx) * 24, cls * 24];          // i3 y=72 band = sIcon class row
    // passive 0 = source (216,72): in the original the i3 y=72 band is the class's sIcon row, whose 10th icon
    // is the class passive (오라소드/자연력/…); our i3.png leaves that band empty, so read sIcon directly
    if (this.sub === 1) return idx === 0 ? ['sIcon', 216, cls * 24] : ['i3', (idx - 1) * 24, 48];
    return ['i3', 144 + 24 * (idx & 3), 24 * (idx >> 2)];
  }

  private name(idx: number): string {
    const t = this.ctx.assets.text, cls = this.fs.model.cls;
    if (this.sub === 0) return t[0xc9c + cls * 9 + idx] ?? '';
    if (this.sub === 1) return t[idx === 0 ? 0xc93 + cls : 0xc95 + idx] ?? '';
    return t[0xcb7 + idx] ?? '';
  }

  /**
   * FUN_0005b160 -> FUN_0004c0bc: sub-tab keycaps, the selected skill's name and the points box,
   * the skill tree panel (active: three branches joined by connector lines, passive 3+3+1,
   * traits 4x3), then the invest / quick-slot keycaps.
   */
  draw(u: Ui): void {
    const t = this.ctx.assets.text;
    const tabs = [0, 1, 2].map((i) => button(gt(t[0x16f + i] ?? ''), {
      sel: i === this.sub, glow: this.focus === 0, cls: 'sk-subtab',
      on: () => { this.sub = i; this.focus = 0; this.sel = 0; },
    }));
    const canQuick = !!this.sel && this.learned(this.sel - 1) > 0;
    u.mount('tab', 'skill', h('div.v-col.v-fill.v-tab.sk-tab', null,
      h('div.v-row.sk-subtabs', null, tabs),
      h('div.v-row', { style: 'gap:4px' }, this.infoView(), this.pointsView()),
      this.treeView(),
      h('div.v-row.sk-actions', null,
        button([gt(t[0x1a1f] ?? ''), padBadge(this.ctx.input, AVK.STAR, 'v-pad-corner')],                                 // 상세보기 = '*'
          { sel: true, glow: false, on: () => (this.focus === 1 && this.sel ? [AVK.STAR] : []) }),
        this.sub === 0 && button([gt(t[0x1a20] ?? ''), padBadge(this.ctx.input, AVK.POUND, 'v-pad-corner')],             // 퀵슬롯 = '#'
          { sel: canQuick, glow: false, cls: canQuick ? '' : 'sk-off', on: () => [AVK.POUND] }))));
    if (this.quick) this.drawQuick(u);
    if (this.detail) u.mount('tab-over', 'skillDetail', this.detailView());
  }

  /**
   * Skill detail MENUPOP 2 (FUN_0002daec): icon, yellow name, the element icon (actives), "LV.%d"
   * (0x1A68: the effective level, 0 before learning; traits the account level); the description and
   * the value lines; under "습득조건 :" (0x1A3F) the cost and requirements while below max level.
   * The texts come from skillDetail.ts (checked against the original FUN_0004f6a8(2)).
   */
  private detailView(): VNode {
    const fs = this.fs, a = this.ctx.assets, t = a.text, idx = this.sel - 1, cls = fs.model.cls, learned = this.learned(idx);
    const eff = this.sub === 0 ? (learned ? effectiveSkillLevel(learned, idx, fs.stats.D) : 0)
      : this.sub === 1 ? (learned ? learned + fs.stats.D[53] : 0) : learned;
    const d = skillDetail(a, {
      cls, sub: this.sub, idx, learned, eff, points: fs.skillPoints, level: fs.model.level,
      learnedOf: (i) => fs.skills[i] ?? 0,
    });
    const [img, sx, sy] = this.icon(idx);
    return win('.v-col.v-fill.sk-detail', { on: () => [AVK.OK] },
      h('div.v-box.v-row.sk-detail-head', null,
        h('span.sk-icon', null, sprite(img, sx, sy, 24, 24)),
        gt(this.name(idx), { pen: 0xffe0, cls: 'v-grow' }),
        this.sub === 0 && cSprite(a, 3 + (idx % 3)),
        gt(cfmt(t[0x1a68] ?? '', eff), { cls: 'sk-detail-lv' })),
      h('div.v-box.v-col.v-grow.v-scroll.sk-detail-body', null,
        gt(d.desc, { cls: 'v-left' }),
        h('div.v-col.v-center.sk-detail-lines', null, d.body.map((ln) => gt(ln || ' ')))),
      !d.maxed && h('div.v-box.v-row.sk-detail-next', null,
        gt(t[0x1a3f] ?? '', { cls: 'sk-detail-label' }),
        h('div.v-col', null, d.footer.map((ln) => gt(ln)))));
  }


  /** FUN_0004d0a8 skill tooltip (the name of the focused cell), shown in a strip above the tree */
  private infoView(): VNode {
    const idx = this.sel - 1, show = this.focus === 1 && this.sel > 0, lv = show ? this.learned(idx) : 0;
    return h(`div.v-box.v-row.v-grow.sk-info${show ? '.on' : ''}`, null,
      show && gt(this.name(idx), { cls: 'v-grow' }),
      show && h('span.sk-info-lv', null, lv ? `${this.ctx.assets.text[0x12] ?? 'LV'} ${lv}/10` : '-'));
  }

  /** points box (roundFill 157,58,54,16): skill points, or trait points on the third sub-tab */
  private pointsView(): VNode {
    const tr = this.sub === 2;
    return h('div.v-box.v-row.v-points.sk-points', null,
      sprite('c', tr ? 239 : 197, tr ? 63 : 88, 14, 14),
      h('span.v-grow', { style: 'text-align:right' }, String(tr ? account().traitPoints : this.fs.skillPoints)));
  }

  /** one tree cell: the original icon, its level; unlearned cells dimmed (alpha 16) */
  private cellView(idx: number): VNode {
    const [img, sx, sy] = this.icon(idx), lv = this.learned(idx), sel = this.sel - 1 === idx;
    return h(`div.v-row.sk-cell${lv === 0 && !sel ? '.off' : ''}${sel ? '.cur' : ''}`, {
      on: () => { if (this.focus === 1 && this.sel === idx + 1) return [AVK.OK]; this.focus = 1; this.sel = idx + 1; this.f = 0; },
    },
      h(`span.sk-icon${sel && !this.popup ? '.v-sel' : ''}`, null, sprite(img, sx, sy, 24, 24)),
      h('span.sk-lv', null, lv ? `${this.ctx.assets.text[0x12] ?? 'LV'}${lv}` : ''));
  }

  private treeView(): VNode {
    if (this.sub === 0) {
      // branch c = cells c, c+3, c+6; a link lights up once the upper skill reaches 5 (tryInvest 0x29)
      const branches = [0, 1, 2].map((c) => h('div.v-col.sk-branch', null,
        [0, 1, 2].map((r) => [
          r > 0 && h(`span.sk-link${this.fs.skills[c + 3 * (r - 1)] >= 5 ? '.on' : ''}`),
          this.cellView(c + 3 * r),
        ])));
      return h('div.v-box.v-row.v-grow.sk-tree.sk-active', null, branches);
    }
    const cells = Array.from({ length: CELLS[this.sub] }, (_, i) => this.cellView(i));
    return h(`div.v-box.v-grow.sk-tree.sk-grid.${this.sub === 1 ? 'sk-passive' : 'sk-traits'}`, null, cells);
  }

  /** quick-slot picker left of the window: the six HUD slots, the cursor slot tinted and showing the skill */
  private drawQuick(u: Ui): void {
    const q = this.quick!, inv = this.fs.inv, cls = this.fs.model.cls;
    const slots = Array.from({ length: 6 }, (_, i) => {
      const s = inv.quick[i], cur = i === q.cur;
      return h(`div.sk-qslot${cur ? '.cur' : ''}`, { on: () => { if (q.cur === i) return [AVK.OK]; q.cur = i; } },
        sprite('touch', 0, 18, 31, 31, { cls: 'sk-qpad' }),
        cur ? sprite('sIcon', q.action * 24, cls * 24, 24, 24, { cls: 'sk-qicon' })
          : s.kind === 1 && sprite('sIcon', (s.id % 10) * 24, cls * 24, 24, 24, { cls: 'sk-qicon dim' }),
        padBadge(this.ctx.input, QUICK_KEYS[i], 'v-pad-slot'));                // the slot's own button picks it
    });
    u.view('skill-quick', -50, 15, 31, 35 * 6 - 4, h('div.v-col.v-fill.sk-quick', null, slots));
  }

  drawOverlay(): void { /* no absolute-coordinate overlays */ }

  drawPopups(): void { this.popup?.p.draw(); }
}
