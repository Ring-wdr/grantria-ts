// Event script VM (FUN_0006ffdc commands, FUN_00034e24 frame loop, FUN_0002cdc8 end, FUN_00065534 skip),
// analysis/features/events.md §0.2–0.6. Records {time, cmd, arg} run when time == clock; the clock
// advances one tick per frame only while nothing waits.
// Not ported / approximated: SPAWN_TYPE placement for low actor ids the table does not place (they
// spawn at the leader) [추정], PARTY_SWAP (unused by the scripts), pose effects / sounds, FILTER1, DANGER
// objects; darkness levels and lightning are drawn as plain overlays [근사].
import type { Dir } from './player';
import type { FieldScene } from './fieldScene';
import { Dialogue, drawCaption } from './dialogue';
import { AVK } from './input';
import type { Ui } from './ui';
import type { EvActor } from './actors';

const W = 480, H = 320;
export const PLAYER_ARG = 299;
const PARTY_ALL = 0x120;
const NO_SKIP = [0, 1, 4, 10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x27, 0x29, 0x2f, 0x30, 0x31, 0x32, 0x39];
const FLASH = [32, 32, 32, 24, 24, 16, 8, 6, 24, 16, 8, 4, 2, 0, 0];
/** repeatable hint events: the end handler clears their own flag again */
const REPEATABLE = [0x6e, 0x6f, 0x70, 0x71, 0x79, 0x7c, 0x7f, 0x80, 0x81, 0x82, 0x83, 0x8a, 0x8d, 0x8e, 0x90, 0x92, 0x93, 0x94, 0x96];
/** end handler flag changes (FUN_0002cdc8) */
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const END_HOOK: Record<number, { set?: number[]; clr?: number[] }> = {
  0: { set: [...range(10, 29), ...range(0x7f, 0x86), ...range(0x92, 0xa3)] },
  10: { set: [...range(1, 9), ...range(0x14, 0x1d), ...range(0x6d, 0x79), ...range(0x92, 0xa3)] },
  0x14: { set: [...range(1, 0x14), ...range(0x6d, 0x79), ...range(0x7f, 0x86)] },
  1: { set: [0x6e, 0x6f, 0x72, 0x73, 0x74] },
  3: { set: [0x70, 0x71, 0x8d], clr: [0x72, 0x73, 0x74, 0x79] },
  7: { set: [0x79] }, 9: { set: [0x72, 0x74] },
  0xb: { set: [0x7f, 0x80] }, 0xd: { set: [0x81] }, 0xe: { set: [0x82] },
  0x11: { set: [0x83, 0x8e], clr: [0x84] },
  0x15: { set: [0x92, 0x93] }, 0x17: { set: [0x94] },
  0x1e: { set: [0x40, 0x49, 0x8d, 0x8e, 0x90, 0x95] },
  0x22: { set: [0x8a, 0x36, 0x29, 0x25, 0x52] },
  0x24: { set: [0x7c], clr: [0x25] }, 0x25: { clr: [0x7c] },
  0x28: { set: [0x7c, 0x55], clr: [0x29] },
  0x2c: { set: [0x60, 0x8c] },
  0x35: { clr: [0x36] }, 0x3e: { clr: [0x8d] }, 0x47: { clr: [0x8e] }, 0x54: { clr: [0x55] }, 0x59: { clr: [0x8a] },
  0x3f: { set: [0x8d], clr: [0x40] }, 0x48: { set: [0x8e], clr: [0x49] },
  0x4e: { set: [0x96] }, 0x5b: { set: [0x8a] }, 0x5e: { set: [0x65] }, 0x8f: { set: [0x90] },
  0x53: { clr: [0x52, 0x90] },
  0x58: { set: [0x57] },
  0x5f: { set: [0x89], clr: [0x60] }, 100: { clr: [0x65, 0x8c] },
};

/** SPAWN_TYPE placement (FUN_00063f7c per-event table, run with tools/grantria_spawn.py): 'event:type' -> [x, y, dir] */
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
  private darken = 0;
  private darkLevel = 0;
  private lightning = 0;
  dialogue: Dialogue | null = null;
  private caption: { text: string | string[]; n: number } | null = null;
  /** caption index DAT_003b1dbc (reset at the start of 0x6A, hardmode.md §2.2) */
  private capIdx = -1;
  private showItem: { icon: number; k: number; x: number; y: number } | null = null;
  /** QUEST_ACCEPT / QUEST_COMPLETE waiting for the popup */
  private questPending = false;
  /** skip fade (state 0x3A): frames left */
  private skipFade = 0;
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
    if (e === 0x6a) this.capIdx = -1;
    this.textId = this.db.headers[e].textBase - 1;
    this.wait = 0x19;
    this.fill = 0; this.fade = 0; this.grey = false; this.flash = 0; this.darken = 0; this.darkLevel = 0;
    this.dialogue = null; this.caption = null; this.showItem = null; this.questPending = false;
    this.fs.beginEvent();
    this.camTarget = this.fs.lead;
    this.camCell = null;
    // sprites used by the script are loaded before it runs
    const ids = new Set<number>();
    for (let s = this.pc; s < this.end; s++) {
      const r = this.db.rec(e, s);
      if (r.cmd === 0x0f) ids.add(r.arg);
      else if (r.cmd >= 0x16df && r.cmd < 0x16df + 0xf5) ids.add(r.cmd - 0x16df);
      else if (r.cmd >= 5000 && r.cmd < 5300) ids.add(r.cmd - 5000);
      else if (r.cmd >= 0x1900 && r.cmd < 0x1900 + 300) ids.add(r.cmd - 0x1900);
    }
    this.wait = 'map';
    void this.fs.preloadActors([...ids]).then(() => { this.wait = 0x19; });
  }

  private rec(s: number) { return this.db.rec(this.id, s); }

  /** resolveActor: an actor with that id (visible ones for 0x1a), else the leader (slot 0) */
  private actor(arg: number, cmd = 0): EvActor {
    const lead = this.fs.lead!;
    if (arg < 0 || arg === PLAYER_ARG) return lead;
    if (arg === lead.id) return lead;
    return this.fs.actors.find((a) => a.id === arg && (cmd !== 0x1a || a.visible)) ?? lead;
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
    if (this.darken > 0) this.darken--;
    if (this.lightning > 0) this.lightning--;
    this.shakeY = this.shakeAmp ? ((this.frame & 1) ? this.shakeAmp : -this.shakeAmp) : 0;
    if (this.skipFade > 0) { if (--this.skipFade === 0) this.fastForward(); return; }
    if (this.wait === 'map') return;
    if (this.wait === 0x19) { this.wait = 0; return; }
    if (this.wait === 0) this.run();
    if (!this.active) return;
    for (const a of this.fs.actors) a.update();
    this.fs.lead?.update();
    if (this.pc >= this.end && this.wait === 0) { this.finish(); return; }
    // keys (DemoKey FUN_0004244c)
    for (const k of presses) {
      if (k === AVK.POUND && this.clock > 10 && this.skippable(this.lastCmd) && !this.questPending) { this.skip(); return; }
      if (k !== AVK.OK) continue;
      if (this.wait === 1 && this.dialogue) {
        if (this.dialogue.advance()) { this.dialogue = null; this.next(); }
      } else if (this.wait === 2 && !this.questPending) this.next();          // WAIT_KEY
    }
    switch (this.wait) {
      case 0: this.clock++; break;
      case 1: this.dialogue?.tick(); break;
      case 2: if (this.questPending && !this.fs.popupOpen) this.next(); break;   // quest popup dismissed
      case 4:
        if (this.caption && ++this.caption.n >= 80) { this.caption = null; this.wait = 0; this.clock++; }
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
      case 0x13: if (!this.waitActor || !this.waitActor.moving) this.wait = 0; break;
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
      a.walkTo(fs.field, arg >> 8, arg & 0xff);
      if (fast) a.finishPath(); else { this.wait = 0x13; this.waitActor = a; }
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
      const a = id === PLAYER_ARG || id === fs.lead!.id ? fs.lead! : fs.actors.find((x) => x.id === id) ?? fs.spawnActor(id) ?? fs.lead!;
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
      a.walkTo(fs.field, arg >> 8, arg & 0xff);
      if (fast) a.finishPath();
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
        this.dialogue = new Dialogue(fs.ctx.assets.text[this.textId] ?? '', fs.ctx.assets.text[this.db.nameId(a.id)] ?? '', this.faceOf(a), cmd === 7);
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
        if (arg === -100) break;
        if (arg === 0x3e0) { for (const a of fs.actors) if (a.id === 0x3e0) a.visible = false; break; }
        this.actor(arg).visible = false;
        break;
      case 0x0f: {                                             // SPAWN_TYPE
        const a = fs.spawnActor(arg, true);
        if (!a) break;
        const p = SPAWN_PLACE[`${this.id}:${arg}`];
        if (p) { a.x = p[0]; a.y = p[1]; a.face((p[2] & 3) as Dir); }
        else { a.x = fs.lead!.x; a.y = fs.lead!.y; }
        break;
      }
      case 0x10: this.wait = 'map'; void fs.eventMap(arg).then(() => { this.wait = 0; }); break;
      case 0x13: if (!fast) { this.questPending = true; this.wait = 2; fs.quests.accept(arg); } break;
      case 0x14: {
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
      case 0x1d:                                               // CAPTION
        if (this.id === 0x6a) {                                // staff roll: [4,9,7,11,8,11,1] consecutive text ids
          const L = [4, 9, 7, 11, 8, 11, 1][++this.capIdx] ?? 1, lines: string[] = [];
          for (let i = 0; i < L; i++) lines.push(fs.ctx.assets.text[++this.textId] ?? '');
          if (!fast) { this.caption = { text: lines, n: 0 }; this.wait = 4; }
          break;
        }
        this.textId++;
        if (!fast) { this.caption = { text: fs.ctx.assets.text[this.textId] ?? '', n: 0 }; this.wait = 4; }
        break;
      case 0x1e: fs.partyJoin(); break;
      case 0x25: fs.partyHide(); this.camTarget = fs.lead; if (!fast) this.wait = 0x0c; break;
      case 0x26:                                               // FX_RESET
        this.grey = false; this.fill = 0; this.darkLevel = 0; this.camTarget = this.camTarget ?? fs.lead; this.camCell = null;
        for (const a of [fs.lead!, ...fs.actors]) { a.pose = 0; a.anim = -1; a.speed = 5; }
        break;
      case 0x27: if (!fast) { this.waitUntil = performance.now() + arg; this.wait = 0x15; } break;
      case 0x28: break;                                        // REDRAW_BG
      case 0x29: { const a = this.actor(arg); const d = (a.dir ^ 1) as Dir; a.walkTo(fs.field, Math.floor(a.x / 16) + (d === 0 ? -1 : d === 1 ? 1 : 0), Math.floor(a.y / 16) + (d === 2 ? -1 : d === 3 ? 1 : 0)); break; }
      case 0x2a: fs.partHide = 0; break;                       // PART_SHOW
      case 0x2b: for (const a of [fs.lead!, ...fs.actors]) a.speed = arg; break;
      case 0x2f: case 0x30: this.actor(arg).face(cmd === 0x2f ? 3 : 2); break;
      case 0x31: case 0x32: this.actor(arg).face(cmd === 0x31 ? 0 : 1); break;
      case 0x33: this.shakeAmp = this.shakeAmp ? 0 : arg; break;
      case 0x34: if (!fast) this.darken = arg; break;
      case 0x35: this.darkLevel = Math.min(3, this.darkLevel + 1); break;
      case 0x36: this.darkLevel = 0; break;
      case 0x38: this.fill = 0; if (!fast) { this.fade = 16; this.fadeWhite = true; this.lightning = 16; } break;
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
    story.set(e);
    const hook = END_HOOK[e];
    for (const f of hook?.set ?? []) story.set(f);
    for (const f of hook?.clr ?? []) story.set(f, false);
    if (REPEATABLE.includes(e)) story.set(e, false);
    this.fs.endEvent(e);
  }

  drawOverlay(u: Ui): void {
    if (this.fill) u.fill(0, 0, W, H, this.fill === 1 ? 0x000001 : 0xffffff);
    if (this.darkLevel || this.darken) { u.alpha = this.darken ? 16 : [0, 10, 18, 26][this.darkLevel]; u.fill(0, 0, W, H, 0); u.alpha = 32; }
    if (this.fade) {
      const a = this.fade < 0 ? ((this.fade + 15) * 2) : ((this.fade - 1) * 2);
      if (a > 0) { u.alpha = Math.min(32, a); u.fill(0, 0, W, H, this.fadeWhite ? 0xffffff : 0); u.alpha = 32; }
    }
    if (this.skipFade) { u.alpha = Math.min(32, (16 - this.skipFade) * 2); u.fill(0, 0, W, H, 0); u.alpha = 32; }
    if (this.flash) { u.alpha = FLASH[15 - this.flash] ?? 0; u.fill(0, 0, W, H, 0xffffff); u.alpha = 32; }
    if (this.lightning >= 9 && (this.lightning & 1)) { u.alpha = 12; u.fill(0, 0, W, H, 0xffffff); u.alpha = 32; }
    if (this.showItem) {
      const s = this.showItem, r = this.fs.db.iconRect(s.icon);
      const x = s.x < 0 ? (W >> 1) - 12 : s.x - this.fs.cam.x - 12, y = s.y < 0 ? (H >> 1) - 12 : s.y - this.fs.cam.y - 24;
      u.alpha = Math.max(0, Math.min(32, Math.round(Math.sin((s.k * Math.PI) / 180 * 4) * 32)));
      u.image(r.image, r.sx, r.sy, 24, 24, x, y);
      u.alpha = 32;
    }
    if (this.caption) drawCaption(u, this.caption.text, this.caption.n);
    if (this.active) u.hit(0, 0, W, H, () => [AVK.OK]);       // tap = next line
    if (this.dialogue) this.dialogue.draw(u, this.frame);
    if (this.active && this.clock >= 11 && this.skippable(this.lastCmd) && !this.skipFade) {
      u.hit(W - 76, 0, 62, 36, () => [AVK.POUND]);
      u.alpha = 16;
      u.button(W - 70, 6, 50, 24, 3, 1);
      u.alpha = 32;
      if (this.frame % 8 >= 4) u.textId(100, W - 57, 10);
    }
  }
}
