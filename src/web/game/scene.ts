// Screen/state framework (the original's drawHandle states, game-flow-ui.md §1).
import type * as THREE from 'three';
import type { Cmf } from '../../core/data/assets';
import type { WebAssets } from '../assets';
import type { Compositor } from '../render/compositor';
import type { Input } from '../input/input';
import type { DomUi } from '../render/domUi';
import type { Sound } from '../audio';
import type { PowerProfile } from '../power';
import type { Options } from '../../core/save/options';
import type { Screens } from '../../core/scenes/host';

export interface GameContext {
  assets: WebAssets;
  renderer: THREE.WebGLRenderer;
  compositor: Compositor;
  input: Input;
  /** screen-space UI layer and the 1.3x overlay layer L1 (popups), HTML/CSS */
  ui: DomUi;
  ui13: DomUi;
  /** field HUD layer (status bar, touch buttons, minimap, dialogue) under the screen UI */
  hud: DomUi;
  /** sprites used by menus (title logo, class idle animations) */
  cmfs: Record<string, Cmf>;
  audio: Sound;
  /** 절전 모드 on: the current way, off: the 0.1.7 way (power.ts), fixed at launch */
  power: PowerProfile;
  /** option.dat settings; applyOptions pushes volume / speed changes to audio and the tick rate */
  options: Options;
  applyOptions(): void;
  /** switch to another scene */
  go(scene: Scene): void;
  /** the screens the core flow goes to (core/scenes/host.ts), each a scene made here (screens.ts WebScreens) */
  readonly screens: Screens;
}

export interface Scene {
  /** one 50 ms tick with the virtual keys pressed since the previous tick */
  update(presses: number[]): void;
  /** render into the compositor target and the DOM UI layers */
  draw(): void;
  debugLine?(): string;
  /** fullscreen: the screen UI reaches into the side margins, so a fill over the whole view covers them too
   *  (the logo's white, the title backdrop); other screens stay in the 480x320 middle */
  wide?: boolean;
  /** colour around and under the screen while the scene shows (the logo's white): the page and the cleared
   *  canvas, so no black shows at the frame's edges; black when unset */
  backdrop?: number;
  /** drawn on every animation frame, not only after a tick (원정's realtime field and its parry windows; no main-play
   *  scene sets it, so their frames are unchanged) */
  everyFrame?: boolean;
  /** the scene was replaced (GameContext.go): free its GPU resources */
  dispose?(): void;
}
