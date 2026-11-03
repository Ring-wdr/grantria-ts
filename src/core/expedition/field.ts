// 원정(가제): realtime field play on a zone. Positions are floats in map pixels, time in seconds (the host steps it
// every animation frame, not on the 20 Hz tick). The hero moves 360°: held arrows give 8 ways, the touch / pad stick
// its angle and strength; the sprite shows the nearest of its four directions, with some hysteresis so it does not
// flicker on a diagonal. Bodies are circles that slide along the blocked cells of the walk layer.
// Combat (rules after the 3D prototype's field): a light 3-combo and a heavy swing are arcs around the facing angle,
// turned toward the nearest enemy in a cone when they start; hits fill an enemy's break gauge (decaying when left
// alone) and kill only the weak tier. A dodge has i-frames. A parry held up as an enemy's lunge lands breaks it hard
// and makes it flinch; a lunge that lands starts a fair battle, or an ambush when it came from behind; touching a
// broken (stunned) enemy starts a battle with the party first. A ranged creature (Species.field.shot) keeps its distance
// and fires its own projectile instead: parried, the shot flies back and breaks what it meets like a parried lunge; a
// dodge's i-frames let it pass; a shot that lands starts the battle like a lunge.
// A battle zone may hold a rare creature (web/docs/expedition-balance.md §7): it sparkles, runs from the hero in bursts
// (a breath between them is the chance to catch it), lunges once when cornered, and is gone 40 s after it was first
// seen; broken, it can be engaged like any. Chests (§6) open with 상호작용, and at night the dark merchant (§9) stands
// somewhere 20..35 steps from where the hero was.
import { AVK } from '../keys';
import type { InputState } from '../input';
import { TILE, walkDist, type Zone, type ZoneChest } from './zone';
import { RARE, SPECIES, animRec, rareStats, zoneStats, type Shot, type Species } from './species';

/** sprite directions as the original numbers them: left, right, up, down */
export type Dir = 0 | 1 | 2 | 3;

/** a key press with the time it happened (ms, the host's clock) */
export interface Press { key: number; t: number }

export const HERO_SPEED = 120;
export const HERO_RADIUS = 6;

/** field keys: the quick-slot keys (and their touch spots) are 강공격 · 회피 · 패링 · 상호작용 in this mode */
export const FK = { LIGHT: AVK.OK, HEAVY: AVK.K1, DODGE: AVK.K3, PARRY: AVK.K7, ACT: AVK.K9 } as const;

/** the nearest sprite direction of an angle (0 = right, π/2 = down), kept while within `hold` of its sector */
export function dirOf(angle: number, cur: Dir, hold = 0.2): Dir {
  const centre = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][cur];
  const off = Math.abs(wrap(angle - centre));
  if (off <= Math.PI / 4 + hold) return cur;
  const a = wrap(angle);
  if (a > -Math.PI / 4 && a <= Math.PI / 4) return 1;
  if (a > Math.PI / 4 && a <= (3 * Math.PI) / 4) return 3;
  if (a < -Math.PI / 4 && a >= (-3 * Math.PI) / 4) return 2;
  return 0;
}

/** angle into (-π, π] */
export function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/** movement wanted this frame: a direction and a strength 0..1 (held arrows, else the stick) */
export function moveInput(inp: InputState): { angle: number; amount: number } {
  const dx = (inp.isHeld(AVK.RIGHT) ? 1 : 0) - (inp.isHeld(AVK.LEFT) ? 1 : 0);
  const dy = (inp.isHeld(AVK.DOWN) ? 1 : 0) - (inp.isHeld(AVK.UP) ? 1 : 0);
  const s = inp.stick;
  if (s.active && s.level > 0) return { angle: (s.angle * Math.PI) / 180, amount: Math.min(1, 0.35 + (s.level - 4) * 0.17) };
  if (dx || dy) return { angle: Math.atan2(dy, dx), amount: 1 };
  return { angle: 0, amount: 0 };
}

/** the walk layer of a zone as the bodies see it */
export class Ground {
  readonly W: number;
  readonly H: number;
  readonly zone: Zone;
  constructor(zone: Zone) {
    this.zone = zone;
    this.W = zone.map.header.width;
    this.H = zone.map.header.height;
  }
  get pxW(): number { return this.W * TILE; }
  get pxH(): number { return this.H * TILE; }

  open(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.W && r < this.H && this.zone.walk[r * this.W + c] === 1;
  }

  /** nothing blocks the straight line between two points (sampled every 6 px) */
  clear(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (!this.open(Math.floor((x0 + (x1 - x0) * k) / TILE), Math.floor((y0 + (y1 - y0) * k) / TILE))) return false;
    }
    return true;
  }

  /** a circle at (x, y) touches no blocked cell */
  fits(x: number, y: number, rad: number): boolean {
    const c0 = Math.floor((x - rad) / TILE), c1 = Math.floor((x + rad) / TILE);
    const r0 = Math.floor((y - rad) / TILE), r1 = Math.floor((y + rad) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (this.open(c, r)) continue;
      const nx = Math.max(c * TILE, Math.min(x, c * TILE + TILE)), ny = Math.max(r * TILE, Math.min(y, r * TILE + TILE));
      if ((nx - x) ** 2 + (ny - y) ** 2 < rad * rad) return false;
    }
    return true;
  }

  /** move a body by (dx, dy) in steps of at most 4 px, each axis on its own so it slides along walls; returns how far
   *  it went */
  move(b: { x: number; y: number }, dx: number, dy: number, rad: number): number {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
    const sx = dx / n, sy = dy / n, x0 = b.x, y0 = b.y;
    for (let i = 0; i < n; i++) {
      if (sx && this.fits(b.x + sx, b.y, rad)) b.x += sx;
      if (sy && this.fits(b.x, b.y + sy, rad)) b.y += sy;
    }
    return Math.hypot(b.x - x0, b.y - y0);
  }
}

interface Swing {
  /** c0 action record: frames rec.frame[k] + mult × facing row */
  act: number;
  dur: number;
  hitAt: number;
  range: number;
  /** half the arc, radians */
  arc: number;
  dmg: number;
  brk: number;
  heavy: boolean;
  /** forward speed until the hit, px/s */
  lunge: number;
}

const LIGHT: Swing[] = [
  { act: 0, dur: 0.4, hitAt: 0.15, range: 32, arc: 1.0, dmg: 6, brk: 9, heavy: false, lunge: 90 },
  { act: 1, dur: 0.4, hitAt: 0.15, range: 32, arc: 1.0, dmg: 6, brk: 9, heavy: false, lunge: 90 },
  { act: 2, dur: 0.55, hitAt: 0.22, range: 36, arc: 0.8, dmg: 9, brk: 15, heavy: false, lunge: 120 },
];
const HEAVY: Swing = { act: 3, dur: 0.8, hitAt: 0.36, range: 42, arc: 1.2, dmg: 14, brk: 30, heavy: true, lunge: 140 };
const DODGE_T = 0.42, DODGE_IFRAMES = 0.34, DODGE_SPEED = 270;
/** a parry is up this long after its press, then a short recovery if nothing came */
export const PARRY_UP = 0.22, PARRY_LOCK = 0.35;
/** the lunge of an enemy, seconds */
const LUNGE_T = 0.34;
/** a shooter holds its attack pose this long after the shot leaves */
const SHOOT_T = 0.3;

export type HeroState = 'move' | 'light' | 'heavy' | 'dodge' | 'parry';

export class Hero {
  x = 0;
  y = 0;
  /** facing angle (0 = right, π/2 = down) and the sprite direction drawn */
  angle = Math.PI / 2;
  dir: Dir = 3;
  /** seconds walked (the walk cycle) and standing */
  walkT = 0;
  idleT = 0;
  moving = false;
  state: HeroState = 'move';
  /** seconds in the state */
  t = 0;
  combo = 0;
  swing: Swing | null = null;
  hitDone = false;
  buffered: 'light' | 'heavy' | null = null;
  invuln = 0;
  dodgeA = 0;
  /** the parry caught a lunge this time */
  parried = false;

  constructor(x: number, y: number) { this.x = x; this.y = y; }

  face(a: number): void { this.angle = a; this.dir = dirOf(a, this.dir); }

  get parrying(): boolean { return this.state === 'parry' && this.t <= PARRY_UP; }

  /** sprite frame of c0 (idle row facing*6, walk 0x12 + facing*6, the action records for swings) and mirroring */
  look(actions: { frame: number[]; n: number }[], mult: number[]): { frame: number; mirror: boolean; alpha?: number } {
    const facing = [1, 1, 2, 0][this.dir], mirror = this.dir === 1;
    if ((this.state === 'light' || this.state === 'heavy') && this.swing) {
      const rec = actions[this.swing.act], k = Math.min(rec.n - 1, Math.floor(this.t * 20));
      return { frame: rec.frame[k] + (mult[this.swing.act] ?? 0) * facing, mirror };
    }
    if (this.state === 'parry') return { frame: actions[0].frame[this.t <= PARRY_UP ? 2 : 0] + (mult[0] ?? 0) * facing, mirror };
    if (this.state === 'dodge') return { frame: 0x12 + facing * 6 + (Math.floor(this.t * 30) % 6), mirror, alpha: Math.floor(this.t * 30) % 2 ? 14 : 26 };
    const frame = this.moving ? 0x12 + facing * 6 + (Math.floor(this.walkT * 14) % 6) : facing * 6 + (Math.floor(this.idleT * 8) % 6);
    return { frame, mirror };
  }
}

export type EState = 'idle' | 'wander' | 'notice' | 'chase' | 'windup' | 'lunge' | 'recover' | 'flinch' | 'stunned' | 'dead' | 'cooldown' | 'return' | 'flee';

/** the rare creature runs this much faster than the hero for `run` s, then stops for `rest` s; it is gone `vanish` s
 *  after it was first seen, and lunges once when it has been stuck `stuck` s close to the hero */
export const RARE_RUN = { speed: 1.1, run: 2.5, rest: 1.0, vanish: 40, stuck: 0.5 } as const;

let nextId = 1;

export class FieldEnemy {
  readonly id = nextId++;
  readonly sp: Species;
  readonly species: number;
  /** one of the gatekeeper group by the exit stone (§20.4): beating it drops a piece for sure */
  gate = false;
  x: number;
  y: number;
  readonly homeX: number;
  readonly homeY: number;
  angle: number;
  dir: Dir = 3;
  lastV: 2 | 3 = 3;
  state: EState = 'idle';
  /** seconds in the state */
  t = 0;
  hp: number;
  readonly hpMax: number;
  brk = 0;
  readonly brkMax: number;
  lastHit = -99;
  wx = 0;
  wy = 0;
  lungeA = 0;
  /** attacks made (the boss pounces every third) */
  attacks = 0;
  /** this attack is the boss's pounce */
  pounce = false;
  /** this attack is a shot (Species.field.shot) */
  shooting = false;
  flashT = 0;
  /** seconds the sprite's current animation has run */
  animT = 0;
  moving = false;
  removed = false;
  /** idle seconds before the next wander */
  private rest: number;
  private readonly sim: FieldSim;

  /** the species' stats at this zone's power */
  readonly stats: Species['stats'];
  /** the zone's rare creature (§7) */
  readonly rare: boolean;
  /** when the hero first made it run (s, sim time) */
  seenAt: number | null = null;
  /** it has lunged from a corner (once); how long it has been stuck */
  cornered = false;
  private stuckT = 0;

  constructor(species: number, x: number, y: number, sim: FieldSim, rare = false) {
    this.species = species;
    this.sim = sim;
    this.sp = SPECIES[species];
    this.rare = rare;
    this.x = this.homeX = x;
    this.y = this.homeY = y;
    this.angle = sim.rng() * Math.PI * 2;
    this.dir = dirOf(this.angle, 3);
    this.stats = rare ? rareStats(zoneStats(this.sp.stats, sim.power)) : zoneStats(this.sp.stats, sim.power);
    this.hp = this.hpMax = this.stats.hp;
    this.brkMax = Math.round(this.sp.field.breakMax * (rare ? RARE.brk : 1));
    this.rest = 1 + sim.rng() * 2;
    this.pickWander();
  }

  get alive(): boolean { return this.state !== 'dead' && !this.removed; }
  get stunned(): boolean { return this.state === 'stunned'; }
  get killable(): boolean { return this.sp.tier === 'weak' && !this.sp.field.noKill && !this.rare; }
  /** after a lunge, a flinch or a stun: back to the hunt, or (a rare one) to running */
  private get onward(): EState { return this.rare ? 'flee' : 'chase'; }
  get radius(): number { return this.sp.field.radius; }
  /** this attack's windup and lunge (a pounce winds up longer and leaps further) */
  get windupT(): number { return this.sp.field.windup * (this.pounce ? 1.7 : 1); }
  get lungeT(): number { return this.shooting ? SHOOT_T : LUNGE_T * (this.sp.tier === 'boss' ? (this.pounce ? 1.8 : 1.3) : 1); }

  set(s: EState): void {
    this.state = s;
    this.t = 0;
    this.animT = 0;
  }

  private pickWander(): void {
    const a = this.sim.rng() * Math.PI * 2, r = this.sim.rng() * 70;
    this.wx = this.homeX + Math.cos(a) * r;
    this.wy = this.homeY + Math.sin(a) * r;
  }

  private turnTo(a: number, k: number, dt: number): void {
    this.angle += wrap(a - this.angle) * Math.min(1, k * dt);
    this.dir = dirOf(this.angle, this.dir);
    if (this.dir >= 2) this.lastV = this.dir as 2 | 3;
  }

  update(dt: number): void {
    if (this.removed) return;
    this.t += dt;
    this.animT += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    const sim = this.sim, h = sim.hero, f = this.sp.field;
    const dx = h.x - this.x, dy = h.y - this.y, dist = Math.hypot(dx, dy), toH = Math.atan2(dy, dx);
    let speed = 0;
    if (this.state !== 'stunned' && sim.time - this.lastHit > 3.5) this.brk = Math.max(0, this.brk - dt * this.brkMax * 0.12);
    const reach = 26 + this.radius;
    if (this.rare && this.seenAt !== null && sim.time - this.seenAt > RARE_RUN.vanish && this.state !== 'stunned' && sim.controls) {
      this.removed = true;
      sim.emit({ kind: 'vanish', enemy: this });
      return;
    }
    switch (this.state) {
      case 'idle':
      case 'wander':
        if (this.state === 'idle' && this.t > this.rest) { this.set('wander'); this.rest = 1.5 + sim.rng() * 2; }
        if (this.state === 'wander') {
          const wd = Math.hypot(this.wx - this.x, this.wy - this.y);
          if (wd < 4 || this.t > 6) { this.pickWander(); this.set('idle'); } else { this.turnTo(Math.atan2(this.wy - this.y, this.wx - this.x), 4, dt); speed = f.speed * 0.4; }
        }
        if (this.rare ? dist < f.detect * 1.2 && sim.controls : dist < f.detect && sim.controls && h.invuln <= 0) {
          if (this.rare) { this.seenAt ??= sim.time; this.set('flee'); } else this.set('notice');
          sim.emit({ kind: 'notice', enemy: this });
        }
        break;
      case 'flee': {
        const k = this.t % (RARE_RUN.run + RARE_RUN.rest);
        if (k >= RARE_RUN.run || !sim.controls) { this.turnTo(toH, 6, dt); this.stuckT = 0; break; }    // a breath: the chance
        // away from the hero; of a few headings around that, the first with room ahead
        const away = toH + Math.PI, look = 22;
        const a = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8].map((o) => away + o).find((x) => sim.ground.fits(this.x + Math.cos(x) * look, this.y + Math.sin(x) * look, this.radius * 0.8)) ?? away;
        this.turnTo(a, 10, dt);
        const v = HERO_SPEED * RARE_RUN.speed * dt, went = sim.ground.move(this, Math.cos(this.angle) * v, Math.sin(this.angle) * v, this.radius * 0.8);
        this.moving = went > 0.2 * v;
        this.stuckT = this.moving ? 0 : this.stuckT + dt;
        if (this.stuckT > RARE_RUN.stuck && !this.cornered && dist < reach * 2.5) { this.cornered = true; this.pounce = false; this.shooting = false; this.set('windup'); }
        return;
      }
      case 'notice':
        this.turnTo(toH, 10, dt);
        if (this.t > 0.45) this.set('chase');
        break;
      case 'chase': {
        this.turnTo(toH, 8, dt);
        // a shooter stops where it has a clear line inside its range and fires; up close it lunges like the rest
        const aim = !!f.shot && dist > reach * 1.2 && dist < f.shot.range * 0.85 && sim.ground.clear(this.x, this.y, h.x, h.y);
        if (dist > reach * 0.85 && !aim) speed = f.speed;
        if ((aim || dist < reach * (this.sp.tier === 'boss' ? 2.2 : 1)) && this.t > 0.4 && sim.controls) {
          this.pounce = this.sp.tier === 'boss' && ++this.attacks % 3 === 0;
          this.shooting = aim;
          this.set('windup');
        }
        if (this.sp.tier !== 'boss' && (Math.hypot(this.x - this.homeX, this.y - this.homeY) > 420 || dist > f.detect * 2.4)) this.set('return');
        break;
      }
      case 'windup':
        if (this.t < this.windupT * 0.7) this.turnTo(toH, 6, dt);
        if (this.t >= this.windupT) {
          this.lungeA = this.angle;
          this.set('lunge');
          if (this.shooting && f.shot && sim.controls) sim.fire(this, f.shot);
          sim.emit({ kind: 'sfx', id: this.pounce ? 40 : 29 });
        }
        break;
      case 'lunge': {
        if (this.shooting) { if (this.t >= this.lungeT) this.set('recover'); break; }
        const k = this.t / this.lungeT, d = (this.pounce ? 330 : 230) * (1 - k * 0.6) * dt;
        sim.ground.move(this, Math.cos(this.lungeA) * d, Math.sin(this.lungeA) * d, this.radius * 0.8);
        if (dist < this.radius + HERO_RADIUS + 5 && h.invuln <= 0 && sim.controls) { sim.lungeHits(this); return; }
        if (this.t >= this.lungeT) this.set('recover');
        break;
      }
      case 'recover':
        if (this.t > (this.shooting ? 1.3 : 1.0)) this.set(this.onward);
        break;
      case 'flinch':
        if (this.t > 0.45) this.set(this.onward);
        break;
      case 'stunned':
        if (this.t > 6) { this.brk = 0; this.set(this.onward); }
        break;
      case 'cooldown':
        if (this.t > 4) this.set('return');
        break;
      case 'return':
        this.turnTo(Math.atan2(this.homeY - this.y, this.homeX - this.x), 5, dt);
        speed = f.speed * 0.8;
        if (Math.hypot(this.homeX - this.x, this.homeY - this.y) < 8) this.set('idle');
        if (dist < f.detect * 0.6 && this.t > 2 && sim.controls) this.set('chase');
        break;
      case 'dead':
        if (this.t > 0.7) this.removed = true;
        break;
    }
    if (speed > 0) sim.ground.move(this, Math.cos(this.angle) * speed * dt, Math.sin(this.angle) * speed * dt, this.radius * 0.8);
    this.moving = speed > 0;
  }

  /** a field hit from the hero; true when it connected */
  takeHit(dmg: number, brk: number, heavy: boolean): boolean {
    if (!this.alive) return false;
    const sim = this.sim;
    this.lastHit = sim.time;
    this.flashT = 0.12;
    if (this.killable) this.hp = Math.max(0, this.hp - dmg);
    if (this.killable && this.hp <= 0) { this.set('dead'); sim.emit({ kind: 'kill', enemy: this }); return true; }
    if (this.state !== 'stunned') {
      this.brk = Math.min(this.brkMax, this.brk + brk);
      if (this.brk >= this.brkMax) { this.set('stunned'); sim.emit({ kind: 'break', enemy: this }); return true; }
    }
    const p = this.sp.field.poise;
    if (this.state !== 'stunned' && (p === 0 || (p === 1 && heavy)) && this.state !== 'lunge') {
      this.set('flinch');
      const a = Math.atan2(this.y - sim.hero.y, this.x - sim.hero.x), k = heavy ? 18 : 7;
      sim.ground.move(this, Math.cos(a) * k, Math.sin(a) * k, this.radius * 0.8);
    } else if (this.state === 'idle' || this.state === 'wander' || this.state === 'return') {
      if (this.rare) this.seenAt ??= sim.time;
      this.set(this.onward);
    }
    return true;
  }

  /** a battle with it was fled: it leaves the hero alone for a while */
  pacify(): void { this.brk = 0; this.set('cooldown'); }

  /** sprite: anim record and frame for its state */
  look(cmf: { anims: { frames: number[]; n: number }[] }): { frame: number; mirror: boolean } {
    const a = this.sp.anim, st = this.state;
    const base = st === 'windup' || st === 'lunge' || st === 'recover' ? a.attack : this.moving ? a.move : a.idle;
    const rec = cmf.anims[animRec(this.sp, base, this.dir, this.lastV)] ?? cmf.anims[0];
    let k: number;
    if (st === 'windup') k = 0;
    else if (st === 'lunge') k = Math.min(rec.n - 1, 1 + Math.floor((this.t / this.lungeT) * (rec.n - 1)));
    else if (st === 'recover') k = rec.n - 1;
    else if (st === 'stunned' || st === 'dead') k = 0;
    else k = Math.floor(this.animT * 10) % rec.n;
    return { frame: rec.frames[k] ?? 0, mirror: this.dir === 1 };
  }
}

/** a ranged creature's projectile flying along the ground (drawn Shot.lift px over it) */
export class FieldShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** px it may still fly */
  left: number;
  /** parried back toward its shooter */
  reflected = false;
  gone = false;
  readonly owner: FieldEnemy;
  readonly shot: Shot;
  constructor(owner: FieldEnemy, shot: Shot, x: number, y: number, angle: number) {
    this.owner = owner; this.shot = shot;
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * shot.speed; this.vy = Math.sin(angle) * shot.speed;
    this.left = shot.range;
  }

  /** the frame flying this way (the side frame faces left) */
  look(): { frame: number; mirror: boolean } {
    return Math.abs(this.vx) >= Math.abs(this.vy) ? { frame: this.shot.side, mirror: this.vx > 0 } : { frame: this.shot.vert, mirror: false };
  }
}

export type Advantage = 'party' | 'none' | 'enemy';

export type FieldEvent =
  | { kind: 'battle'; enemies: FieldEnemy[]; advantage: Advantage }
  | { kind: 'kill'; enemy: FieldEnemy }
  | { kind: 'break'; enemy: FieldEnemy }
  | { kind: 'notice'; enemy: FieldEnemy }
  | { kind: 'hit'; x: number; y: number; heavy: boolean }
  | { kind: 'parry'; x: number; y: number }
  | { kind: 'sfx'; id: number }
  | { kind: 'chest'; chest: FieldChest }
  | { kind: 'shop' }
  | { kind: 'vanish'; enemy: FieldEnemy }
  | { kind: 'exit' };

/** a chest of the zone: once opened it fades (t counts from the opening) */
export interface FieldChest extends ZoneChest { opened: boolean; t: number }

/** the dark merchant stands this many walk steps (tiles) from where the hero was when night fell (§9) */
export const MERCHANT_STEPS = [20, 35] as const;

/** One zone being played: the hero on its ground, the enemies, the camera following. */
export class FieldSim {
  readonly ground: Ground;
  readonly hero: Hero;
  readonly enemies: FieldEnemy[] = [];
  shots: FieldShot[] = [];
  /** camera top-left (map px) for a 480 × 320 view */
  camX = 0;
  camY = 0;
  time = 0;
  /** the hero can act and be noticed (off while a battle starts) */
  controls = true;
  /** what happened since the owner last took them */
  events: FieldEvent[] = [];
  chests: FieldChest[];
  /** the dark merchant's spot (map px), once night has fallen */
  merchant: { x: number; y: number } | null = null;
  readonly zone: Zone;
  private seed: number;

  /** how much stronger this zone's creatures are (zoneStats) */
  readonly power: number;

  constructor(zone: Zone, seed = 1, power = 0) {
    this.zone = zone;
    this.power = power;
    this.seed = seed >>> 0 || 1;
    this.ground = new Ground(zone);
    this.hero = new Hero(zone.start.x, zone.start.y);
    this.hero.face(zone.kind === 'boss' ? -Math.PI / 2 : 0);
    this.chests = (zone.chests ?? []).map((c) => ({ ...c, opened: false, t: 0 }));
    for (const s of zone.spawns) {
      const head = new FieldEnemy(s.species, s.x, s.y, this, !!s.rare);
      head.gate = s.beat === 'gate';
      this.enemies.push(head);
      if (SPECIES[s.species].tier === 'boss' || s.rare) continue;
      const n = s.pack ?? Math.floor(this.rng() * 2.4);             // a pack: more of the kind nearby (§20.4)
      for (let i = 0, tries = 0; i < n && tries < 12; tries++) {
        const a = this.rng() * Math.PI * 2, x = s.x + Math.cos(a) * 30, y = s.y + Math.sin(a) * 30;
        if (!this.ground.fits(x, y, 9)) continue;
        const e = new FieldEnemy(s.species, x, y, this);
        e.gate = head.gate;
        this.enemies.push(e);
        i++;
      }
    }
    this.follow(1);
  }

  rng(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  emit(e: FieldEvent): void { this.events.push(e); }

  takeEvents(): FieldEvent[] { const e = this.events; this.events = []; return e; }

  /** one frame: dt seconds, the held input, the presses since the last frame */
  step(dt: number, inp: InputState, presses: Press[]): void {
    this.time += dt;
    const h = this.hero, keys = this.controls ? presses.map((p) => p.key) : [];
    const m = this.controls ? moveInput(inp) : { angle: 0, amount: 0 };
    h.t += dt;
    h.invuln = Math.max(0, h.invuln - dt);
    const want = (k: number) => keys.includes(k);
    switch (h.state) {
      case 'move':
        if (m.amount > 0) {
          h.face(m.angle);
          const d = HERO_SPEED * m.amount * dt;
          const went = this.ground.move(h, Math.cos(m.angle) * d, Math.sin(m.angle) * d, HERO_RADIUS);
          h.moving = went > 0.01 * dt * HERO_SPEED;
          h.walkT += dt * m.amount;
          h.idleT = 0;
        } else { h.moving = false; h.idleT += dt; }
        if (want(FK.DODGE)) this.startDodge(m);
        else if (want(FK.PARRY)) this.startParry();
        else if (want(FK.LIGHT)) this.startSwing(LIGHT[0], 0);
        else if (want(FK.HEAVY)) this.startSwing(HEAVY, 0);
        else if (want(FK.ACT)) this.interact();
        break;
      case 'light':
      case 'heavy': {
        const sw = h.swing!;
        h.moving = false;
        if (h.t < sw.hitAt + 0.05) {
          const d = sw.lunge * (1 - h.t / (sw.hitAt + 0.05)) * dt;
          this.ground.move(h, Math.cos(h.angle) * d, Math.sin(h.angle) * d, HERO_RADIUS);
        }
        if (!h.hitDone && h.t >= sw.hitAt) { h.hitDone = true; this.strike(sw); }
        if (want(FK.LIGHT)) h.buffered = 'light';
        if (want(FK.HEAVY)) h.buffered = 'heavy';
        if (want(FK.DODGE) && h.t > sw.hitAt) { this.startDodge(m); break; }
        if (want(FK.PARRY) && h.t > sw.hitAt) { this.startParry(); break; }
        if (h.state === 'light' && h.buffered === 'light' && h.combo < LIGHT.length - 1 && h.t > sw.hitAt + 0.05) { this.startSwing(LIGHT[h.combo + 1], h.combo + 1); break; }
        if (h.t >= sw.dur) {
          if (h.buffered === 'heavy') this.startSwing(HEAVY, 0);
          else if (h.buffered === 'light' && h.state === 'heavy') this.startSwing(LIGHT[0], 0);
          else { h.state = 'move'; h.t = 0; }
        }
        break;
      }
      case 'dodge': {
        const k = h.t / DODGE_T, d = DODGE_SPEED * (1 - k * k) * dt;
        this.ground.move(h, Math.cos(h.dodgeA) * d, Math.sin(h.dodgeA) * d, HERO_RADIUS);
        if (h.t >= DODGE_T) { h.state = 'move'; h.t = 0; }
        else if (h.t > 0.28 && want(FK.LIGHT)) this.startSwing(LIGHT[0], 0);
        break;
      }
      case 'parry':
        if ((h.parried && h.t > 0.3) || h.t >= PARRY_UP + PARRY_LOCK) { h.state = 'move'; h.t = 0; }
        break;
    }
    for (const e of this.enemies) e.update(dt);
    for (const c of this.chests) if (c.opened) c.t += dt;
    for (const s of this.shots) this.fly(s, dt);
    this.shots = this.shots.filter((s) => !s.gone);
    // walking into a broken enemy: the party strikes first (swinging at it instead can still finish a weak one)
    if (this.controls && h.state === 'move' && h.moving) for (const e of this.enemies) {
      if (e.stunned && e.alive && Math.hypot(e.x - h.x, e.y - h.y) < e.radius + HERO_RADIUS + 4) { this.startBattle(e, 'party'); break; }
    }
    this.follow(dt);
  }

  private startSwing(sw: Swing, combo: number): void {
    const h = this.hero;
    h.state = sw.heavy ? 'heavy' : 'light';
    h.t = 0;
    h.combo = combo;
    h.swing = sw;
    h.hitDone = false;
    h.buffered = null;
    this.emit({ kind: 'sfx', id: sw.heavy ? 40 : 29 });
    const t = this.nearestEnemy(90, h.angle, 1.1);                 // soft aim: the nearest enemy in a cone in front
    if (t) h.face(Math.atan2(t.y - h.y, t.x - h.x));
  }

  private startDodge(m: { angle: number; amount: number }): void {
    const h = this.hero;
    h.state = 'dodge';
    h.t = 0;
    h.invuln = DODGE_IFRAMES;
    h.dodgeA = m.amount > 0 ? m.angle : h.angle + Math.PI;
    if (m.amount > 0) h.face(m.angle);
    this.emit({ kind: 'sfx', id: 39 });
  }

  private startParry(): void {
    const h = this.hero;
    h.state = 'parry';
    h.t = 0;
    h.parried = false;
    h.moving = false;
  }

  /** 상호작용: a broken enemy close by is engaged with the party first; then a chest, the merchant, the exit stone */
  private interact(): void {
    const h = this.hero;
    const e = this.enemies.find((x) => x.stunned && x.alive && Math.hypot(x.x - h.x, x.y - h.y) < 44);
    if (e) { this.startBattle(e, 'party'); return; }
    const c = this.nearChest();
    if (c) { c.opened = true; this.emit({ kind: 'chest', chest: c }); this.emit({ kind: 'sfx', id: 39 }); return; }
    if (this.nearMerchant()) { this.emit({ kind: 'shop' }); return; }
    if (this.nearExit() && this.zone.kind !== 'boss') this.emit({ kind: 'exit' });
  }

  /** an unopened chest within reach */
  nearChest(): FieldChest | null {
    const h = this.hero;
    return this.chests.find((c) => !c.opened && Math.hypot(c.x - h.x, c.y - h.y) < 28) ?? null;
  }

  nearMerchant(): boolean {
    const m = this.merchant, h = this.hero;
    return !!m && Math.hypot(m.x - h.x, m.y - h.y) < 30;
  }

  /** night fell: the merchant takes a spot MERCHANT_STEPS walk steps from the hero (the farthest reached, if none is) */
  placeMerchant(): { x: number; y: number } {
    const W = this.ground.W, H = this.ground.H, h = this.hero, c0 = Math.floor(h.x / TILE), r0 = Math.floor(h.y / TILE);
    const d = walkDist(this.zone.walk, W, H, c0, r0), ok: number[] = [];
    let far = r0 * W + c0;
    for (let i = 0; i < W * H; i++) {
      if (d[i] < 0) continue;
      if (d[i] > d[far]) far = i;
      const c = i % W, r = (i / W) | 0;
      if (d[i] >= MERCHANT_STEPS[0] && d[i] <= MERCHANT_STEPS[1] && this.ground.open(c + 1, r) && this.ground.open(c - 1, r) && this.ground.open(c, r + 1)) ok.push(i);
    }
    const i = ok.length ? ok[Math.floor(this.rng() * ok.length)] : far;
    this.merchant = { x: (i % W) * TILE + 8, y: ((i / W) | 0) * TILE + 8 };
    return this.merchant;
  }

  /** on or next to the exit stone (a 64 × 48 slab anchored at its top-left) */
  nearExit(): boolean {
    const h = this.hero, x = this.zone.exit;
    return Math.hypot(x.x + 32 - h.x, x.y + 24 - h.y) < 40;
  }

  /** what 상호작용 would do here, for the prompt */
  actHint(): string | null {
    const h = this.hero;
    if (this.enemies.some((x) => x.stunned && x.alive && Math.hypot(x.x - h.x, x.y - h.y) < 44)) return '선제 공격';
    if (this.nearChest()) return '상자 열기';
    if (this.nearMerchant()) return '암흑상인과 거래';
    if (this.nearExit() && this.zone.kind !== 'boss') return this.zone.kind === 'rest' ? '쉼터에서 정비' : '다음 지역으로';
    return null;
  }

  nearestEnemy(range: number, angle: number, cone: number): FieldEnemy | null {
    let best: FieldEnemy | null = null, bd = Infinity;
    const h = this.hero;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - h.x, e.y - h.y);
      if (d > range + e.radius || Math.abs(wrap(Math.atan2(e.y - h.y, e.x - h.x) - angle)) > cone) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private strike(sw: Swing): void {
    const h = this.hero;
    let any = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - h.x, e.y - h.y);
      if (d > sw.range + e.radius) continue;
      if (d > e.radius + 4 && Math.abs(wrap(Math.atan2(e.y - h.y, e.x - h.x) - h.angle)) > sw.arc) continue;
      const k = e.state === 'windup' ? 1.5 : 1;                       // catching a windup breaks harder
      if (e.takeHit(sw.dmg, sw.brk * k, sw.heavy)) { any = true; this.emit({ kind: 'hit', x: e.x, y: e.y - 14, heavy: sw.heavy }); }
    }
    if (any) this.emit({ kind: 'sfx', id: sw.heavy ? 21 : 20 });
  }

  /** a shooter's shot leaves it toward where it faces */
  fire(e: FieldEnemy, shot: Shot): void {
    const a = e.angle;
    this.shots.push(new FieldShot(e, shot, e.x + Math.cos(a) * (e.radius + 4), e.y + Math.sin(a) * (e.radius + 4), a));
  }

  /** a shot flies on in steps of at most 4 px: a wall stops it; it meets the hero (parried back, dodged through, or a
   *  battle), or once parried, any creature it meets (broken like by a parried lunge) */
  private fly(s: FieldShot, dt: number): void {
    const h = this.hero, sp = Math.hypot(s.vx, s.vy), d = sp * dt, n = Math.max(1, Math.ceil(d / 4));
    for (let i = 0; i < n && !s.gone; i++) {
      s.x += (s.vx * dt) / n; s.y += (s.vy * dt) / n; s.left -= d / n;
      if (s.left <= 0 || !this.ground.open(Math.floor(s.x / TILE), Math.floor(s.y / TILE))) { s.gone = true; break; }
      if (s.reflected) {
        const e = this.enemies.find((x) => x.alive && Math.hypot(x.x - s.x, x.y - s.y) < x.radius + 5);
        if (e) { s.gone = true; this.staggered(e, 0.6); this.emit({ kind: 'hit', x: e.x, y: e.y - 14, heavy: true }); this.emit({ kind: 'sfx', id: 21 }); }
        continue;
      }
      if (!this.controls || Math.hypot(h.x - s.x, h.y - s.y) >= HERO_RADIUS + 6) continue;
      if (h.parrying) {
        h.parried = true;
        h.invuln = Math.max(h.invuln, 0.3);
        const o = s.owner, back = o.alive ? Math.atan2(o.y - s.y, o.x - s.x) : Math.atan2(-s.vy, -s.vx), k = sp * 1.5;
        s.reflected = true; s.vx = Math.cos(back) * k; s.vy = Math.sin(back) * k; s.left = s.shot.range * 1.6;
        this.emit({ kind: 'parry', x: s.x, y: s.y - s.shot.lift });
        this.emit({ kind: 'sfx', id: 39 });
        break;
      }
      if (h.invuln > 0) continue;                                     // a dodge (or the grace after a battle) lets it by
      s.gone = true;
      if (!s.owner.alive) break;
      const from = Math.atan2(-s.vy, -s.vx);
      this.startBattle(s.owner, Math.abs(wrap(from - h.angle)) > Math.PI * 0.62 ? 'enemy' : 'none');
    }
  }

  /** a parried attack's break on an enemy: k of its gauge, stunned when full, a flinch otherwise */
  private staggered(e: FieldEnemy, k: number): void {
    e.lastHit = this.time;
    if (e.stunned) return;
    e.brk = Math.min(e.brkMax, e.brk + e.brkMax * k);
    if (e.brk >= e.brkMax) { e.set('stunned'); this.emit({ kind: 'break', enemy: e }); }
    else e.set('flinch');
  }

  /** an enemy's lunge reached the hero: parried, or a battle */
  lungeHits(e: FieldEnemy): void {
    const h = this.hero;
    if (h.parrying) {
      h.parried = true;
      h.invuln = 0.5;
      this.emit({ kind: 'parry', x: (e.x + h.x) / 2, y: (e.y + h.y) / 2 - 14 });
      this.emit({ kind: 'sfx', id: 39 });
      this.staggered(e, 0.6);
      const a = Math.atan2(e.y - h.y, e.x - h.x);
      this.ground.move(e, Math.cos(a) * 16, Math.sin(a) * 16, e.radius * 0.8);
      return;
    }
    const from = Math.atan2(e.y - h.y, e.x - h.x);
    this.startBattle(e, Math.abs(wrap(from - h.angle)) > Math.PI * 0.62 ? 'enemy' : 'none');
  }

  /** the battle with an enemy and those close to it (at most three; a boss fights alone) */
  startBattle(e: FieldEnemy, advantage: Advantage): void {
    if (!this.controls) return;
    this.controls = false;
    this.shots = [];
    const group = [e];
    if (e.sp.tier !== 'boss' && !e.rare) {
      for (const o of this.enemies) {
        if (group.length >= 3) break;
        if (o !== e && o.alive && o.sp.tier !== 'boss' && !o.rare && o.state !== 'cooldown' && Math.hypot(o.x - e.x, o.y - e.y) < 110) group.push(o);
      }
    }
    this.emit({ kind: 'battle', enemies: group, advantage });
  }

  /** back from a battle: the beaten are gone, the rest (fled from) leave the hero alone for a while */
  resume(beaten: FieldEnemy[], fled: FieldEnemy[]): void {
    for (const e of beaten) e.removed = true;
    for (const e of fled) e.pacify();
    const h = this.hero;
    h.state = 'move'; h.t = 0; h.invuln = 1.5;
    this.controls = true;
  }

  /** ease the camera toward the hero (k = 1 snaps), kept inside the map */
  follow(dt: number, viewW = 480, viewH = 320): void {
    const tx = this.hero.x - viewW / 2, ty = this.hero.y - viewH / 2 - 10;
    const k = dt >= 1 ? 1 : 1 - Math.exp(-dt * 10);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    this.camX = Math.max(0, Math.min(this.ground.pxW - viewW, this.camX));
    this.camY = Math.max(0, Math.min(this.ground.pxH - viewH, this.camY));
  }
}
