// 회상 (title screen, replay.ts) and 보스 러시 (기록실, archive.ts), not in the original: a throwaway FieldScene. A replay
// is built from the class's seen events alone (no slot); the rush from a snapshot of the slot being played. It is never
// saved, gains no exp, starts no other events and leaves no account trace except the records it is for (boss records,
// the rush best, the replay count). The scene that started it waits and comes back after.
// The state and keys are core/scenes/sandbox.ts; this draws them.
import type { GameContext, Scene } from './scene';
import { FieldScene } from './fieldScene';
import type { PlayScene } from './screens';
import { type SaveData } from '../../core/save/save';
import { popupPaint } from './popup';
import { h } from '../render/view';
import { drawBacklog } from './backlog';
import { VIEW_H as H, VIEW_W as W } from '../render/field';
import { fillScreen, render } from './screens';
import { ticksText } from '../../core/menu/archive';
import { SandboxLogic } from '../../core/scenes/sandbox';
import '../styles/convenience.css';

/** the scene a sandbox returns to */
/** the scene a sandbox returns to; finished = the replayed event ran to its end (played or skipped, not Esc) */
export interface SandboxHost extends Scene { resume(finished?: boolean): void }

export class SandboxScene extends SandboxLogic {
  declare protected readonly ctx: GameContext;
  declare protected fs: FieldScene | null;

  private constructor(ctx: GameContext, private back: SandboxHost, mode: 'replay' | 'rush') { super(ctx, mode); }

  /** replay event e as class cls (SandboxLogic.startReplay) over back */
  static async replay(ctx: GameContext, back: SandboxHost, cls: 0 | 1 | 2, e: number): Promise<void> {
    const s = new SandboxScene(ctx, back, 'replay');
    ctx.go(s);
    await s.startReplay(cls, e);
  }

  /** a 보스 러시 (SandboxLogic.startRush) over the play scene, which waits suspended */
  static async rush(ctx: GameContext, back: PlayScene): Promise<void> {
    const s = new SandboxScene(ctx, back, 'rush');
    back.suspend();
    ctx.go(s);
    await s.startRush(back.field);
  }

  protected async newField(save: SaveData, lap: number, mode: 'replay' | 'rush'): Promise<FieldScene> {
    try { return await FieldScene.create(this.ctx, save, lap, mode); }
    catch (err) { console.error('sandbox load failed', err); throw err; }
  }

  protected goBack(finished: boolean): void {
    this.ctx.go(this.back);
    this.back.resume(finished);
  }

  override update(presses: number[]): void {
    const fs = this.fs, input = this.ctx.input;
    input.uiMode = !!(this.log || this.overlays.size || fs?.busyTalking || fs?.dead);
    input.padField = !input.uiMode;
    input.confirm = input.device === 'touch' && !!(this.overlays.size || fs?.busyTalking);
    for (const t of input.takeTaps()) {
      const keys = this.ctx.ui13.tapAt(t.x, t.y) ?? this.ctx.ui.tapAt(t.x, t.y) ?? this.ctx.hud.tapAt(t.x, t.y);
      if (keys) presses = [...presses, ...keys];
    }
    super.update(presses);
  }

  draw(): void {
    const fs = this.fs;
    if (!fs) { render(this.ctx, () => fillScreen(this.ctx.ui, 0)); return; }
    fs.showButtons = !this.overlays.size;
    fs.draw();
    const u = this.ctx.ui;
    u.begin();
    const label = this.mode === 'replay' ? `회상${this.ctx.options.replayChain ? ' · 이어서 보기' : ''} · Esc 나가기`
      : `보스 러시 ${Math.min(this.stage + 1, this.stages.length)} / ${this.stages.length} · ${ticksText(this.ticks)}${this.state === 'clear' ? ' · 격파!' : ''}`;
    // a replay is all dialogue (the box covers the bottom 89 px): the label goes to the top; the rush keeps it low
    u.view('sandboxBar', (W >> 1) - 90, this.mode === 'replay' ? 4 : H - 48, 180, 14, h('div.sb-bar', null, label));
    if (this.log) drawBacklog(u, this.log, this.ctx.input);
    u.end();
    if (this.overlays.size) { this.ctx.ui13.begin(); this.overlays.draw(popupPaint(this.ctx)); this.ctx.ui13.end(); }
    this.ctx.compositor.show();
  }

  dispose(): void { this.fs?.dispose(); }
}
