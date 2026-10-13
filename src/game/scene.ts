// Screen/state framework (the original's drawHandle states, game-flow-ui.md §1).
import type * as THREE from 'three';
import type { Assets, Cmf } from '../assets';
import type { Compositor } from '../compositor';
import type { Input } from './input';
import type { DomUi } from './domUi';
import type { GameAudio } from './audio';
import type { Options } from './options';

export interface GameContext {
  assets: Assets;
  renderer: THREE.WebGLRenderer;
  compositor: Compositor;
  input: Input;
  /** 2D canvas over the WebGL screen (provisional text until the bitmap font is ported) */
  overlay: HTMLCanvasElement;
  /** screen-space UI layer and the 1.3x overlay layer L1 (popups), HTML/CSS */
  ui: DomUi;
  ui13: DomUi;
  /** field HUD layer (status bar, touch buttons, minimap, dialogue) under the screen UI */
  hud: DomUi;
  /** sprites used by menus (title logo, class idle animations) */
  cmfs: Record<string, Cmf>;
  audio: GameAudio;
  /** option.dat settings; applyOptions pushes volume / speed changes to audio and the tick rate */
  options: Options;
  applyOptions(): void;
  /** switch to another scene */
  go(scene: Scene): void;
}

export interface Scene {
  /** one 50 ms tick with the virtual keys pressed since the previous tick */
  update(presses: number[]): void;
  /** render into the compositor target and the overlay */
  draw(): void;
  debugLine?(): string;
}
