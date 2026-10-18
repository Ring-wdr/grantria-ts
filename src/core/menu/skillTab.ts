// Skill tab 0x20 (FUN_0005b160 -> grid FUN_0004c0bc, keys FUN_00056e4c), analysis/features/ui-tabs.md
// §0.6 and game-rules.md §4. Active / passive investment with the original checks; the third
// sub-tab invests account trait points (gamedata 0x35c, account.ts, account.md §2.2).
// State and keys; the host draws it (web/game/skillTab.ts).
import type { FieldGame } from '../field/fieldGame';
import { AVK, slotPickerKey } from '../keys';
import { Popup, openPopup } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';
import { account, traitCheck, traitCommit } from '../rules/account';
import { skillMaxCd } from '../rules/skills';
import { skillReqLevel } from '../data/skillDetail';
import type { Host } from '../host';

export const CELLS = [9, 7, 12];

/** Tab cell (tier*3 + group) -> action id / icon index (group*3 + tier); d+0x2558b is the inverse. */
export const actionOf = (idx: number) => (idx % 3) * 3 + Math.trunc(idx / 3);

export class SkillTabLogic {
  protected sub = 0;
  protected focus: 0 | 1 = 0;
  protected sel = 0;              // 1-based, 0 = none
  protected f = 0;
  private t = 0;
  /** popups over the tab */
  protected readonly overlays = new OverlayStack();
  protected quick: { cur: number; action: number } | null = null;

  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame) {}

  /** skill detail MENUPOP 2 ('*' with a cell selected, FUN_0002daec) */
  protected detail = false;

  get busy(): boolean { return !!(this.overlays.size || this.quick || this.detail); }
  /** the quick-slot picker is open (its slot keys must not page the menu) */
  get picking(): boolean { return !!this.quick; }

  protected learned(idx: number): number {
    return this.sub === 0 ? this.fs.skills[idx] : this.sub === 1 ? this.fs.skills[9 + idx] : account().traits[idx] ?? 0;
  }

  update(presses: number[]): boolean {
    this.t++;
    if (this.f < 15) this.f++;
    if (this.overlays.update(presses)) return true;
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
      if (this.overlays.size) break;   // an overlay opened by an earlier key takes the rest
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

  /** popup p for skill idx: only the confirmation 0x26 invests on yes, the checks' popups are messages */
  private ask(p: Popup, idx: number): void { openPopup(this.overlays, p, p.id === 0x26 ? () => this.invest(idx) : undefined); }

  /** Checks of the investment (popups 0x28 / 0x27 / 0x2A / 0x29), then confirmation 0x26. */
  private tryInvest(idx: number): void {
    const fs = this.fs, ctx = this.ctx, t = ctx.assets.text;
    if (this.sub === 2) { this.ask(new Popup(ctx, traitCheck(idx + 1)), idx); return; }   // 0x28 / 0x27 / 0x26
    const lv = this.learned(idx);
    if (lv > 9) { this.ask(new Popup(ctx, 0x28), idx); return; }
    const cost = this.sub === 0 ? fs.db.a.d8(0x24695 + Math.trunc(idx / 3) * 10 + lv) : 1;
    if (fs.skillPoints < cost) { this.ask(new Popup(ctx, 0x27), idx); return; }
    if (this.sub === 0) {
      if (fs.model.level < skillReqLevel(fs.db.a, fs.model.cls, idx)) { this.ask(new Popup(ctx, 0x2a), idx); return; }
      if (idx >= 3 && fs.skills[idx - 3] < 5) {
        const name = t[0xc9c + fs.model.cls * 9 + idx - 3] ?? '';
        this.ask(new Popup(ctx, 0x29, 0, (s) => s.replace('%s', name).replace('%d', '5')), idx);
        return;
      }
    }
    this.ask(new Popup(ctx, 0x26), idx);
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
}
