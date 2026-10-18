// Quest tab 0x21 (FUN_0005b010 / keys FUN_00056df0) and the detail popup MENUPOP 3 (FUN_00031f68,
// keys FUN_00044564), analysis/features/ui-tabs.md §0.8: the list cursor, the detail's focus and scroll,
// tracking and abandoning. The host draws it (web/game/questTab.ts).
import type { FieldGame } from '../field/fieldGame';
import type { Host } from '../host';
import { AVK } from '../keys';
import type { ScrollRef } from '../render';
import { untrackKey } from '../rules/quests';
import { OverlayStack } from '../ui/overlays';
import { Popup, openPopup } from '../ui/popup';

export class QuestTabLogic {
  protected sel = 0;
  protected t = 0;
  /** focus: 0 확인, 1 추적 켬 / 끔 (not in the original), 2 포기 (side quests) */
  protected detail: { q: number; scroll: ScrollRef; focus: number } | null = null;
  /** popups over the tab */
  protected readonly overlays = new OverlayStack();

  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

  get busy(): boolean { return !!(this.detail || this.overlays.size); }

  update(presses: number[]): boolean {
    this.t++;
    const active = this.fs.story.active;
    if (this.overlays.update(presses)) return true;
    if (this.detail) {
      const d = this.detail, n = this.fs.sdb.mainQuest(d.q) ? 2 : 3;
      for (const k of presses) {
        if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
        if (k === AVK.LEFT) d.focus = (d.focus + n - 1) % n;
        else if (k === AVK.RIGHT) d.focus = (d.focus + 1) % n;
        else if (k === AVK.UP) d.scroll.y = Math.max(0, d.scroll.y - 15);
        else if (k === AVK.DOWN) d.scroll.y += 15;                     // the renderer clamps at the end
        else if (k === AVK.OK) {
          if (d.focus === 2) openPopup(this.overlays, new Popup(this.ctx, 0x51), () => { if (this.detail) this.abandon(this.detail.q); this.detail = null; });
          else if (d.focus === 1) this.toggleTracked(d.q);
          else this.detail = null;
        }
        else if (k === AVK.CLR) this.detail = null;
      }
      return true;
    }
    for (const k of presses) {
      if (k === AVK.UP) this.sel = (this.sel + 5) % 6;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % 6;
      else if (k === AVK.OK) { const a = active[this.sel]; if (a) this.detail = { q: a.q, scroll: { y: 0 }, focus: 0 }; }
      else return false;
    }
    return true;
  }

  tracked(q: number): boolean { return !this.fs.story.counters[untrackKey(q)]; }

  private toggleTracked(q: number): void {
    const c = this.fs.story.counters, k = untrackKey(q);
    if (c[k]) delete c[k]; else c[k] = 1;
  }

  /** FUN_0001c59c: back to "available", accept items taken back, slot removed */
  private abandon(q: number): void {
    const { story, sdb, inv } = this.fs;
    delete story.counters[untrackKey(q)];                            // a quest taken again is tracked again
    story.qs[q] = 1;
    story.active = story.active.filter((a) => a.q !== q);
    const it = sdb.quests[q].acceptItem;
    if (it >= 0 && it < 100) inv.removeKey(it);                     // only the key store is searched (0x1d stays)
  }

  protected rewardLines(q: number): string[] {
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
}
