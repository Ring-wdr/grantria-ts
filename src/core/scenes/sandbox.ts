// 회상 (title screen, replay.ts) and 보스 러시 (기록실, archive.ts), not in the original: a throwaway FieldScene. A replay
// is built from the class's seen events alone (no slot); the rush from a snapshot of the slot being played. It is never
// saved, gains no exp, starts no other events and leaves no account trace except the records it is for (boss records,
// the rush best, the replay count). The scene that started it waits and comes back after.
// State and keys; the host draws it (web/game/sandbox.ts), builds its field and goes back to the scene that started it.
import { AVK } from '../keys';
import type { SceneHost } from './host';
import type { FieldGame } from '../field/fieldGame';
import { eventMap, OPENING } from '../field/fieldGame';
import { StoryDb, Story } from '../data/story';
import { newGame, type SaveData } from '../save/save';
import { seenEvents, countReplay, recordRush } from '../rules/records';
import { seenAlongRoute } from '../data/storyChart';
import { Popup, openPopup } from '../ui/popup';
import { OverlayStack } from '../ui/overlays';
import { saveOptions } from '../save/options';
import { rushBosses, ticksText } from '../menu/archive';
import { BacklogReader, replayLog } from '../ui/backlog';

type RushState = 'load' | 'fight' | 'clear' | 'over';

export abstract class SandboxLogic {
  protected fs: FieldGame | null = null;
  /** the rush's result popup and "quit the rush?" over the field */
  protected readonly overlays = new OverlayStack();
  /** 회상: this scene's lines (LOG / pad □) */
  protected log: BacklogReader | null = null;
  private started = false;
  /** rush: the boss list, the current one, its state and the clock */
  protected stages: { type: number; map: number }[] = [];
  protected stage = 0;
  protected state: RushState = 'load';
  protected ticks = 0;
  private wait = 0;
  private beaten = 0;
  /** left (or failed to load): late async work stops here */
  private left = false;

  protected constructor(protected readonly ctx: SceneHost, readonly mode: 'replay' | 'rush') {}

  /** the host's field for the sandbox (FieldGame.start in its sandbox mode); throws when it cannot be built */
  protected abstract newField(save: SaveData, lap: number, mode: 'replay' | 'rush'): Promise<FieldGame>;
  /** back to the scene that started it; finished = the replayed event ran to its end */
  protected abstract goBack(finished: boolean): void;

  /** replay event e as class cls: a new game of that class whose story has every event it has seen but e */
  protected async startReplay(cls: 0 | 1 | 2, e: number): Promise<void> {
    replayLog.clear();
    const save = newGame(cls), story = Story.fresh(cls);
    for (const x of seenAlongRoute(cls, seenEvents(cls))) if (x !== e) story.set(x);
    if (e !== OPENING[cls]) story.set(OPENING[cls]);               // else the class's opening would start instead
    save.story = story.toJSON();
    const hd = new StoryDb(this.ctx.assets).headers[e];
    save.map = eventMap(e, hd.map);
    const fs = await this.load(save, 0, 'replay');
    if (!fs) return;
    // kind 0 scenes start when the room's boss falls (events.md §0.5): it is gone, as in play, not standing beside
    // the one the scene shows
    if (hd.kind === 0 && !OPENING.includes(e)) fs.monsters = fs.monsters.filter((m) => !m.isBoss);
    if (!fs.events.active) fs.events.start(e);                     // the opening event may have started by itself
    this.fs = fs;
    this.started = true;
  }

  /** the sandbox field, or back to the scene that started it when it cannot be built */
  private async load(save: SaveData, lap: number, mode: 'replay' | 'rush'): Promise<FieldGame | null> {
    try { return await this.newField(save, lap, mode); }
    catch { this.leave(); return null; }
  }

  /** every recorded boss in story order, back to back, in its own room, on a snapshot of the slot played in src */
  protected async startRush(src: FieldGame): Promise<void> {
    this.stages = rushBosses();
    const save = src.snapshot();
    save.map = this.stages[0].map; save.x = -1; save.y = -1;
    if (save.story) save.story.maps = (save.story.maps ?? []).filter((m) => m !== this.stages[0].map);   // a visited boss room keeps its boss away
    const fs = await this.load(save, src.lap, 'rush');
    if (!fs) return;
    fs.refill();
    this.fs = fs;
    this.enterStage(0, true);
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
    openPopup(this.overlays, new Popup(this.ctx, 0x18, 0, () => body), undefined, { on: { close: () => this.leave() } });
  }

  /** back to the scene that started it; watched = a replay played to its end (Esc or SKIP do not count for 추억),
   *  finished = its event ended (played or skipped), so 이어서 보기 may go on */
  private leave(watched = false, finished = false): void {
    if (this.left) return;
    this.left = true;
    if (this.mode === 'replay' && this.started && watched) countReplay();
    this.goBack(finished);
  }

  update(presses: number[]): void {
    const fs = this.fs;
    if (this.overlays.update(presses)) return;
    if (!fs) { if (presses.includes(AVK.CLR)) this.leave(); return; }
    if (this.log) { if (!this.log.update(presses)) this.log = null; return; }
    // the dialogue's LOG / AUTO keys work here too (pad □ / △ while a page shows); a replay logs into its own list
    if (fs.dialogueShown) presses = presses.map((k) => (k === AVK.K1 ? AVK.LOG : k === AVK.K3 ? AVK.AUTO : k));
    if (presses.includes(AVK.AUTO)) { this.ctx.options.auto ^= 1; saveOptions(this.ctx.options); }
    if (presses.includes(AVK.LOG) && this.mode === 'replay' && !fs.popupOpen) { this.log = new BacklogReader(replayLog); return; }
    presses = presses.filter((k) => k !== AVK.LOG && k !== AVK.AUTO && k !== AVK.FAST);
    if (this.mode === 'replay') {
      if (presses.includes(AVK.CLR) && !fs.popupOpen) { this.leave(); return; }   // Esc: back at once
      fs.update(presses);
      if (this.started && !fs.events.active && !fs.popupOpen) this.leave(!fs.events.skipped, true);
      return;
    }
    if (this.state === 'over') return;
    if (fs.dead) { this.finishRush(false); return; }
    if (presses.includes(AVK.CLR) && !fs.busyTalking) {
      openPopup(this.overlays, new Popup(this.ctx, 0x0e, 0, () => '보스 러시를 그만두시겠습니까?'), () => this.finishRush(false));
      return;
    }
    if (this.state === 'load') return;
    fs.update(presses.filter((k) => k !== AVK.SAVE && k !== AVK.MAP));
    if (this.state === 'fight') {
      this.ticks++;
      if (!fs.bossAlive) { this.beaten++; this.state = 'clear'; this.wait = 60; }
    } else if (this.state === 'clear' && --this.wait <= 0) this.next();
  }
}
