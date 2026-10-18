// 대사 로그 (not in the original): event talk, captions and NPC lines of this play session, newest last.
// L / pad □ during dialogue (or L on the field) opens it over the game, which stands still while it is open;
// ↑↓ scroll a line, ←→ a page, Esc / 5 / L close. The log and its reader are core/ui/backlog.ts.
import { AVK } from '../input/input';
import { button, gt, h } from '../render/view';
import type { Ui } from '../render/ui';
import { inlineHint } from './dialogue';
import type { PadKind } from '../input/gamepad';
import '../styles/convenience.css';
import type { BacklogReader } from '../../core/ui/backlog';

const W = 480, H = 320;

/** event text breaks lines with '@' (dialogue.ts); the view text uses '|@' */
function viewText(s: string): string {
  return s.replace(/(?<!\|)@ ?/g, '|@');
}

/** the open log (core/ui/backlog.ts BacklogReader) over the game */
export function drawBacklog(u: Ui, r: BacklogReader, input: { device: string; padKind: PadKind }): void {
  const rows = r.log.entries.map((e) => e.kind === 'caption'
    ? h('div.log-entry.caption', null, gt(viewText(e.text), { pen: 0xc618 }))
    : h('div.log-entry', null,
      e.name && h('div.log-name', null, gt(e.name, { pen: 0xffe0 })),
      gt(viewText(e.text))));
  u.view('backlog', 0, 0, W, H, h('div.v-modal.log-modal', { on: () => [] },
    h('div.v-col.log-window', null,
      h('div.v-row.log-head', null, h('span.v-grow', null, '대사 로그'),
        button('닫기', { cls: 'dlg-btn', glow: false, on: () => [AVK.CLR] })),
      h('div.v-grow.v-scroll.log-list', { scroll: r.scroll },
        rows.length ? rows : h('div.log-empty', null, '아직 기록된 대사가 없습니다.')),
      h('div.log-foot', null, input.device === 'touch' ? '닫기 버튼으로 닫습니다'
        : ['↑↓ 스크롤 · ←→ 페이지 · ', inlineHint(input, AVK.OK), ' ', inlineHint(input, AVK.CLR), ' 닫기']))));
}
