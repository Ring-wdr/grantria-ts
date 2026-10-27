// What the screen flow (title, slots, play, the title's side screens) needs from its host beyond core/host.ts: a way to
// go to another screen, the music player of 음악감상, and the options object to replace after a backup is restored.
// The web host (web/game/screens.ts WebScreens) makes each screen's view and switches to it.
import type { Host } from '../host';
import type { SaveData } from '../save/save';
import type { Options } from '../save/options';
import type { BgmPlayer, SoundOut } from '../sound';

/** the screens the flow goes to (states of the original's drawHandle, game-flow-ui.md §1) */
export interface Screens {
  /** 0x06 rating notice */
  rating(): void;
  /** 0x08 / 0x09: intro (from the rating notice) or straight to the menu */
  title(intro?: boolean): void;
  /** 0x0A slot select */
  slots(): void;
  /** 0x0B character select for an empty slot */
  charSelect(slot: number): void;
  /** 0x10 field play of a slot (loads, then plays) */
  play(slot: number, save: SaveData): void;
  /** 0x0C settings / 0x0D help over the title */
  titleOption(mode: 'settings' | 'help'): void;
  /** title side screens: 게임순위, 회상, 음악감상, 데이터 관리 (0x3B) */
  ranking(): void;
  replays(): void;
  musicRoom(): void;
  data(): void;
  /** 원정(가제): the standalone extra mode (core/expedition), apart from main play */
  expedition(): void;
}

export interface SceneHost extends Host {
  options: Options;
  readonly audio: SoundOut & BgmPlayer;
  readonly screens: Screens;
}
