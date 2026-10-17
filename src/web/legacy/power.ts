// The 0.1.7 power profile: everything the 0.1.8 heat work changed (2788013, 584c79c, 3d5ef40, aa5790d, 8aa3fa2)
// as 0.1.7 had it. Bug fixes and features since 0.1.7 stay in (each legacy file names the ones it keeps).
// Retired from here (both ways now): the debug line under the stage, built in dev builds only; the never-drawn
// #overlay canvas, gone; the virtual stick, drawn after the other touch buttons.
import type { PowerProfile } from '../power';
import { LegacyAudio } from './audio';
import { LegacyCompositor } from './compositor';
import { LegacyDomUi } from './domUi';
import { LegacyMinimap } from './minimap';
import { everyFrame } from './pacing';

export const LEGACY: PowerProfile = {
  pacer: everyFrame,
  gl: { antialias: false, preserveDrawingBuffer: true },
  refreshCap: false,                                               // the screen's own refresh rate
  Audio: LegacyAudio,
  Compositor: LegacyCompositor,
  DomUi: LegacyDomUi,
  Minimap: LegacyMinimap,
};
