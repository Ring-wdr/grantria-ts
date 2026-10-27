// 원정(가제): realtime field play on a zone. Positions are floats in map pixels, time in seconds (the host steps it
// every animation frame, not on the 20 Hz tick). The hero moves 360°: held arrows give 8 ways, the touch / pad stick
// its angle and strength; the sprite shows the nearest of its four directions, with some hysteresis so it does not
// flicker on a diagonal. Bodies are circles that slide along the blocked cells of the walk layer.
import { AVK } from '../keys';
import type { InputState } from '../input';
import { TILE, type Zone } from './zone';

/** sprite directions as the original numbers them: left, right, up, down */
export type Dir = 0 | 1 | 2 | 3;

/** a key press with the time it happened (ms, the host's clock) */
export interface Press { key: number; t: number }

export const HERO_SPEED = 120;
export const HERO_RADIUS = 6;

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
  constructor(readonly zone: Zone) {
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

export class Hero {
  x = 0;
  y = 0;
  /** facing angle (0 = right, π/2 = down) and the sprite direction drawn */
  angle = Math.PI / 2;
  dir: Dir = 3;
  /** seconds walked (the walk cycle) and since the last state change */
  walkT = 0;
  idleT = 0;
  moving = false;

  constructor(x: number, y: number) { this.x = x; this.y = y; }

  face(a: number): void { this.angle = a; this.dir = dirOf(a, this.dir); }

  /** sprite frame of c0 (idle row facing*6, walk 0x12 + facing*6; 6 frames at 10 per second) and mirroring */
  look(): { frame: number; mirror: boolean } {
    const facing = [1, 1, 2, 0][this.dir];
    const frame = this.moving ? 0x12 + facing * 6 + (Math.floor(this.walkT * 14) % 6) : facing * 6 + (Math.floor(this.idleT * 8) % 6);
    return { frame, mirror: this.dir === 1 };
  }
}

/** One zone being played: the hero on its ground, the camera following. */
export class FieldSim {
  readonly ground: Ground;
  readonly hero: Hero;
  /** camera top-left (map px) for a 480 × 320 view */
  camX = 0;
  camY = 0;
  time = 0;

  constructor(readonly zone: Zone) {
    this.ground = new Ground(zone);
    this.hero = new Hero(zone.start.x, zone.start.y);
    this.hero.face(0);
    this.follow(1);
  }

  /** one frame: dt seconds, the held input, the presses since the last frame */
  step(dt: number, inp: InputState, _presses: Press[]): void {
    this.time += dt;
    const h = this.hero, m = moveInput(inp);
    if (m.amount > 0) {
      h.face(m.angle);
      const d = HERO_SPEED * m.amount * dt;
      const went = this.ground.move(h, Math.cos(m.angle) * d, Math.sin(m.angle) * d, HERO_RADIUS);
      h.moving = went > 0.01 * dt * HERO_SPEED;
      h.walkT += dt * m.amount;
      h.idleT = 0;
    } else {
      h.moving = false;
      h.idleT += dt;
    }
    this.follow(dt);
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
