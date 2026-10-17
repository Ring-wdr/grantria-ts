// 0.1.7 frame pacing (before 3d5ef40 / 8aa3fa2): a frame every vsync, a tick once a whole tickMs has built up.
import type { FramePacer } from '../pacing';

export const everyFrame: FramePacer = {
  due: (acc, tickMs) => acc >= tickMs,
  next: (frame) => { requestAnimationFrame(frame); },
};
