// The input the game logic reads each tick, already normalised to the original virtual keys (AVK).
// Hosts fill it from keyboard, touch and gamepads (src/web/input/input.ts).

/** analogue stick (touch stick or pad left stick) */
export interface Stick {
  active: boolean;
  angle: number;
  level: number;
  /** dominant-axis direction key the original also generates, or 0 */
  key: number;
  /** raw offset from the stick centre in virtual pixels (drives the knob drawing) */
  dx: number;
  dy: number;
}

/** the device used last: on-screen hints and the menu ring follow it */
export type InputDevice = 'keyboard' | 'touch' | 'pad';

export interface InputState {
  readonly stick: Stick;
  readonly device: InputDevice;
  isHeld(k: number): boolean;
  /** the direction key to act on this tick, or 0 */
  direction(): number;
}
