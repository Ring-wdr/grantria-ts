// Data management (title "info" icon): JSON backup of every web save, and import / export of the
// original save.dat / gamedata.dat through file upload and download (account.md §5.3).
// The state and keys are core/scenes/data.ts; this draws them.
import { AVK } from '../input/input';
import type { GameContext } from './scene';
import { frozenTitle, render } from './screens';
import { button, gt, h, sprite } from '../render/view';
import { DataLogic } from '../../core/scenes/data';
import '../styles/screens-misc.css';
import { platform } from '../../core/platform';

const ITEMS = ['백업 내보내기 (JSON)', '백업 가져오기 (JSON)', '원본 세이브 가져오기', '원본 세이브 내보내기'];

export class DataScene extends DataLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    super(ctx);
    ctx.input.uiMode = true; ctx.input.zones = [];
  }

  override update(presses: number[]): void {
    for (const tap of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(tap.x, tap.y); if (k) presses = [...presses, ...k]; }
    super.update(presses);
  }

  readonly wide = true;                                               // over the title backdrop

  draw(): void {
    render(this.ctx, () => {
      frozenTitle(this.ctx);
      const u = this.ctx.ui;
      u.pushCenter220();
      u.view('data', 0, 0, 0xdc, 0xd4, h('div.sm-win.u-window.v-col.v-fill.sm-panel', null,
        [0, 1, 2, 3].map((i) => sprite('c', 104, 37, 8, 8, { cls: `u-corner c${i}` })),
        h('div.v-row.sm-head', null, gt('데이터 관리', { pen: 0xffe0, cls: 'v-grow sm-title' })),
        h('div.v-col.v-grow.sm-data-list', null, ITEMS.map((s, i) => button(gt(s), {
          sel: i === this.cur, cls: this.busy && i === this.cur ? 'sm-busy' : '', on: () => { if (this.cur === i) return [AVK.OK]; this.cur = i; },
        }))),
        h('div.v-box.sm-data-note', null,
          gt(this.msg || `${platform().saveLocation} ` + '원본 파일은 같은 이름(save.dat.회원번호)으로 내보내야 원본 앱에서 읽힙니다.'))));
      u.pop();
      u.closeButton();
    });
  }
}
