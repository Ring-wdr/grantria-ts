// 대사 로그 (not in the original): event talk, captions and NPC lines of this play session, newest last.
// Kept in memory only (a new PlayScene starts it empty); the log view is web/game/backlog.ts.
const MAX = 300;

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
