// Skill tab 0x20 (FUN_0005b160 -> grid FUN_0004c0bc, keys FUN_00056e4c), analysis/features/ui-tabs.md
// §0.6 and game-rules.md §4. Active / passive investment with the original checks; the third
// sub-tab (account traits) is drawn but its points (gamedata 0x35c) are not ported.
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import { Popup } from './popup';
import { account, traitCheck, traitCommit } from './account';
import { rdiv } from './rules';
import type { GameContext } from './scene';
import type { Ui } from './ui';

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

  get busy(): boolean { return !!(this.popup || this.quick); }

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
    if (this.quick) {
      for (const k of presses) {
        if (k === AVK.LEFT) this.quick.cur = (this.quick.cur + 5) % 6;
        else if (k === AVK.RIGHT) this.quick.cur = (this.quick.cur + 1) % 6;
        else if (k === AVK.OK) { this.fs.inv.registerQuick(this.quick.cur, 1, this.quick.action, skillMaxCd(this.fs, this.quick.action)); this.quick = null; break; }
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
      const rec = skillRec(fs, idx);
      if (fs.model.level < rec[11]) { this.popup = { p: new Popup(ctx, 0x2a), idx }; return; }
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

  private cellPos(idx: number): [number, number] {
    if (this.sub === 2) return [[28, 74, 120, 166][idx & 3], 84 + 38 * (idx >> 2)];
    if (this.sub === 1 && idx === 6) return [98, 160];
    return [30 + 68 * (idx % 3), 84 + 38 * Math.trunc(idx / 3)];
  }

  private icon(idx: number): [string, number, number] {
    const cls = this.fs.model.cls;
    if (this.sub === 0) return ['sIcon', actionOf(idx) * 24, cls * 24];          // i3 y=72 band = sIcon class row
    if (this.sub === 1) return idx === 0 ? ['i3', 216, 72] : ['i3', (idx - 1) * 24, 48];
    return ['i3', 144 + 24 * (idx & 3), 24 * (idx >> 2)];
  }

  private name(idx: number): string {
    const t = this.ctx.assets.text, cls = this.fs.model.cls;
    if (this.sub === 0) return t[0xc9c + cls * 9 + idx] ?? '';
    if (this.sub === 1) return t[idx === 0 ? 0xc93 + cls : 0xc95 + idx] ?? '';
    return t[0xcb7 + idx] ?? '';
  }

  draw(u: Ui): void {
    const fs = this.fs;
    u.roundFill(157, 58, 54, 16, 0, 1);
    u.image('c', this.sub === 2 ? 239 : 197, this.sub === 2 ? 63 : 88, 14, 14, 164, 59);
    u.number(this.sub === 2 ? account().traitPoints : fs.skillPoints, 192, 59, 1, 1);
    if (this.focus === 0) u.glow(69 * this.sub + 6, 30, 66, 26, this.t);
    for (let i = 0; i < 3; i++) {
      const x = 8 + 69 * i;
      u.alpha = i === this.sub ? 32 : 16;
      u.button(x, 32, 0x3e, 0x16, 3, i === this.sub ? 1 : 0);
      u.hit(x, 30, 0x3e, 26, () => { this.sub = i; this.focus = 0; this.sel = 0; });
      u.textId(0x16f + i, x + 31, 37, 'center');
      u.alpha = 32;
    }
    u.roundFill(8, 77, 203, 115, 0, 1);
    if (this.sub === 0) for (const x of [42, 110, 178]) u.fill(x, 89, 2, 82, 0x999999);
    for (let idx = 0; idx < CELLS[this.sub]; idx++) {
      const [x, y] = this.cellPos(idx), lv = this.learned(idx), sel = this.sel - 1 === idx;
      if (lv === 0 && !sel) u.alpha = 16;
      if (sel && !this.popup) u.glow(x - 2, y - 2, 28, 28, this.t);
      u.hit(x - 4, y - 4, 32, 32, () => { if (this.focus === 1 && this.sel === idx + 1) return [AVK.OK]; this.focus = 1; this.sel = idx + 1; this.f = 0; });
      if (this.sub === 0) u.fill(x + 12, y, 2, 24, 0);
      const [img, sx, sy] = this.icon(idx);
      u.image(img, sx, sy, 24, 24, x, y);
      if (lv) {
        u.cfont(this.ctx.assets.text[0x12] ?? 'LV', x + 24, y);
        u.number(lv, x + 39, y, 0, 0);
      }
      u.alpha = 32;
    }
    if (this.f > 9 && this.focus === 1 && this.sel && !this.popup) this.tooltip(u, this.sel - 1);
    u.button(10, 194, 0x3e, 0x16, 3, 1);
    u.hit(10, 194, 0x3e, 0x16, () => (this.focus === 1 && this.sel ? [AVK.OK] : []));
    u.textId(0x1a1f, 41, 198, 'center');
    if (this.sub === 0) {
      u.button(148, 194, 0x3e, 0x16, 3, this.sel && this.learned(this.sel - 1) > 0 ? 1 : 3);
      u.hit(148, 194, 0x3e, 0x16, () => [AVK.POUND]);
      u.textId(0x1a20, 179, 198, 'center');
    }
    if (this.quick) this.drawQuick(u);
  }

  /** FUN_0004d0a8 skill tooltip: grows to (x-60, y-20, 120, 40), colour 0x111111. */
  private tooltip(u: Ui, idx: number): void {
    const col = this.sub === 2 ? idx & 3 : idx % 3, row = this.sub === 2 ? idx >> 2 : Math.trunc(idx / 3);
    let tx: number, ty: number;
    if (this.sub === 2) { tx = 68 + 28 * col; ty = row * 38 + 130 - (row >= 2 ? 69 : 0); }
    else if (this.sub === 1 && idx === 6) { tx = 102; ty = 137; }
    else { tx = 68 + 41 * col; ty = row * 38 + (this.sel >= 7 ? 61 : 130); }
    const anim = Math.min(2 * this.f, 30), k = (anim - 10) >> 1;
    if (k > 0) { u.alpha = 24; u.fill(tx - Math.min(60, 4 * k), ty - Math.min(20, 2 * k), Math.min(120, 8 * k), Math.min(40, 4 * k), 0x111111); u.alpha = 32; }
    if (anim === 30) u.paragraph(this.name(idx), tx, ty - 8, 80);
  }

  private drawQuick(u: Ui): void {
    const q = this.quick!, inv = this.fs.inv, cls = this.fs.model.cls;
    for (let i = 0; i < 6; i++) {
      const y = 18 + 35 * i;
      u.image('touch', 0, 18, 31, 31, -50, y - 3, 0, i === q.cur ? { tint: [255, 255, 153], amount: Math.abs(16 - (this.t % 32)) } : undefined);
      u.hit(-50, y - 3, 31, 31, () => { if (q.cur === i) return [AVK.OK]; q.cur = i; });
      const s = inv.quick[i];
      u.alpha = 16;
      if (i !== q.cur && s.kind === 1) u.image('sIcon', (s.id % 10) * 24, cls * 24, 24, 24, -46, y);
      u.alpha = 32;
    }
    u.image('sIcon', q.action * 24, cls * 24, 24, 24, -46, 18 + 35 * q.cur);
  }

  drawOverlay(): void { /* no absolute-coordinate overlays */ }

  drawPopups(): void { this.popup?.p.draw(); }
}
