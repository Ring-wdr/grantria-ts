// Path finder FUN_00066c70 and path walking (FUN_00070918 / player state 9), events.md §0.3 WALK_TO and
// garden.md (popup 0x5E "아니오"). A 4-way A* variant checked against the original in the emulator: the heuristic
// is measured one step further along the move, the turn penalty compares with the node popped just before (not the
// parent), and DAT_003b3bf2 (that index) is never reset between searches. The open list holds 128 entries and is
// ordered by f % 10000 (stable radix sort), earlier entries first on ties.

/** d.dat+0x22aa8: up, right, down, left, then the diagonals (only the goal fix uses them) */
const NB: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

/** DAT_003b3bf2: index of the previously popped node, kept from the last search */
let lastBf2 = 0;
/** set the kept index (tests replay single searches) */
export function setPathMemory(n: number): void { lastBf2 = n; }

/** FUN_0007b5c8 / FUN_0007aee8: integer distance, 0 at 4096 px and beyond */
export function idist(ax: number, ay: number, bx: number, by: number): number {
  const s = (ax - bx) ** 2 + (ay - by) ** 2;
  if (s < 0x10000) return Math.floor(Math.sqrt(s * 65536)) >> 8;
  const t = s >> 8;
  return t >= 0x10000 ? 0 : Math.floor(Math.sqrt(t * 65536)) >> 4;
}

/** FUN_00061218 (pixels): 32 unless the move keeps the direction from the previous node */
function turn(cx: number, cy: number, px: number, py: number, i: number): number {
  if (px < 1 && py < 1) return 0;
  if (cy - py > 16 || cx - px > 16) return 0;
  const d = cy === py ? (cx > px ? 1 : cx !== px ? 3 : 0) : cx === px && cy > py ? 2 : 0;
  return d === i ? 0 : 32;
}

export interface PathActor {
  x: number; y: number; lastH: number; lastV: number;
  /** body box of the current frame, already flipped for the facing: dx, dy, w, h */
  body: [number, number, number, number];
}

/** FUN_00066690: the start cell, the body box edge snapped toward the facing */
function startCell(a: PathActor): [number, number] {
  const [bx, by, bw, bh] = a.body;
  let ox: number, oy: number;
  if (a.lastH === 0) { const v = a.x + bx; ox = v & 15 ? -(v & 15) : 0; } else { const v = a.x + bx + bw; ox = v & 15 ? 16 - (v & 15) : 0; }
  if (a.lastV === 2) { const v = a.y + by; oy = v & 15 ? -(v & 15) : 0; } else { const v = a.y + by + bh; oy = v & 15 ? 16 - (v & 15) : 0; }
  return [(a.x + ox) >> 4, (a.y + oy) >> 4];
}

/**
 * FUN_00066c70: path from the actor to the pixel target as cell top-left pixel points, the goal at [0] and the
 * first step last (walked from the end); null when there is none. walk(c, r) reads the bitmap by the linear
 * index c + r*W like the original (the goal fix can run past a row end). Outside events (fieldState) the goal becomes the first passable neighbour
 * of the target cell (up first; the target cell itself is never used).
 */
export function findPath(walk: (c: number, r: number) => boolean, W: number, H: number, a: PathActor, tx: number, ty: number, fieldState: boolean): [number, number][] | null {
  let tcx = tx >> 4, tcy = ty >> 4;
  if (fieldState) {
    const k = NB.findIndex(([dx, dy]) => walk(tcx + dx, tcy + dy));
    if (k < 0) return null;
    tcx += NB[k][0]; tcy += NB[k][1];
  }
  const [sx, sy] = startCell(a);
  type N = { x: number; y: number; g: number; f: number; par: number };
  const closed: N[] = new Array(256);
  closed[0] = { x: sx, y: sy, g: 0, f: 0, par: 0 };
  const shut = new Set([sy * W + sx]), seen = new Set<number>(), open: N[] = [];
  let cur = closed[0], curIdx = 0, bf1 = 0, bf2 = lastBf2, count = 0;
  const fail = () => { lastBf2 = bf2; return null; };
  for (let guard = 0; guard < 4096; guard++) {
    if (cur.x === tcx && cur.y === tcy) {                            // goal first, back to the step after the start
      const pts: [number, number][] = [];
      let k = bf1;
      do {
        pts.push([closed[k].x * 16, closed[k].y * 16]);
        k = closed[k].par;
        if (pts.length > 300) return fail();                          // bf1 wrap-around guard (u8 index)
      } while (!(closed[k].x === sx && closed[k].y === sy));
      lastBf2 = bf2;
      return pts;
    }
    NB.slice(0, 4).forEach(([dx, dy], i) => {
      const nx = cur.x + dx, ny = cur.y + dy, key = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !walk(nx, ny) || shut.has(key) || seen.has(key)) return;
      seen.add(key);
      const p = closed[bf2] ?? { x: 0, y: 0 };
      const g = (cur.g + 10 + turn(cur.x * 16, cur.y * 16, p.x * 16, p.y * 16, i)) & 0xffff;
      const h = idist((nx + dx) * 16, (ny + dy) * 16, tcx * 16, tcy * 16);   // FUN_00063e64: one step further
      if (count < 128) open.push({ x: nx, y: ny, g, f: (g + h) & 0xffff, par: curIdx });
      count++;
    });
    if (count === 0) { bf2 = bf1; return fail(); }
    let best = 0;
    for (let j = 1; j < open.length; j++) if (open[j].f % 10000 < open[best].f % 10000) best = j;
    cur = open.splice(best, 1)[0];
    bf2 = bf1; bf1 = (bf1 + 1) & 0xff; closed[bf1] = cur; curIdx = bf1; shut.add(cur.y * W + cur.x);
    if (--count >= 128) return fail();
  }
  return fail();
}

export interface Steerable { x: number; y: number; dir: number; lastH: number; lastV: number }

/**
 * FUN_00065f9c: velocity toward (tx, ty) for the body box's top-left (bx, by offsets) at speed sp: the major axis
 * ±sp, the minor one sp·|minor|/|major| rounded on the first decimal; facing follows the larger component.
 */
export function steer(e: Steerable, bx: number, by: number, tx: number, ty: number, sp: number): [number, number] {
  const dx = tx - (e.x + bx), dy = ty - (e.y + by);
  e.lastH = dx > 0 ? 1 : 0; e.lastV = dy >= 1 ? 3 : 2;
  const sy = dy >= 1 ? 1 : -1;
  const rnd = (num: number, den: number) => { const q = Math.abs(Math.trunc((sp * 10 * num) / den)); return Math.trunc(q / 10) + (q % 10 >= 5 ? 1 : 0); };
  let vx: number, vy: number;
  if (Math.abs(dy) < Math.abs(dx)) { vx = dx > 0 ? sp : -sp; vy = dx === 0 ? 0 : sy * rnd(dy, dx); }
  else { vy = sy * sp; vx = dy === 0 ? 0 : (dx > 0 ? 1 : -1) * rnd(dx, dy); }
  if (Math.abs(vy) < Math.abs(vx)) { e.dir = e.lastH = vx > 0 ? 1 : 0; e.lastV = vy > 0 ? 3 : 2; }
  else if (Math.abs(vx) < Math.abs(vy)) { e.dir = e.lastV = vy > 0 ? 3 : 2; e.lastH = vx > 0 ? 1 : 0; }
  return [vx, vy];
}

/**
 * One tick of path walking (FUN_00070918, player state 9): steer to the current point, take the next point once
 * the foot is within 16 of the cell centre (the move of this tick still uses the old point); arriving clears the
 * velocity. Returns true on arrival.
 */
export function walkPathTick(e: Steerable, body: [number, number], path: [number, number][], sp: number): boolean {
  const [px, py] = path[path.length - 1];
  let [vx, vy] = steer(e, body[0], body[1], px, py, sp);
  let arrived = false;
  if (idist(e.x, e.y, px + 8, py + 8) < 16) {
    path.pop();
    if (!path.length) { arrived = true; vx = vy = 0; }
  }
  e.x += vx; e.y += vy;
  return arrived;
}
