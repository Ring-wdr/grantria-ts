// Quest tab 0x21 (FUN_0005b010 / keys FUN_00056df0) and the detail popup MENUPOP 3 (FUN_00031f68,
// keys FUN_00044564), analysis/features/ui-tabs.md §0.8. The detail's NPC portrait cell and the
// location string are not drawn; rows outside the clip (7,57,204,120) are skipped instead of clipped.
import { stringWidth } from '../text';
import type { FieldScene } from './fieldScene';
import { AVK } from './input';
import { Popup } from './popup';
import type { GameContext } from './scene';
import type { Ui } from './ui';

const YELLOW = 0xffe0;

/** wrap at width w on characters (text-rendering.md §0.4), '|@' breaks */
function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  for (const part of s.split('|@')) {
    let cur = '';
    for (const ch of part) {
      if (stringWidth(cur + ch) >= w - 8 && cur) { out.push(cur); cur = ch === ' ' ? '' : ch; } else cur += ch;
    }
    out.push(cur);
  }
  return out;
}

export class QuestTab {
  private sel = 0;
  private t = 0;
  private detail: { q: number; scroll: number; focus: 0 | 1 } | null = null;
  private popup: Popup | null = null;

  constructor(private ctx: GameContext, private fs: FieldScene) {}

  get busy(): boolean { return !!(this.detail || this.popup); }

  update(presses: number[]): boolean {
    this.t++;
    const active = this.fs.story.active;
    if (this.popup) {
      const r = this.popup.handle(presses);
      if (r === 'yes' && this.detail) this.abandon(this.detail.q);
      if (r) { this.popup = null; if (r === 'yes') this.detail = null; }
      return true;
    }
    if (this.detail) {
      const d = this.detail, main = this.fs.sdb.mainQuest(d.q);
      for (const k of presses) {
        if ((k === AVK.LEFT || k === AVK.RIGHT) && !main) d.focus ^= 1;
        else if (k === AVK.UP) d.scroll = Math.max(0, d.scroll - 15);
        else if (k === AVK.DOWN) d.scroll = Math.min(this.contentHeight(d.q), d.scroll + 15);
        else if (k === AVK.OK) { if (d.focus === 1) this.popup = new Popup(this.ctx, 0x51); else this.detail = null; }
        else if (k === AVK.CLR) this.detail = null;
      }
      return true;
    }
    for (const k of presses) {
      if (k === AVK.UP) this.sel = (this.sel + 5) % 6;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 6;
      else if (k === AVK.OK) { const a = active[this.sel]; if (a) this.detail = { q: a.q, scroll: 0, focus: 0 }; }
      else return false;
    }
    return true;
  }

  /** FUN_0001c59c: back to "available", accept items taken back, slot removed */
  private abandon(q: number): void {
    const { story, sdb, inv } = this.fs;
    story.qs[q] = 1;
    story.active = story.active.filter((a) => a.q !== q);
    const it = sdb.quests[q].acceptItem;
    if (it >= 0 && it < 1000) {
      const [type, sub] = it < 100 ? [0x1a, it] : [0x1d, it - 100];
      const i = inv.items.findIndex((x) => x && x.type === type && x.sub === sub);
      if (i >= 0) inv.remove(i);
    }
  }

  private rewardLines(q: number): string[] {
    const Q = this.fs.sdb.quests[q], out: string[] = [];
    const exp = (Q.exp & 0x1fff) << 3;
    if (exp) out.push(`EXP ${exp}`);
    const r = this.fs.sdb.rewardOf(Q);
    if (r) {
      if (r.type === 0x1c) out.push(`${r.count * 50} Gold`);
      else {
        const it = this.fs.db.create(r.type, r.sub, 0, this.fs.rng, true);
        out.push(`${this.fs.db.makeName(it, this.fs.rng)}${r.count > 1 ? ` x${r.count}` : ''}`);
      }
    }
    return out;
  }

  private contentHeight(q: number): number {
    const t = this.ctx.assets.text;
    const n = wrap(t[0x6dd + q] ?? '', 160).length, c = wrap(t[0x5ac + q] ?? '', 160).length;
    return Math.max(0, 285 + 15 * (n - 1) + c * 15 - 177);
  }

  draw(u: Ui): void {
    if (this.detail) return;                       // the detail window replaces the list
    const active = this.fs.story.active, t = this.ctx.assets.text, sdb = this.fs.sdb;
    u.glow(16, this.sel * 30 + 34, 188, 26, this.t);
    for (let i = 0; i < 6; i++) {
      u.button(18, 36 + 30 * i, 184, 22, 3, i === this.sel ? 1 : 0);
      u.hit(18, 36 + 30 * i, 184, 24, () => { if (this.sel === i) return [AVK.OK]; this.sel = i; });
      const a = active[i];
      if (!a) { u.image('c', 208, 63, 7, 9, 106, 41 + 30 * i); continue; }
      const main = sdb.mainQuest(a.q);
      if (main) u.cfont(t[0x28] ?? 'MAIN', 22, 39 + 30 * i, 1);
      u.textId(0x514 + a.q, 110, 39 + 30 * i, 'center', main ? { pen: YELLOW } : undefined);
    }
  }

  drawOverlay(): void { /* no absolute-coordinate overlays */ }

  /** MENUPOP 3 detail, drawn over the tab body */
  drawPopups(): void {
    const d = this.detail;
    const u = this.ctx.ui13;
    if (d) {                                       // called inside the menu's ui13 begin/end
      u.pushCenter220();
      this.drawDetail(u, d);
      u.pop();
    }
    this.popup?.draw();
  }

  private drawDetail(u: Ui, d: { q: number; scroll: number; focus: 0 | 1 }): void {
    const t = this.ctx.assets.text, sdb = this.fs.sdb, Q = sdb.quests[d.q], main = sdb.mainQuest(d.q), s = d.scroll;
    u.window(0, 23, 220, 196);
    u.hit(-200, -200, 700, 700, () => []);
    u.hit(0, 57, 220, 60, () => [AVK.UP]);
    u.hit(0, 117, 220, 66, () => [AVK.DOWN]);
    u.roundFill(18, 32, 184, 22, 0x111111, 1);
    u.textId(0x514 + d.q, 110, 34, 'center');
    u.cfont(t[0x28 + (main ? 0 : 1)] ?? '', 20, 35, 1);
    const inClip = (y: number) => y >= 57 && y + 13 <= 177;
    const line = (str: string, x: number, y: number, pen?: number) => { if (inClip(y)) u.string(str, x, y, 'left', pen ? { pen } : undefined); };
    // giver name
    if (inClip(60 - s)) {
      u.cfont(t[0x2a] ?? 'NPC', 20, 65 - s, 1);
      const name = Q.giver === 0 ? t[0x3e1 + this.fs.model.cls] : t[sdb.nameId(Q.giver)];
      u.string(name ?? '', 50, 62 - s);
    }
    if (inClip(133 - s)) u.fill(14, 133 - s, 192, 1, 0x666666);
    line(t[0x1a44] ?? '[ 목표 ]', 20, 140 - s);
    const goal = wrap(t[0x6dd + d.q] ?? '', 160);
    goal.forEach((ln, i) => line(ln, 33, 155 - s + 15 * i));
    let y = 175 + 15 * (goal.length - 1) - s;
    if (inClip(y)) u.fill(14, y, 192, 1, 0x666666);
    line(t[0x1a45] ?? '[ 보상 ]', 20, y + 5, 0xf81f);
    this.rewardLines(d.q).forEach((ln, i) => line(ln, 33, y + 20 + 15 * i));
    y += 65;
    if (inClip(y)) u.fill(14, y, 192, 1, 0x666666);
    line(t[0x1a46] ?? '[ 내용 ]', 20, y + 5);
    wrap(t[0x5ac + d.q] ?? '', 160).forEach((ln, i) => line(ln, 33, y + 20 + 15 * i));
    u.roundFill(8, 186, 204, 28, 0x171d24, 1);
    if (main) {
      u.glow(75, 187, 68, 28, this.t);
      u.button(78, 190, 0, 0x16, 1, 1, 406);
      u.hit(60, 186, 100, 30, () => [AVK.OK]);
    } else {
      u.glow(d.focus ? 135 : 15, 187, 68, 28, this.t);
      u.button(18, 190, 0, 0x16, 1, d.focus ? 0 : 1, 406);
      u.button(138, 190, 0, 0x16, 1, d.focus ? 1 : 0, 0x18b);
      u.hit(0, 186, 100, 30, () => { d.focus = 0; return [AVK.OK]; });
      u.hit(120, 186, 100, 30, () => { d.focus = 1; return [AVK.OK]; });
    }
  }
}
