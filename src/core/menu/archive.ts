// 기록실 (not in the original): 게임 메뉴 → 환경설정 → 기록실 (the original 몬스터도감 row, optionTab.ts) lists 몬스터 도감
// (the original book) and these pages (←→ between them): 아이템 도감, 보스 기록 with the 보스 러시, 도전과제 (the
// original 50 and the added ones) and 출석 · 심연. Records are account-wide (core/rules/records.ts); attendance and
// challenges per slot. 회상 is on the title screen (replay.ts).
// State and keys; the host draws it (web/game/archive.ts).
import { AVK } from '../keys';
import type { FieldGame } from '../field/fieldGame';
import type { Host } from '../host';
import type { ScrollRef } from '../render';
import { records } from '../rules/records';
import { PORTED_BOSSES } from '../combat/boss';

/** the 기록실 list: 몬스터 도감 (the original book screens in optionTab.ts), then the archive pages */
export const RECORD_ROWS = ['몬스터 도감', '아이템 도감', '보스 기록', '도전과제', '출석 · 심연'];
export const PAGES = RECORD_ROWS.slice(1);
const ROW_H = 18;

/** what the archive asks its owner (the play scene) to start */
export type Launch = { kind: 'rush' };

/** "mm:ss" of a tick count at 20 ticks a second */
export function ticksText(t: number): string {
  const s = Math.round(t / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** bosses the rush can bring back: killed in their story room (records), in story order */
export function rushBosses(): { type: number; map: number }[] {
  const r = records();
  return PORTED_BOSSES.map((type) => ({ type, map: r.bosses[type]?.map ?? -1 })).filter((b) => b.map >= 0);
}

export class ArchivePanelLogic {
  protected cur = 0;
  protected scroll: ScrollRef = { y: 0 };
  launch: Launch | null = null;

  /** page: 0 아이템 도감, 1 보스 기록, 2 도전과제, 3 출석 · 심연 */
  constructor(protected readonly ctx: Host, protected readonly fs: FieldGame, protected page = 0) {}

  protected get rows(): number { return this.page === 1 ? 1 : 0; }   // the 보스 러시 button

  /** false once closed */
  update(presses: number[]): boolean {
    for (const k of presses) {
      if (k === AVK.LEFT || k === AVK.TAB_L) this.go((this.page + PAGES.length - 1) % PAGES.length);
      else if (k === AVK.RIGHT || k === AVK.TAB_R) this.go((this.page + 1) % PAGES.length);
      else if (k === AVK.UP) { if (this.rows) this.move(Math.max(0, this.cur - 1)); else this.scroll.y = Math.max(0, this.scroll.y - ROW_H * 2); }
      else if (k === AVK.DOWN) { if (this.rows) this.move(Math.min(this.rows - 1, this.cur + 1)); else this.scroll.y += ROW_H * 2; }
      else if (k === AVK.OK) this.activate();
      else if (k === AVK.CLR) return false;
    }
    return true;
  }

  private go(p: number): void { this.page = p; this.cur = 0; this.scroll.y = 0; }

  protected move(i: number): void {
    this.cur = i;
    const top = i * ROW_H, view = 7 * ROW_H;
    if (top < this.scroll.y) this.scroll.y = top;
    else if (top + ROW_H > this.scroll.y + view) this.scroll.y = top + ROW_H - view;
  }

  private activate(): void {
    if (this.page === 1 && rushBosses().length) this.launch = { kind: 'rush' };
  }
}
