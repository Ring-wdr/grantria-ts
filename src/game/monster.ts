// Normal monsters (behaviour 1): combat.md §3–§5, game-rules.md §3.7 and monster-ai.md §1
// (wander FUN_0007210c, record choice and state decisions of FUN_00034300).
// Status timers (polish.md §1): slow, dark, poison, stun (state 0xd), burn / chill marks. Type
// overrides of polish.md §2.3: type 6 idles on record F, 0x15 on record 0 outside attacks.
import type { Cmf } from '../assets';
import type { Drawable, Field } from './field';
import type { Rect } from './player';
import type { SpriteFx } from '../sprites';
import { monsterStats, type Rng } from './rules';
import type { BoxOverride, ShotOpts } from './boss';

export const FACING = [1, 1, 2, 0] as const;
const HURT_STEPS = [16, 4];                                  // state 6
const KNOCK_STEPS = [64, -6, 5, -4, 3, -2, 1, 0, 1, 0];      // state 7
export const DEATH_TICKS = 11;
const RESPAWN_TICKS = 550;

export type Dir = 0 | 1 | 2 | 3;

export const overlaps = (a: Rect, b: Rect): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Box from a frame's body (0) or attack (4) bytes, mirrored when dir & 1 (FUN_000231e4). */
export function frameBox(cmf: Cmf, frame: number, which: 'body' | 'attack', x: number, y: number, dir: number): Rect | null {
  const b = which === 'body' ? cmf.frames[frame]?.body_box : cmf.frames[frame]?.attack_box;
  if (!b || b[2] <= 0 || b[3] <= 0) return null;
  const bx = dir & 1 ? -b[0] - b[2] : b[0];
  return [x + bx, y + b[1], x + bx + b[2], y + b[1] + b[3]];
}

/** What a monster needs from the scene each tick. */
export interface MonsterWorld {
  field: Field;
  rng: Rng;
  /** global frame counter DAT_003b3b78 (wander timers count on odd ticks) */
  gtick: number;
  px: number;
  py: number;
  playerBox: Rect;
  playerAlive: boolean;
}

export class Monster {
  x: number;
  y: number;
  spawnX: number;
  spawnY: number;
  dir: Dir = 3;
  lastH: 0 | 1 = 0;
  lastV: 2 | 3 = 3;
  state = 0;               // +0x79: 0 idle/wander, 1 attack, 2 chase, 4 return, 6 hurt, 7 knockback
  rec = 0;                 // +0x24 anim record index
  t = 0;                   // +0x14
  phase = 0;               // +0x7f attack cycle: 2 attacking, 1 / 0 resting
  /** +0x81: wander time left (2-tick units); also read by the chase / return decisions */
  timer = 0;
  /** +0x82: wander mode 0..3 direction, 4 stopped, 9/10 bound reached */
  wander = 0;
  hurt = 0;                // remaining hurt / knockback steps
  hurtTable: number[] = [];
  pushDir: Dir = 0;
  tint = 0;                // red tint strength 0..32
  /** slow timer +0x54: movement halved (FUN_00072400) */
  slow = 0;
  /** 차원의 문: dead monsters stay dead; index into the floor's records */
  noRespawn = false;
  /** +0x56 dark (the player evades its attacks +50 %p), +0x5a stun (state 0xd), +0x5c burn / +0x5e chill (marks only) */
  dark = 0;
  stun = 0;
  burn = 0;
  chill = 0;
  /** +0x8f == 3: c0 shoulder tackle / rush, a 10-tick stun when the hurt ends */
  stunAfter = false;
  /** boxes frozen when the stun starts (FUN_000231e4 is not run while stunned, polish.md §1.4) */
  private stunBody: Rect | null = null;
  private stunAttack: Rect | null = null;
  /** state 0xd for n ticks: the body and attack boxes stay as they were at this moment */
  startStun(n: number): void {
    this.stunBody = this.body();
    this.stunAttack = this.attackBox();
    this.state = 0xd; this.t = 0; this.stun = n;
  }
  /** tick of the first hit since (re)spawn, for "killed within 5 seconds" (title 6..8) */
  firstHit = -1;
  dimIdx = -1;
  /** poison timer +0x58 (극독의 비약): a hit of player ATK/20 every 20 ticks, never below HP 1 (leftovers-combat.md §1) */
  poison = 0;
  /** pulled toward a point (state 9, gravity hole): 8 px per tick while ticks > 0 */
  pull: { x: number; y: number; ticks: number } | null = null;
  /** +0x48: summoner (King Dusty's summons chase every tick) */
  parent: Monster | null = null;
  frame = 0;
  hp: number;
  maxHp: number;
  atk: number;
  level: number;
  alive = true;
  deathT = 0;
  respawnT = 0;
  readonly ai: number[];
  readonly fourDir: boolean;
  readonly sight: number;
  readonly range: number;
  /** +0x76 action (boss pattern; the damage multiplier key) */
  action = 0;
  /** FUN_000231e4 box overrides (bosses) */
  boxes: Record<string, BoxOverride> = {};
  /** this tick's horizontal move (shots that follow their owner) */
  lastVx = 0;
  /** main body of a multi-part boss */
  main: Monster | null = null;
  /** projectiles to create this tick (FUN_000628a8, monster-ai.md §1.5) */
  shotsOut: { x: number; y: number; o: ShotOpts }[] = [];
  private lastShotFrame = -1;

  constructor(readonly type: number, readonly cmfName: string, readonly cmf: Cmf, x: number, y: number,
    roomLevel: number, readonly typeRec: number[], hard = false) {
    this.x = this.spawnX = x;
    this.y = this.spawnY = y;
    const st = monsterStats(roomLevel, type, hard);              // hard: level + 80, ATK ×1.2 (FUN_0001bb8c)
    this.level = st.level;
    this.hp = this.maxHp = st.hp;
    this.atk = st.atk;
    const hex = cmf.trailing_hex ?? '';
    this.ai = Array.from({ length: 8 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2) || '0', 16));
    this.fourDir = typeRec[5] !== 2;
    this.sight = typeRec[7] * 8;
    this.range = (this.ai[3] >> 3) << 4;
    this.rec = this.idleRec();
  }

  get isBoss(): boolean { return this.typeRec[1] === 11; }
  protected get F(): number { return FACING[this.dir]; }
  protected get V(): number { return this.lastV === 2 ? 1 : 0; }
  protected idleRec(): number { return this.fourDir ? this.F : this.V; }
  protected moveRec(): number { return this.fourDir ? 3 + this.F : 2 + this.V; }
  private attackRec(): number { return this.ai[0] + (this.ai[6] === 4 ? this.F : (~this.lastV & 1)); }

  body(): Rect | null {
    if (this.stun > 0 && this.stunBody) return this.stunBody;
    return frameBox(this.cmf, this.frame, 'body', this.x, this.y, this.dir);
  }

  /** Attack box on this tick's frame while attacking (frames without a box deal no damage). */
  attackBox(): Rect | null {
    if (this.stun > 0) return this.alive ? this.stunAttack : null;   // an attack frame frozen by the stun keeps hitting (FUN_0006fd44)
    if (!this.alive || this.state !== 1 || this.phase !== 2) return null;
    return frameBox(this.cmf, this.frame, 'attack', this.x, this.y, this.dir);
  }

  setDir(d: Dir): void {
    this.dir = d;
    if (d < 2) this.lastH = d as 0 | 1; else this.lastV = d as 2 | 3;
  }

  /** FUN_00061158: lastH / lastV toward the point, dir on the dominant axis (mode 2 = horizontal only). */
  face(px: number, py: number, mode = this.fourDir ? 4 : 2): void {
    const dx = px - this.x, dy = py - this.y;
    this.lastH = px > this.x ? 1 : 0;
    this.lastV = py > this.y ? 3 : 2;
    this.dir = mode === 2 || Math.abs(dy) < Math.abs(dx) ? this.lastH : this.lastV;
  }

  /** Diagonal step toward a point (FUN_000609c0): the minor axis is speed*minor/major rounded. */
  toward(px: number, py: number, speed: number): [number, number] {
    const dx = px - this.x, dy = py - this.y;
    if (!dx && !dy) return [0, 0];
    const round = (v: number) => Math.trunc((v * 10 + 5) / 10);
    if (Math.abs(dy) < Math.abs(dx)) return [Math.sign(dx) * speed, Math.sign(dy) * round(speed * Math.abs(dy) / Math.abs(dx))];
    return [Math.sign(dx) * round(speed * Math.abs(dx) / Math.abs(dy)), Math.sign(dy) * speed];
  }

  protected blocked(field: Field, box: Rect | null): boolean {
    if (!box) return false;
    const c0 = Math.max(0, box[0] >> 4), c1 = Math.max(0, (box[2] - 1) >> 4);
    const r0 = Math.max(0, box[1] >> 4), r1 = Math.max(0, (box[3] - 1) >> 4);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!field.walkCell(c, r)) return true;
    return false;
  }

  /** FUN_000681f8: per-axis move with walk-layer collision; the whole move is undone if it overlaps
   *  the player. Returns which axes were blocked and whether the player was hit. */
  move(field: Field, vx: number, vy: number, player: Rect): { blocked: boolean; player: boolean } {
    if (this.slow > 0) { vx >>= 1; vy >>= 1; }
    const x0 = this.x, y0 = this.y;
    let blocked = false;
    for (const [axis, v] of [['x', vx], ['y', vy]] as const) {
      if (!v) continue;
      const old = this[axis];
      this[axis] = old + v;
      if (this.blocked(field, this.body())) { this[axis] = old; blocked = true; }
    }
    const b = this.body();
    if (b && overlaps(b, player) && (vx || vy)) { this.x = x0; this.y = y0; return { blocked, player: true }; }
    return { blocked, player: false };
  }

  /** Called by the player's hit (FUN_0006e120): hurt or knockback away from the attacker. */
  /** keepFacing: El's basic projectile leaves the facing and pushes the target backwards (FUN_00060d10). */
  onHit(attackerDir: Dir, knockback: boolean, keepFacing = false): void {
    this.tint = 16;
    if (this.hp <= 0) { this.die(); return; }
    if (this.stun > 0) return;                                   // no hurt / knockback while stunned (combat.md §3.2)
    this.state = knockback ? 7 : 6;
    this.hurtTable = knockback ? KNOCK_STEPS : HURT_STEPS;
    this.hurt = 0;
    if (keepFacing) { this.pushDir = (this.dir ^ 1) as Dir; return; }
    this.pushDir = attackerDir;
    this.setDir((attackerDir ^ 1) as Dir);                     // face the attacker
  }

  protected die(): void {
    this.hp = 0;
    this.alive = false;
    this.deathT = 0;
    this.frame = this.cmf.anims[this.idleRec()]?.frames[0] ?? 0;
  }

  /** Death fade and respawn wait; returns 'dead' on the reward tick. */
  protected updateDead(w: MonsterWorld): 'dead' | null {
    if (this.deathT < DEATH_TICKS) {
      if (++this.deathT === DEATH_TICKS) { this.respawnT = 0; return 'dead'; }
      return null;
    }
    if (!this.isBoss && !this.noRespawn && ++this.respawnT >= RESPAWN_TICKS && Math.hypot(w.px - this.spawnX, w.py - this.spawnY) > 50) this.respawn();
    return null;
  }

  /** One tick (FUN_000725a0 + FUN_00072400 + FUN_00034300). Returns 'dead' on the reward tick. */
  update(w: MonsterWorld): 'dead' | null {
    const { field, px, py, playerBox } = w;
    if (this.tint > 0) this.tint = Math.max(0, this.tint - 4);
    if (this.slow > 0) this.slow--;
    if (this.dark > 0) this.dark--;
    if (this.burn > 0) this.burn--;
    if (this.chill > 0) this.chill--;
    if (!this.alive) return this.updateDead(w);
    if (this.stun > 0) {                                          // state 0xd: record 0 frames only, no move / AI / boxes
      const r0 = this.cmf.anims[0];
      if (r0) this.frame = r0.frames[this.t % r0.n];
      this.t++;
      if (--this.stun === 0) { this.state = 2; this.rec = this.moveRec(); this.t = 0; }
      return null;
    }
    if (this.pull && this.state !== 6 && this.state !== 7) {     // state 9
      const [vx, vy] = this.toward(this.pull.x, this.pull.y, 8);
      this.move(field, vx, vy, playerBox);
      if (--this.pull.ticks <= 0) { this.pull = null; this.state = 2; this.rec = this.moveRec(); this.t = 0; this.timer = 0; }
      return null;
    }
    if (this.state === 6 || this.state === 7) {                 // FUN_00068298, AI and t frozen
      const s = this.hurtTable[this.hurt++] ?? 0;
      const v: [number, number] = this.pushDir === 0 ? [-s, 0] : this.pushDir === 1 ? [s, 0] : this.pushDir === 2 ? [0, -s] : [0, s];
      this.move(field, v[0], v[1], playerBox);
      this.frame = this.fourDir ? [0, 6, 12][this.F] : this.V * 6;
      if (this.hurt >= this.hurtTable.length) {
        this.state = 2; this.rec = this.moveRec(); this.t = 0;
        if (this.stunAfter) { this.stunAfter = false; this.startStun(10); }   // FUN_00068298: +0x8f == 3 -> stun 10
      }
      return null;
    }
    if (this.parent && this.parent.type === 5) this.state = 2;  // King Dusty's summons always chase
    const rec = this.cmf.anims[this.rec] ?? this.cmf.anims[0];
    if (!rec) return null;
    const k = this.t % rec.n;
    this.frame = rec.frames[k];
    const step = rec.step[k];
    let vx = 0, vy = 0;
    if (this.state === 0) {
      [vx, vy] = this.wanderStep(w, step);
      if (w.gtick & 1) this.timer--;
    } else if (this.state === 1) {
      const s = this.dir & 1 ? step : -step;
      if (this.dir < 2) vx = s; else vy = s;
      if (this.phase === 2 && this.frame !== this.lastShotFrame) this.fire(w);
      this.lastShotFrame = this.frame;
    } else if (this.state === 2) {
      [vx, vy] = this.toward(px, py, step);
      this.face(px, py);
    } else if (this.state === 4) {
      [vx, vy] = this.toward(this.spawnX, this.spawnY, step);
      this.face(this.spawnX, this.spawnY);
    }
    this.move(field, vx, vy, playerBox);
    this.t++;
    if (this.t > 0 && this.t % rec.n === 0) this.decide(w);
    return null;
  }

  /** +0x80 size class: (max(body w, h) & 0xfff) >> 5 */
  private sizeClass(): number {
    const b = this.cmf.frames[this.frame]?.body_box;
    return b ? (Math.max(b[2], b[3]) & 0xfff) >> 5 : 0;
  }

  /** FUN_0007210c (monster-ai.md §1.2) */
  private wanderStep(w: MonsterWorld, step: number): [number, number] {
    if (this.type === 0x20 || this.type === 0x23 || this.type === 0x27) return [0, 0];
    const bb = this.cmf.frames[this.frame]?.body_box ?? [0, 0, 0, 0];
    const R = (this.typeRec[6] >> 1) * 16, size = this.sizeClass();
    const sx = this.spawnX + bb[0], sy = this.spawnY + bb[1];
    const B = [Math.max(0, sx - R), Math.max(0, sx + R - 8), Math.max(0, sy - R), Math.max(0, sy + R - 8)];
    if (!(this.timer > 0 && this.wander <= 8)) {
      const b = w.rng.rand(4);
      if (this.wander === 4 || w.rng.rand(3) === 0) {
        this.wander = b;
        this.setDir(b as Dir);
        const d = b < 2 ? Math.abs(this.x + bb[0] - B[b]) : Math.abs(this.y + bb[1] - B[b]);
        this.timer = size * 16 + w.rng.rand((d & 0xfff) >> 4) + 4;
      } else {
        this.wander = 4;
        this.timer = size * 16 + w.rng.rand(size * 7) + 4;
      }
    }
    const s = Math.max(step, 0);
    switch (this.wander) {
      case 0: case 1: {
        const vx = (this.lastH ? 1 : -1) * s;
        if ((this.wander === 0 && this.x + vx < B[this.dir]) || (this.wander === 1 && this.x + vx > B[this.dir])) { this.wander = 9; return [0, 0]; }
        return [vx, 0];
      }
      case 2: case 3: {
        const vy = (this.lastV & 1 ? 1 : -1) * s;
        if ((this.wander === 2 && this.y + vy < B[this.dir]) || (this.wander === 3 && this.y + vy > B[this.dir])) { this.wander = 10; return [0, 0]; }
        return [0, vy];
      }
      default: return [0, 0];
    }
  }

  /** FUN_00034300 on decision ticks (t % n == 0), monster-ai.md §1.3–1.4. */
  private decide(w: MonsterWorld): void {
    const { px, py } = w;
    const dist = Math.hypot(px - this.x, py - this.y);
    const inRange = w.playerAlive && dist < this.range;
    // line attackers 13 / 15 / 27 / 31: attack while aligned within ±19, at any distance (FUN_00034300 33614 / 33671)
    const line = this.type < 32 && ((1 << this.type) & 0x8800a000) !== 0;
    const aligned = line && ((px - 19 <= this.x && this.x <= px + 19) || (py - 19 <= this.y && this.y <= py + 19));
    const bb = this.cmf.frames[this.frame]?.body_box ?? [0, 0, 0, 0];
    const bx = this.x + bb[0], by = this.y + bb[1];
    switch (this.state) {
      case 0: {
        const S = this.sight;
        const inSight = Math.max(0, bx - S) <= px && px <= bx + S && (by - S >= 16 ? by - S - 16 : 0) <= py && py <= by + S;
        if (inSight) { this.state = 2; this.timer = 0; this.rec = this.moveRec(); this.t = 0; }
        if (inRange) { this.startAttack(px, py); break; }
        if (this.state === 0 && this.phase === 0) {          // wander record: idle when stopped, else walking
          const r = this.wander === 4 ? this.idleRec() : this.moveRec();
          if (r !== this.rec) { this.rec = r; this.t = 0; }
        }
        break;
      }
      case 1:
        // attack cycle: attack record, then two idle cycles (phase 2 -> 1 -> 0)
        if (this.phase === 2) { this.phase = 1; this.rec = this.idleRec(); this.t = 0; }
        else if (this.phase === 1) { this.phase = 0; this.t = 0; }
        else if (line ? aligned : inRange) this.startAttack(px, py);
        else { this.state = 2; this.rec = this.moveRec(); this.t = 0; this.wander = this.dir; this.timer = 0; }
        break;
      case 2:
        if (inRange || aligned) { this.startAttack(px, py); break; }
        if (this.timer > 16) { this.state = 4; this.timer = 0; this.rec = this.moveRec(); this.t = 0; break; }
        { const r = this.moveRec(); if (r !== this.rec) { this.rec = r; this.t = 0; } }
        break;
      case 4: {
        const b0 = this.typeRec[0], sx = this.spawnX, sy = this.spawnY;
        const home = sx - (b0 + 6) * 8 + 16 <= this.x && this.x <= sx + b0 * 8 + 32 && sy - (b0 + 6) * 8 + 16 <= this.y && this.y <= sy + b0 * 8 + 32;
        if (home) { this.state = 0; this.timer = 0; this.rec = this.idleRec(); this.t = 0; }
        else if (dist <= 70) { this.state = 2; this.timer = 0; this.rec = this.moveRec(); this.t = 0; }
        else if (this.timer > 16) { this.state = 0; this.timer = 0; this.spawnX = this.x; this.spawnY = this.y; this.rec = this.idleRec(); this.t = 0; }
        break;
      }
    }
    // FUN_00034300 end (polish.md §2.3): outside attacks type 6 uses idle record F (step 4), type 0x15 record 0
    if (this.state !== 1 && this.type === 6) this.rec = this.F;
    else if (this.state !== 1 && this.type === 0x15) this.rec = 0;
  }

  /** FUN_000628a8 -> FUN_0006205c: normal monster shots on their trigger frames (monster-ai.md §1.5) */
  private fire(w: MonsterWorld): void {
    const F = this.F, f = this.frame, d = this.dir, x = this.x, y = this.y;
    const go = (sp: number) => ({ vx: d === 0 ? -sp : d === 1 ? sp : 0, vy: d === 2 ? -sp : d === 3 ? sp : 0, dir: d as Dir, mirror: d === 1 });
    const four = (lr: [number, number], up: [number, number], dn: [number, number]) =>
      d === 0 ? [x - lr[0], y + lr[1]] : d === 1 ? [x + lr[0], y + lr[1]] : d === 2 ? [x + up[0], y + up[1]] : [x + dn[0], y + dn[1]];
    switch (this.type) {
      case 6: if (f === F * 8 + 0x31) this.shotsOut.push({ x: x - 5, y: y - 26, o: { frame: 0x45, life: 15, ...go(5) } }); break;
      case 13: if (f === F * 7 + 0x27) { const [sx, sy] = four([50, -28], [0, -70], [0, 15]); this.shotsOut.push({ x: sx, y: sy, o: { frame: d < 2 ? 0x49 : 0x48, life: 15, ...go(8) } }); } break;
      case 15: if (f === F * 6 + 0x26) { const [sx, sy] = four([50, -12], [0, -70], [0, 25]); this.shotsOut.push({ x: sx, y: sy, o: { frame: d < 2 ? 0x37 : d === 3 ? 0x36 : 0x38, life: 15, ...go(8) } }); } break;
      case 27: if (f === 0x20 || f === 0x1a) this.shotsOut.push({ x: d === 1 ? x + 30 : x - 20, y: y - 30, o: { frame: 0x24, life: 40, ...go(7) } }); break;
      case 31: if (f === F * 6 + 9) { const [sx, sy] = four([50, -26], [-10, -65], [-10, -20]); this.shotsOut.push({ x: sx, y: sy, o: { frame: 0x18 + d, life: 30, ...go(5) } }); } break;
      case 36: if (f === F * 16 + 0x2b) this.shotsOut.push({ x: w.px - 20, y: w.py - 10, o: { frame: 0x58, life: 8, frameStep: true } }); break;
    }
  }

  private startAttack(px: number, py: number): void {
    this.face(px, py);
    this.state = 1;
    this.phase = 2;
    this.rec = this.attackRec();
    this.t = 0;
  }

  protected respawn(): void {
    Object.assign(this, { x: this.spawnX, y: this.spawnY, hp: this.maxHp, alive: true, state: 0, phase: 0, t: 0, tint: 0, dir: 3, deathT: 0, timer: 0, wander: 0, slow: 0, poison: 0, firstHit: -1 });
    this.rec = this.idleRec();
  }

  drawable(): Drawable | null {
    if (!this.alive && this.deathT >= DEATH_TICKS) return null;
    let fx: SpriteFx | undefined;
    if (!this.alive) fx = { tint: [255, 255, 255], amount: Math.min(32, this.deathT + 16), alpha: Math.max(0, 32 - 3 * this.deathT) };
    else if (this.tint) fx = { tint: [255, 0, 0], amount: this.tint };
    else if (this.poison > 0 && (this.poison >> 2) & 1) fx = { tint: [0, 0x66, 0], amount: 24 };   // FUN_0007a254(24, 0x006600)
    return { cmfName: this.cmfName, cmf: this.cmf, frame: this.frame, x: this.x, y: this.y, mirror: this.dir < 2 && this.lastH === 1, fx };
  }
}
