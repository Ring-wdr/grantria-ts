// Player locomotion in field play, implemented from analysis/features/locomotion.md §0
// (FUN_000718c4 / FUN_00060520 / FUN_000680b4 / FUN_0007343c).
import type { ActionRecord, Cmf } from '../assets';
import { DEFAULT_EQUIP, type Equip } from '../sprites';
import type { Drawable, Field } from './field';
import { boxOverride } from './projectiles';
import { AVK, type Input } from './input';
import { walkPathTick } from './pathfind';

/** Direction like entity +0x7a: 0 left, 1 right, 2 up, 3 down. */
export type Dir = 0 | 1 | 2 | 3;

export const LOCO = {
  accel: 4,                                   // DAT_003b3b3c (ACCEL = DECEL)
  vmax: 8,
  /** class 2 max speed by t & 7 (DAT_003a92c0) */
  vmaxClass2: [8, 8, 8, 8, 11, 9, 5, 7],
  /** stick mode 1 diagonal step |vx|, |vy| (no acceleration) */
  diag: [6, 3] as const,
  /** direction -> facing row (d.dat+0x24ab9) */
  facing: [1, 1, 2, 0] as const,
  idleLen: 6,
  walkBase: 0x12,
  walkLen: [6, 6, 16] as const,              // per class
  /** body box {dx, dy, w, h} for c0/c1/c2 idle and walk frames */
  body: [-8, -8, 16, 8] as const,
};

const DIR_KEYS: Record<number, Dir> = { [AVK.LEFT]: 0, [AVK.RIGHT]: 1, [AVK.UP]: 2, [AVK.DOWN]: 3 };

/** Rectangle in world pixels: [left, top, right, bottom) */
export type Rect = [number, number, number, number];

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

export interface Blockers {
  /** NPC / gimmick boxes: block per axis (FUN_000680b4) */
  solid: Rect[];
  /** monster boxes: overlapping after the move undoes the whole tick's move */
  monsters: Rect[];
}

export class Player {
  x = 0;
  y = 0;
  dir: Dir = 3;
  lastH: 0 | 1 = 0;
  lastV: 2 | 3 = 3;
  vx = 0;                                     // signed velocity used this tick
  vy = 0;
  t = 0;                                      // +0x14 animation tick
  walking = false;
  frame = 0;
  cls = 0;
  /** +0x76 action (0 = move/idle, 1..3 basic attack combo), +0x18 action tick, combo flag */
  action = 0;
  actTick = 0;
  combo = false;
  /** attack box of this tick's frame (world rect) or null */
  attack: Rect | null = null;
  /** sound id requested this tick (0 = none) */
  sound = 0;
  actions: ActionRecord[] = [];
  mult: number[] = [];
  /** action-record events handled by the scene (projectiles 9..26, pull 29) */
  onEvent: (ev: number) => void = () => {};
  /** event 31: c2 drill car / body spin can steer while acting (DAT_003b3a98) */
  private moveAllowed = false;
  private loopCnt = 0;
  private loopMax = 0;
  /** number of basic-attack records before the skills (c0/c2 3, c1 1) */
  get basicCount(): number { return this.cls === 1 ? 1 : 3; }
  /** skill action id a for the damage formula (+0x8f), 100 = basic attack */
  get skillAid(): number { return this.action > this.basicCount ? this.action - (this.cls === 1 ? 2 : 4) : 100; }
  equip: Equip = { ...DEFAULT_EQUIP };
  /** boss hit reaction (FUN_00060d10 / FUN_0007172c): kind 6 stagger, 7 knockback; c counts down */
  knock: { kind: 6 | 7; c: number; bonus: number; stun: boolean } | null = null;
  /** stun ticks (player state 5, +0x5a) */
  stun = 0;
  /** slow timer +0x54 (Black Leo's roar) and player state 2: max speed 4 for every class (FUN_00060520);
   *  a knockback / stagger / stun overwrites state 2, so the slow ends early */
  slowT = 0;
  slowed = false;
  slow(t: number): void { this.slowT = t; this.slowed = true; }
  /** grabbed by Mother's arm (player state 1): no input and no time limit until the arm releases (frame 0x23) */
  grabbed = false;
  /** Queen Frostworm suction (player state 8): the body box's top-left is pulled toward this point (230, 300) */
  pullTo: [number, number] | null = null;
  /** the actor in monster slot 3 (the Queen's main body): walking away from it pulls at 4 instead of 9 */
  pullRef: { x: number; y: number } | null = null;

  /** corner correction state (locomotion.md): blocked code DAT_003dc1b0[0] (1 x, 2 y, 5..8 diagonal corners),
   *  its cell DAT_00415b3c[0] (cx << 8 | cy) and flags DAT_00415bbc[0] (dir << 4 | side) */
  blockCode = 0;
  /** position before the corner correction this tick (FUN_000712a4 runs before FUN_00068444) */
  portalX: number | null = null;
  portalY: number | null = null;
  private cornerCell = 0;
  private cornerFlags = 0;

  /** player state 9: walking a found path (garden entrance "아니오"); all field keys are ignored meanwhile */
  private autoPath: [number, number][] | null = null;
  private onAutoDone: (() => void) | null = null;
  get autoWalking(): boolean { return !!this.autoPath; }
  startAutoWalk(path: [number, number][], done: () => void): void {
    this.autoPath = path; this.onAutoDone = done; this.vx = this.vy = 0; this.action = 0; this.attack = null;
  }

  grab(): void { this.grabbed = true; this.action = 0; this.attack = null; this.vx = this.vy = 0; }

  cmf: Cmf;
  constructor(cmf: Cmf) { this.cmf = cmf; }

  /** FUN_00060d10: face the attacker and get pushed away; stunAfter = +0x76 == 5 (stun 20 ticks after) */
  startKnock(kind: 6 | 7, ax: number, ay: number, opts: { dir?: Dir; bonus?: number; stun?: boolean } = {}): void {
    const dx = ax - this.x, dy = ay - this.y;
    const d: Dir = opts.dir ?? (Math.abs(dx) > Math.abs(dy) ? (ax < this.x ? 0 : 1) : (ay < this.y ? 2 : 3));
    this.dir = d;
    if (d < 2) this.lastH = d as 0 | 1; else this.lastV = d as 2 | 3;
    this.knock = { kind, c: kind === 6 ? 5 : 9, bonus: opts.bonus ?? 0, stun: !!opts.stun };
    this.slowed = false;                                               // +0x79 = 6 / 7 overwrites state 2
    this.action = 0;
    this.attack = null;
  }

  get controllable(): boolean { return !this.knock && this.stun === 0; }

  /** FUN_0007172c: one push tick; frame = first idle frame of the facing */
  private knockTick(field: Field, blockers: Blockers): void {
    const k = this.knock!;
    this.frame = LOCO.facing[this.dir] * LOCO.idleLen;
    const sp = (k.kind === 6 || k.bonus ? [0, 1, 2, 5, 10, 20][k.c] ?? 0 : [0, 1, 0, 1, -2, 3, -4, 5, -6, 64][k.c] ?? 0) + k.bonus;
    const v = this.dir === 0 ? [sp, 0] : this.dir === 1 ? [-sp, 0] : this.dir === 2 ? [0, sp] : [0, -sp];
    this.moveAxis('x', v[0], field, { solid: blockers.solid, monsters: [] });
    this.moveAxis('y', v[1], field, { solid: blockers.solid, monsters: [] });
    if (k.c === 0) {
      if (k.stun) { this.stun = 20; this.slowed = false; }
      this.knock = null;
      this.action = 0;
      return;
    }
    k.c--;
  }

  get cmfName(): string {
    return `cmf_c${this.cls}`;
  }

  /** Spawn after a map change: speed, action and t reset, direction kept. */
  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = this.vy = 0;
    this.t = 0;
    this.walking = false;
    this.action = 0;
    this.attack = null;
    this.blockCode = 0;                                                // FUN_0001d6c4 memset on map load
    this.frame = LOCO.facing[this.dir] * LOCO.idleLen;
  }

  /** Skill start (FUN_000452a0): +0x76 = (class 1 ? 2 : 4) + a, played from the next tick. */
  startSkill(a: number): void {
    this.action = (this.cls === 1 ? 2 : 4) + a;
    this.actTick = 0;
    this.combo = false;
  }

  /** interaction action (pickup / gathering, FUN_00045570): c0 / c2 0xf, c1 0xd; no facing term */
  get interactAction(): number { return this.cls === 1 ? 0xd : 0xf; }
  /** pickup frame of the interaction action: the item is gained when it is shown (c0 k3, c1 / c2 k5) */
  static readonly PICK_FRAME = [694, 812, 866];
  /** set by the scene each frame while gathering: the swing offset s; the action tick stays 0 (FUN_000618f4) */
  gatherSwing: number | null = null;
  /** called on the pickup frame of the interaction action */
  onPickup: () => void = () => {};
  startInteract(): void { this.action = this.interactAction; this.actTick = 0; this.combo = false; }

  /** '5' pressed (FUN_00045570): start the first basic attack unless already acting. */
  startAttack(): void {
    if (this.action !== 0 || !this.actions.length) return;
    this.action = 1;
    this.actTick = 0;
    this.combo = false;
  }

  /** Attack tick (FUN_00070f28 / FUN_00070b68, combat.md §0). Returns the move velocity. */
  private attackTick(okHeld: boolean): [number, number] {
    const rec = this.actions[this.action - 1];
    const k = this.actTick % rec.n;
    if (this.action === this.interactAction) {                       // FUN_00063ab4 / 63948 / 637dc
      this.attack = null;
      this.sound = 0;
      if (this.gatherSwing !== null) { this.frame = rec.frame[k] + this.gatherSwing; return [0, 0]; }   // +0x18 held at 0
      this.frame = rec.frame[k];
      if (this.frame === Player.PICK_FRAME[this.cls]) this.onPickup();
      if (rec.event[k] === 4) this.action = 0; else this.actTick++;
      return [0, 0];
    }
    this.frame = rec.frame[k] + (this.mult[this.action - 1] ?? 0) * LOCO.facing[this.dir];
    const s = rec.step[k];
    let vx = 0, vy = 0;
    if (s) {
      if (this.dir < 2) vx = this.lastH === 1 ? s : -s;
      else vy = this.lastV === 3 ? s : -s;
    }
    this.sound = rec.sound[k];
    if (okHeld && !this.combo) this.combo = this.cls !== 1 && this.actTick >= rec.n - 3;
    const action = this.action;
    const ev = rec.event[k];
    switch (ev) {
      case 1: if (this.combo) { this.action++; this.actTick = 0; } else this.action = 0; this.combo = false; break;
      case 2: this.combo = false; break;
      case 4: this.action = 0; this.combo = false; this.moveAllowed = false; break;
      case 31: this.moveAllowed = true; break;
      case 32: this.loopCnt = 0; this.loopMax = this.action === 8 ? 1 : this.action === 9 ? 2 : 0; break;
      case 33:                                         // c2 drill car / body spin repeat (FUN_00070b68)
        if (this.loopCnt === this.loopMax) { this.loopCnt = 0; this.loopMax = 0; }
        else if (this.action === 8) { this.loopCnt++; this.frame = 453 + 18 * LOCO.facing[this.dir]; this.actTick = 6; }
        else if (this.action === 9) { this.loopCnt++; this.frame = 509 + 17 * LOCO.facing[this.dir]; this.actTick = 8; }
        break;
      default: if ((ev >= 9 && ev <= 26) || ev === 29) this.onEvent(ev);
    }
    if (this.action === action) this.actTick++;
    // attack box: override table or frame bytes 4..7 mirrored when dir & 1; the player gets
    // w + 2 and x - 2 facing left (FUN_000231e4 / FUN_000232f8)
    const ov = boxOverride(this.cls, this.frame, this.dir, this.lastH);
    const a = this.cmf.frames[this.frame]?.attack_box;
    this.attack = null;
    const b = ov ?? (a && a[2] > 0 && a[3] > 0 ? [this.dir & 1 ? -a[0] - a[2] : a[0], a[1], a[2], a[3]] : null);
    if (b) {
      let bx = b[0];
      if (this.dir === 0) bx -= 2;
      this.attack = [this.x + bx, this.y + b[1], this.x + bx + b[2] + 2, this.y + b[1] + b[3]];
    }
    return [vx, vy];
  }

  box(x = this.x, y = this.y): Rect {
    const [dx, dy, w, h] = LOCO.body;
    return [x + dx, y + dy, x + dx + w, y + dy + h];
  }

  private blocked(field: Field, b: Blockers): boolean {
    const [l, t, r, btm] = this.box();
    const c0 = Math.max(0, l >> 4), c1 = Math.max(0, (r - 1) >> 4);
    const r0 = Math.max(0, t >> 4), r1 = Math.max(0, (btm - 1) >> 4);
    // FUN_00067d4c: the first blocked cell is classified for the corner correction (FUN_00067884)
    for (let row = r0; row <= r1; row++) for (let c = c0; c <= c1; c++) if (!field.walkCell(c, row)) { this.classify(field, c, row); return true; }
    const me = this.box();
    return b.solid.some((s) => overlaps(me, s));
  }

  private wk(f: Field, c: number, r: number): number { return f.walkAt(c + r * f.map.header.width); }
  /** the diagonal checks of dir 2 / 3 read bit ~b & 7, i.e. the mirrored cell index ^ 7 (original bug, emulator-checked) */
  private wkLsb(f: Field, c: number, r: number): number { return f.walkAt((c + r * f.map.header.width) ^ 7); }
  /** FUN_00067640: cell range of the body box */
  private cells(): { c0: number; r0: number } {
    const L = this.x - 8, T = this.y - 8;
    return { c0: L > 0 ? (L & 0xfff) >> 4 : 0, r0: T > 0 ? (T & 0xfff) >> 4 : 0 };
  }

  /** FUN_00067884: classify the blocked cell (cx, cy) as a diagonal corner 5↖ 6↗ 7↙ 8↘ (or 0) */
  private classify(f: Field, cx: number, cy: number): void {
    if (this.action !== 0) return;
    const { c0, r0 } = this.cells(), Lk = [0, 0, 0, 0];
    for (let k = 1; k <= 2; k++) {
      if (this.dir < 2) {
        const col = this.lastH === 1 ? c0 + 1 : c0 - 1;
        Lk[2] = this.wk(f, col, r0 - k); Lk[3] = this.wk(f, col, r0 + k);
        if (Lk[2] !== Lk[3]) break;
      } else {
        const row = this.lastV === 2 ? r0 : r0 + 1;
        Lk[0] = this.wk(f, c0 - k, row); Lk[1] = this.wk(f, c0 + k, row);
        if (Lk[0] !== Lk[1]) break;
      }
    }
    let code = 0;
    switch (this.dir) {
      case 2: code = !Lk[0] ? (Lk[1] && this.wk(f, cx + 1, cy) && !this.wkLsb(f, cx + 1, cy - 1) ? 6 : 0) : (this.wk(f, cx - 1, cy) && !this.wkLsb(f, cx - 1, cy - 1) ? 5 : 0); break;
      case 3: code = !Lk[0] ? (Lk[1] && this.wk(f, cx + 1, cy) && !this.wkLsb(f, cx + 1, cy + 1) ? 8 : 0) : (this.wk(f, cx - 1, cy) && !this.wkLsb(f, cx - 1, cy + 1) ? 7 : 0); break;
      case 0: code = !Lk[2] ? (Lk[3] && this.wk(f, cx, cy + 1) ? 7 : 0) : (this.wk(f, cx, cy - 1) ? 5 : 0); break;
      case 1: code = !Lk[2] ? (Lk[3] && this.wk(f, cx, cy + 1) ? 8 : 0) : (this.wk(f, cx, cy - 1) ? 6 : 0); break;
    }
    this.blockCode = code;
    this.cornerCell = ((cx << 8) | (cy & 0xff)) & 0xffff;
    this.cornerFlags = ((this.dir & 15) << 4) | (this.dir < 2 ? (Lk[2] ? 2 : 3) : (Lk[0] ? 0 : 1));
  }

  /**
   * FUN_00068444 (after both axis moves while walking, speed != 0, no action): when the cell 16 px ahead of the
   * body box is blocked (or this tick was blocked) the speed drops to 0; then the player is nudged around the
   * corner: along the other axis toward the one open side (4 px vertically, 6 px horizontally, cells ±1..3), or
   * diagonally by the edge distance for the corner codes 5..8. A nudge into walls or monsters is undone.
   */
  private corner(f: Field, b: Blockers): void {
    const W = f.map.header.width, H = f.map.header.height;
    let p = this.blockCode;
    const L = this.x - 8, R = this.x + 8, T = this.y - 8, B = this.y;
    const ahead: [number, number, number][] = [[(L - 16) >> 4, T >> 4, 1], [(R + 16) >> 4, T >> 4, 1], [this.x >> 4, (T - 16) >> 4, 2], [this.x >> 4, (B + 16) >> 4, 2]];
    const [ac, ar, base] = ahead[this.dir];
    if (!this.wk(f, ac, ar)) { this.classify(f, ac, ar); p = this.blockCode || base; }
    else if (!p) return;
    this.vx = this.vy = 0;
    this.blockCode = 0;
    const { c0, r0 } = this.cells();
    let vx = 0, vy = 0, dist = 0, route: 'D' | 'V' | 'H' = 'D';
    if (p >= 3) {
      const lo = this.cornerFlags & 15, cx = this.cornerCell >> 8, cy = this.cornerCell & 0xff;
      if (this.cornerFlags >> 4 < 2) {
        if (lo === 2 || lo === 3) { dist = lo === 2 ? Math.abs(cy * 16 - this.y) : Math.abs(cy * 16 + 16 - T); if (dist >= 5) route = 'V'; }
      } else if (lo === 0 || lo === 1) { dist = lo === 0 ? Math.abs(cx * 16 - R) : Math.abs(cx * 16 + 16 - L); if (dist >= 7) route = 'H'; }
    }
    if (route === 'D') {
      if (p >= 5 && p <= 8) { vx = p & 1 ? -dist : dist; vy = p < 7 ? -dist : dist; }
      else if (p === 1) route = 'V';
      else if (p === 2) route = 'H';
    }
    if (route === 'V') {
      let up = 0;
      for (let k = 1; ; k++) {
        if (c0 - 1 < 1 || c0 + 1 >= W || r0 - k < 1 || r0 + k >= H) return;
        const col = this.lastH === 1 ? c0 + 1 : c0 - 1;
        up = this.wk(f, col, r0 - k);
        if (up !== this.wk(f, col, r0 + k)) break;
        if (k === 3) return;
      }
      vy = up ? -4 : 4;
    } else if (route === 'H') {
      let left = 0;
      for (let k = 1; ; k++) {
        if (c0 - k < 1 || c0 + k >= W || r0 - 1 < 1 || r0 + 1 >= H) return;
        const row = this.lastV === 2 ? r0 - 1 : r0 + 1;
        left = this.wk(f, c0 - k, row);
        if (left !== this.wk(f, c0 + k, row)) break;
        if (k === 3) return;
      }
      vx = left ? -6 : 6;
    }
    this.x += vx; this.y += vy;
    if (b.monsters.some((m) => overlaps(this.box(), m)) || this.blocked(f, b)) { this.x -= vx; this.y -= vy; }
  }

  /** Move one axis by v, clamp to the map, undo when blocked. Returns the applied velocity. */
  private moveAxis(axis: 'x' | 'y', v: number, field: Field, b: Blockers): number {
    if (!v) return 0;
    const old = this[axis];
    let p = old + v;
    p = axis === 'x' ? Math.max(8, Math.min(field.width - 8, p)) : Math.max(8, Math.min(field.height, p));
    this[axis] = p;
    if (this.blocked(field, b)) {
      this[axis] = old;
      if (axis === 'x') { if (!this.blockCode) this.blockCode = 1; }    // FUN_000680b4
      else if (this.blockCode < 2) this.blockCode = 2;                  // FUN_00067f70
      return 0;
    }
    return p - old;
  }

  update(input: Input, field: Field, blockers: Blockers): void {
    this.sound = 0;
    this.portalX = this.portalY = null;
    if (this.slowT > 0) this.slowT--;                                 // FUN_0007352c, before the player update
    if (this.slowed && this.slowT === 0) this.slowed = false;          // FUN_00071ec0 case 2: back to state 0
    if (this.knock) { this.knockTick(field, blockers); this.walking = false; this.t++; return; }
    if (this.grabbed) { this.walking = false; return; }                // state 1 has no case in FUN_00071ec0
    if (this.autoPath) {                                               // case 9: speed 8, no walls / portals / corners
      if (walkPathTick(this, [-8, -8], this.autoPath, 8)) { this.autoPath = null; this.vx = this.vy = 0; const d = this.onAutoDone; this.onAutoDone = null; d?.(); }
      const len = LOCO.walkLen[this.cls] ?? 6;
      this.frame = LOCO.walkBase + LOCO.facing[this.dir] * len + ((this.t >> 1) % len);
      this.walking = true;
      this.t++;
      return;
    }
    if (this.pullTo) { this.suction(input, field, blockers); return; }
    if (this.stun > 0) { this.stun--; this.frame = LOCO.facing[this.dir] * LOCO.idleLen; this.walking = false; this.vx = this.vy = 0; return; }
    if (this.action !== 0) {                         // direction locked, arrows ignored
      let [vx, vy] = this.attackTick(input.isHeld(AVK.OK));
      if (this.moveAllowed) {                        // steer like walking (FUN_00060520 path)
        const key = input.direction();
        if (key) {
          this.dir = DIR_KEYS[key];
          if (this.dir < 2) this.lastH = this.dir as 0 | 1; else this.lastV = this.dir as 2 | 3;
          const sp = Math.min(LOCO.vmax, Math.max(Math.abs(this.vx), Math.abs(this.vy)) + LOCO.accel);
          vx = this.dir === 0 ? -sp : this.dir === 1 ? sp : 0;
          vy = this.dir === 2 ? -sp : this.dir === 3 ? sp : 0;
        }
      }
      const x0 = this.x, y0 = this.y;
      this.vx = this.moveAxis('x', vx, field, blockers);
      this.vy = this.moveAxis('y', vy, field, blockers);
      if (blockers.monsters.some((m) => overlaps(this.box(), m))) { this.x = x0; this.y = y0; this.vx = this.vy = 0; }
      this.walking = false;
      this.t++;
      return;
    }
    this.attack = null;
    this.actTick = 0;                                  // +0x18 is 0 while moving (skill start check)
    const key = input.direction();
    const held = key !== 0;
    const vmax = this.slowed ? 4 : this.cls === 2 ? LOCO.vmaxClass2[this.t & 7] : LOCO.vmax;
    let onAxis: 'x' | 'y' | null = null;
    if (held) {
      this.dir = DIR_KEYS[key];
      if (this.dir < 2) this.lastH = this.dir as 0 | 1;
      else this.lastV = this.dir as 2 | 3;
      onAxis = this.dir < 2 ? 'x' : 'y';
    }
    // one axis at a time; the other axis' speed is dropped
    let vx = 0, vy = 0;
    if (this.dir < 2) {
      const s = onAxis === 'x' ? Math.min(Math.abs(this.vx) + LOCO.accel, vmax) : Math.max(Math.abs(this.vx) - LOCO.accel, 0);
      vx = this.lastH === 1 ? s : -s;
    } else {
      const s = onAxis === 'y' ? Math.min(Math.abs(this.vy) + LOCO.accel, vmax) : Math.max(Math.abs(this.vy) - LOCO.accel, 0);
      vy = this.lastV === 3 ? s : -s;
    }
    const st = input.stick;
    if (held && st.active) {
      const rad = st.angle * Math.PI / 180;
      const fromVertical = Math.atan2(Math.abs(Math.cos(rad)), Math.abs(Math.sin(rad))) * 180 / Math.PI;
      if (fromVertical > 24 && fromVertical < 65) {
        vx = Math.cos(rad) >= 0 ? LOCO.diag[0] : -LOCO.diag[0];
        vy = Math.sin(rad) >= 0 ? LOCO.diag[1] : -LOCO.diag[1];
      }
    }
    this.walkMove(vx, vy, field, blockers);
    this.walking = held;
    // pick this tick's frame, then advance t (FUN_0002c2a8 / FUN_0007343c)
    const facing = LOCO.facing[this.dir];
    const len = LOCO.walkLen[this.cls] ?? 6;
    this.frame = held
      ? LOCO.walkBase + facing * len + ((this.t >> 1) % len)
      : facing * LOCO.idleLen + (this.t % LOCO.idleLen);
    this.t++;
  }

  /** FUN_00071424: x then y, a monster overlap undoes the tick, then the corner correction (speed != 0, no action) */
  walkMove(vx: number, vy: number, field: Field, blockers: Blockers): void {
    const x0 = this.x, y0 = this.y;
    this.vx = this.moveAxis('x', vx, field, blockers);
    this.vy = this.moveAxis('y', vy, field, blockers);
    if (blockers.monsters.some((m) => overlaps(this.box(), m))) {
      this.x = x0;
      this.y = y0;
      this.vx = this.vy = 0;
    } else if ((this.vx || this.vy) && this.action === 0) {
      this.portalX = this.x; this.portalY = this.y;                    // the portal check uses the pre-correction spot
      this.corner(field, blockers);
    }
  }

  /** face a key direction (FUN_00060520 without acceleration) */
  private faceKey(key: number): void {
    this.dir = DIR_KEYS[key];
    if (this.dir < 2) this.lastH = this.dir as 0 | 1; else this.lastV = this.dir as 2 | 3;
  }

  /** move s px along the facing (walls and solids per axis, monster overlap undoes); the stored speed becomes s */
  private moveFacing(s: number, field: Field, blockers: Blockers): void {
    const sign = this.dir === 0 || this.dir === 2 ? -s : s;
    const x0 = this.x, y0 = this.y;
    if (this.dir < 2) { this.vx = this.moveAxis('x', sign, field, blockers) || 0; this.vy = 0; }
    else { this.vy = this.moveAxis('y', sign, field, blockers) || 0; this.vx = 0; }
    if (blockers.monsters.some((m) => overlaps(this.box(), m))) { this.x = x0; this.y = y0; this.vx = this.vy = 0; }
  }

  /**
   * Player state 8 (FUN_00071ec0 120335–120371): ① keys turn only, the stored speed decays by 4 along the facing;
   * ② speed 9, or 4 when the held key points away from the Queen's main body; ③ FUN_00065f9c pulls the body box's
   * top-left toward the point (no walls) and turns the player; ④ the facing component c of that pull moves another
   * max(c - 4, 0) (only +x / +y pulls); ⑤ the walk animation.
   */
  private suction(input: Input, field: Field, blockers: Blockers): void {
    const key = input.direction();
    if (key) this.faceKey(key);
    const mag = Math.max(0, Math.max(Math.abs(this.vx), Math.abs(this.vy)) - LOCO.accel);
    this.moveFacing(mag, field, blockers);
    const q = this.pullRef, k = key ? DIR_KEYS[key] : -1;
    const away = !!q && (k === 0 ? this.x <= q.x : k === 1 ? this.x >= q.x : k === 2 ? this.y <= q.y : k === 3 ? this.y >= q.y : false);
    const sp = away ? 4 : 9;
    const [tx, ty] = this.pullTo!;
    const dx = tx - (this.x - 8), dy = ty - (this.y - 8);
    const round = (v: number) => Math.trunc((v * 10 + 5) / 10);
    let vx: number, vy: number;
    if (!dx && !dy) { vx = 0; vy = -sp; }
    else if (Math.abs(dy) < Math.abs(dx)) { vx = Math.sign(dx) * sp; vy = Math.sign(dy) * round((sp * Math.abs(dy)) / Math.abs(dx)); }
    else { vx = Math.sign(dx) * round((sp * Math.abs(dx)) / Math.abs(dy)); vy = Math.sign(dy) * sp; }
    if (Math.abs(vx) > Math.abs(vy)) { this.dir = vx < 0 ? 0 : 1; this.lastH = this.dir as 0 | 1; }
    else { this.dir = vy < 0 ? 2 : 3; this.lastV = this.dir as 2 | 3; }
    this.x += vx; this.y += vy;
    if (key) this.faceKey(key);
    const c = this.dir < 2 ? vx : vy;
    this.moveFacing(Math.max(c - 4, 0), field, blockers);
    const len = LOCO.walkLen[this.cls] ?? 6;
    this.frame = LOCO.walkBase + LOCO.facing[this.dir] * len + ((this.t >> 1) % len);
    this.walking = false;
    this.t++;
  }

  drawable(): Drawable {
    // facing row 1 art faces left; facing right is the mirrored case (locomotion.md §0)
    const mirror = this.dir < 2 && this.lastH === 1;
    return { cmfName: this.cmfName, cmf: this.cmf, frame: this.frame, x: this.x, y: this.y, mirror, equip: this.equip, depth: this.y + LOCO.body[1] };
  }
}
