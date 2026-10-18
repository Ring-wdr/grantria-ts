// Item action popup (FUN_00055820 / FUN_000552e0 / FUN_00055004): a column of actions beside the selected cell. The
// state and keys; the host draws it (web/game/tabs.ts drawAction / actionAnchor) and advances its opening frames.
import { AVK } from '../keys';

export class ActionPopup {
  sel = 0;
  private c = 0;
  /** side / up: which way it opens from the cell so it stays inside the window */
  constructor(readonly entries: number[], readonly side: 'left' | 'right' = 'right', readonly up = false) {}
  /** returns the chosen action id, 0 for cancel, or null */
  handle(presses: number[]): number | null {
    if (this.c < 3) return null;
    for (const k of presses) {
      if (k === AVK.UP) this.sel = (this.sel + this.entries.length - 1) % this.entries.length;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % this.entries.length;
      else if (k === AVK.CLR) return 0;
      else if (k === AVK.OK) return this.entries[this.sel];
    }
    return null;
  }
  /** one drawn frame: the opening frames gate input, as the original slide-in */
  frame(): void { this.c = this.c < 10 ? this.c + 1 : 3; }
}
