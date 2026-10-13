// Skill projectiles (objects 0x29..0x64), ported from analysis/features/skills.md §4
// (FUN_00069528 spawn, per-kind behaviour functions, FUN_000231e4 box overrides §2.2).
// Every behaviour ends with the common tail of the original: life < 1 removes the object, else frame++ / life--,
// so an object lives one update past life 0. Kind 18 (hell laser launcher) runs its own state machine
// (FUN_0006eb3c status 40, emulator-checked: pillars at updates 26, 53 and 79). Kind 0 is not used.
import type { Cmf } from '../assets';
import type { Drawable } from './field';
import type { Monster } from './monster';
import type { Rect } from './player';

const FACING = [1, 1, 2, 0];

/** Projectile record d+0x21592 + kind*18: frame, action (+0x76), status, type (cmf class). */
export interface ProjRecord { frame: number; action: number; status: number; type: number }

export interface Owner { x: number; y: number; dir: number; lastH: number; lastV: number }

/** Attack box overrides of FUN_000231e4 for player-class sheets (type 0..2), §2.2. */
export function boxOverride(type: number, frame: number, dir: number, lastH: number): [number, number, number, number] | null {
  if (type === 0) {
    if ([592, 594, 596, 598].includes(frame)) return dir === 1 ? [13, -32, 137, 88] : [-150, -32, 137, 88];
    if (frame === 635) return [-34, -76, 72, 201];
    if (frame === 640) return dir === 1 ? [-91, -37, 201, 72] : [-110, -37, 201, 72];
    if (frame === 645) return [-34, -136, 72, 201];
  } else if (type === 1) {
    if (frame === 601) return dir === 1 ? [105, -23, 59, 44] : [-164, -23, 59, 44];
    if (frame === 609) return [-23, -161, 50, 57];
  } else if (type === 2) {
    if (frame === 880 || frame === 883) return [-64, -5, 126, 155];
    if (frame === 887 || frame === 890) return lastH ? [-50, -51, 155, 126] : [-105, -51, 155, 126];
    if (frame === 894 || frame === 897) return [-65, -122, 126, 155];
    if (frame === 744) return lastH ? [4, -54, 151, 74] : [-155, -54, 151, 74];
    if (frame === 769) return [-58, -136, 118, 120];
  }
  return null;
}

/** World attack rect of a player-sheet frame: override, else cmf bytes 4..7 mirrored when dir & 1. */
export function sheetAttackBox(cmf: Cmf, type: number, frame: number, x: number, y: number, dir: number, lastH: number): Rect | null {
  let b: number[] | null = boxOverride(type, frame, dir, lastH);
  if (!b) {
    const a = cmf.frames[frame]?.attack_box;
    if (!a || a[2] <= 0 || a[3] <= 0) return null;
    b = [dir & 1 ? -a[0] - a[2] : a[0], a[1], a[2], a[3]];
  }
  let [bx, by] = b;
  // kind 9 (ground ice) boxes are shifted ~250 px ahead
  if (type === 1 && frame >= 645 && frame <= 651) by += 250;
  if (type === 1 && frame >= 661 && frame <= 667) bx += lastH ? 250 : -250;
  if (type === 1 && frame >= 677 && frame <= 683) by -= 260;
  return [x + bx, y + by, x + bx + b[2], y + by + b[3]];
}

const fwd = (dir: number): [number, number] => [dir === 0 ? -1 : dir === 1 ? 1 : 0, dir === 2 ? -1 : dir === 3 ? 1 : 0];

export class Projectile {
  x: number;
  y: number;
  dir: number;
  lastH: number;
  lastV: number;
  frame: number;
  life: number;
  action: number;
  status: number;
  type: number;
  /** skill action id for the damage formula, 100 = basic attack formula (kind 3) */
  skillAid: number;
  hits = true;           // still able to hit
  gone = false;
  fresh = true;          // not updated on its spawn tick
  private age = 0;
  private cx = 0;
  private cy = 0;
  private angle = 0;
  private target: Monster | null = null;
  private stopped = false;
  private extra = 0;
  /** +0x82 sub-state, +0x8d counter (kind 4 / 18), target locked (kind 4 +0x8d) */
  private sub = 0;
  private cnt = 0;
  private locked = false;

  readonly kind: number;
  readonly cmf: Cmf;
  readonly idx: number;
  constructor(kind: number, rec: ProjRecord, owner: Owner, cmf: Cmf, idx = 0, ex = 0, ey = 0) {
    this.kind = kind; this.cmf = cmf; this.idx = idx;
    this.dir = owner.dir; this.lastH = owner.lastH; this.lastV = owner.lastV;
    this.frame = rec.frame; this.action = rec.action; this.status = rec.status; this.type = rec.type;
    this.skillAid = rec.status === 3 ? 100 : rec.action - (rec.type === 1 ? 2 : 4);
    const { x: ox, y: oy } = owner, d = owner.dir, F = FACING[d];
    const at = (pos: [number, number][]) => pos[d];
    this.x = ox; this.y = oy; this.life = 1;
    const like3: [number, number][] = [[ox - 30, oy - 10], [ox + 30, oy - 10], [ox, oy - 30], [ox, oy + 20]];
    const like7: [number, number][] = [[ox, oy - 10], [ox, oy - 10], [ox, oy], [ox, oy]];
    const set = (life: number, frame: number, pos?: [number, number]) => { this.life = life; this.frame = frame; if (pos) [this.x, this.y] = pos; };
    switch (kind) {
      case 1: {
        const c: [number, number, number][] = [[ox - 60, oy, 20], [ox + 60, oy, -180], [ox, oy - 70, -80], [ox, oy + 60, 100]];
        [this.cx, this.cy, this.angle] = c[d];
        set(17, 623);
        this.orbit();
        break;
      }
      case 2: set(5, 633 + 5 * F); break;
      case 3: set(4, 842, at(like3)); break;
      case 4: set(30, 569 + 5 * F, at(like3)); break;
      case 5: set(8, 588 + 8 * F, at([[ox - 40, oy - 10], [ox + 40, oy - 10], [ox, oy - 40], [ox, oy + 30]])); break;
      case 6: set(9, 824 + 6 * F, d === 3 ? [ox, oy - 30] : [ox, oy]); break;
      case 7: set(15, 612 + 5 * F, at(like7)); break;
      case 8: set(20, 629, at(like7)); break;
      case 9: set(30, 636 + 16 * F, at([[ox - 50, oy - 20], [ox + 50, oy - 20], [ox, oy + 50], [ox, oy - 60]])); break;
      case 10: set(25, 684, at(like7)); break;
      case 11: set(30, 693, at([[ox - 70, oy - 10], [ox + 70, oy - 10], [ox, oy - 70], [ox, oy + 20]])); break;
      case 12: set(5, 708, at(like3)); break;
      case 13: set(30, 684 + idx, at(like3)); break;
      case 14: set(35, 647 + 3 * F, at([[ox - 40, oy - 25], [ox + 40, oy - 25], [ox, oy - 65], [ox, oy + 15]])); break;
      case 15: set(35, 666, at([[ox - 90, oy - 10], [ox + 90, oy - 10], [ox, oy - 70], [ox, oy + 60]])); break;
      case 16: set(200, 683, at([[ox - 43, oy], [ox + 43, oy], [ox, oy - 10], [ox - 2, oy + 19]])); break;
      case 17: set(56, 697 + 25 * F, at([[ox - 43, oy], [ox + 43, oy], [ox, oy - 40], [ox, oy + 30]])); break;
      case 18: set(18, 772, at([[ox - 50, oy], [ox + 50, oy], [ox, oy - 40], [ox, oy + 30]])); this.hits = false; break;
      case 19: set(6, d >= 2 ? 654 : 651, [ex, ey]); this.hits = false; break;
      case 20: {
        const p0: [number, number][] = [[ex - 30, ey - 60], [ex + 30, ey - 60], [ex, ey - 30], [ex, ey - 70]];
        const p1: [number, number][] = [[ex - 110, ey - 60], [ex + 110, ey - 60], [ex, ey - 110], [ex, ey + 20]];
        set(7, 879 + 7 * F, (idx ? p1 : p0)[d]);
        break;
      }
    }
  }

  private orbit(): void {
    const r = (this.angle * Math.PI) / 180;
    this.x = this.cx + Math.trunc(Math.cos(r) * 1024 * 0.06);
    this.y = this.cy - Math.trunc(Math.sin(r) * 1024 * 0.06);
  }

  private nearest(monsters: Monster[], range: number): Monster | null {
    let best: Monster | null = null, bd = range;
    for (const m of monsters) {
      if (!m.alive || m.type > 42) continue;
      const d = Math.hypot(m.x - this.x, m.y - this.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  private chase(m: Monster, speed: number): void {
    const ty = m.y + (m.type === 38 || m.type === 39 ? -30 : m.type === 35 ? 76 : 0);   // FUN_000609c0 target offsets
    const dx = m.x - this.x, dy = ty - this.y, d = Math.hypot(dx, dy) || 1;
    this.x += Math.trunc((dx / d) * speed);
    this.y += Math.trunc((dy / d) * speed);
  }

  private step(n: number): void {
    const [fx, fy] = fwd(this.dir);
    this.x += fx * n; this.y += fy * n;
  }

  /** FUN_000231e4 rewrites the box from the frame every update; a box-less frame never hits (FUN_00060c40).
   *  frame: the frame whose box is used (kinds 3 / 4 test after moving with the previous update's box). */
  attackBox(frame = this.frame): Rect | null {
    if (!this.hits || this.gone) return null;
    return sheetAttackBox(this.cmf, this.type, frame, this.x, this.y, this.dir, this.lastH);
  }
  /** kinds 3 / 4 move first and test afterwards (FUN_00072790 LAB_00072956) */
  get hitsAfterMove(): boolean { return this.kind === 3 || this.kind === 4; }

  /** "+0x76 == 10" rule (§2.3): first contact turns into the 6-tick explosion without damage. */
  contactExplodes(): boolean {
    if (this.action !== 10 || this.dir === 2) return false;
    this.frame = 691; this.life = 6; this.dir = 2;
    return true;
  }

  /** Called after a tick in which this projectile hit something. */
  onHit(): void {
    switch (this.kind) {
      case 3: this.gone = true; break;
      case 4: this.sub = 2; this.frame = 584; this.life = 3; this.hits = false; break;
      case 7: this.life = 2; this.frame = 627; this.hits = false; break;
      case 8: if (this.frame < 633) { this.life = 3; this.frame = 633; } break;
      case 10: if (!this.stopped) { this.stopped = true; this.extra = 16; } break;
      case 14: if (!this.stopped) this.stopped = true; break;
    }
  }

  /** Movement, frame and life for one tick; returns kind-20 spawn requests (kind 18). */
  update(monsters: Monster[]): { spawn20?: [number, number] } {
    const F = FACING[this.dir];
    this.age++;
    let out: { spawn20?: [number, number] } = {};
    switch (this.kind) {
      case 1: this.angle += 20; this.orbit(); this.frame = this.life === 2 ? 631 : this.frame >= 631 ? 623 : this.frame + 1; break;
      case 2: this.frame++; break;
      case 3: {                                                    // the frame runs while searching; locked: 843 + tail = 844
        if (!this.target) {
          this.step(6);
          const m = this.nearest(monsters, 90);
          if (m) { this.target = m; this.life = 30; }
        } else if (this.target.alive) this.chase(this.target, 35 - this.life);
        else this.step(6);
        if (this.target) this.frame = 843;
        this.frame++;
        break;
      }
      case 4: {                                                    // FUN_00072790 status 16
        if (this.sub === 0) {                                      // backs off 2 px; at life 25 jumps ahead (after the -2)
          this.step(-2);
          if (this.life === 25) { this.sub = 1; this.frame = 587; this.step(this.dir === 3 ? 37 : 47); }
        } else if (this.sub === 1) {                               // the target is locked once and never searched again
          this.frame = 587;
          if (!this.locked) {
            this.target = this.nearest(monsters, 190);
            this.locked = !!this.target;
            if (!this.target) { this.life = 5; this.sub = 3; }
          }
          if (this.target) this.chase(this.target, Math.min(48, 36 - Math.trunc(this.life * 3.3 - 25)));
        } else if (this.sub === 3) { this.frame = 587; this.step(2); this.hits = false; }   // no target: drifts, no hits
        this.frame++;                                              // tail: 588 while chasing, 585 / 586 exploding
        break;
      }
      case 5: this.frame++; break;
      case 6: this.step(30); this.frame = this.life >= 6 ? 825 + 6 * F : this.frame + 1; break;
      case 7: if (this.hits) { this.step(14); this.frame = this.frame >= 616 + 5 * F ? 612 + 5 * F : this.frame + 1; } else this.frame++; break;
      case 8:
        if (this.frame < 633) { this.step(5); this.frame = this.frame >= 632 ? 629 : this.frame + 1; if (this.life === 1) this.frame = 633; }
        else this.frame++;
        break;
      case 9: {
        if (this.life === 23) this.x += [40, -40, 0, 0][this.dir], this.y += [0, 0, 35, -45][this.dir];
        const base = 16 * F;
        this.frame++;
        if (this.frame === 644 + base) this.frame++;
        if (this.frame > 651 + base) this.frame = 647 + base;
        break;
      }
      case 10:
        if (!this.stopped) this.step(8);
        else if (this.extra > 0) { this.step(8); this.extra -= 8; }
        this.frame = this.frame >= 692 ? 685 : this.frame + 1;
        break;
      case 11: this.frame = this.life === 2 ? 706 : this.frame >= 706 ? 693 : this.frame + 1; break;
      case 12: if (this.frame >= 691) this.frame++; break;
      case 13: {
        if (this.frame >= 691 && this.life <= 6 && this.dir === 2) { this.frame++; break; }
        if (this.life > 25) {
          const dv = [-8, -4, 0, 4, 8][this.idx];
          if (this.dir < 2) this.y += dv; else this.x += dv;
        } else if (this.life < 20) {
          const m = this.target?.alive ? this.target : (this.target = this.nearest(monsters, 140));
          if (m) this.chase(m, 10); else this.step(2);
        }
        this.frame = this.life === 1 ? 692 : this.frame >= 692 ? 684 : this.frame + 1;
        break;
      }
      case 14:
        if (this.life === 11) this.stopped = true;
        if (this.life === 10) this.frame = 656;
        else if (this.frame >= 656) this.frame++;
        else { if (!this.stopped) this.step(4); this.frame = this.frame >= 650 + 3 * F ? 647 + 3 * F : this.frame + 1; }
        break;
      case 15:
        if (this.life === 3) { this.frame = 680; this.hits = false; }
        else this.frame = this.frame >= 680 ? 667 : this.frame + 1;
        break;
      case 16: {
        if (this.frame >= 691 && this.dir === 2 && this.life <= 6) { this.frame++; break; }
        const m = this.target?.alive ? this.target : (this.target = this.nearest(monsters, 110));
        if (m) this.chase(m, 12);
        this.frame = this.frame >= 691 ? 683 : this.frame + 1;
        break;
      }
      case 17: this.frame = this.frame >= 721 + 25 * F ? 705 + 25 * F : this.frame + 1; break;
      case 18: return this.launcher();
      case 19: if (this.age % 2 === 0) this.frame++; break;
      case 20: this.frame++; break;
    }
    if (this.life < 1) this.gone = true; else this.life--;          // the common tail (frame++ is done per kind above)
    return out;
  }

  /** FUN_0006eb3c status 40: 773..784, hold 785, 786, pillars on 787 then three counted waits rewinding to 779 */
  private launcher(): { spawn20?: [number, number] } {
    const tail = () => { if (this.life < 1) this.gone = true; else { this.frame++; this.life--; } };
    switch (this.sub) {
      case 0:
        if (this.frame === 784) { this.sub = 3; this.frame = 785; this.life = 11; return {}; }
        if (this.frame === 785) this.sub = 2;
        tail(); return {};
      case 3:                                                       // hold 785 until life 1
        if (this.life === 1) { this.sub = 0; this.frame = 785; this.life = 5; return {}; }
        this.life--; return {};
      case 2:                                                       // both pillars (idx 0 and 1)
        this.sub = 1; tail(); return { spawn20: [this.x, this.y] };
      default:                                                      // 1: counted wait, every 7th rewinds
        if (this.cnt < 21) {
          if (this.cnt % 7 === 0 && this.cnt !== 0) { this.life = 11; this.frame = 779; this.sub = 0; }
          this.cnt++; return {};
        }
        tail(); return {};
    }
  }

  /** The gravity hole (kind 15) still pulling. */
  get pulling(): boolean { return this.kind === 15 && !this.gone && this.life > 3; }

  drawable(): Drawable {
    return { cmfName: `cmf_c${this.type}`, cmf: this.cmf, frame: this.frame, x: this.x, y: this.y, mirror: this.dir < 2 && this.lastH === 1 };
  }
}
