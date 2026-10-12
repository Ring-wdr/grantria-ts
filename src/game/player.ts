// Player locomotion in field play, implemented from analysis/features/locomotion.md §0
// (FUN_000718c4 / FUN_00060520 / FUN_000680b4 / FUN_0007343c).
import type { ActionRecord, Cmf } from '../assets';
import { DEFAULT_EQUIP, type Equip } from '../sprites';
import type { Drawable, Field } from './field';
import { boxOverride } from './projectiles';
import { AVK, type Input } from './input';

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
  /** slow timer +0x54 (Black Leo's roar): walking speed halved [추정] */
  slowT = 0;
  /** grabbed by Mother's arm (player state 1): no input until released (safety limit 60 ticks) */
  grabbed = false;
  private grabT = 0;
  /** Queen Frostworm suction (player state 8): pulled toward the point 9 px/tick, 4 when walking away [추정] */
  pullTo: [number, number] | null = null;

  grab(): void { this.grabbed = true; this.grabT = 0; this.action = 0; this.attack = null; this.vx = this.vy = 0; }

  constructor(public cmf: Cmf) {}

  /** FUN_00060d10: face the attacker and get pushed away; stunAfter = +0x76 == 5 (stun 20 ticks after) */
  startKnock(kind: 6 | 7, ax: number, ay: number, opts: { dir?: Dir; bonus?: number; stun?: boolean } = {}): void {
    const dx = ax - this.x, dy = ay - this.y;
    const d: Dir = opts.dir ?? (Math.abs(dx) > Math.abs(dy) ? (ax < this.x ? 0 : 1) : (ay < this.y ? 2 : 3));
    this.dir = d;
    if (d < 2) this.lastH = d as 0 | 1; else this.lastV = d as 2 | 3;
    this.knock = { kind, c: kind === 6 ? 5 : 9, bonus: opts.bonus ?? 0, stun: !!opts.stun };
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
      if (k.stun) this.stun = 20;
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
    this.frame = LOCO.facing[this.dir] * LOCO.idleLen;
  }

  /** Skill start (FUN_000452a0): +0x76 = (class 1 ? 2 : 4) + a, played from the next tick. */
  startSkill(a: number): void {
    this.action = (this.cls === 1 ? 2 : 4) + a;
    this.actTick = 0;
    this.combo = false;
  }

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
    for (let row = r0; row <= r1; row++) for (let c = c0; c <= c1; c++) if (!field.walkCell(c, row)) return true;
    const me = this.box();
    return b.solid.some((s) => overlaps(me, s));
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
      return 0;
    }
    return p - old;
  }

  update(input: Input, field: Field, blockers: Blockers): void {
    this.sound = 0;
    if (this.slowT > 0) this.slowT--;
    if (this.knock) { this.knockTick(field, blockers); this.walking = false; this.t++; return; }
    if (this.grabbed) {
      this.frame = LOCO.facing[this.dir] * LOCO.idleLen;
      if (++this.grabT > 60) this.grabbed = false;
      this.walking = false;
      return;
    }
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
    let vmax = this.cls === 2 ? LOCO.vmaxClass2[this.t & 7] : LOCO.vmax;
    if (this.slowT > 0) vmax >>= 1;
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
    const x0 = this.x, y0 = this.y;
    this.vx = this.moveAxis('x', vx, field, blockers);
    this.vy = this.moveAxis('y', vy, field, blockers);
    if (blockers.monsters.some((m) => overlaps(this.box(), m))) {
      this.x = x0;
      this.y = y0;
      this.vx = this.vy = 0;
    }
    if (this.pullTo) {
      const [tx, ty] = this.pullTo, dx = tx - this.x, dy = ty - this.y;
      const away = held && ((this.dir === 0 && dx > 0) || (this.dir === 1 && dx < 0) || (this.dir === 2 && dy > 0) || (this.dir === 3 && dy < 0));
      const sp = away ? 4 : 9, d = Math.hypot(dx, dy);
      if (d > 1) {
        this.moveAxis('x', Math.round((dx / d) * Math.min(sp, d)), field, blockers);
        this.moveAxis('y', Math.round((dy / d) * Math.min(sp, d)), field, blockers);
      }
    }
    this.walking = held;
    // pick this tick's frame, then advance t (FUN_0002c2a8 / FUN_0007343c)
    const facing = LOCO.facing[this.dir];
    const len = LOCO.walkLen[this.cls] ?? 6;
    this.frame = this.pullTo ? 0x12 : held
      ? LOCO.walkBase + facing * len + ((this.t >> 1) % len)
      : facing * LOCO.idleLen + (this.t % LOCO.idleLen);
    this.t++;
  }

  drawable(): Drawable {
    // facing row 1 art faces left; facing right is the mirrored case (locomotion.md §0)
    const mirror = this.dir < 2 && this.lastH === 1;
    return { cmfName: this.cmfName, cmf: this.cmf, frame: this.frame, x: this.x, y: this.y, mirror, equip: this.equip, depth: this.y + LOCO.body[1] };
  }
}
