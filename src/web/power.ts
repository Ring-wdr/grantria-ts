// 절전 모드 (편의 설정, options.powerSave), read once at launch: which of two whole ways runs the game's rendering,
// sound and frame loop. On: the current way (SAVING here, 0.1.8 on). Off: the 0.1.7 way (legacy/power.ts), every
// optimisation since then undone and every bug fix and feature kept.
// This is the only module that imports legacy/ (tests/boundary.test.ts), and nothing else reads powerSave: the
// game gets the profile (GameContext.power) and builds from it. Retiring the 0.1.7 way is deleting legacy/ and its
// line here.
import type { WebGLRenderer, WebGLRendererParameters } from 'three';
import type { Options } from '../core/save/options';
import type { WebAssets } from './assets';
import { GameAudio, type Sound } from './audio';
import { tickAligned, type FramePacer } from './pacing';
import { Compositor } from './render/compositor';
import { DomUi } from './render/domUi';
import { Minimap } from './render/minimap';
import { LEGACY } from './legacy/power';

export interface PowerProfile {
  /** when the loop ticks and asks for the next frame */
  readonly pacer: FramePacer;
  /** WebGLRenderer parameters besides the canvas */
  readonly gl: Omit<WebGLRendererParameters, 'canvas'>;
  /** ask the host for 60 Hz on a 90 / 120 Hz screen (Platform.refreshCap) */
  readonly refreshCap: boolean;
  readonly Audio: new () => Sound;
  /** the compositor, and through it the kind of sprite layer (Compositor.newLayer) */
  readonly Compositor: new (renderer: WebGLRenderer) => Compositor;
  readonly DomUi: typeof DomUi;
  readonly Minimap: new (assets: WebAssets) => Minimap;
}

export const SAVING: PowerProfile = {
  pacer: tickAligned,
  // the canvas is never read back (the compositor reads its own targets) and nothing is depth-tested: no preserved
  // buffer (the browser swaps instead of copying each frame), no depth or stencil buffer
  gl: { antialias: false, depth: false, stencil: false, powerPreference: 'low-power' },
  // the game draws at 20 Hz and its UI animations need no more than 60
  refreshCap: true,
  Audio: GameAudio,
  Compositor,
  DomUi,
  Minimap,
};

export function powerProfile(o: Options): PowerProfile {
  return o.powerSave ? SAVING : LEGACY;
}
