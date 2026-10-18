// What the game logic (field play, menus, screens) needs from the host that runs it: the game data, the options,
// the tick's input and the sound. The web host's GameContext (web/game/scene.ts) is one.
import type { Assets } from './data/assets';
import type { InputState } from './input';
import type { Options } from './save/options';
import type { SoundOut } from './sound';

export interface Host {
  readonly assets: Assets;
  readonly options: Options;
  readonly input: InputState;
  readonly audio: SoundOut;
  /** push changed options to what they drive (volumes, the tick rate, the screen) */
  applyOptions(): void;
}
