// Sound (engine.md §5, GrantriaSound + PlayBGM FUN_0001afb0 / PlaySFX FUN_0001af90):
// n < 19 = BGM sN.ogg, looping at gain 0.5, not restarted when already playing;
// n >= 19 = SFX sN.ogg (48 -> s53) at gain 0.8 on a single stream (a new one stops the previous).
// Browsers start audio only after a user gesture, so the context is created on the first input.
import { platform } from '../core/platform';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private bgm: { n: number; src: AudioBufferSourceNode | null } = { n: -1, src: null };
  private sfx: AudioBufferSourceNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  /** option.volume: 0 mutes (BGM gain 0, SFX not played) */
  enabled = true;
  private wanted = -1;

  constructor() {
    const unlock = () => {
      if (this.ctx) return;
      try {
        this.ctx = new AudioContext();
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = this.enabled ? 0.5 : 0;
        this.bgmGain.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.8;
        this.sfxGain.connect(this.ctx.destination);
        if (this.wanted >= 0) { const n = this.wanted; this.bgm.n = -1; this.playBgm(n); }
      } catch { this.ctx = null; }
    };
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
  }

  private load(n: number): Promise<AudioBuffer | null> {
    const file = n === 48 ? 's53' : `s${n}`;
    let p = this.buffers.get(file);
    if (!p && this.ctx) {
      const ctx = this.ctx;
      p = platform().assets.bytes(`sound/${file}.ogg`)
        .then((b) => ctx.decodeAudioData(b.slice().buffer))
        .catch(() => null);
      this.buffers.set(file, p);
    }
    return p ?? Promise.resolve(null);
  }

  playBgm(n: number): void {
    this.wanted = n;
    if (n < 0 || n >= 19 || this.bgm.n === n || !this.ctx) return;
    this.bgm.src?.stop();
    this.bgm = { n, src: null };
    void this.load(n).then((buf) => {
      if (!buf || !this.ctx || this.bgm.n !== n) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.bgmGain!);
      src.start();
      this.bgm.src = src;
    });
    if (this.bgmGain) this.bgmGain.gain.value = this.enabled ? 0.5 : 0;
  }

  /** Soundmute: volume 0 silences the BGM (gain 0) and skips SFX requests */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.bgmGain) this.bgmGain.gain.value = on ? 0.5 : 0;
  }

  stopBgm(): void {
    this.bgm.src?.stop();
    this.bgm = { n: -1, src: null };
    this.wanted = -1;
  }

  playSfx(n: number): void {
    if (!this.enabled || !this.ctx || n < 19 || (n > 47 && n !== 48)) return;
    void this.load(n).then((buf) => {
      if (!buf || !this.ctx) return;
      try { this.sfx?.stop(); } catch { /* already ended */ }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.sfxGain!);
      src.start();
      this.sfx = src;
    });
  }
}
