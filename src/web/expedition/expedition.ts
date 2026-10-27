// 원정(가제) (not in the original): the standalone roguelike extra mode. A placeholder screen for now.
// The state and keys are core/expedition/expedition.ts; this draws them. Like the core side it stays apart from main
// play: no imports of the field game, combat, rules or saves (tests/boundary.test.ts).
import { AVK } from '../input/input';
import type { GameContext } from '../game/scene';
import { h, padBadge } from '../render/view';
import { ExpeditionLogic } from '../../core/expedition/expedition';
import './expedition.css';

export class ExpeditionScene extends ExpeditionLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    super(ctx);
    ctx.input.uiMode = true; ctx.input.zones = []; ctx.input.padField = false; ctx.input.confirm = false;
  }

  override update(presses: number[]): void {
    for (const t of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(t.x, t.y); if (k) presses = [...presses, ...k]; }
    super.update(presses);
  }

  draw(): void {
    const u = this.ctx.ui;
    u.begin();
    u.fill(0, 0, 480, 320, 0x101820);
    u.view('expedition', 0, 0, 480, 320, h('div.v-fill.v-col.ex-screen', null,
      h('div.ex-title', null, '원정(가제)'),
      h('div.ex-sub', null, '프로토타입 준비 중'),
      h('div.v-row.ex-back', { on: () => [AVK.CLR] }, padBadge(this.ctx.input, AVK.CLR), h('span', null, '타이틀로 돌아가기'))));
    u.closeButton(-44);
    u.endClear();
  }
}
