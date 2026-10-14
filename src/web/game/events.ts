// Event script VM (FUN_0006ffdc commands, FUN_00034e24 frame loop, FUN_0002cdc8 end, FUN_00065534 skip),
// analysis/features/events.md §0.2–0.6. Records {time, cmd, arg} run when time == clock; the clock
// advances one tick per frame only while nothing waits.
// SPAWN_TYPE of the low ids puts an item on the ground (SPAWN_ITEM); PARTY_SWAP is not ported (unused by the
// scripts) and FILTER1 does nothing in the original either.
// DARKEN / the darkness steps / LIGHTNING are the RGB565 blur and smear filters of FUN_000f8b00 (screenfx.ts).
import type { Dir } from '../../core/combat/player';
import { blur8, smear } from '../../core/world/screenfx';
import type { FieldScene } from './fieldScene';
import { Dialogue, HoldSkip, drawCaption, drawDialogueButtons } from './dialogue';
import { readLog } from '../../core/save/readLog';
import { addSeen } from '../../core/rules/records';
import { backlog, replayLog } from './backlog';
import { fxScale, optionFps } from '../../core/save/options';
import { AVK } from '../input/input';
import type { Ui } from '../render/ui';
import { button, h, padBadge } from '../render/view';
import { EvActor } from '../../core/world/actors';
import { REPEATABLE } from '../../core/data/story';

export { REPEATABLE };

const W = 480, H = 320;
export const PLAYER_ARG = 299;
const PARTY_ALL = 0x120;
const NO_SKIP = [0, 1, 4, 10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x27, 0x29, 0x2f, 0x30, 0x31, 0x32, 0x39];
const FLASH = [32, 32, 32, 24, 24, 16, 8, 6, 24, 16, 8, 4, 2, 0, 0];
/** end handler flag changes (FUN_0002cdc8) */
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const END_HOOK: Record<number, { set?: number[]; clr?: number[]; dim?: number[]; doors?: number[]; item?: [number, number] }> = {
  0: { set: [...range(10, 29), ...range(0x7f, 0x86), ...range(0x92, 0xa3)] },
  10: { set: [...range(1, 9), ...range(0x14, 0x1d), ...range(0x6d, 0x79), ...range(0x92, 0xa3)] },
  0x14: { set: [...range(1, 0x14), ...range(0x6d, 0x79), ...range(0x7f, 0x86)] },
  1: { set: [0x6e, 0x6f, 0x72, 0x73, 0x74] },
  3: { set: [0x70, 0x71, 0x8d], clr: [0x72, 0x73, 0x74, 0x79] },
  7: { set: [0x79] }, 9: { set: [0x72, 0x74] },
  0xb: { set: [0x7f, 0x80] }, 0xd: { set: [0x81] }, 0xe: { set: [0x82] },
  0x11: { set: [0x83, 0x8e], clr: [0x84] },
  0x15: { set: [0x92, 0x93] }, 0x17: { set: [0x94] },
  0x1e: { set: [0x40, 0x49, 0x8d, 0x8e, 0x90, 0x95], doors: [2, 0, 5] },          // doors: +0x32a1 barrier bits
  0x22: { set: [0x8a, 0x36, 0x29, 0x25, 0x52] },
  0x24: { set: [0x7c], clr: [0x25] }, 0x25: { clr: [0x7c] },
  0x28: { set: [0x7c, 0x55], clr: [0x29], item: [0x1a, 0x0b] },                     // 투명한 허물 for quest 0x45
  0x2c: { set: [0x60, 0x8c] },
  0x35: { clr: [0x36] }, 0x3e: { clr: [0x8d] }, 0x47: { clr: [0x8e] }, 0x54: { clr: [0x55] }, 0x59: { clr: [0x8a] },
  0x3f: { set: [0x8d], clr: [0x40] }, 0x48: { set: [0x8e], clr: [0x49] },
  0x4e: { set: [0x96] }, 0x5b: { set: [0x8a] }, 0x5e: { set: [0x65] }, 0x8f: { set: [0x90] },
  0x53: { clr: [0x52, 0x90] },
  0x58: { set: [0x57], dim: [9, 5, 6, 7] }, 0x31: { dim: [4] }, 0x5d: { dim: [8] },   // dim: +0x3173 bit toggles
  0x5f: { set: [0x89], clr: [0x60] }, 100: { clr: [0x65, 0x8c] },
};

/** events whose done bit an end hook (or a class start) can set without the event being played: 회상 lists them
 *  only when one of their lines is in the read log (archive.ts) */
export const SET_WITHOUT_PLAY = new Set([0, ...Object.values(END_HOOK).flatMap((h) => h.set ?? [])]);

/** SPAWN_TYPE placement (FUN_00063f7c per-event table, run with tools/grantria_spawn.py): 'event:type' -> [x, y, dir];
 *  'event:type@clock' where the placement code compares the event clock */
const SPAWN_PLACE: Record<string, [number, number, number]> = {
  '0:44': [80, 224, 1], '4:57': [432, 640, 1], '5:48': [112, 208, 1], '7:44': [336, 208, 1],
  '7:48': [416, 208, 0], '7:51': [320, 224, 1], '7:57': [416, 240, 0], '8:5': [250, 240, 3],
  '9:258': [235, 75, 0], '10:80': [208, 176, 0], '10:85': [144, 176, 1], '13:97': [384, 208, 0],
  '19:258': [347, 235, 0], '20:122': [176, 192, 0], '20:992': [480, 192, 0], '29:258': [704, 144, 0],
  '58:57': [672, 624, 1], '67:97': [240, 320, 0], '71:80': [112, 160, 0], '76:32': [336, 320, 0],
  '88:36': [240, 432, 1], '88:37': [240, 496, 1], '92:194': [64, 176, 1], '94:36': [720, 176, 1],
  '94:37': [768, 176, 0], '102:37': [448, 400, 0], '104:161': [320, 256, 1], '106:44': [304, 448, 0],
  '106:51': [304, 480, 0], '106:80': [112, 160, 0], '106:85': [144, 160, 0], '106:97': [80, 160, 1],
  '106:123': [272, 480, 0], '106:218': [288, 160, 0], '107:992': [512, 448, 0], '152:123': [192, 592, 1],
  '19:258@158': [240, 352, 0], '106:44@1024': [368, 192, 0], '106:51@1026': [336, 192, 1], '106:123@1028': [240, 160, 1],
};

/** SPAWN_TYPE of the low ids (2..14): an item lying on the ground (actor id 200, +0x8a = 5), category / sub / spot
 *  hard-coded per event and clock (FUN_00063f7c run at each record's clock): 'event:clock' -> [cat, sub, x, y] */
const SPAWN_ITEM: Record<string, [number, number, number, number]> = {
  '7:12': [0x1a, 2, 368, 256], '7:92': [0x1a, 2, 368, 256], '10:210': [0x1a, 5, 171, 176], '15:57': [0x1a, 5, 309, 459],
  '16:38': [0x1a, 5, 256, 208], '16:288': [0x1a, 6, 256, 208], '20:16': [0x1d, 7, 78, 170], '29:133': [0x1a, 9, 240, 122],
  '29:419': [0x1a, 9, 240, 122], '30:380': [0x1a, 2, 598, 336], '30:382': [0x1a, 9, 619, 336], '40:24': [0x1a, 11, 320, 224],
  '41:34': [0x1a, 11, 101, 368], '46:254': [0x1d, 2, 624, 880], '48:54': [0x1d, 4, 832, 800], '48:136': [0x1d, 4, 832, 800],
  '49:164': [0x1d, 4, 176, 240], '53:42': [0x12, 7, 214, 384], '53:64': [0x1a, 14, 214, 384], '61:153': [0x1d, 5, 224, 288],
  '62:20': [0x1d, 5, 106, 171], '64:32': [0x1d, 5, 1064, 528], '70:298': [0x1d, 6, 275, 112], '73:34': [0x1d, 6, 339, 144],
  '81:10': [0x1d, 7, 78, 170], '81:120': [0x1d, 7, 309, 195], '81:122': [0x1d, 5, 292, 208], '81:124': [0x1d, 6, 315, 208],
  '85:34': [0x1d, 7, 1157, 704], '88:245': [0x1d, 5, 400, 496], '88:247': [0x1d, 6, 432, 496], '88:249': [0x1d, 7, 368, 496],
  '88:272': [0x1d, 9, 400, 496], '88:328': [0x1d, 9, 397, 507], '88:497': [0x1a, 5, 266, 496], '88:644': [0x1d, 9, 282, 501],
  '92:197': [0x1d, 8, 395, 221], '93:40': [0x1d, 8, 240, 320], '100:32': [0x1d, 3, 256, 293], '101:36': [0x1d, 3, 432, 336],
  '106:60': [0x1a, 5, 355, 197], '106:114': [0x1a, 5, 355, 197], '106:272': [0x1d, 9, 269, 160], '106:920': [0x1a, 5, 160, 168],
};

type Wait = 0 | 1 | 2 | 4 | 0x0c | 0x0d | 0x0e | 0x13 | 0x14 | 0x15 | 0x16 | 0x19 | 'map';

export class EventRunner {
  id = -1;
  private pc = 0;
  private end = 0;
  private clock = 0;
  private textId = 0;
  wait: Wait = 0;
  private lastCmd = 0;
  private lastTime = 0;
  private counter = 0;
  private waitUntil = 0;
  private waitActor: EvActor | null = null;
  private fadeActor: EvActor | null = null;
  frame = 0;
  // screen effects
  private fade = 0;
  private fadeWhite = false;
  private fill: 0 | 1 | 2 = 0;            // 1 black, 2 white
  grey = false;
  private flash = 0;
  shakeY = 0;
  private shakeAmp = 0;
  /** DARKEN frames (DAT_003b3c3b): the field is not redrawn and the held frame is blurred again each frame */
  private darken = 0;
  /** darkness step (DAT_003b3c3c, no cap): 1 blur, 2 smear (1), 3 smear (0) */
  private darkLevel = 0;
  /** DAT_003b3c3a = 2: LIGHTNING filters while the white fade runs */
  private lightMode = 0;
  dialogue: Dialogue | null = null;
  private caption: { text: string | string[]; n: number; id: number } | null = null;
  /** caption index DAT_003b1dbc (reset at the start of 0x6A, hardmode.md §2.2) */
  private capIdx = -1;
  private showItem: { icon: number; k: number; x: number; y: number } | null = null;
  /** QUEST_ACCEPT / QUEST_COMPLETE waiting for the popup */
  private questPending = false;
  /** skip fade (state 0x3A): frames left */
  private skipFade = 0;
  /** 회상 (not in the original): quests are not taken or completed and the end changes no flags */
  replay = false;
  /** where the lines go: the play log, or the replay's own (회상) */
  private get log() { return this.replay ? replayLog : backlog; }
  /** auto advance (편의 설정): ticks spent on a WAIT_KEY */
  private keyWaitTicks = 0;
  /** held fast-forward (편의 설정 빨리 넘기기) */
  private hold = new HoldSkip();
  /** the last dialogue of this event had been read before: '읽은 대사만' lets a hold run on through WAIT_KEY too */
  private lastSeen = false;
  /** SKIP ('#') was used in this event (회상: a skipped replay is not counted as watched) */
  skipped = false;
  /** camera: follow an actor or a fixed cell */
  camTarget: EvActor | null = null;
  camCell: [number, number] | null = null;
  /** set while the VM runs (state 0x12); NPC talk uses the dialogue alone (state 0x11) */
  get active(): boolean { return this.id >= 0; }
  /** events that keep monsters on screen (FUN_00034e24 first frame) */
  get keepsMonsters(): boolean { return [0x66, 0x56, 0x4f, 0x50].includes(this.id); }
  /** event clock (DAT_00408576), read by bosses during events */
  get progress(): number { return this.clock; }

  constructor(private fs: FieldScene) {}

  debug(): string { return this.active ? `ev ${this.id} pc ${this.pc}/${this.end} t ${this.clock} wait ${this.wait} fill ${this.fill}` : ''; }

  private get db() { return this.fs.sdb; }

  /** FUN_0001d6c4 */
  start(e: number): void {
    const { story } = this.fs;
    if (story.isDone(e)) { if (![0x52, 0x29, 0x8d, 0x8e, 0x90].includes(e)) this.fs.afterEvent(e); return; }
    [this.pc, this.end] = this.db.range(e);
    this.id = e;
    this.clock = 0;
    this.fs.player.blockCode = 0;                              // FUN_0001d6c4 clears the block codes
    if (e === 0x6a) this.capIdx = -1;
    this.textId = this.db.headers[e].textBase - 1;
    this.wait = 0x19;
    this.fill = 0; this.fade = 0; this.grey = false; this.flash = 0; this.darken = 0; this.darkLevel = 0;
    this.dialogue = null; this.caption = null; this.showItem = null; this.questPending = false;
    this.lastSeen = false; this.hold.reset(); this.skipped = false;
    this.fs.beginEvent();
    this.camTarget = this.fs.lead;
    this.camCell = null;
    // sprites used by the script are loaded before it runs
    const ids = new Set<number>();
    for (let s = this.pc; s < this.end; s++) {
      const r = this.db.rec(e, s);
      if (r.cmd === 0x0f) { if (!SPAWN_ITEM[`${e}:${r.time}`]) ids.add(r.arg); }
      else if (r.cmd >= 0x16df && r.cmd < 0x16df + 0xf5) ids.add(r.cmd - 0x16df);
      else if (r.cmd >= 5000 && r.cmd < 5300) ids.add(r.cmd - 5000);
      else if (r.cmd >= 0x1900 && r.cmd < 0x1900 + 300) ids.add(r.cmd - 0x1900);
    }
    this.wait = 'map';
    void this.fs.preloadActors([...ids]).then(() => { this.wait = 0x19; });
  }

  private rec(s: number) { return this.db.rec(this.id, s); }

  /** resolveActor: an actor with that id (visible ones for 0x1a), the room's boss, else the leader (slot 0) */
  private actor(arg: number, cmd = 0): EvActor {
    const lead = this.fs.lead!;
    if (arg < 0 || arg === PLAYER_ARG) return lead;
    if (arg === lead.id) return lead;
    return this.fs.actors.find((a) => a.id === arg && (cmd !== 0x1a || a.visible)) ?? this.fs.bossActor(arg) ?? lead;
  }
  private party(arg: number): EvActor[] {
    return arg === PARTY_ALL ? this.fs.partyActors() : [this.actor(arg)];
  }

  /** One frame (FUN_00034e24). */
  update(presses: number[]): void {
    this.frame++;
    if (!this.active) return;
    if (this.fade > 0) this.fade--; else if (this.fade < 0) this.fade++;
    if (this.flash > 0) this.flash--;
    const amp = Math.round(this.shakeAmp * fxScale(this.fs.ctx.options.shake));   // 편의 설정: shake reduced / off
    this.shakeY = amp ? ((this.frame & 1) ? amp : -amp) : 0;
    if (this.skipFade > 0) { if (--this.skipFade === 0) this.fastForward(); return; }
    if (this.wait === 'map') return;
    if (this.wait === 0x19) { this.wait = 0; return; }
    if (this.wait === 0) this.run();
    if (this.fill) this.darken = 0;                            // FUN_0003357c: a FILL frame ends DARKEN
    if (!this.active) return;
    for (const a of this.fs.actors) a.update();
    this.fs.lead?.update();
    if (this.pc >= this.end && this.wait === 0) { this.finish(); return; }
    // auto advance (편의 설정): a read page, or a WAIT_KEY after a short pause, counts as the '5' key
    const opts = this.fs.ctx.options;
    if (this.wait === 2 && !this.questPending) this.keyWaitTicks++; else this.keyWaitTicks = 0;
    if (opts.auto && !this.fs.popupOpen && !presses.includes(AVK.OK)
      && ((this.wait === 1 && this.dialogue?.autoDue(opts)) || (this.wait === 2 && !this.questPending && this.keyWaitTicks * (1000 / optionFps(opts)) >= 1200))) presses = [...presses, AVK.OK];
    // held fast-forward: read pages (or every page) turn every few ticks, WAIT_KEY goes on, captions run 4x
    const input = this.fs.ctx.input;
    const holding = this.hold.update(!this.fs.popupOpen && (input.isHeld(AVK.OK) || input.isHeld(AVK.FAST)));
    if (!presses.includes(AVK.OK)) {
      if (this.wait === 1 && this.dialogue?.fastDue(opts, holding)) presses = [...presses, AVK.OK];
      else if (this.wait === 2 && !this.questPending && holding && (opts.skip === 2 || (opts.skip === 1 && this.lastSeen)) && this.keyWaitTicks >= 2) presses = [...presses, AVK.OK];
    }
    if (this.wait === 4 && this.caption && holding && (opts.skip === 2 || (opts.skip === 1 && readLog().has(this.caption.id)))) this.caption.n = Math.min(79, this.caption.n + 3);
    // keys (DemoKey FUN_0004244c)
    for (const k of presses) {
      if (k === AVK.POUND && this.clock > 10 && this.skippable(this.lastCmd) && !this.questPending) { this.skip(); return; }
      if (k !== AVK.OK) continue;
      if (this.wait === 1 && this.dialogue) {
        if (this.dialogue.advance()) { this.lastSeen = this.dialogue.seen; this.dialogue.markRead(); this.dialogue = null; this.next(); }
      } else if (this.wait === 2 && !this.questPending) this.next();          // WAIT_KEY
    }
    switch (this.wait) {
      case 0: this.clock++; break;
      case 1: this.dialogue?.tick(opts); break;
      case 2: if (this.questPending && !this.fs.popupOpen) this.next(); break;   // quest popup dismissed
      case 4:
        if (this.caption && ++this.caption.n >= 80) {
          if (this.caption.id >= 0) { readLog().mark(this.caption.id); readLog().flush(); }
          this.caption = null; this.wait = 0; this.clock++;
        }
        break;
      case 0x0c: this.wait = 0; break;
      case 0x0d: case 0x0e: {
        const a = this.fadeActor;
        if (!a) { this.wait = 0; break; }
        a.alpha += this.wait === 0x0d ? 3 : -3;
        if (++this.counter >= 10) {
          a.alpha = this.wait === 0x0d ? 32 : 0;
          a.visible = this.wait === 0x0d;
          this.wait = 0;
        }
        break;
      }
      case 0x13: {                                              // any actor finishing its path releases it (FUN_00070918);
        const all = [this.fs.lead!, ...this.fs.actors];          // no path at all: released at once (the original hangs)
        if (all.some((a) => a.arrived) || !this.waitActor?.moving) { this.wait = 0; for (const a of all) a.speed = 5; }
        break;
      }
      case 0x14: if (![this.fs.lead!, ...this.fs.actors].some((a) => a.moving)) this.wait = 0; break;
      case 0x15: if (performance.now() >= this.waitUntil) this.wait = 0; break;
      case 0x16:
        if (this.showItem) { this.showItem.k += 4; if (Math.sin((this.showItem.k * Math.PI) / 180 * 4) < 0 || this.showItem.k > 45 * 4) this.showItem = null; }
        if (!this.showItem) { this.wait = 0; }
        break;
    }
    this.fs.eventCamera();
  }

  /** a waiting command finished by a key: clock++, pc++ */
  private next(): void {
    this.wait = 0;
    this.questPending = false;
    this.clock++;
    this.pc++;
  }

  private skippable(c: number): boolean {
    return !NO_SKIP.includes(c) && !(c >= 5000 && c < 5300) && c < 0x17d4;
  }

  /** FUN_0006ffdc: run every record whose time equals the clock */
  private run(): void {
    while (this.pc < this.end) {
      const r = this.rec(this.pc);
      if (r.time !== this.clock) return;
      this.lastCmd = r.cmd; this.lastTime = r.time;
      this.wait = 0;
      if (r.cmd === 2) this.fill = 1; else if (r.cmd === 3) this.fill = 2; else if (r.cmd === 0x18) this.shakeAmp = 0;
      this.exec(r.cmd, r.arg, false);
      if (this.id < 0) return;
      if ([5, 6, 7, 0x11, 0x12, 0x13, 0x14, 0x15].includes(r.cmd)) return;
      this.pc++;
      if ((this.wait as Wait) === 'map') return;
    }
  }

  private place(a: EvActor, arg: number): void {
    if (arg > 0) { a.x = (arg >> 8) * 16; a.y = (arg & 0xff) * 16; }
    a.path = [];
    a.visible = true;
    a.alpha = 32;
  }

  /** Execute one command. fast = skip mode: only state-changing effects, moves complete at once. */
  private exec(cmd: number, arg: number, fast: boolean): void {
    const fs = this.fs;
    if (cmd >= 0xbe && cmd < 0xbe + 4810) {                    // BALLOON
      if (!fast) for (const a of this.party(arg)) { a.balloon = cmd - 0xbe; a.balloonT = 0; }
      return;
    }
    if (cmd >= 5000 && cmd < 5300) {                           // WALK_TO (blocking)
      const a = cmd - 5000 === PLAYER_ARG ? fs.lead! : this.actor(cmd - 5000);
      if (fast) a.placeAt((arg >> 8) * 16 + 12, (arg & 0xff) * 16 + 20);   // FUN_00065534
      else { a.walkTo(fs.field, arg >> 8, arg & 0xff); this.wait = 0x13; this.waitActor = a; }
      return;
    }
    if (cmd >= 0x14b4 && cmd < 0x15b3) { fs.partHide = ((cmd - 0x14b4) << 8) | (arg & 0xff); return; }   // PART_HIDE
    if (cmd >= 0x15b3 && cmd < 0x16df) {                       // SHOW_ITEM
      if (fast) return;
      const n = cmd - 0x15b3;
      const cat = [6, 0x17, 0x69].includes(this.id) || ([0x11, 0x1b].includes(this.id) && n === 1) ? 0x1d : 0x1a;
      const x = arg ? (arg >> 8) * 16 : -1, y = arg ? (arg & 0xff) * 16 : -1;
      this.showItem = { icon: fs.db.icon(cat, n), k: 1, x, y };
      this.wait = 0x16;
      return;
    }
    if (cmd >= 0x16df && cmd < 0x17d4) {                       // PLACE
      const id = cmd - 0x16df;
      const a = id === PLAYER_ARG || id === fs.lead!.id ? fs.lead! : fs.actors.find((x) => x.id === id) ?? fs.bossActor(id) ?? fs.spawnActor(id) ?? fs.lead!;
      this.place(a, arg);
      return;
    }
    if (cmd >= 0x17d4 && cmd < 0x1900) {                       // SET_ACTION
      const a = this.actor(arg), n = cmd - 0x17d4;
      if (a.party) a.setPose(n); else a.anim = n;
      return;
    }
    if (cmd >= 0x1900 && cmd < 0x1900 + 300) {                 // MOVE_TO (no wait)
      const a = cmd - 0x1900 === PLAYER_ARG ? fs.lead! : this.actor(cmd - 0x1900);
      if (fast) a.placeAt((arg >> 8) * 16, (arg & 0xff) * 16);
      else a.walkTo(fs.field, arg >> 8, arg & 0xff);
      return;
    }
    switch (cmd) {
      case 0x00: if (!fast) { this.fill = 0; this.fade = -16; this.fadeWhite = arg === 1; } break;
      case 0x01: this.fill = 0; if (!fast) { this.fade = 16; this.fadeWhite = arg === 1; } break;
      case 0x02: case 0x03: break;                             // fill set in run()
      case 0x04: this.grey = true; this.fill = 0; break;
      case 0x05: case 0x06: case 0x07: {                       // TALK
        this.textId++;
        if (fast) break;
        const a = this.actor(arg);
        const text = fs.ctx.assets.text[this.textId] ?? '', name = fs.ctx.assets.text[this.db.nameId(a.id)] ?? '';
        this.dialogue = new Dialogue(text, name, this.faceOf(a), cmd === 7, this.textId);
        this.log.push({ name, text, textId: this.textId, kind: 'talk' });
        this.wait = cmd === 5 ? 1 : 1;
        this.camTarget = a; this.camCell = null;
        break;
      }
      case 0x08: this.camTarget = this.actor(arg); this.camCell = null; break;
      case 0x09: this.camCell = [(arg >> 8) * 16, (arg & 0xff) * 16]; this.camTarget = null; break;
      case 0x0a: if (!fast) this.flash = 15; break;
      case 0x0b: this.camTarget = this.actor(arg); this.camCell = null; fs.snapCamera(); break;
      case 0x0c: case 0x0d: for (const a of this.party(arg)) a.face(cmd === 0x0c ? 0 : 1); break;
      case 0x2d: case 0x2e: for (const a of this.party(arg)) a.face(cmd === 0x2d ? 2 : 3); break;
      case 0x0e:
        if (arg === -100) { fs.eventItems = []; break; }       // ground items of the event (+0x8a == 5) removed
        if (arg === 0x3e0) { for (const a of fs.actors) if (a.id === 0x3e0) a.visible = false; break; }
        this.actor(arg).visible = false;
        break;
      case 0x0f: {                                             // SPAWN_TYPE (FUN_00063f7c)
        const it = SPAWN_ITEM[`${this.id}:${this.clock}`];
        if (it) { fs.eventItems.push({ cat: it[0], sub: it[1], x: it[2], y: it[3] }); break; }   // a new one every time
        const p = SPAWN_PLACE[`${this.id}:${arg}@${this.clock}`] ?? SPAWN_PLACE[`${this.id}:${arg}`];
        if (arg >= 0x101) {                                    // not created: only one already on the map moves
          const a = fs.actors.find((x) => x.id === arg);
          if (a && p) { a.x = p[0]; a.y = p[1]; a.face((p[2] & 3) as Dir); }
          break;
        }
        // a boss standing in the room is the one brought in (event 8 King Dusty): a new one would stand beside it
        const a = fs.actors.find((x) => x.id === arg && x.visible) ?? fs.bossActor(arg, true) ?? fs.spawnActor(arg, true);
        if (!a) break;
        a.visible = true;
        if (p) { a.x = p[0]; a.y = p[1]; a.face((p[2] & 3) as Dir); }
        break;
      }
      case 0x10: this.wait = 'map'; void fs.eventMap(arg).then(() => { this.wait = 0; }); break;
      // 회상: the quest is neither taken nor completed; the wait without a popup ends the next frame like the original's
      case 0x13: if (!fast) { this.questPending = true; this.wait = 2; if (!this.replay) fs.quests.accept(arg); } break;
      case 0x14: {
        if (this.replay) { if (!fast) { this.questPending = true; this.wait = 2; } break; }
        if (fast) break;
        const q = this.id === 0x1e ? [0x12, 0x25, 0x38][fs.model.cls] : arg;
        this.questPending = true; this.wait = 2; fs.quests.complete(q);
        break;
      }
      case 0x11: case 0x12: case 0x15: if (!fast) this.wait = 2; break;
      case 0x16: fs.ctx.audio.playBgm(arg); break;
      case 0x17: fs.ctx.audio.stopBgm(); break;
      case 0x19: case 0x1a: {
        const a = this.actor(arg, cmd);
        if (fast) { a.visible = cmd === 0x19; a.alpha = 32; break; }
        a.visible = true; a.alpha = cmd === 0x19 ? 0 : 32;
        this.fadeActor = a; this.counter = 0; this.wait = cmd === 0x19 ? 0x0d : 0x0e;
        break;
      }
      case 0x1c: { const a = this.actor(arg); if (a.party) a.setPose(1); break; }   // ATTACK: basic attack pose
      case 0x1b: EvActor.freeze = arg === 0 ? -1 : arg; break;  // ANIM_FREEZE
      case 0x1d:                                               // CAPTION
        if (this.id === 0x6a) {                                // staff roll: [4,9,7,11,8,11,1] consecutive text ids
          const L = [4, 9, 7, 11, 8, 11, 1][++this.capIdx] ?? 1, lines: string[] = [];
          for (let i = 0; i < L; i++) lines.push(fs.ctx.assets.text[++this.textId] ?? '');
          if (!fast) { this.caption = { text: lines, n: 0, id: this.textId }; this.wait = 4; this.log.push({ name: '', text: lines.join('@'), textId: -1, kind: 'caption' }); }
          break;
        }
        this.textId++;
        if (!fast) {
          this.caption = { text: fs.ctx.assets.text[this.textId] ?? '', n: 0, id: this.textId }; this.wait = 4;
          this.log.push({ name: '', text: this.caption.text as string, textId: this.textId, kind: 'caption' });
        }
        break;
      case 0x1e: fs.partyJoin(); break;
      case 0x25: fs.partyHide(); this.camTarget = fs.lead; if (!fast) this.wait = 0x0c; break;
      case 0x26:                                               // FX_RESET
        this.grey = false; this.fill = 0; this.camTarget = this.camTarget ?? fs.lead; this.camCell = null;   // the darkness step stays
        for (const a of [fs.lead!, ...fs.actors]) { a.pose = 0; a.anim = -1; a.speed = 5; }
        EvActor.freeze = -1;
        break;
      case 0x27: if (!fast) { this.waitUntil = performance.now() + arg; this.wait = 0x15; } break;
      case 0x28: break;                                        // REDRAW_BG
      case 0x29: { const a = this.actor(arg); const d = (a.dir ^ 1) as Dir; a.walkTo(fs.field, Math.floor(a.x / 16) + (d === 0 ? -1 : d === 1 ? 1 : 0), Math.floor(a.y / 16) + (d === 2 ? -1 : d === 3 ? 1 : 0)); break; }
      case 0x2a: fs.partHide = 0; break;                       // PART_SHOW
      case 0x2b: for (const a of [fs.lead!, ...fs.actors]) a.speed = arg; break;
      case 0x2f: case 0x30: this.actor(arg).face(cmd === 0x2f ? 3 : 2); break;
      case 0x31: case 0x32: this.actor(arg).face(cmd === 0x31 ? 0 : 1); break;
      case 0x33: this.shakeAmp = this.shakeAmp ? 0 : arg; break;
      case 0x34: if (!fast) this.darken = arg & 0xff; break;
      case 0x35: if (!fast) this.darkLevel = (this.darkLevel + 1) & 0xff; break;
      case 0x36: this.darkLevel = 0; break;
      case 0x38: this.fill = 0; if (!fast) { this.fade = 16; this.fadeWhite = true; this.lightMode = 2; } break;
      case 0x39: if (!fast) this.wait = 0x14; else for (const a of [fs.lead!, ...fs.actors]) a.finishPath(); break;
      case 0x3a: fs.ctx.audio.stopBgm(); fs.ctx.audio.playBgm(0x0c); fs.setDanger(true); break;
      case 0x3b: fs.setDanger(false); break;
      default: break;
    }
  }

  /** face{n}: party ids 0..2, else by sprite set (events.md §0.8) */
  private faceOf(a: EvActor): number {
    if (a.party) return a.id;
    const g = this.db.typeByte(a.id, 0) & 0xff;
    if (g === 0x26) return 10;
    if (g === 0x30) return 3;
    if (g === 0x2b && a.id === 0x30) return 4;
    if (g === 0x34 && a.id === 0x55) return 5;
    if (g === 0x39) return 6;
    if (g === 0x3e) return 7;
    if (g === 0x3f && this.id !== 0x14) return 8;
    if (g === 0x31) return 9;
    return -1;
  }

  private skip(): void {
    this.skipped = true;
    this.clock = this.lastTime;
    this.skipFade = 16;
    this.fade = -16; this.fadeWhite = false;
  }

  /** FUN_00065534: apply the remaining state-changing commands at once, stop at quest commands */
  private fastForward(): void {
    this.fs.partHide = 0;
    if (this.wait === 1 || this.wait === 2) this.pc++;        // the shown talk is already counted
    this.dialogue = null; this.caption = null; this.showItem = null;
    for (const a of [this.fs.lead!, ...this.fs.actors]) { a.balloon = 0; a.finishPath(); }
    this.wait = 0;
    let prev = this.lastTime;
    while (this.pc < this.end) {
      const r = this.rec(this.pc);
      this.clock += r.time - prev;
      prev = r.time;
      if (r.cmd >= 0x11 && r.cmd <= 0x15) { this.clock = r.time; this.run(); break; }
      if (r.cmd === 2) this.fill = 1; else if (r.cmd === 3) this.fill = 2;
      this.exec(r.cmd, r.arg, true);
      this.pc++;
      if ((this.wait as Wait) === 'map') {                  // continue after the map loads
        const resume = () => { if (this.wait === 'map') { setTimeout(resume, 20); return; } this.lastTime = prev; this.fastForward(); };
        setTimeout(resume, 20);
        return;
      }
    }
    this.fill = 0;
    this.fade = 16; this.fadeWhite = false;
    this.fs.snapCamera();
    if (this.pc >= this.end) this.finish();
  }

  /** FUN_0002cdc8 */
  private finish(): void {
    const e = this.id;
    const { story } = this.fs;
    this.id = -1;
    this.fs.partHide = 0;
    this.fill = 0; this.grey = false; this.dialogue = null; this.caption = null; this.shakeAmp = 0; this.darkLevel = 0;
    if (this.replay) return;                                   // 회상: the copy is thrown away, nothing to record
    story.set(e);
    if (!this.fs.sandbox) addSeen(this.fs.model.cls, [e]);       // 회상 (title screen): seen by this class, account-wide
    const hook = END_HOOK[e];
    for (const f of hook?.set ?? []) story.set(f);
    for (const f of hook?.clr ?? []) story.set(f, false);
    for (const b of hook?.dim ?? []) if (!story.collectDim.delete(b)) story.collectDim.add(b);
    for (const b of hook?.doors ?? []) story.doors.add(b);
    if (hook?.item) { this.fs.inv.gain(hook.item[0], hook.item[1], 0, 1, this.fs.rng); this.fs.quests.onItems(); }   // FUN_0003ecc4
    if (REPEATABLE.includes(e)) story.set(e, false);
    this.fs.endEvent(e);
  }

  /** DARKEN holds the last frame instead of redrawing the field (FUN_0003357c) */
  get holdFrame(): boolean { return this.active && !this.fill && this.darken > 0; }
  get screenFxOn(): boolean { return this.active && !this.fill && (this.darken > 0 || (this.darkLevel >= 1 && this.darkLevel <= 3) || (this.fade !== 0 && this.lightMode === 2)); }

  /** FUN_00030734 on the field screen (before balloons, dialogue and HUD): DARKEN blur, darkness step, LIGHTNING */
  screenFx(b: Uint16Array, w: number, h: number): void {
    if (this.fill) return;
    if (this.darken) { blur8(b, w, h); this.darken--; }
    if (this.darkLevel === 3) smear(b, w, h, 0); else if (this.darkLevel === 2) smear(b, w, h, 1); else if (this.darkLevel === 1) blur8(b, w, h);
    if (this.fade !== 0 && this.lightMode === 2) {
      const v = (this.fade << 24) >> 24;
      if (v >= 9) smear(b, w, h, 0); else if (v >= 5) smear(b, w, h, 1); else if (v >= 2) blur8(b, w, h); else this.lightMode = 0;
    }
  }

  drawOverlay(u: Ui): void {
    if (this.fill) u.fill(0, 0, W, H, this.fill === 1 ? 0x000001 : 0xffffff);
    const flashK = fxScale(this.fs.ctx.options.flash);              // 편의 설정: white flashes reduced / off
    if (this.fade) {
      const a = this.fade < 0 ? ((this.fade + 15) * 2) : ((this.fade - 1) * 2);
      const k = this.fadeWhite && this.lightMode === 2 ? flashK : 1;  // LIGHTNING's white burst
      if (a * k > 0) { u.alpha = Math.min(32, Math.round(a * k)); u.fill(0, 0, W, H, this.fadeWhite ? 0xffffff : 0); u.alpha = 32; }
    }
    if (this.skipFade) { u.alpha = Math.min(32, (16 - this.skipFade) * 2); u.fill(0, 0, W, H, 0); u.alpha = 32; }
    if (this.flash && flashK) { u.alpha = Math.round((FLASH[15 - this.flash] ?? 0) * flashK); u.fill(0, 0, W, H, 0xffffff); u.alpha = 32; }
    if (this.showItem) {
      const s = this.showItem, r = this.fs.db.iconRect(s.icon);
      const x = s.x < 0 ? (W >> 1) - 12 : s.x - this.fs.cam.x - 12, y = s.y < 0 ? (H >> 1) - 12 : s.y - this.fs.cam.y - 24;
      u.alpha = Math.max(0, Math.min(32, Math.round(Math.sin((s.k * Math.PI) / 180 * 4) * 32)));
      u.image(r.image, r.sx, r.sy, 24, 24, x, y);
      u.alpha = 32;
    }
    if (this.caption) drawCaption(u, this.caption.text, this.caption.n);
    if (this.active) u.hit(0, 0, W, H, () => [AVK.OK]);       // tap = next line
    if (this.dialogue) { this.dialogue.draw(u, this.frame); drawDialogueButtons(u, !!this.fs.ctx.options.auto, this.fs.ctx.input); }
    if (this.active && this.clock >= 11 && this.skippable(this.lastCmd) && !this.skipFade) {
      // SKIP: the button at alpha 16 with the label blinking every 8 frames (CSS), centred in the button
      u.view('evSkip', W - 70 + this.fs.ctx.input.edge, 6, 50, 24,   // edge layout: at the right edge with the buttons
 button([h('span.ev-skip', null, this.fs.db.a.text[100] ?? 'SKIP'), padBadge(this.fs.ctx.input, AVK.POUND, 'ev-skip-pad')], {
        sel: true, glow: false, cls: 'ev-skip-btn', style: 'width:100%;height:100%', on: () => [AVK.POUND],
      }));
    }
  }
}
