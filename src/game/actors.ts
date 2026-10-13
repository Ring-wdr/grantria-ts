// Field actors other than the player and monsters: NPCs, event-spawned actors and party members
// (events.md §0.3 PLACE / SPAWN_TYPE / WALK_TO / MOVE_TO / BALLOON, §2.4 appearance conditions).
// Walking uses the original path finder FUN_00066c70 (pathfind.ts, event state: no goal fix) and the path walk
// FUN_00070918: steer the body box's top-left to each cell, the next point within 16 px of the cell centre.
import type { Cmf } from '../assets';
import { findPath, walkPathTick } from './pathfind';
import { bodyBox } from '../world';
import type { Drawable, Field } from './field';
import { LOCO, type Dir, type Rect } from './player';
import type { Equip } from '../sprites';

const FACING = [1, 1, 2, 0] as const;

interface PoseRec { n: number; frame: number[]; step: number[]; event: number[]; sound?: number[] }
/** poses whose frame ignores the facing (capture minigame poses; FUN_00063ab4 / 63948 / 637dc) */
const NO_FACING = [[15, 18], [13], [15]];

export class EvActor {
  /** player action tables (d+0x186ac / 0x18ed4 / 0x1958c) and multipliers d+0x24b3a, set by the field scene */
  static poses: { actions: PoseRec[][]; mult: number[][] } = { actions: [], mult: [] };
  /** pose frame events: ev 9..26 spawn effect type ev − 8 (FUN_00069528), sound ids (FUN_0001af90) */
  static onPose: (a: EvActor, ev: number, sound: number) => void = () => {};
  /** ANIM_FREEZE DAT_003b1dba (event 0x1B, -1 = none): the party member of that class (FUN_0007343c) or the actor
   *  with that id (FUN_00069e9c) stops its animation counter; actor 0xEC also shows frame 5 */
  static freeze = -1;
  dir: Dir = 3;
  lastH: 0 | 1 = 0;
  lastV: 2 | 3 = 3;
  visible = true;
  /** 0..32; ACTOR_FADE_IN/OUT */
  alpha = 32;
  t = 0;
  walking = false;
  /** path points, the goal at [0], walked from the end (FUN_00066c70 buffer) */
  path: [number, number][] = [];
  /** reached the end of its path this tick (releases WALK_TO wait 0x13 for anyone) */
  arrived = false;
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

  /** body box of the current frame flipped for the facing (FUN_000231e4: dx = -dx - w when dir & 1) */
  private bodyNow(): [number, number, number, number] {
    const s8 = (v: number) => (v << 24) >> 24;
    const [bx, by, bw, bh] = bodyBox(this.cmf, this.frame).map(s8);
    return [this.dir & 1 ? -bx - bw : bx, by, bw, bh];
  }

  /** WALK_TO / MOVE_TO (FUN_00067318): nothing when already on the cell's top-left; no path -> no walk */
  walkTo(field: Field, cx: number, cy: number): void {
    this.path = [];
    if (this.x === cx * 16 && this.y === cy * 16) return;
    const W = field.map.header.width;
    this.path = findPath((c, r) => field.walkAt(c + r * W) === 1, W, field.map.header.height,
      { x: this.x, y: this.y, lastH: this.lastH, lastV: this.lastV, body: this.bodyNow() }, cx * 16, cy * 16, false) ?? [];
  }

  /** skip (FUN_00065534): party members go to the goal cell's top-left; others keep walking */
  finishPath(): void {
    if (!this.party) return;
    const goal = this.path[0];
    if (goal) { this.x = goal[0]; this.y = goal[1]; }
    this.path = [];
    this.walking = false;
  }

  /** a skipped WALK_TO / MOVE_TO record places the actor directly */
  placeAt(x: number, y: number): void { this.path = []; this.x = x; this.y = y; this.walking = false; }

  update(): void {
    this.walking = false;
    this.arrived = false;
    if (this.path.length) {                                     // FUN_00070918
      const [bx, by] = this.bodyNow();
      this.arrived = walkPathTick(this, [bx, by], this.path, this.speed);
      this.walking = !this.arrived;
    }
    if (this.balloon) this.balloonT++;
    const frozen = EvActor.freeze !== -1 && (this.party ? this.cls : this.id) === EvActor.freeze;
    if (this.party && this.pose && this.poseFrame(frozen)) { if (!frozen) this.t++; return; }
    this.frame = this.pickFrame();
    if (frozen && !this.party && this.id === 0xec) this.frame = 5;
    if (!frozen) this.t++;
  }

  setPose(n: number): void { this.pose = n; this.poseT = 0; this.poseHold = false; }

  /** FUN_00070b68: frame[t % N] + mult·FACING[dir], step moves, ev 4 / 1 end, ev 30 holds the last frame.
   *  ev 9..26 spawn effects and the sound column plays (EvActor.onPose). Returns false when there is no record. */
  private poseFrame(frozen = false): boolean {
    const rec = EvActor.poses.actions[this.cls]?.[this.pose - 1];
    if (!rec) { this.pose = 0; return false; }
    const i = this.poseT % rec.n;
    const facing = NO_FACING[this.cls]?.includes(this.pose) ? 0 : (EvActor.poses.mult[this.cls]?.[this.pose - 1] ?? 0) * LOCO.facing[this.dir];
    this.frame = rec.frame[i] + facing;
    const mv = rec.step[i];
    if (mv) { if (this.dir < 2) this.x += this.lastH === 0 ? -mv : mv; else this.y += this.lastV === 2 ? -mv : mv; }
    const ev = rec.event[i];
    if ((ev >= 9 && ev <= 26) || rec.sound?.[i]) EvActor.onPose(this, ev, rec.sound?.[i] ?? 0);
    if (ev === 4 || ev === 1) { this.pose = 0; return true; }
    if (ev === 30) this.poseHold = true;
    if (!this.poseHold && !frozen) this.poseT++;
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
