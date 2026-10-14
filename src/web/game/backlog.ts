// 대사 로그 (not in the original): event talk, captions and NPC lines of this play session, newest last.
// L / pad □ during dialogue (or L on the field) opens it over the game, which stands still while it is open;
// ↑↓ scroll a line, ←→ a page, Esc / 5 / L close. Kept in memory only (a new PlayScene starts it empty).
import { AVK } from '../input/input';
import { button, gt, h, type ScrollRef } from '../render/view';
import type { Ui } from '../render/ui';
import { inlineHint } from './dialogue';
import type { PadKind } from '../input/gamepad';
import '../styles/convenience.css';

const W = 480, H = 320;
const MAX = 300;
const LINE = 13;

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

/** event text breaks lines with '@' (dialogue.ts); the view text uses '|@' */
function viewText(s: string): string {
  return s.replace(/(?<!\|)@ ?/g, '|@');
}

export class BacklogView {
  /** starts at the newest entry (the browser clamps the overshoot) */
  private scroll: ScrollRef = { y: 1e6 };

  constructor(private log: Backlog = backlog) {}

  /** false once closed */
  update(presses: number[]): boolean {
    for (const k of presses) {
      if (k === AVK.UP) this.scroll.y = Math.max(0, this.scroll.y - LINE * 2);
      else if (k === AVK.DOWN) this.scroll.y += LINE * 2;
      else if (k === AVK.LEFT) this.scroll.y = Math.max(0, this.scroll.y - 200);
      else if (k === AVK.RIGHT) this.scroll.y += 200;
      else if (k === AVK.CLR || k === AVK.OK || k === AVK.LOG || k === AVK.K1) return false;
    }
    return true;
  }

  draw(u: Ui, input: { device: string; padKind: PadKind }): void {
    const rows = this.log.entries.map((e) => e.kind === 'caption'
      ? h('div.log-entry.caption', null, gt(viewText(e.text), { pen: 0xc618 }))
      : h('div.log-entry', null,
        e.name && h('div.log-name', null, gt(e.name, { pen: 0xffe0 })),
        gt(viewText(e.text))));
    u.view('backlog', 0, 0, W, H, h('div.v-modal.log-modal', { on: () => [] },
      h('div.v-col.log-window', null,
        h('div.v-row.log-head', null, h('span.v-grow', null, '대사 로그'),
          button('닫기', { cls: 'dlg-btn', glow: false, on: () => [AVK.CLR] })),
        h('div.v-grow.v-scroll.log-list', { scroll: this.scroll },
          rows.length ? rows : h('div.log-empty', null, '아직 기록된 대사가 없습니다.')),
        h('div.log-foot', null, input.device === 'touch' ? '닫기 버튼으로 닫습니다'
          : ['↑↓ 스크롤 · ←→ 페이지 · ', inlineHint(input, AVK.OK), ' ', inlineHint(input, AVK.CLR), ' 닫기']))));
  }
}
