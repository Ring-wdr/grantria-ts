// 회상 (title screen, replay.ts) and 보스 러시 (기록실, archive.ts), not in the original: a throwaway FieldScene. A replay
// is built from the class's seen events alone (no slot); the rush from a snapshot of the slot being played. It is never
// saved, gains no exp, starts no other events and leaves no account trace except the records it is for (boss records,
// the rush best, the replay count). The scene that started it waits and comes back after.
import { AVK } from '../input/input';
import type { GameContext, Scene } from './scene';
import { eventMap, FieldScene, OPENING } from './fieldScene';
import type { PlayScene } from './screens';
import { StoryDb, Story } from '../../core/data/story';
import { newGame } from '../../core/save/save';
import { seenEvents } from '../../core/rules/records';
import { Popup } from './popup';
import { countReplay, recordRush } from '../../core/rules/records';
import { saveOptions } from '../../core/save/options';
import { rushBosses, ticksText } from './archive';
import { h } from '../render/view';
import { VIEW_H as H, VIEW_W as W } from '../render/field';
import { fillScreen, render } from './screens';
import '../styles/convenience.css';

type RushState = 'load' | 'fight' | 'clear' | 'over';

/** the scene a sandbox returns to */
export interface SandboxHost extends Scene { resume(): void }

export class SandboxScene implements Scene {
  private fs: FieldScene | null = null;
  private popup: { p: Popup; then?: (r: 'yes' | 'no' | 'ok') => void } | null = null;
  private started = false;
  /** rush: the boss list, the current one, its state and the clock */
  private stages: { type: number; map: number }[] = [];
  private stage = 0;
  private state: RushState = 'load';
  private ticks = 0;
  private wait = 0;
  private beaten = 0;
  /** left (or failed to load): late async work stops here */
  private left = false;

  private constructor(private ctx: GameContext, private back: SandboxHost, readonly mode: 'replay' | 'rush') {}

  /** replay event e as class cls: a new game of that class whose story has every event it has seen but e */
  static async replay(ctx: GameContext, back: SandboxHost, cls: 0 | 1 | 2, e: number): Promise<void> {
    const s = new SandboxScene(ctx, back, 'replay');
    ctx.go(s);
    const save = newGame(cls), story = Story.fresh(cls);
    for (const x of seenEvents(cls)) if (x !== e) story.set(x);
    if (e !== OPENING[cls]) story.set(OPENING[cls]);               // else the class's opening would start instead
    save.story = story.toJSON();
    save.map = eventMap(e, new StoryDb(ctx.assets).headers[e].map);
    const fs = await s.load(save, 0, 'replay');
    if (!fs) return;
    if (!fs.events.active) fs.events.start(e);                     // the opening event may have started by itself
    s.fs = fs;
    s.started = true;
  }

  /** the sandbox FieldScene, or back to the play scene when it cannot be built */
  private async load(save: Parameters<typeof FieldScene.create>[1], lap: number, mode: 'replay' | 'rush'): Promise<FieldScene | null> {
    try { return await FieldScene.create(this.ctx, save, lap, mode); }
    catch (err) { console.error('sandbox load failed', err); this.leave(); return null; }
  }

  /** every recorded boss in story order, back to back, in its own room */
  static async rush(ctx: GameContext, back: PlayScene): Promise<void> {
    const s = new SandboxScene(ctx, back, 'rush');
    s.stages = rushBosses();
    back.suspend();
    ctx.go(s);
    const src = back.field, save = src.snapshot();
    save.map = s.stages[0].map; save.x = -1; save.y = -1;
    if (save.story) save.story.maps = (save.story.maps ?? []).filter((m) => m !== s.stages[0].map);   // a visited boss room keeps its boss away
    const fs = await s.load(save, src.lap, 'rush');
    if (!fs) return;
    fs.refill();
    s.fs = fs;
    s.enterStage(0, true);
  }

  private enterStage(i: number, loaded = false): void {
    const fs = this.fs!, st = this.stages[i];
    this.stage = i;
    this.state = 'load';
    const go = async () => {
      if (!loaded) { fs.story.maps.delete(st.map); await fs.enterMap(st.map); }
      if (this.left || this.state === 'over') return;
      if (!fs.bossAlive) { this.next(); return; }                  // the boss did not come back: skip it
      this.state = 'fight';
    };
    void go();
  }

  private next(): void {
    if (this.stage + 1 < this.stages.length) this.enterStage(this.stage + 1);
    else this.finishRush(true);
  }

  private finishRush(all: boolean): void {
    if (this.state === 'over') return;
    this.state = 'over';
    const fs = this.fs!, best = this.beaten > 0 && recordRush(this.ticks, this.beaten, fs.model.cls, Date.now(), all && this.beaten === this.stages.length);
    const body = `${all ? '보스 러시 완주!' : '보스 러시 종료'}|@보스 ${this.beaten} / ${this.stages.length}마리 · ${ticksText(this.ticks)}${best ? '|@새 기록입니다.' : ''}`;
    this.popup = { p: new Popup(this.ctx, 0x18, 0, () => body), then: () => this.leave() };
  }

  /** back to the scene that started it; watched = a replay played to its end (Esc or SKIP do not count for 추억) */
  private leave(watched = false): void {
    if (this.left) return;
    this.left = true;
    if (this.mode === 'replay' && this.started && watched) countReplay();
    this.ctx.go(this.back);
    this.back.resume();
  }

  update(presses: number[]): void {
    const fs = this.fs, input = this.ctx.input;
    input.uiMode = !!(this.popup || fs?.popup || fs?.busyTalking || fs?.dead);
    input.padField = !input.uiMode;
    input.confirm = input.device === 'touch' && !!(this.popup || fs?.popup || fs?.busyTalking);
    for (const t of input.takeTaps()) {
      const keys = this.ctx.ui13.tapAt(t.x, t.y) ?? this.ctx.ui.tapAt(t.x, t.y) ?? this.ctx.hud.tapAt(t.x, t.y);
      if (keys) presses = [...presses, ...keys];
    }
    if (this.popup) { const r = this.popup.p.handle(presses); if (r) { const t = this.popup.then; this.popup = null; t?.(r); } return; }
    if (!fs) { if (presses.includes(AVK.CLR)) this.leave(); return; }
    // the dialogue's AUTO key works here too (no log: replay lines stay out of it)
    if (presses.includes(AVK.AUTO) || (fs.dialogueShown && presses.includes(AVK.K3))) { this.ctx.options.auto ^= 1; saveOptions(this.ctx.options); }
    if (fs.dialogueShown) presses = presses.filter((k) => k !== AVK.K1 && k !== AVK.K3);
    presses = presses.filter((k) => k !== AVK.LOG && k !== AVK.AUTO && k !== AVK.FAST);
    if (this.mode === 'replay') {
      if (presses.includes(AVK.CLR) && !fs.popupOpen) { this.leave(); return; }   // Esc: back at once
      fs.update(presses);
      if (this.started && !fs.events.active && !fs.popupOpen) this.leave(!fs.events.skipped);
      return;
    }
    if (this.state === 'over') return;
    if (fs.dead) { this.finishRush(false); return; }
    if (presses.includes(AVK.CLR) && !fs.busyTalking) {
      this.popup = { p: new Popup(this.ctx, 0x0e, 0, () => '보스 러시를 그만두시겠습니까?'), then: (r) => { if (r === 'yes') this.finishRush(false); } };
      return;
    }
    if (this.state === 'load') return;
    fs.update(presses.filter((k) => k !== AVK.SAVE && k !== AVK.MAP));
    if (this.state === 'fight') {
      this.ticks++;
      if (!fs.bossAlive) { this.beaten++; this.state = 'clear'; this.wait = 60; }
    } else if (this.state === 'clear' && --this.wait <= 0) this.next();
  }

  draw(): void {
    const fs = this.fs;
    if (!fs) { render(this.ctx, () => fillScreen(this.ctx.ui, 0)); return; }
    fs.showButtons = !this.popup;
    fs.draw();
    const u = this.ctx.ui;
    u.begin();
    const label = this.mode === 'replay' ? '회상 · Esc 나가기'
      : `보스 러시 ${Math.min(this.stage + 1, this.stages.length)} / ${this.stages.length} · ${ticksText(this.ticks)}${this.state === 'clear' ? ' · 격파!' : ''}`;
    // a replay is all dialogue (the box covers the bottom 89 px): the label goes to the top; the rush keeps it low
    u.view('sandboxBar', (W >> 1) - 90, this.mode === 'replay' ? 4 : H - 48, 180, 14, h('div.sb-bar', null, label));
    u.end();
    if (this.popup) { this.ctx.ui13.begin(); this.popup.p.draw(); this.ctx.ui13.end(); }
    this.ctx.compositor.show();
  }

  dispose(): void { this.fs?.dispose(); }
}
