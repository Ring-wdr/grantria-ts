// 0.1.7 sound (before 2788013 / 584c79c / 8aa3fa2): the default 'interactive' context, suspended only in the
// background, every decoded BGM kept. Kept since 0.1.7: the BGM decode matched to its request by identity (8aa3fa2,
// a bug fix). The current one is ../audio.ts.
// Sound (engine.md §5, GrantriaSound + PlayBGM FUN_0001afb0 / PlaySFX FUN_0001af90):
// n < 19 = BGM sN.ogg, looping at gain 0.5, not restarted when already playing;
// n >= 19 = SFX sN.ogg (48 -> s53) at gain 0.8 on a single stream (a new one stops the previous).
// The music / effect volumes (0..10, not in the original) scale those gains; 10 keeps them.
// Browsers start audio only after a user gesture (the context resumes on the first input); in the background
// (platform lifecycle: hidden page, minimised window, app switched away) everything is muted.
import { platform } from '../../core/platform';
import type { Sound } from '../audio';

export class LegacyAudio implements Sound {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private bgm: { n: number; src: AudioBufferSourceNode | null } = { n: -1, src: null };
  private sfx: AudioBufferSourceNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  /** option.volume: 0 mutes (BGM gain 0, SFX not played) */
  enabled = true;
  /** music / sound effect volume 0..10 (편의 설정) */
  private bgmLevel = 10;
  private sfxLevel = 10;
  private wanted = -1;

  /** the page is hidden (minimised window, app in the background): everything stays silent until it is back */
  private paused = false;

  constructor() {
    const create = () => {
      if (this.ctx) return;
      try {
        this.ctx = new AudioContext();
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = this.bgmValue();
        this.bgmGain.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxValue();
        this.sfxGain.connect(this.ctx.destination);
        if (this.paused) void this.ctx.suspend();
        if (this.wanted >= 0) { const n = this.wanted; this.bgm.n = -1; this.playBgm(n); }
      } catch { this.ctx = null; }
    };
    // Hosts that allow autoplay (the Tauri shells, see tauri.conf.json / MainActivity.kt) start sound at once;
    // a browser keeps the context suspended until the first key or tap, which resumes it.
    create();
    const unlock = () => {
      create();
      if (this.ctx?.state === 'suspended' && !this.paused) void this.ctx.resume();
    };
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
    platform().lifecycle.onPause((p) => this.setPaused(p));
  }

  /** background: suspend the whole audio graph (BGM and SFX); foreground: resume it */
  setPaused(p: boolean): void {
    this.paused = p;
    if (!this.ctx) return;
    void (p ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
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
    // compared by identity: after stopBgm() and the same track again, both decodes would pass a check of n and the
    // first source would play on with no reference left to stop it
    const cur = this.bgm = { n, src: null as AudioBufferSourceNode | null };
    void this.load(n).then((buf) => {
      if (!buf || !this.ctx || this.bgm !== cur) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.bgmGain!);
      src.start();
      cur.src = src;
    });
    if (this.bgmGain) this.bgmGain.gain.value = this.bgmValue();
  }

  private bgmValue(): number { return this.enabled ? 0.5 * this.bgmLevel / 10 : 0; }
  private sfxValue(): number { return 0.8 * this.sfxLevel / 10; }

  /** Soundmute: volume 0 silences the BGM (gain 0) and skips SFX requests; bgm / sfx scale the gains (0..10) */
  setEnabled(on: boolean, bgm = this.bgmLevel, sfx = this.sfxLevel): void {
    this.enabled = on;
    this.bgmLevel = bgm;
    this.sfxLevel = sfx;
    if (this.bgmGain) this.bgmGain.gain.value = this.bgmValue();
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxValue();
  }

  stopBgm(): void {
    this.bgm.src?.stop();
    this.bgm = { n: -1, src: null };
    this.wanted = -1;
  }

  playSfx(n: number): void {
    if (!this.enabled || !this.sfxLevel || !this.ctx || n < 19 || (n > 47 && n !== 48)) return;
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
