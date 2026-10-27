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
  /** not in option.dat: scale the stage to fill the screen and draw the field into the side margins (app.ts fit())
   *  instead of whole-number scaling with black bars; on a desktop the window goes OS fullscreen too (F11 /
   *  Alt+Enter). Until the player sets it (fullscreenSet) it follows the screen: a phone or tablet starts in
   *  fullscreen, a desktop does not */
  fullscreen: number;
  fullscreenSet: number;
  /** not in option.dat (편의 설정, game/convenience.ts): music / sound effect volume 0..10 (10 = the original gains) */
  bgm: number;
  sfx: number;
  /** typewriter: 0 the original (1 character per tick), 1 ×2, 2 ×4, 3 the whole page at once */
  textSpeed: number;
  /** dialogue auto advance on / off, and its pace 0 slow, 1 normal, 2 fast */
  auto: number;
  autoSpeed: number;
  /** screen shake and white flashes: 0 the original, 1 reduced, 2 off */
  shake: number;
  flash: number;
  /** hold '5' (or the 빨리 넘기기 key) through dialogue: 0 off, 1 read lines only, 2 every line */
  skip: number;
  /** 이벤트 SKIP goes through the key waits and on after a quest popup (off by default: the original stops there) */
  skipThrough: number;
  /** extra HUD information (display only): HP / MP / EXP numbers (off by default: the original shows none), buff
   *  icons, boss HP bar, quest tracker (on by default) */
  hudNumbers: number;
  hudBuffs: number;
  hudBoss: number;
  hudQuests: number;
  /** seconds left on a quick slot's cooldown ring (on by default; display only) */
  hudCooldown: number;
  /** 오토루팅 once bought: on (the original, by default) or off — ground items are picked up by hand again */
  autoLoot: number;
  /** minimap quest NPC / warp stone icons, every active quest's destination on the map tab (on by default) */
  minimapIcons: number;
  mapQuests: number;
  /** autosave on entering a map where saving is allowed (off by default: death returns to the last save) */
  autosaveMap: number;
  /** after a 차원의 문 clear, offer the 심연 (stronger floors below) before the result (off by default: the original result) */
  abyss: number;
  /** 회상 이어서 보기: a scene that ends (or is skipped) goes on to the next one of the route (off by default) */
  replayChain: number;
  /** 절전 모드 (off by default): rendering, sound and frame loop as 0.1.8 on (on) or as 0.1.7 (off), web/power.ts;
   *  read at launch */
  powerSave: number;
}

/** value counts per setting row (DAT_003ce20c) */
export const OPTION_COUNTS = [2, 2, 3, 2, 2];
export const OPTION_KEYS: (keyof Options)[] = ['volume', 'vibration', 'speed', 'minimap', 'effects'];

/** settings outside option.dat with their value counts; the defaults keep the original behaviour (the HUD extras
 *  but the HP / MP / EXP numbers only add information and start on) */
export const EXTRA_COUNTS: Partial<Record<keyof Options, number>> = {
  fullscreen: 2, fullscreenSet: 2, bgm: 11, sfx: 11, textSpeed: 4, auto: 2, autoSpeed: 3, shake: 3, flash: 3,
  skip: 3, skipThrough: 2, hudNumbers: 2, hudBuffs: 2, hudBoss: 2, hudQuests: 2, hudCooldown: 2, autoLoot: 2, minimapIcons: 2, mapQuests: 2, autosaveMap: 2, abyss: 2, replayChain: 2, powerSave: 2,
};

export function defaultOptions(): Options {
  return { volume: 1, vibration: 1, speed: 2, minimap: 1, effects: 1, fullscreen: 0, fullscreenSet: 0,
    bgm: 10, sfx: 10, textSpeed: 0, auto: 0, autoSpeed: 1, shake: 0, flash: 0,
    skip: 1, skipThrough: 0, hudNumbers: 0, hudBuffs: 1, hudBoss: 1, hudQuests: 1, hudCooldown: 1, autoLoot: 1, minimapIcons: 1, mapQuests: 1, autosaveMap: 0, abyss: 0, replayChain: 0,
    powerSave: 0 };
}

/** strength of screen shake / white flashes for an option value: 1, 0.5, 0 */
export function fxScale(v: number): number {
  return v === 1 ? 0.5 : v === 2 ? 0 : 1;
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
      for (const [k, n] of Object.entries(EXTRA_COUNTS) as [keyof Options, number][]) {
        const v = d[k];
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n) o[k] = v;
      }
    }
  } catch { /* storage unavailable */ }
  if (!o.fullscreenSet) o.fullscreen = platform().touchFirst() ? 1 : 0;   // never chosen: fullscreen on a touch screen
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
