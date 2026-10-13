// option.dat (game-flow-ui.md §3.5, engine.md §5): volume, vibration, speed, minimap, screen effects.
// Defaults from FUN_00020bdc: 1, 1, 2, 1, 1. Stored apart from the save slots, like the original file.
import { platform } from '../platform';

const KEY = 'grantria.option';

export interface Options {
  volume: number;
  vibration: number;
  speed: number;
  minimap: number;
  effects: number;
  /** not in option.dat: on a touch-first screen, scale the stage to fill the screen and draw the field into
   *  the side margins (app.ts fit()) instead of whole-number scaling with black bars */
  fullscreen: number;
}

/** value counts per setting row (DAT_003ce20c) */
export const OPTION_COUNTS = [2, 2, 3, 2, 2];
export const OPTION_KEYS: (keyof Options)[] = ['volume', 'vibration', 'speed', 'minimap', 'effects'];

export function defaultOptions(): Options {
  return { volume: 1, vibration: 1, speed: 2, minimap: 1, effects: 1, fullscreen: 0 };
}

export function loadOptions(): Options {
  const o = defaultOptions();
  try {
    const raw = platform().storage.get(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Options>;
      OPTION_KEYS.forEach((k, i) => {
        const v = d[k];
        if (typeof v === 'number' && v >= 0 && v < OPTION_COUNTS[i]) o[k] = v;
      });
      if (d.fullscreen === 0 || d.fullscreen === 1) o.fullscreen = d.fullscreen;
    }
  } catch { /* storage unavailable */ }
  return o;
}

export function saveOptions(o: Options): void {
  try {
    platform().storage.set(KEY, JSON.stringify(o));
  } catch { /* storage unavailable */ }
}

/** frames per second: mSpeed(4 - speed) with mspeed = {10,20,20,15,15,10,10} -> 15 / 15 / 20 */
export function optionFps(o: Options): number {
  return [10, 20, 20, 15, 15, 10, 10][4 - o.speed] ?? 20;
}
