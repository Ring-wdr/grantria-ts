// The gathering gauge; the gathering itself is core/rules/gather.ts.
import type { GatherRun } from '../../core/rules/gather';
import type { Ui } from '../render/ui';

/** FUN_0002eae8 gauge above the node (screen coordinates of the node origin); white bar while flashing */
export function drawGatherGauge(u: Ui, run: GatherRun, nx: number, ny: number): void {
  if (run.c62 === 0) return;
  const x = nx, y = ny - 46, cur = Math.min(run.c62 === 4 ? 61 : run.cur, 61);
  const bar = run.flash ? 0xffffff : 0xffdd00, done = run.flash ? 0xffffff : 0xff6600;
  u.alpha = run.alpha;
  u.fill(x - 28, y, 73, 15, 0xffffff);
  u.fill(x - 26, y + 2, 69, 11, 0);
  u.fill(x - 24, y + 4, 64, 7, 0x666666);
  u.fill(x - 23, y + 5, cur, 5, bar);
  u.fill(x - 23, y + 5, Math.min(cur, run.c66 + 20), 5, done);
  const sh = run.shake ? 6 : 0;
  u.fill(x - 23 + run.c66 + 18, y + 2 - sh, 3, 11 + 2 * sh, 0xffffff);   // timing window; arrows shake ∓6
  u.alpha = 16; u.fill(x - 23, y + 6, cur, 2, 0xffffff);
  u.alpha = 32;
}
