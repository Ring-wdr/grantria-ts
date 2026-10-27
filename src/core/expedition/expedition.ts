// 원정(가제) (not in the original): a standalone roguelike extra mode, reached from the title's 엑스트라 submenu.
// It stands apart from main play: no save slot (a run lives in memory only), and nothing here imports the field game,
// combat, rules or saves (tests/boundary.test.ts). For now a placeholder screen; the back key returns to the title.
// State and keys; the host draws it (web/expedition/expedition.ts).
// Plain fields, no constructor parameter properties: node's type stripping loads core/ in tests.
import { AVK } from '../keys';

/** what the mode needs from its host: the way back to the title (core/scenes/host.ts Screens has it) */
export interface ExpeditionHost {
  readonly screens: { title(): void };
}

export class ExpeditionLogic {
  protected readonly ctx: ExpeditionHost;
  constructor(ctx: ExpeditionHost) { this.ctx = ctx; }

  update(presses: number[]): void {
    for (const k of presses) if (k === AVK.CLR) { this.ctx.screens.title(); return; }
  }
}
