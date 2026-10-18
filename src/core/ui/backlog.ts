// 대사 로그 (not in the original): event talk, captions and NPC lines of this play session, newest last.
// Kept in memory only (a new PlayScene starts it empty). BacklogReader is the open log's scroll and keys; the host
// draws it (web/game/backlog.ts).
import { AVK } from '../keys';
import type { ScrollRef } from '../render';

const MAX = 300;
/** reader scroll steps: a line (13 px) and a page */
const LINE = 13, PAGE = 200;

export interface LogEntry {
  name: string;
  text: string;
  /** game text id, -1 when unknown */
  textId: number;
  kind: 'talk' | 'caption';
}

export type Backlog = ReturnType<typeof makeLog>;

function makeLog() {
  const entries: LogEntry[] = [];
  return {
    entries: entries as readonly LogEntry[],
    push(e: LogEntry): void {
      if (!e.text) return;
      entries.push(e);
      if (entries.length > MAX) entries.splice(0, entries.length - MAX);
    },
    clear(): void { entries.length = 0; },
  };
}

/** the play session's log */
export const backlog = makeLog();
/** 회상: the lines of the scene being replayed (emptied when one starts), kept out of the play log */
export const replayLog = makeLog();

/** the log open over the game: ↑↓ scroll a line, ←→ a page, Esc / 5 / L (pad □) close */
export class BacklogReader {
  /** starts at the newest entry (the renderer clamps the overshoot) */
  readonly scroll: ScrollRef = { y: 1e6 };

  constructor(readonly log: Backlog = backlog) {}

  /** false once closed */
  update(presses: number[]): boolean {
    for (const k of presses) {
      if (k === AVK.UP) this.scroll.y = Math.max(0, this.scroll.y - LINE * 2);
      else if (k === AVK.DOWN) this.scroll.y += LINE * 2;
      else if (k === AVK.LEFT) this.scroll.y = Math.max(0, this.scroll.y - PAGE);
      else if (k === AVK.RIGHT) this.scroll.y += PAGE;
      else if (k === AVK.CLR || k === AVK.OK || k === AVK.LOG || k === AVK.K1) return false;
    }
    return true;
  }
}
