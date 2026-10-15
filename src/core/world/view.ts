// 2.5D view angle: the camera turns in 45° steps (Arcturus' + and x views) and the movement input turns with it, so
// "up" on screen stays "away from the camera". The game logic keeps its 4-direction grid: only the key -> world
// direction mapping and the facing drawn on screen change. Not in the original.
import { AVK } from '../keys';
import type { InputState, Stick } from '../input';

/** clockwise order of the direction keys, starting at screen up */
const CW = [AVK.UP, AVK.RIGHT, AVK.DOWN, AVK.LEFT] as const;
/** Dir (0 left, 1 right, 2 up, 3 down) -> index in CW */
const DIR_CW = [3, 1, 0, 2] as const;
const CW_DIR = [2, 1, 3, 0] as const;

const STEP = 45;
/** degrees turned per tick while the view moves to its target (45° in 5 ticks = 0.25 s at 20 Hz) */
const TURN_SPEED = 9;

const norm = (a: number) => ((a % 360) + 360) % 360;

/**
 * Quarter turns (0..3) of the logic grid under a view yaw: the screen-up key moves the player along the world axis
 * nearest to "away from the camera". At an odd multiple of 45° both neighbours are equally near; the lower quarter
 * wins, so 45° keeps the + mapping and 135° the next one.
 */
export function quarterOf(yaw: number): number {
  return Math.floor(norm(yaw) / 90 + 0.5 - 1e-6) & 3;
}

/** a direction key pressed on screen -> the world direction key under q quarter turns (other keys unchanged) */
export function screenKeyToWorld(key: number, q: number): number {
  const i = CW.indexOf(key as (typeof CW)[number]);
  return i < 0 ? key : CW[(i + q) & 3];
}

/** a world facing (Dir) -> the facing to draw on screen under q quarter turns */
export function worldDirToScreen(dir: number, q: number): 0 | 1 | 2 | 3 {
  return CW_DIR[(DIR_CW[dir & 3] - q + 4) & 3];
}

/** stick angle (degrees, y down) on screen -> world, and the dominant-axis key of the result */
function rotateStick(s: Stick, yaw: number): Stick {
  const angle = s.angle + yaw, r = (angle * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r);
  const key = !s.key ? 0 : Math.abs(c) >= Math.abs(n) ? (c >= 0 ? AVK.RIGHT : AVK.LEFT) : (n >= 0 ? AVK.DOWN : AVK.UP);
  return { ...s, angle, key };
}

/**
 * The input as the player logic should see it under the view: direction keys and the stick turned into world
 * directions (by the target yaw, so a turn answers at once). Keys are turned by whole quarters (the 4-direction grid), the stick by the exact yaw (it already
 * moves diagonally).
 */
export function viewInput(base: InputState, view: { readonly target: number }): InputState {
  return {
    get stick() { return view.target === 0 ? base.stick : rotateStick(base.stick, view.target); },
    isHeld(k: number): boolean {
      const q = quarterOf(view.target);
      return base.isHeld(q === 0 ? k : screenKeyToWorld(k, (4 - q) & 3));
    },
    direction(): number {
      const d = base.direction();
      return d ? screenKeyToWorld(d, quarterOf(view.target)) : 0;
    },
  };
}

/** View yaw state: a target on the 45° grid, the drawn yaw easing toward it, an optional lock (fixed bosses). */
export class ViewAngle {
  /** drawn yaw in degrees, 0..360 */
  yaw = 0;
  /** target yaw, a multiple of 45 */
  target = 0;
  /** yaws this map allows (multiples of 45); [0] = the camera never turns */
  allowed: number[] = [0, 45, 90, 135, 180, 225, 270, 315];
  /** while set the view goes back to `home` and ignores turns (a boss without 4-direction art is on the map) */
  locked = false;
  /** the map's default yaw */
  home = 0;

  /** turn one step clockwise (+1) or counter-clockwise (-1) to the next allowed yaw; false when nothing changed */
  turn(step: 1 | -1): boolean {
    if (this.locked || this.allowed.length < 2) return false;
    for (let k = 1; k <= 8; k++) {
      const a = norm(this.target + step * STEP * k);
      if (this.allowed.includes(a)) { this.target = a; return true; }
    }
    return false;
  }

  /** set the allowed yaws and the default of a newly entered map; the view jumps there without turning */
  reset(allowed: number[] | undefined, home = 0): void {
    this.allowed = allowed?.length ? allowed.map(norm) : [0, 45, 90, 135, 180, 225, 270, 315];
    this.home = norm(home);
    if (!this.allowed.includes(this.home)) this.allowed.push(this.home);
    if (this.locked || !this.allowed.includes(this.target)) this.target = this.home;
    this.yaw = this.target;
  }

  lock(on: boolean): void {
    this.locked = on;
    if (on) this.target = this.home;
  }

  /** whether the view is still turning */
  get turning(): boolean { return this.yaw !== this.target; }

  /** once per tick: ease the drawn yaw toward the target along the shorter way */
  tick(): void {
    if (this.yaw === this.target) return;
    let d = norm(this.target - this.yaw);
    if (d > 180) d -= 360;
    this.yaw = Math.abs(d) <= TURN_SPEED ? this.target : norm(this.yaw + Math.sign(d) * TURN_SPEED);
  }
}
