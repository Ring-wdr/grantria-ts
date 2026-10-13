// Vibration (FUN_00077da0 -> Java mVibration -> Vibrator.vibrate): always 500 ms, skipped when the option 진동 is off.
// The original calls it after a settings change, on a skill / projectile hit on a monster, on a strong hit and when
// the player is hurt. Here it drives the platform haptics (src/web/platform.ts: phone vibration and gamepad rumble).

import { platform } from '../core/platform';

const MS = 500;

export function vibrate(on: number | boolean): void {
  if (on) platform().vibrate(MS);
}
