// Bosses (behaviour 11, FUN_0006c960 and the per-type functions), analysis/features/monster-ai.md §2–§3.
// The common skeleton (§2.2), box overrides (§2.6), hit-stop and all 14 bosses. Queen Frostworm (35)
// and Mother (39) are three objects; how their HP is shared is not decoded, so hits on the parts
// go to the main body here [추정]. Monster shots ignore walls; scale-2 shots are drawn at scale 1.
import type { Cmf } from '../assets';
import { FACING, Monster, frameBox, overlaps, type Dir, type MonsterWorld } from './monster';
import type { Drawable } from './field';
import type { Rect } from './player';
import { rdiv } from './rules';

export const PORTED_BOSSES = [5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 39, 42];

/** death events (FUN_00061bb0, events.md §0.5) */
export function bossDeathEvent(type: number, map: number): number {
  const m: Record<number, number> = { 5: 9, 8: 0x13, 11: 0x1d, 14: 0x21, 17: 0x28, 20: 0x2b, 23: 100, 26: 0x39, 29: 0x42, 35: 0x58, 38: 0x6a, 39: 0x50, 42: 0x6c };
  return type === 32 ? (map === 0xea ? 0x67 : 0x4c) : m[type] ?? -1;
}

/** FUN_0001b334 HP / ATK multipliers (game-rules.md §3.5), normal difficulty */
export function applyBossStats(b: Monster, hard = false): void {
  // hard HP: × n or rdiv(base·p, 100) (hardmode.md §4.2, FUN_0001b334 checked in the emulator)
  const hpN: Record<number, number> = { 23: 6, 38: 10 }, hpHard: Record<number, number> = { 23: 700, 26: 600, 29: 840, 32: 960, 35: 1120, 38: 3000, 39: 1260, 42: 1000 };
  b.hp = b.maxHp = hard ? rdiv(b.maxHp * (hpHard[b.type] ?? 650), 100) : b.maxHp * (hpN[b.type] ?? 5);
  const base: Record<number, [number, number]> = { 5: [24, 20], 8: [24, 20], 11: [24, 20], 14: [27, 20], 17: [300, 200] };
  const [n, d] = base[b.type] ?? [300, 200];
  let atk = Math.trunc((b.atk * n) / d);
  const q: Record<number, number> = hard ? { 8: 80, 11: 80, 14: 80, 17: 80, 20: 80, 23: 80, 26: 70, 29: 70, 32: 70, 35: 80, 39: 80 } : { 8: 70, 11: 60, 14: 60, 17: 70 };
  if (q[b.type]) atk = rdiv(atk * q[b.type], 100);
  b.atk = atk;
}

/** Box override table entry (bosses.json box_overrides, FUN_000231e4 run on the original code) */
export interface BoxOverride {
  attack: number[]; mirrored_attack: number[]; body: number[]; mirror: string;
  by_action?: Record<string, { attack: number[]; mirrored_attack: number[]; body: number[]; mirror: string }>;
}
export type BoxTable = Record<string, Record<string, BoxOverride>>;

/** room-wide boss scratch DAT_00413a1c..a26 (reset on map load and boss death) */
export class BossGlobals {
  a = new Array<number>(11).fill(0);
  get(addr: number): number { return this.a[addr - 0x1c]; }
  set(addr: number, v: number): void { this.a[addr - 0x1c] = v & 0xff; }
  reset(): void { this.a.fill(0); }
}

/** Effects a boss asks the scene for this tick. */
export interface BossFx { shake?: number; flash?: number; slowPlayer?: number; summon?: { x: number; y: number }; shots?: MonsterShot[]; }

/** Box of a frame with the FUN_000231e4 override table (frame -> box, by action), else the cmf box. */
export function overrideBox(boxes: Record<string, BoxOverride>, cmf: Cmf, frame: number, action: number,
  which: 'body' | 'attack', x: number, y: number, dir: number, lastH: number): Rect | null {
  const o0 = boxes[String(frame)];
  const o = o0?.by_action?.[String(action)] ?? o0?.by_action?.['0'] ?? o0;
  if (!o || !o.attack) return frameBox(cmf, frame, which, x, y, dir);
  const flag = o.mirror.startsWith('dir') ? dir & 1 : o.mirror.startsWith('lastH') ? lastH : 0;
  const bx = which === 'attack' ? (flag ? o.mirrored_attack : o.attack) : o.body;
  if (!bx || bx[2] <= 0 || bx[3] <= 0) return null;
  return [x + bx[0], y + bx[1], x + bx[0] + bx[2], y + bx[1] + bx[3]];
}

export interface ShotOpts {
  frame: number; life: number; vx?: number; vy?: number;
  /** the shot itself is the attacker (type 17: +0x76 = 9, level 0) */
  selfAttack?: boolean;
  /** frame shown after moveTicks (17's puddle) */
  stopFrame?: number; moveTicks?: number;
  /** behaviour 5: chase the player at this speed ('rand' = rand(8)*2 each tick, type 38) */
  track?: number | 'rand';
  /** frame loop [first, last] */
  loop?: [number, number];
  /** behaviour 7: frame++ every tick */
  frameStep?: boolean;
  /** follow the boss's horizontal movement (38 beam) */
  followBoss?: boolean;
  /** what a touch does: remove (29 bubble), flame (32), explode (38 orb), stop (17), keep */
  onHit?: 'remove' | 'flame' | 'explode' | 'stop' | 'keep';
  noBox?: boolean;
  dir?: Dir; lastH?: number;
  /** fire on the ground: not removed by hits (32 flame, +0x7f = -2) */
  flame?: boolean;
  /** draw mirrored (left-facing art shot to the right) */
  mirror?: boolean;
}

/** Monster projectile (behaviours 4 / 5 / 7, monster-ai.md §2.5). Ignores walls. */
export class MonsterShot {
  x: number; y: number; frame: number; life: number; vx: number; vy: number;
  stopped = false;
  gone = false;
  exploded = false;
  private age = 0;
  constructor(readonly owner: Monster, x: number, y: number, readonly o: ShotOpts) {
    this.x = x; this.y = y; this.frame = o.frame; this.life = o.life; this.vx = o.vx ?? 0; this.vy = o.vy ?? 0;
  }
  get selfAttack(): boolean { return !!this.o.selfAttack; }
  update(px: number, py: number, rand: (n: number) => number): void {
    if (this.life <= 0) { this.gone = true; return; }
    const o = this.o;
    if (this.exploded) this.frame++;
    else if (o.track !== undefined && !this.stopped) {
      const sp = o.track === 'rand' ? rand(8) * 2 : o.track;
      const [vx, vy] = towardPt(this.x, this.y, px, py, sp);
      this.x += vx; this.y += vy;
    } else if (!this.stopped && (!o.moveTicks || this.age < o.moveTicks)) { this.x += this.vx; this.y += this.vy; }
    else if (o.stopFrame !== undefined) { this.stopped = true; this.frame = o.stopFrame; }
    if (o.followBoss) this.x += this.owner.lastVx;
    if (o.frameStep && !this.exploded) this.frame++;
    if (o.loop && !this.exploded) this.frame = this.frame >= o.loop[1] ? o.loop[0] : this.frame + 1;
    this.age++;
    this.life--;
  }
  /** first touch of a 38 orb: no damage, the explosion plays (+0x7f = 6, 7 ticks) */
  explode(): void { this.exploded = true; this.life = 7; }
  box(): Rect | null {
    if (this.o.noBox || (this.stopped && this.o.stopFrame !== undefined && this.o.selfAttack)) return null;
    return overrideBox(this.owner.boxes, this.owner.cmf, this.frame, this.owner.action, 'attack', this.x, this.y, this.o.dir ?? 3, this.o.lastH ?? 0);
  }
  drawable(): Drawable { return { cmfName: this.owner.cmfName, cmf: this.owner.cmf, frame: this.frame, x: this.x, y: this.y, mirror: this.o.mirror }; }
}

function towardPt(x: number, y: number, px: number, py: number, speed: number): [number, number] {
  const dx = px - x, dy = py - y;
  if (!dx && !dy) return [0, 0];
  const round = (v: number) => Math.trunc((v * 10 + 5) / 10);
  if (Math.abs(dy) < Math.abs(dx)) return [Math.sign(dx) * speed, Math.sign(dy) * round(speed * Math.abs(dy) / Math.abs(dx))];
  return [Math.sign(dx) * round(speed * Math.abs(dx) / Math.abs(dy)), Math.sign(dy) * speed];
}

const REST: Record<number, Record<number, number>> = {
  5: { 6: 1, 12: 4 }, 8: { 4: 1, 6: 2 }, 11: { 4: 3, 6: 2, 8: 5 }, 14: { 6: 1, 9: 2, 12: 2 }, 17: { 6: 3, 9: 2 }, 20: { 4: 2, 6: 3, 8: 6 },
  26: { 6: 1, 9: 2, 12: 0 }, 29: { 1: 3, 2: 3, 3: 5, 4: 6 }, 32: { 1: 3, 2: 7, 3: 5, 4: 6 }, 38: { 2: 4, 3: 7, 4: 6 }, 42: { 2: 4, 3: 7 },
};
/** bosses whose record is the action itself (no facing offset) */
const FIXED = [29, 32, 38, 42];
/** bosses with hit-stop (+0x81 stops t) */
const HOLD = [5, 8, 11, 14, 17, 20, 38, 39, 42];
const SHARDS: [number, number, number, number, number][] = [[-100, 0, 0x22, -7, 6], [-40, -10, 0x23, -5, 8], [-30, 0, 0x24, 0, 9], [-20, -10, 0x25, 5, 8], [20, 0, 0x26, 7, 6]];
const KD_CORNERS = [[120, 300], [356, 300], [236, 222], [240, 382]];
/** Khorkhor poison blob velocities by dir and index (monster-ai.md §3.5) */
const BLOB_V: Record<number, [number, number][]> = {
  1: [[7, -2], [8, 3], [7, 8]], 0: [[-7, -2], [-8, 3], [-7, 8]], 2: [[-4, -7], [0, -8], [4, -7]], 3: [[-4, 9], [0, 11], [4, 9]],
};

export class Boss extends Monster {
  /** +0x81 hit-stop: set when the player hits the boss in state 0 or 2; that tick t does not advance */
  hold = 0;
  /** +0x8d start counter, +0x8e rest cycles */
  start = 0;
  rest = 0;
  /** +0x7f: King Dusty summons left */
  summons = 0;
  /** +0x18 Witch Tree charge timer; +0x5a stun; +0x82 Black Leo speed bonus */
  timer18 = 0;
  stunT = 0;
  bonus82 = 0;
  /** King Dusty jump step (+0x08 / +0x0c) */
  private jump: [number, number] = [0, 0];
  private summonDir: Dir = 0;
  /** attack boxes already landed this action (FUN_00063218 hit list) */
  hitThisAction = false;
  /** 35 / 39 parts: role (+0x7f), main body, the parts of a main body, active flag (35 part B) */
  role = -1;
  declare main: Boss | null;
  parts: Boss[] = [];
  active = true;
  /** 39 part counter (+0x8d of the arm / head) */
  cnt = 0;
  readonly ported: boolean;

  constructor(type: number, cmfName: string, cmf: Cmf, x: number, y: number, roomLevel: number, typeRec: number[],
    readonly g: BossGlobals, boxes: Record<string, BoxOverride>, dir: Dir, hard = false) {
    super(type, cmfName, cmf, x, y, roomLevel, typeRec, hard);
    this.boxes = boxes;
    applyBossStats(this, hard);
    this.ported = PORTED_BOSSES.includes(type);
    this.setDir(dir);
    this.rec = 0;
  }

  private get bossRange(): number { return this.g.get(0x24) * 16; }
  private recLen(): number { return (this.cmf.anims[this.rec] ?? this.cmf.anims[0])?.n ?? 1; }
  /** 23: record = form * 3 + k */
  private get form(): number { return this.g.get(0x1c); }

  /** box with the FUN_000231e4 override for this frame (and action) */
  private ovBox(which: 'body' | 'attack'): Rect | null {
    return overrideBox(this.boxes, this.cmf, this.frame, this.action, which, this.x, this.y, this.dir, this.lastH);
  }
  override body(): Rect | null { return this.ovBox('body'); }
  /** attack box of the current frame in states 1 and 0xd (a charge stopped by the player still lands) [추정] */
  override attackBox(): Rect | null {
    if (!this.alive || !this.active) return null;
    if (this.role >= 0) return this.ovBox('attack');                // parts attack by record, not state
    return this.state === 1 || this.state === 0xd ? this.ovBox('attack') : null;
  }

  /** bosses only flash and lose HP (no stagger); hit-stop in states 0 / 2 */
  override onHit(): void {
    const m = this.main ?? this;
    this.tint = 16;
    m.tint = 16;
    if (m.hp <= 0) { m.die(); for (const p of m.parts) p.die(); return; }
    if ((this.state === 0 || this.state === 2) && HOLD.includes(this.type)) this.hold = 1;
  }
  /** parts give no reward of their own */
  get noReward(): boolean { return this.role >= 0 && this.main !== null; }

  private faceP(w: MonsterWorld, mode: number): void { this.face(w.px, w.py, mode); }
  private flipH(): void { this.lastH = (this.lastH ^ 1) as 0 | 1; this.dir = this.lastH; }

  private recFor(action: number): number {
    if (FIXED.includes(this.type) || this.type === 23) return action;
    if (this.type === 11 || this.type === 20 || (this.type === 8 && action === 4)) return this.V + action;
    return this.F + action;
  }

  /** One tick of the common skeleton (§2.2). */
  override update(w: MonsterWorld): 'dead' | null {
    if (this.tint > 0) this.tint = Math.max(0, this.tint - 4);
    if (!this.alive) return this.updateDead(w);
    const fx: BossFx = {};
    this.fx = fx;
    if (this.type === 35 || this.type === 39) { this.partsTick(w, fx); return null; }
    const g = this.g;
    if (this.type === 14 && g.get(0x1d) > 0) {               // Black Leo rage: 300 ticks of +4 chase speed
      g.set(0x1e, g.get(0x1e) + 1);
      if (g.get(0x1e) >= 100) { g.set(0x1e, 0); g.set(0x1d, g.get(0x1d) - 1); }
      this.bonus82 = 4;
    } else if (this.type === 14) this.bonus82 = 0;
    if (this.type === 8) this.timer18++;

    let rec = this.cmf.anims[this.rec] ?? this.cmf.anims[0];
    const n = rec.n;
    const k = this.t % n;
    this.frame = rec.frames[k];
    const step = rec.step[k];
    const a26 = g.get(0x26);
    let freeze = false;                                      // the tick does not advance t (stun)
    const x0 = this.x;
    switch (this.state) {
      case 0:
        if (this.type === 38) {                              // return toward the spawn x at 6 px
          const d = this.spawnX - this.x;
          if (Math.abs(d) > 9) this.x += Math.sign(d) * 6;
        }
        if (this.type === 23 && this.action === 2 && this.frame === 0x16) g.set(0x1c, 1);   // transform 0 -> 1
        if (this.type === 23 && this.action === 5 && this.frame === 0x0e) g.set(0x1c, 0);   // transform 1 -> 0
        break;
      case 1: this.attackTick(w, step, fx); break;
      case 2: {
        if (FIXED.includes(this.type)) { this.start = 1; break; }
        if (w.playerAlive && Math.hypot(w.px - this.x, w.py - this.y) < this.bossRange) { this.hitThisAction = false; this.start = 1; break; }
        let sp = step + a26;
        if (this.type === 14) sp += this.bonus82;
        if (this.type === 23 || this.type === 26) sp = step;     // no a26 bonus
        if (this.type === 20 && g.get(0x1e)) { sp += g.get(0x1e); fx.flash = 5; }
        const [vx, vy] = this.toward(w.px, w.py, sp);
        this.move(w.field, vx, vy, w.playerBox);
        if (this.type === 11) {                              // chase record set directly, t kept
          this.faceP(w, 2);
          if (this.lastV === 2) this.flipH();
          this.rec = this.lastV === 2 ? 3 : 2;
        } else this.faceP(w, this.fourDir && this.type !== 8 && this.type !== 20 ? 4 : 2);
        if (this.type === 20 && g.get(0x1e)) this.t++;      // charging: walk animation twice as fast
        break;
      }
      case 4: {                                              // Witch Tree retreat: face the player, back away
        this.faceP(w, 4);
        const s = step;
        const v: [number, number] = this.dir === 0 ? [s, 0] : this.dir === 1 ? [-s, 0] : this.dir === 2 ? [0, s] : [0, -s];
        this.move(w.field, v[0], v[1], w.playerBox);
        break;
      }
      case 9:                                                // King Dusty summoning
        if (this.frame === this.F * 4 + 0x45) fx.summon = this.summonSpot(this.summonDir);
        break;
      case 0xd:                                              // Witch Tree stunned after a charge
        this.frame = this.F * 6 + 0x2f;
        if (this.stunT > 0) { this.stunT--; freeze = true; }
        break;
    }
    this.lastVx = this.x - x0;
    if (!freeze) { if (this.hold > 0 && HOLD.includes(this.type)) this.hold--; else this.t++; }
    rec = this.cmf.anims[this.rec] ?? this.cmf.anims[0];
    if (this.t >= this.recLen()) { this.bossDecide(w); this.t = 0; }
    if (this.start > 0) {
      this.rest = this.type === 23 ? (this.form === 0 ? 4 : 2) : REST[this.type]?.[this.action] ?? 0;
      this.start--;
      this.state = 1;
      this.onPatternStart(w);
      this.rec = this.recFor(this.action);
      this.t = 0;
      this.hitThisAction = false;
    }
    if (this.hp * 5 < this.maxHp) g.set(0x26, 4);
    return null;
  }

  /** per-tick effects of this boss for the scene */
  fx: BossFx = {};

  private attackTick(w: MonsterWorld, step: number, fx: BossFx): void {
    const t = this.type, f = this.frame, g = this.g;
    if (t === 5 && this.action === 12) {                     // jump smash timeline
      if (f === 78 && this.lastJumpFrame !== 78) {
        const dx = w.px - 232, dy = w.py - 302;
        const c = Math.abs(dy) < Math.abs(dx) ? (dx < 0 ? 0 : 1) : (dy < 0 ? 2 : 3);
        g.set(0x1d, c);
        this.jump = [Math.trunc((KD_CORNERS[c][0] - this.x) / 4), Math.trunc((KD_CORNERS[c][1] - this.y) / 4)];
      } else if (f === 79 || f === 80 || f === 81) { this.x += this.jump[0]; this.y += this.jump[1]; }
      else if (f === 82) { const c = KD_CORNERS[g.get(0x1d)]; this.x = c[0]; this.y = c[1]; }
      else if (f === 83 && this.lastJumpFrame !== 83) fx.shake = 2;
      this.lastJumpFrame = f;
      return;
    }
    if (FIXED.includes(t)) { this.fixedAttack(w, step, fx); this.lastJumpFrame = f; return; }
    let vx = 0, vy = 0;
    if (t === 11 && this.action === 8) [vx, vy] = this.toward(w.px, w.py, step);
    else { const s = this.dir & 1 ? step : -step; if (this.dir < 2) vx = s; else vy = s; }
    const r = this.move(w.field, vx, vy, w.playerBox);
    if (t === 8 && this.action === 6 && (vx || vy)) {         // charge collision (DAT_00413a25)
      if (r.player) { g.set(0x25, 2); fx.shake = 2; this.state = 0xd; this.stunT = 0; }
      else if (r.blocked) { g.set(0x25, 1); fx.shake = 2; this.state = 0xd; this.stunT = 30; }
    }
    if (t === 14 && this.action === 9 && r.player) fx.shake = 2;
    if (t === 11 && this.action === 4 && (f === 36 || f === 46) && this.lastJumpFrame !== f) fx.shake = 2;
    if (t === 14 && this.action === 12 && (f === 84 || f === 88 || f === 92) && this.lastJumpFrame !== f) fx.slowPlayer = 60;
    if (t === 17 && this.action === 9 && f === this.F * 6 + 0x41 && this.lastJumpFrame !== f) {
      fx.shots = [0, 1, 2].map((i) => {
        const [bvx, bvy] = BLOB_V[this.dir][i];
        return new MonsterShot(this, this.x, this.y - 50, { frame: 0x4e, life: 45, vx: bvx, vy: bvy, selfAttack: true, stopFrame: 0x4f, moveTicks: 10, onHit: 'stop' });
      });
    }
    if (t === 23 && this.action === 4 && f === 0x28 && this.lastJumpFrame !== f) {     // cards
      const right = this.dir === 1, by = this.y;
      fx.shots = [0, 1, 2].map((i) => {
        const x = right ? [this.x + 100, this.x + 5, this.x + 80][i] : [this.x - 100, this.x - 40, this.x - 5][i];
        const y = i === 2 && right ? by - 35 : by - 46;
        const v = right ? [[7, 0], [0, 7], [6, 6]][i] : [[-7, 0], [0, 7], [-6, 6]][i];
        return new MonsterShot(this, x, y, { frame: i === 2 && right ? 0x31 : 0x2e + i, life: 25, vx: v[0], vy: v[1], dir: (right ? [1, 3, 2] : [0, 3, 2])[i] as Dir });
      });
    }
    if (t === 20 && this.action === 6) {
      if ((f === 46 || f === 55) && ((this.t + this.hold) & 1)) fx.flash = 5;
      if ((f === 47 || f === 56) && this.lastJumpFrame !== f) fx.shake = 2;
    }
    this.lastJumpFrame = f;
  }
  private lastJumpFrame = -1;

  /** attacks of the stationary bosses 29 / 32 / 38 / 42 */
  private fixedAttack(w: MonsterWorld, step: number, fx: BossFx): void {
    const t = this.type, f = this.frame, once = this.lastJumpFrame !== f, x = this.x, y = this.y;
    if (t === 29 && this.action === 3 && f === 20 && once) {
      fx.shots = [[-70, 0x18, -10, 10], [-20, 0x19, 0, 15], [15, 0x1a, 10, 10]].map(([dx, fr, vx, vy]) =>
        new MonsterShot(this, x + dx, y + 20, { frame: fr, life: 25, vx, vy }));
    }
    if (t === 29 && this.action === 4 && f === 21 && once) fx.shots = [new MonsterShot(this, x - 40, y - 20, { frame: 0x1c, life: 40, track: 5, loop: [0x1c, 0x1f], onHit: 'remove' })];
    if (t === 32 && this.action === 3 && f === 22 && once) fx.shots = [-60, 15].map((dx) => new MonsterShot(this, x + dx, y + 30, { frame: 0x24, life: 35, vy: 15 }));
    if (t === 32 && this.action === 4 && f === 23 && once) fx.shots = [-60, 15].map((dx) => new MonsterShot(this, x + dx, y + 30, { frame: 0x24, life: 40, track: 6, loop: [0x24, 0x27], onHit: 'flame' }));
    if (t === 38) {
      if (this.action === 3) {                               // beam: follow the player x at 4 px
        const d = w.px - x;
        this.x += Math.abs(d) <= 9 ? Math.sign(d) * Math.abs(step) : Math.sign(d) * 4;
        if (f === 0x1c && once) fx.shots = [new MonsterShot(this, x, y + 10, { frame: 0x3d, life: 16, frameStep: true, followBoss: true, onHit: 'keep' })];
      }
      if (this.action === 2 && f === 15 && once) fx.shots = [new MonsterShot(this, x, y - 90, { frame: 0x4d, life: 1, noBox: true })];
      if (this.action === 4 && f === 0x33 && once) {
        fx.shots = [[-40, 20], [30, 20], [-20, 50], [50, 50]].map(([dx, dy]) =>
          new MonsterShot(this, x + dx, y + dy, { frame: 0x36, life: 25, track: 'rand', onHit: 'explode' }));
      }
    }
    if (t === 42 && this.action === 3 && f === 0x11 && once) {
      fx.shots = SHARDS.map(([dx, dy, fr, vx, vy]) => new MonsterShot(this, x + dx, y + dy, { frame: fr, life: 30, vx, vy, dir: 3, lastH: 1 }));
    }
  }

  private onPatternStart(w: MonsterWorld): void {
    const g = this.g;
    if (this.type === 26) {
      if (this.action === 6 || this.action === 9) { g.set(0x1c, g.get(0x1c) + 1); if (g.get(0x1c) > 2) g.set(0x1d, 1); }
      else if (this.action === 12) { g.set(0x1c, 0); g.set(0x1d, 0); }
    }
    if (this.type === 38 && this.action === 3) g.set(0x1c, (g.get(0x1c) + 1) % 2);
    if (this.type === 11) { this.faceP(w, 2); if (this.lastV === 2) this.flipH(); }
    if (this.type === 20) {
      if (this.action === 4) g.set(0x1c, g.get(0x1c) + 1);
      else if (this.action === 6) g.set(0x1c, 0);
      else if (this.action === 8) g.set(0x1e, 0);
    }
    this.lastJumpFrame = -1;
  }

  /** FUN_0002e824: left / right / up / down spot for a summon; must be walkable and clear of the player */
  private findSummon(w: MonsterWorld): number {
    for (let d = 0; d < 4; d++) {
      const [x, y] = this.summonSpot(d as Dir);
      const box: Rect = [x - 12, y - 16, x + 12, y];
      if (overlaps(box, w.playerBox)) continue;
      if (w.monsterBoxes?.some((b) => overlaps(box, b))) continue;    // the probe actor collides with actors [추정]
      if (this.blocked(w.field, box)) continue;
      return d + 1;
    }
    return 0;
  }
  private summonSpot(d: Dir): { x: number; y: number } & [number, number] {
    const p: [number, number] = d === 0 ? [this.x - 70, this.y] : d === 1 ? [this.x + 70, this.y] : d === 2 ? [this.x, this.y - 92] : [this.x, this.y + 42];
    return Object.assign(p, { x: p[0], y: p[1] });
  }

  private phaseCheck(cuts: [number, number, number]): boolean {
    const g = this.g, a = g.get(0x1c), hp = this.hp, m = this.maxHp;
    if (a === 3) return false;
    if (hp < m * cuts[2] && a === 2) { g.set(0x1c, 3); return true; }
    if (hp < m * cuts[1] && a === 1) { g.set(0x1c, 2); return true; }
    if (hp < m * cuts[0] && a === 0) { g.set(0x1c, 1); return true; }
    return false;
  }

  private idle(): void {
    this.rest--; this.state = 0;
    this.rec = this.type === 23 ? this.form * 3 : FIXED.includes(this.type) ? 0 : this.fourDir && this.type !== 8 && this.type !== 11 && this.type !== 20 ? this.F : this.V;
  }

  /** decision at the end of a record cycle (per type, monster-ai.md §3) */
  private bossDecide(w: MonsterWorld): void {
    const g = this.g, rng = w.rng;
    switch (this.type) {
      case 5: {
        this.faceP(w, 4);
        g.set(0x24, this.dir === 2 ? 5 : 3);
        if (this.phaseCheck([0.8, 0.5, 0.3])) this.summons = 4;
        if (this.summons !== 0) {
          const s = this.findSummon(w);
          if (s) { this.summonDir = (s - 1) as Dir; this.setDir(this.summonDir); this.rec = this.F + 9; this.state = 9; this.summons--; break; }
        } else if (this.rest > 0) { this.idle(); break; }
        this.state = 2;
        if (rng.rand(5) === 0) { this.action = 12; this.start = 1; } else { this.action = 6; this.rec = this.F + 3; }
        break;
      }
      case 8: {
        this.faceP(w, 2);
        g.set(0x24, this.lastV === 2 ? 5 : 3);
        if (this.timer18 < 301) {
          if (this.state === 4) { this.faceP(w, 4); this.start = 1; this.action = 6; this.rec = this.F + 6; }
          else if (this.rest === 0) { this.state = 2; this.action = 4; this.rec = this.V + 2; }
          else this.idle();
        } else { this.timer18 = rng.rand(150); this.faceP(w, 2); this.state = 4; this.rec = this.V + 2; }
        break;
      }
      case 11: {
        this.faceP(w, 2);
        if (this.lastV === 2) { g.set(0x24, 5); this.flipH(); } else g.set(0x24, 3);
        const r = rng.rand(100);
        if (this.rest === 0) {
          if (g.get(0x1c) === 0 && this.hp < this.maxHp * 0.8) { g.set(0x1c, 1); this.action = 8; this.start = 1; }
          else if (this.hp < this.maxHp / 2 && r < 10) { this.action = 8; this.start = 1; }
          else {
            this.state = 2; this.rec = this.V + 2;
            if (g.get(0x1c) < 3) { if (rng.rand(3) === 0) { g.set(0x1c, 0); this.action = 6; } else { g.set(0x1c, g.get(0x1c) + 1); this.action = 4; } }
            else { this.action = 6; g.set(0x1c, 0); }
          }
        } else this.idle();
        break;
      }
      case 14: {
        this.faceP(w, 4);
        g.set(0x24, this.dir === 2 ? 5 : 4);
        if (this.playerSlowed) { this.state = 2; this.rec = this.F + 3; this.action = 6; }
        else if (this.rest === 0) { this.state = 2; this.rec = this.F + 3; if (rng.rand(5) === 1) { this.action = 9; this.start = 1; } else this.action = 6; }
        else this.idle();
        if (this.phaseCheck([0.7, 0.5, 0.3])) { g.set(0x1d, 3); this.atk += 4; this.action = 12; this.start = 1; }
        break;
      }
      case 17: {
        this.faceP(w, 4);
        g.set(0x24, 4);
        const r = rng.rand(10);
        if (this.rest === 0) {
          if (r < 3 && !this.playerPoisoned) { this.action = 9; this.start = 1; }
          else { this.state = 2; this.action = 6; this.rec = this.F + 3; }
        } else this.idle();
        break;
      }
      case 23: {
        this.faceP(w, 2);
        const f1 = this.form;
        g.set(0x24, this.lastV === 2 ? (f1 ? 6 : 8) : (f1 ? 6 : 5));
        const r = rng.rand(5);
        if (this.rest === 0) {
          if (r === 0 && g.get(0x1e) > 1) { this.state = 0; this.rec = f1 * 3 + 2; this.action = this.rec; this.rest = 2; }
          else { this.state = 2; this.rec = f1 * 3; this.action = f1 * 3 + 1; }
        } else this.idle();
        break;
      }
      case 26: {
        this.faceP(w, 4);
        g.set(0x24, this.dir === 2 ? 5 : 3);
        if (this.rest === 0) {
          this.state = 2; this.rec = this.F + 3;
          const r = rng.rand(10);
          if (g.get(0x1e) === 1 && g.get(0x1d) === 0) { this.action = 12; this.start = 1; g.set(0x1e, 0); }
          else if (g.get(0x1d) === 1 && r < 3) { this.action = 12; if (r === 0) g.set(0x1e, 1); }
          else this.action = rng.rand(2) ? 9 : 6;
        } else this.idle();
        break;
      }
      case 29: {
        if (this.rest > 0) { this.idle(); this.start = 0; break; }
        this.start = 1;
        const r = rng.rand(10);
        if (g.get(0x1c) !== 0) g.set(0x1c, 0);                // repeat the last action
        else if (r < 2) { this.action = 3; if (r === 0) g.set(0x1c, 1); }
        else if (r < 4) this.action = 4;
        else if (w.px >= 171 && w.px <= 369 && w.py < 510) this.action = rng.rand(2) ? 2 : 1;
        else this.action = rng.rand(10) < 2 ? 3 : 4;
        break;
      }
      case 32: {
        if (this.rest > 0) { this.idle(); break; }
        this.start = 1;
        const bx = this.x, by = this.y, px = w.px, py = w.py;
        if (rng.rand(10) === 0) this.action = 4;
        else if (py > by + 150 && bx - 66 <= px && px <= bx + 72) this.action = 3;
        else if (py <= by + 119 && bx - 66 <= px && px <= bx + 72) this.action = 2;
        else if (bx - 166 <= px && px <= bx + 162 && py <= by + 141) this.action = 1;
        else this.action = 4;
        break;
      }
      case 38: {
        this.setDir(3);
        if (g.get(0x1c) === 1) { this.state = 2; this.action = 3; this.start = 1; }
        else if (this.rest === 0) {
          this.state = 2; this.start = 1;
          const r = rng.rand(10), bx = this.x, by = this.y;
          if (w.px < bx - 171 || w.px > bx + 167 || w.py > by + 95) this.action = rng.rand(10) < 5 ? 3 : 4;
          else this.action = r === 1 ? 3 : r === 2 ? 4 : 2;
        } else this.idle();
        break;
      }
      case 42: {
        this.faceP(w, 2);
        this.flipH();
        if (this.rest > 0) { this.idle(); break; }
        this.start = 1;
        const bx = this.x, by = this.y;
        this.action = w.px < bx - 147 || w.px > bx + 141 || w.py > by + 107 || rng.rand(10) === 0 ? 3 : 2;
        break;
      }
      case 20: {
        this.faceP(w, 2);
        g.set(0x1d, this.hp < this.maxHp / 2 ? 10 : 5);
        g.set(0x24, this.lastV === 2 ? 5 : 3);
        if (g.get(0x1e) !== 0) { this.state = 2; this.rec = this.V + 2; this.action = 8; }
        else if (this.rest === 0) {
          if (rng.rand(100) < g.get(0x1d)) { g.set(0x1e, 5); this.state = 2; this.rec = this.V + 2; this.action = 8; }
          else { this.state = 2; this.rec = this.V + 2; this.action = g.get(0x1c) === 2 ? 6 : 4; }
        } else this.idle();
        break;
      }
    }
  }

  /** One tick while an event runs (DAT_003b3be9, monster-ai.md §2.8): mostly the animation only. */
  eventTick(w: MonsterWorld, ev: number, clock: number): void {
    if (!this.alive) return;
    const t = this.type;
    if (t === 35 && ev !== 0x56) { this.update(w); return; }            // 35 keeps its AI in other events
    let run = true;
    if (t === 8) run = ev === 0x12 && clock > 0xaf;
    else if (t === 17) run = clock > 0x9e;
    else if (t === 20) run = ev === 0x2a && clock >= 0x13e;
    else if (t === 26) run = ev === 0x38 && clock >= 0x6c;
    else if (t === 29) run = ev === 0x41;
    else if (t === 35) run = clock >= 0x44;
    else if (t === 39) run = ev === 0x4f || (ev === 0x50 && clock >= 50);
    if (t === 38) this.action = 0;
    if (t === 11 && this.rec <= 3) this.rec = 0;
    const rec = this.cmf.anims[this.rec] ?? this.cmf.anims[0];
    if (!rec) return;
    this.frame = rec.frames[this.t % rec.n];
    if (!run) return;
    if (t === 5) {                                                       // step along the facing
      const st = rec.step[this.t % rec.n], sgn = this.dir & 1 ? 1 : -1;
      if (this.dir < 2) this.x += sgn * st; else this.y += sgn * st;
    }
    this.t++;
    if (this.t >= rec.n) { this.t = 0; if (t === 5) this.rec = 0; }
  }

  /** player effects requested by 35 / 39 parts: pull toward a point (state 8), grab (state 1), release */
  pullPlayer: [number, number] | null | undefined;
  grab: boolean | undefined;

  /** Queen Frostworm (35) and Mother (39): three objects with roles (monster-ai.md §3.11, §3.13) */
  private partsTick(w: MonsterWorld, fx: BossFx): void {
    const g = this.g;
    const rec = this.cmf.anims[this.rec] ?? this.cmf.anims[0];
    this.frame = rec.frames[this.t % rec.n];
    if (!this.active) return;
    this.pullPlayer = undefined; this.grab = undefined;
    const end = () => this.t + 1 >= rec.n;
    if (this.type === 35) {
      if (this.role === 1) {                                 // main body: decides while a1f == 1
        if (g.get(0x1f) === 1) {
          const A = this.parts[0], B = this.parts[1];
          if (w.px >= 151 && w.px <= 329 && w.py < 380) { g.set(0x20, 2); g.set(0x1f, 0); A.t = 0; A.rec = 3; A.action = 3; }
          else {
            const r = w.rng.rand(3);
            if (r === 0) { A.rec = 4; A.action = 4; A.t = 0; g.set(0x20, 3); g.set(0x1f, 0); }
            else if (r === 1) {
              B.t = 0;
              if (w.px > this.x + 44) { B.active = true; B.action = 2; B.setDir(0); B.x = w.px + 100; B.y = w.py - 100; g.set(0x20, 1); g.set(0x1f, 0); }
              else if (w.px < this.x - 46) { B.active = true; B.action = 2; B.setDir(1); B.x = w.px - 100; B.y = w.py - 100; g.set(0x20, 1); g.set(0x1f, 0); }
            } else { A.rec = 1; A.action = 1; A.t = 0; g.set(0x1f, 0); }
          }
        }
      } else if (this.role === 0) {                          // part A: suck (4) and bite (3)
        if (this.rec === 4 && this.frame === 0x22) this.pullPlayer = [230, 300];
        if (this.rec === 4 && w.px >= 215 && w.px <= 245 && w.py >= 305 && w.py <= 335) { this.pullPlayer = null; this.rec = 3; this.action = 3; this.t = -1; }
        if (end()) {
          this.pullPlayer = null;
          if (!this.parts[1]?.active) {
            if (g.get(0x20) === 0) g.set(0x1f, 1); else g.set(0x20, g.get(0x20) - 1);
            this.rec = 1; this.action = 1;
          }
          this.t = -1;
        }
      } else if (this.role === 2) {                          // part B: one strike then inactive
        if (this.t >= rec.n) { this.active = false; this.t = 0; return; }
      }
      this.t++;
      return;
    }
    // 39 Mother
    if (this.role === 0) {
      if (end()) { g.set(0x20, this.hp < this.maxHp / 2 ? 25 : 10); g.set(0x22, this.hp < this.maxHp / 2 ? 1 : 0); }
      for (const p of this.parts) p.tint = Math.max(p.tint, this.tint);
    } else if (this.role === 1) {                            // arm
      if (this.rec === 1 && this.cnt === 0) {
        if (g.get(0x22) === 0) {
          if (g.get(0x1f) === 0) {
            const [vx, vy] = this.toward(w.px - 35, w.py - 90, 4);
            this.x += vx; this.y += vy;
            const tx = w.px - 35, ty = w.py - 90;
            if (tx >= this.x - 20 && tx <= this.x + 30 && ty >= this.y && ty <= this.y + 5) { this.rec = 4; this.action = 4; this.cnt = 2; this.t = 0; }
          } else {
            const [vx, vy] = this.toward(this.spawnX, this.spawnY, 6);
            if (Math.abs(this.spawnX - this.x) > 5 || Math.abs(this.spawnY - this.y) > 5) { this.x += vx; this.y += vy; }
          }
        } else {
          const [vx, vy] = this.toward(w.px - 35, w.py - 90, 4);
          this.x += vx; this.y += vy;
          const ty = w.py - 90;
          if (ty >= this.y && ty <= this.y + 10) { const a = w.rng.rand(2) === 0 ? 3 : 4; this.rec = a; this.action = a; this.cnt = 2; this.t = 0; }
        }
      }
      if (this.rec === 3 && this.frame === 0x23) this.grab = false;
      if (end()) { this.cnt = Math.max(0, this.cnt - 1); if (this.rec === 3 || this.rec === 4) { this.rec = 1; this.action = 1; this.grab = false; } this.t = -1; }
    } else if (this.role === 2) {                            // head
      const sp = this.rec === 5 ? 5 + 2 * g.get(0x22) : 3, lo = this.rec === 5 ? -49 : -39, hi = this.rec === 5 ? -31 : -21;
      if (this.cnt === 0 || this.rec === 5) { if (w.px < this.x + lo) this.x -= sp; else if (w.px > this.x + hi) this.x += sp; }
      if (this.rec === 5 && this.frame === 53 && this.lastJumpFrame !== 53) {
        fx.shots = [new MonsterShot(this, this.x - 20, this.y + 60, { frame: 0x3e, life: 4, followBoss: true, onHit: 'keep' })];
      }
      this.lastJumpFrame = this.frame;
      if (end()) {
        if (this.rec === 5) { this.rec = 2; this.action = 2; g.set(0x1f, 0); }
        else {
          if (this.playerGrabbed) { this.cnt = 1; g.set(0x1f, 1); }
          else if (this.cnt === 0 && w.rng.rand(100) < g.get(0x20)) { this.cnt = 3; g.set(0x1f, 1); }
          if (this.cnt > 0 && --this.cnt === 0) { this.rec = 5; this.action = 5; }
        }
        this.t = -1;
      }
    }
    this.t++;
  }
  playerGrabbed = false;

  /** player status the decisions read (set by the scene each tick) */
  playerSlowed = false;
  playerPoisoned = false;

  override drawable(): Drawable | null {
    if (!this.active) return null;
    const d = super.drawable();
    if (d && this.isBoss) d.mirror = this.dir < 2 && this.lastH === 1;
    return d;
  }
}

/** King Dusty's summon (kind 0): Dusty (type 3), level - 7, HP 10L+140+400L²/300, ATK 50 %, always chasing */
export function summonStats(boss: Boss): { level: number; hp: number; atk: number } {
  const L = Math.max(1, boss.level - 7);
  return { level: L, hp: 10 * L + 140 + Math.trunc((400 * L * L) / 300), atk: rdiv(boss.atk * 50, 100) };
}

export { FACING };
