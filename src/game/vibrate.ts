// Vibration (FUN_00077da0 -> Java mVibration -> Vibrator.vibrate): always 500 ms, skipped when the option 진동 is off.
// The original calls it after a settings change, on a skill / projectile hit on a monster, on a strong hit and when
// the player is hurt. Here it drives the phone (navigator.vibrate) and every connected gamepad with a rumble motor.

const MS = 500;

export function vibrate(on: number | boolean): void {
  if (!on) return;
  try { navigator.vibrate?.(MS); } catch { /* not allowed (no user gesture yet, or blocked) */ }
  let pads: (Gamepad | null)[] = [];
  try { pads = navigator.getGamepads?.() ?? []; } catch { return; }
  for (const gp of pads) {
    const act = (gp as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    if (act?.playEffect) void act.playEffect('dual-rumble', { duration: MS, strongMagnitude: 1, weakMagnitude: 1 }).catch(() => {});
  }
}
