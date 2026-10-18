// What the game logic asks of the host's sound (engine.md §5: PlayBGM FUN_0001afb0 / PlaySFX FUN_0001af90).
export interface SoundOut {
  /** n < 19: BGM n, looping, not restarted when already playing */
  playBgm(n: number): void;
  stopBgm(): void;
  /** n >= 19: a sound effect */
  playSfx(n: number): void;
}

/** 음악감상's player: where the BGM is, pause / go on, loop or play each track once */
export interface BgmPlayer {
  bgmTime(): { t: number; d: number; paused: boolean; ended: boolean } | null;
  pauseBgm(on: boolean): void;
  setBgmLoop(loop: boolean): void;
}
