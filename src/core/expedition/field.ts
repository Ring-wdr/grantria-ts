// 원정(가제): realtime field play on a zone. Positions are floats in map pixels, time in seconds (the host steps it
// every animation frame, not on the 20 Hz tick). The hero moves 360°: held arrows give 8 ways, the touch / pad stick
// its angle and strength; the sprite shows the nearest of its four directions, with some hysteresis so it does not
// flicker on a diagonal. Bodies are circles that slide along the blocked cells of the walk layer.
// Combat (rules after the 3D prototype's field): a light 3-combo and a heavy swing are arcs around the facing angle,
// turned toward the nearest enemy in a cone when they start; hits fill an enemy's break gauge (decaying when left
// alone) and kill only the weak tier. A dodge has i-frames. A parry held up as an enemy's lunge lands breaks it hard
// and makes it flinch; a lunge that lands starts a fair battle, or an ambush when it came from behind; touching a
// broken (stunned) enemy starts a battle with the party first.
import { AVK } from '../keys';
import type { InputState } from '../input';
import { TILE, type Zone } from './zone';
import { SPECIES, animRec, zoneStats, type Species } from './species';

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

export type EState = 'idle' | 'wander' | 'notice' | 'chase' | 'windup' | 'lunge' | 'recover' | 'flinch' | 'stunned' | 'dead' | 'cooldown' | 'return';

let nextId = 1;

export class FieldEnemy {
  readonly id = nextId++;
  readonly sp: Species;
  readonly species: number;
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

  constructor(species: number, x: number, y: number, sim: FieldSim) {
    this.species = species;
    this.sim = sim;
    this.sp = SPECIES[species];
    this.x = this.homeX = x;
    this.y = this.homeY = y;
    this.angle = sim.rng() * Math.PI * 2;
    this.dir = dirOf(this.angle, 3);
    this.stats = zoneStats(this.sp.stats, sim.power);
    this.hp = this.hpMax = this.stats.hp;
    this.brkMax = this.sp.field.breakMax;
    this.rest = 1 + sim.rng() * 2;
    this.pickWander();
  }

  get alive(): boolean { return this.state !== 'dead' && !this.removed; }
  get stunned(): boolean { return this.state === 'stunned'; }
  get killable(): boolean { return this.sp.tier === 'weak' && !this.sp.field.noKill; }
  get radius(): number { return this.sp.field.radius; }
  /** this attack's windup and lunge (a pounce winds up longer and leaps further) */
  get windupT(): number { return this.sp.field.windup * (this.pounce ? 1.7 : 1); }
  get lungeT(): number { return LUNGE_T * (this.sp.tier === 'boss' ? (this.pounce ? 1.8 : 1.3) : 1); }

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
    switch (this.state) {
      case 'idle':
      case 'wander':
        if (this.state === 'idle' && this.t > this.rest) { this.set('wander'); this.rest = 1.5 + sim.rng() * 2; }
        if (this.state === 'wander') {
          const wd = Math.hypot(this.wx - this.x, this.wy - this.y);
          if (wd < 4 || this.t > 6) { this.pickWander(); this.set('idle'); } else { this.turnTo(Math.atan2(this.wy - this.y, this.wx - this.x), 4, dt); speed = f.speed * 0.4; }
        }
        if (dist < f.detect && sim.controls && h.invuln <= 0) { this.set('notice'); sim.emit({ kind: 'notice', enemy: this }); }
        break;
      case 'notice':
        this.turnTo(toH, 10, dt);
        if (this.t > 0.45) this.set('chase');
        break;
      case 'chase':
        this.turnTo(toH, 8, dt);
        if (dist > reach * 0.85) speed = f.speed;
        if (dist < reach * (this.sp.tier === 'boss' ? 2.2 : 1) && this.t > 0.4 && sim.controls) {
          this.pounce = this.sp.tier === 'boss' && ++this.attacks % 3 === 0;
          this.set('windup');
        }
        if (this.sp.tier !== 'boss' && (Math.hypot(this.x - this.homeX, this.y - this.homeY) > 420 || dist > f.detect * 2.4)) this.set('return');
        break;
      case 'windup':
        if (this.t < this.windupT * 0.7) this.turnTo(toH, 6, dt);
        if (this.t >= this.windupT) { this.lungeA = this.angle; this.set('lunge'); sim.emit({ kind: 'sfx', id: this.pounce ? 40 : 29 }); }
        break;
      case 'lunge': {
        const k = this.t / this.lungeT, d = (this.pounce ? 330 : 230) * (1 - k * 0.6) * dt;
        sim.ground.move(this, Math.cos(this.lungeA) * d, Math.sin(this.lungeA) * d, this.radius * 0.8);
        if (dist < this.radius + HERO_RADIUS + 5 && h.invuln <= 0 && sim.controls) { sim.lungeHits(this); return; }
        if (this.t >= this.lungeT) this.set('recover');
        break;
      }
      case 'recover':
        if (this.t > 1.0) this.set('chase');
        break;
      case 'flinch':
        if (this.t > 0.45) this.set('chase');
        break;
      case 'stunned':
        if (this.t > 6) { this.brk = 0; this.set('chase'); }
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
    } else if (this.state === 'idle' || this.state === 'wander' || this.state === 'return') this.set('chase');
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

export type Advantage = 'party' | 'none' | 'enemy';

export type FieldEvent =
  | { kind: 'battle'; enemies: FieldEnemy[]; advantage: Advantage }
  | { kind: 'kill'; enemy: FieldEnemy }
  | { kind: 'break'; enemy: FieldEnemy }
  | { kind: 'notice'; enemy: FieldEnemy }
  | { kind: 'hit'; x: number; y: number; heavy: boolean }
  | { kind: 'parry'; x: number; y: number }
  | { kind: 'sfx'; id: number }
  | { kind: 'exit' };

/** One zone being played: the hero on its ground, the enemies, the camera following. */
export class FieldSim {
  readonly ground: Ground;
  readonly hero: Hero;
  readonly enemies: FieldEnemy[] = [];
  /** camera top-left (map px) for a 480 × 320 view */
  camX = 0;
  camY = 0;
  time = 0;
  /** the hero can act and be noticed (off while a battle starts) */
  controls = true;
  /** what happened since the owner last took them */
  events: FieldEvent[] = [];
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
    for (const s of zone.spawns) {
      this.enemies.push(new FieldEnemy(s.species, s.x, s.y, this));
      if (SPECIES[s.species].tier === 'boss') continue;
      const n = Math.floor(this.rng() * 2.4);                       // a pack: up to two more of the kind nearby
      for (let i = 0; i < n; i++) {
        const a = this.rng() * Math.PI * 2, x = s.x + Math.cos(a) * 30, y = s.y + Math.sin(a) * 30;
        if (this.ground.fits(x, y, 9)) this.enemies.push(new FieldEnemy(s.species, x, y, this));
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

  /** 상호작용: a broken enemy close by is engaged with the party first; the exit stone leaves the zone */
  private interact(): void {
    const h = this.hero;
    const e = this.enemies.find((x) => x.stunned && x.alive && Math.hypot(x.x - h.x, x.y - h.y) < 44);
    if (e) { this.startBattle(e, 'party'); return; }
    if (this.nearExit() && this.zone.kind !== 'boss') this.emit({ kind: 'exit' });
  }

  nearExit(): boolean {
    const h = this.hero, x = this.zone.exit;
    return Math.hypot(x.x - h.x, x.y - h.y) < 34;
  }

  /** what 상호작용 would do here, for the prompt */
  actHint(): string | null {
    const h = this.hero;
    if (this.enemies.some((x) => x.stunned && x.alive && Math.hypot(x.x - h.x, x.y - h.y) < 44)) return '선제 공격';
    if (this.nearExit() && this.zone.kind !== 'boss') return '다음 지역으로';
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

  /** an enemy's lunge reached the hero: parried, or a battle */
  lungeHits(e: FieldEnemy): void {
    const h = this.hero;
    if (h.parrying) {
      h.parried = true;
      h.invuln = 0.5;
      e.lastHit = this.time;
      e.brk = Math.min(e.brkMax, e.brk + e.brkMax * 0.6);
      this.emit({ kind: 'parry', x: (e.x + h.x) / 2, y: (e.y + h.y) / 2 - 14 });
      this.emit({ kind: 'sfx', id: 39 });
      if (e.brk >= e.brkMax) { e.set('stunned'); this.emit({ kind: 'break', enemy: e }); }
      else e.set('flinch');
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
    const group = [e];
    if (e.sp.tier !== 'boss') {
      for (const o of this.enemies) {
        if (group.length >= 3) break;
        if (o !== e && o.alive && o.sp.tier !== 'boss' && o.state !== 'cooldown' && Math.hypot(o.x - e.x, o.y - e.y) < 110) group.push(o);
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
