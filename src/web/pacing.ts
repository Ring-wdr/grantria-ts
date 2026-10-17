// Frame pacing: when the game loop (app.ts frame()) runs a tick and asks for the next animation frame.
// The power profile (power.ts) picks one: tickAligned here is the current way (절전 모드), legacy/pacing.ts the 0.1.7 one.

export interface FramePacer {
  /** one more tick is due with `acc` ms built up */
  due(acc: number, tickMs: number): boolean;
  /** ask for the next frame; `now` is this frame's time, `acc` what is left after its ticks */
  next(frame: FrameRequestCallback, now: number, acc: number, tickMs: number, padConnected: boolean): void;
}

/** Animation frames are only requested around the ticks (a timer wakes the loop WAKE_MS before the next one is due),
 *  except while a gamepad is connected: then every frame, so short presses are not missed. Each animation frame runs
 *  a BeginMainFrame through Blink and the WebView compositor even when the tick draws nothing (3 of 4 frames at 15 Hz).
 *  A tick runs on the frame nearest its due time (up to EARLY_MS early;
 *  `acc` keeps the average rate exact). WAKE_MS leaves the timer some slack over EARLY_MS, or a timer firing a little
 *  late misses that frame and the tick lands a frame later (33 / 67 ms gaps instead of 50). CSS animations are
 *  unaffected: transform / opacity ones run on the compositor, others request their own frames from Blink. */
const WAKE_MS = 10, EARLY_MS = 8;

export const tickAligned: FramePacer = {
  due: (acc, tickMs) => acc >= tickMs - EARLY_MS,
  next(frame, now, acc, tickMs, padConnected) {
    // from the frame time `now`, not from here: the tick and the draw took part of the wait already
    const wait = tickMs - acc - WAKE_MS - (performance.now() - now);
    if (padConnected || wait < 20) requestAnimationFrame(frame);
    else setTimeout(() => requestAnimationFrame(frame), wait);
  },
};
