// Sound (engine.md §5, GrantriaSound + PlayBGM FUN_0001afb0 / PlaySFX FUN_0001af90):
// n < 19 = BGM sN.ogg, looping at gain 0.5, not restarted when already playing;
// n >= 19 = SFX sN.ogg (48 -> s53) at gain 0.8 on a single stream (a new one stops the previous).
// The music / effect volumes (0..10, not in the original) scale those gains; 10 keeps them.
// Browsers start audio only after a user gesture (the context resumes on the first input); in the background
// (platform lifecycle: hidden page, minimised window, app switched away) and with the sound off the whole context
// is suspended, so no output stream keeps the device awake.
// Decoded BGM is large (a mono track of a minute is ~11 MB of float PCM at 48 kHz): only the current and the
// previous track stay decoded, SFX (short) stay cached.
import { platform } from '../core/platform';
import type { SoundOut } from '../core/sound';

/** what the game asks of the sound (GameContext.audio) */
export interface Sound extends SoundOut {
  enabled: boolean;
  setPaused(p: boolean): void;
  setEnabled(on: boolean, bgm?: number, sfx?: number): void;
  /** 음악감상's player: where the BGM is, pause / go on, loop or play each track once */
  bgmTime(): { t: number; d: number; paused: boolean; ended: boolean } | null;
  pauseBgm(on: boolean): void;
  setBgmLoop(loop: boolean): void;
}

export class GameAudio implements Sound {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** BGM files still decoded in buffers, most recent first (at most 2) */
  private bgmKept: string[] = [];
  /** at: context time the loop started from; off: where a paused track stopped; ended: a one-shot track ran out */
  private bgm: { n: number; src: AudioBufferSourceNode | null; at?: number; off?: number; ended?: boolean } = { n: -1, src: null };
  /** BGM loops (the game always); 음악감상's 계속 재생 plays each track once */
  private bgmLoop = true;
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
  /** the context was last asked to run (resume) rather than to stop (suspend) */
  private running = false;

  constructor() {
    const create = () => {
      if (this.ctx) return;
      try {
        // 'playback': larger output buffers than the default 'interactive', so the audio thread wakes far less
        // often (Android's low-latency path keeps a core busy); a few tens of ms more delay suits BGM / SFX here
        this.ctx = new AudioContext({ latencyHint: 'playback' });
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = this.bgmValue();
        this.bgmGain.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxValue();
        this.sfxGain.connect(this.ctx.destination);
        this.running = !this.silent();
        if (!this.running) void this.ctx.suspend();
        if (this.wanted >= 0) { const n = this.wanted; this.bgm.n = -1; this.playBgm(n); }
      } catch { this.ctx = null; }
    };
    // Hosts that allow autoplay (the Tauri shells, see tauri.conf.json / MainActivity.kt) start sound at once;
    // a browser keeps the context suspended until the first key or tap, which resumes it.
    create();
    const unlock = () => {
      create();
      if (this.ctx && this.ctx.state !== 'running' && !this.silent()) { this.running = true; void this.ctx.resume(); }
    };
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
    platform().lifecycle.onPause((p) => this.setPaused(p));
  }

  /** background: suspend the whole audio graph (BGM and SFX); foreground: resume it */
  setPaused(p: boolean): void {
    this.paused = p;
    this.syncRunning();
  }

  /** nothing can be heard: in the background, or volume 0 / both volumes 0 (the BGM keeps its place) */
  private silent(): boolean {
    return this.paused || !this.enabled || (!this.bgmLevel && !this.sfxLevel);
  }

  /** run the audio graph only while it can be heard: a suspended context stops the output stream */
  private syncRunning(): void {
    if (!this.ctx) return;
    // judged by the last request, not ctx.state: a resume turns the state to 'running' only once the output has
    // started, and a suspend asked for before that must still be made or the context runs on in the background.
    // Not silent, any state but 'running' resumes (WebKit's 'interrupted' after a call or an app switch too).
    if (this.silent()) {
      if (!this.running) return;
      this.running = false;
      void this.ctx.suspend().catch(() => {});
    } else if (!this.running || this.ctx.state !== 'running') {
      this.running = true;
      void this.ctx.resume().catch(() => {});
    }
  }

  private load(n: number): Promise<AudioBuffer | null> {
    const file = n === 48 ? 's53' : `s${n}`;
    if (n < 19) {
      this.bgmKept = [file, ...this.bgmKept.filter((f) => f !== file)];
      for (const f of this.bgmKept.splice(2)) this.buffers.delete(f);
    }
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
    const old = this.bgm.src;
    this.bgm.src = null;
    old?.stop();
    this.pausedBuf = null;
    // compared by identity: after stopBgm() and the same track again, both decodes would pass a check of n and the
    // first source would play on with no reference left to stop it
    const cur: typeof this.bgm = this.bgm = { n, src: null };
    void this.load(n).then((buf) => {
      if (!buf || !this.ctx || this.bgm !== cur) return;
      this.startBgm(cur, buf, 0);
    });
    if (this.bgmGain) this.bgmGain.gain.value = this.bgmValue();
  }

  /** a source for track `cur` from `off` seconds in */
  private startBgm(cur: typeof this.bgm, buf: AudioBuffer, off: number): void {
    const ctx = this.ctx!, src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = this.bgmLoop;
    src.connect(this.bgmGain!);
    src.onended = () => { if (cur.src === src) cur.ended = true; };   // a stop() clears cur.src first
    src.start(0, off);
    cur.src = src;
    cur.at = ctx.currentTime - off;
    cur.off = undefined;
    cur.ended = false;
  }

  /** where the current BGM is (seconds into it) and its length; null before it has started (음악감상) */
  bgmTime(): { t: number; d: number; paused: boolean; ended: boolean } | null {
    const { src, at, off, ended } = this.bgm, d = (src ?? this.pausedBuf)?.buffer?.duration;
    if (!this.ctx || !d || at === undefined) return null;
    if (off !== undefined) return { t: off, d, paused: true, ended: false };
    if (ended) return { t: d, d, paused: false, ended: true };
    const t = this.ctx.currentTime - at;
    return { t: this.bgmLoop ? t % d : Math.min(t, d), d, paused: false, ended: false };
  }

  /** the stopped source of a paused track, kept for its buffer */
  private pausedBuf: AudioBufferSourceNode | null = null;

  /** 음악감상: pause the BGM where it is, or go on from there */
  pauseBgm(on: boolean): void {
    const cur = this.bgm, t = this.bgmTime();
    if (!t || !this.ctx) return;
    if (on && !t.paused && !t.ended) {
      const src = cur.src!;
      cur.src = null;
      src.stop();
      this.pausedBuf = src;
      cur.off = t.t;
    } else if (!on && t.paused && this.pausedBuf?.buffer) {
      const buf = this.pausedBuf.buffer;
      this.pausedBuf = null;
      this.startBgm(cur, buf, cur.off!);
    }
  }

  /** 음악감상's 계속 재생: false plays the current and later tracks once (bgmTime().ended), true loops them again */
  setBgmLoop(loop: boolean): void {
    if (this.bgmLoop === loop) return;
    const t = this.bgmTime();
    this.bgmLoop = loop;
    const src = this.bgm.src;
    if (!src || !t || t.ended) return;
    src.loop = loop;
    if (!loop) this.bgm.at = this.ctx!.currentTime - t.t;          // the loops already played do not count
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
    this.syncRunning();
  }

  stopBgm(): void {
    const src = this.bgm.src;
    this.bgm = { n: -1, src: null };
    src?.stop();
    this.pausedBuf = null;
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
