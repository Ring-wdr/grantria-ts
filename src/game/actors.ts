// Field actors other than the player and monsters: NPCs, event-spawned actors and party members
// (events.md §0.3 PLACE / SPAWN_TYPE / WALK_TO / MOVE_TO / BALLOON, §2.4 appearance conditions).
// Walking along a path uses a breadth-first search on the walk grid; the original path finder
// FUN_00066c70 is not decoded [추정].
import type { Cmf } from '../assets';
import { bodyBox } from '../world';
import type { Drawable, Field } from './field';
import { LOCO, type Dir, type Rect } from './player';
import type { Equip } from '../sprites';

const FACING = [1, 1, 2, 0] as const;

interface PoseRec { n: number; frame: number[]; step: number[]; event: number[] }
/** poses whose frame ignores the facing (capture minigame poses; FUN_00063ab4 / 63948 / 637dc) */
const NO_FACING = [[15, 18], [13], [15]];

export class EvActor {
  /** player action tables (d+0x186ac / 0x18ed4 / 0x1958c) and multipliers d+0x24b3a, set by the field scene */
  static poses: { actions: PoseRec[][]; mult: number[][] } = { actions: [], mult: [] };
  dir: Dir = 3;
  lastH: 0 | 1 = 0;
  lastV: 2 | 3 = 3;
  visible = true;
  /** 0..32; ACTOR_FADE_IN/OUT */
  alpha = 32;
  t = 0;
  walking = false;
  path: [number, number][] = [];
  /** px per tick while walking (WALK_SPEED, default 5) */
  speed = 5;
  /** SET_ACTION: forced anim record (NPC +0x24), -1 = idle / walk */
  anim = -1;
  /** party pose +0x76 (SET_ACTION n / ATTACK = 1, leftovers-combat.md §2), its tick +0x18 and the ev-30 hold */
  pose = 0;
  poseT = 0;
  poseHold = false;
  /** BALLOON n (1..12), 0 = none */
  balloon = 0;
  balloonT = 0;
  /** created by the event (removed when it ends) */
  spawned = false;
  frame = 0;
  /** party sprite equipment (the leader copies the player's) */
  equip?: Equip;
  readonly fourDir: boolean;

  constructor(readonly id: number, readonly cmfName: string, readonly cmf: Cmf, public x: number, public y: number,
    /** party member drawn with a player sprite (ids 0..2) */
    readonly party: boolean, readonly cls: number, typeRec: number[], readonly homeDir = 3) {
    this.fourDir = typeRec[5] !== 2;
    this.face(homeDir as Dir);
  }

  face(d: Dir): void {
    this.dir = d;
    if (d < 2) this.lastH = d as 0 | 1; else this.lastV = d as 2 | 3;
  }

  get moving(): boolean { return this.path.length > 0; }

  /** Breadth-first path over walkable 16 px cells to cell (cx, cy); straight line when none. */
  walkTo(field: Field, cx: number, cy: number): void {
    const sx = Math.floor(this.x / 16), sy = Math.floor(this.y / 16);
    const W = field.map.header.width, H = field.map.header.height;
    const prev = new Map<number, number>();
    const key = (x: number, y: number) => y * W + x;
    const q: [number, number][] = [[sx, sy]];
    prev.set(key(sx, sy), -1);
    let found = sx === cx && sy === cy;
    while (q.length && !found) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(key(nx, ny))) continue;
        if (!(nx === cx && ny === cy) && !field.walkCell(nx, ny)) continue;
        prev.set(key(nx, ny), key(x, y));
        if (nx === cx && ny === cy) { found = true; break; }
        q.push([nx, ny]);
      }
    }
    const pts: [number, number][] = [[cx * 16, cy * 16]];
    if (found) {
      let k = prev.get(key(cx, cy)) ?? -1;
      while (k >= 0 && k !== key(sx, sy)) { pts.unshift([(k % W) * 16, Math.floor(k / W) * 16]); k = prev.get(k) ?? -1; }
    }
    this.path = pts;
  }

  /** Teleport to the end of the current path (skip). */
  finishPath(): void {
    const end = this.path[this.path.length - 1];
    if (end) { this.x = end[0]; this.y = end[1]; }
    this.path = [];
    this.walking = false;
    this.speed = 5;
  }

  update(): void {
    this.walking = false;
    if (this.path.length) {
      const [tx, ty] = this.path[0];
      const dx = tx - this.x, dy = ty - this.y;
      if (dx !== 0) { const s = Math.min(this.speed, Math.abs(dx)); this.x += Math.sign(dx) * s; this.face(dx < 0 ? 0 : 1); }
      else if (dy !== 0) { const s = Math.min(this.speed, Math.abs(dy)); this.y += Math.sign(dy) * s; this.face(dy < 0 ? 2 : 3); }
      if (this.x === tx && this.y === ty) this.path.shift();
      this.walking = true;
      if (!this.path.length) this.speed = 5;                  // back to 5 on arrival
    }
    if (this.balloon) this.balloonT++;
    if (this.party && this.pose && this.poseFrame()) { this.t++; return; }
    this.frame = this.pickFrame();
    this.t++;
  }

  setPose(n: number): void { this.pose = n; this.poseT = 0; this.poseHold = false; }

  /** FUN_00070b68: frame[t % N] + mult·FACING[dir], step moves, ev 4 / 1 end, ev 30 holds the last frame.
   *  Effects of ev 9..26 and the sounds are not spawned [근사]. Returns false when there is no record. */
  private poseFrame(): boolean {
    const rec = EvActor.poses.actions[this.cls]?.[this.pose - 1];
    if (!rec) { this.pose = 0; return false; }
    const i = this.poseT % rec.n;
    const facing = NO_FACING[this.cls]?.includes(this.pose) ? 0 : (EvActor.poses.mult[this.cls]?.[this.pose - 1] ?? 0) * LOCO.facing[this.dir];
    this.frame = rec.frame[i] + facing;
    const mv = rec.step[i];
    if (mv) { if (this.dir < 2) this.x += this.lastH === 0 ? -mv : mv; else this.y += this.lastV === 2 ? -mv : mv; }
    const ev = rec.event[i];
    if (ev === 4 || ev === 1) { this.pose = 0; return true; }
    if (ev === 30) this.poseHold = true;
    if (!this.poseHold) this.poseT++;
    return true;
  }

  private pickFrame(): number {
    if (this.party) {
      const f = LOCO.facing[this.dir], len = LOCO.walkLen[this.cls] ?? 6;
      return this.walking ? LOCO.walkBase + f * len + ((this.t >> 1) % len) : f * LOCO.idleLen + (this.t % LOCO.idleLen);
    }
    const F = FACING[this.dir], V = this.lastV === 2 ? 1 : 0;
    const r = this.anim >= 0 ? this.anim : this.walking ? (this.fourDir ? 3 + F : 2 + V) : (this.fourDir ? F : V);
    const rec = this.cmf.anims[r] ?? this.cmf.anims[0];
    return rec ? rec.frames[(this.t >> 1) % rec.n] : 0;
  }

  rect(): Rect {
    const [bx, by, bw, bh] = bodyBox(this.cmf, this.frame);
    return [this.x + bx, this.y + by, this.x + bx + bw, this.y + by + bh];
  }

  drawable(): Drawable | null {
    if (!this.visible || this.alpha <= 0) return null;
    return {
      cmfName: this.cmfName, cmf: this.cmf, frame: this.frame, x: this.x, y: this.y,
      mirror: this.dir < 2 && this.lastH === 1, equip: this.equip, depth: this.party ? this.y + LOCO.body[1] : undefined,
      fx: this.alpha < 32 ? { alpha: this.alpha } : undefined,
    };
  }
}
