// 2.5D test scene (scene3d.html): the synthetic map of synthetic.ts drawn by the 3D field renderer, with a walking
// character, a few NPCs, the 45° view turns, a raised plateau and the original 2D renderer for comparison.
// Arrows / WASD move, Q / E turn the view, R / F pitch, Z / X zoom, T 2D <-> 2.5D, H heights on / off.
import * as THREE from 'three';
import type { Cmf } from '../../core/data/assets';
import { AVK } from '../../core/keys';
import type { Drawable } from '../../core/render';
import { VIEW_H, VIEW_W } from '../../core/render';
import type { InputState } from '../../core/input';
import { quarterOf, viewInput, worldDirToScreen } from '../../core/world/view';
import { WebAssets } from '../assets';
import { Compositor } from '../render/compositor';
import { Field } from '../render/field';
import { Field3D } from '../render3d/field3d';
import { syntheticHeights, syntheticSource } from './synthetic';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const info = document.getElementById('info')!;
const SCALE = 2;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(VIEW_W * SCALE, VIEW_H * SCALE, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const compositor = new Compositor(renderer);

const assets = new WebAssets(syntheticSource());
await assets.init();
const f3 = new Field3D(assets, compositor), f2 = new Field(assets, compositor);
await Promise.all([f3.load(0), f2.load(0)]);
const heights = syntheticHeights(), flat = new Float32Array(heights.length);
f3.setHeights(heights);
const [pc, nc] = await Promise.all([assets.cmf('cmf_test'), assets.cmf('cmf_npc')]);
for (const f of [f3, f2]) { await f.preloadSprite('cmf_test', pc); await f.preloadSprite('cmf_npc', nc); await f.preloadImages(['shadow']); }

interface Walker { x: number; y: number; dir: number; t: number; walking: boolean; cmfName: string; cmf: Cmf }
const DIR_V: Record<number, [number, number, number]> = { [AVK.LEFT]: [-1, 0, 0], [AVK.RIGHT]: [1, 0, 1], [AVK.UP]: [0, -1, 2], [AVK.DOWN]: [0, 1, 3] };
/** Dir -> facing row (0 down, 1 side, 2 up), as LOCO.facing */
const ROW = [1, 1, 2, 0];
const player: Walker = { x: 300, y: 300, dir: 3, t: 0, walking: false, cmfName: 'cmf_test', cmf: pc };
const npcs: Walker[] = [[200, 250], [420, 360], [520, 230], [300, 90]].map(([x, y]) => ({ x, y, dir: 3, t: 0, walking: false, cmfName: 'cmf_npc', cmf: nc }));

const held = new Set<number>();
const KEYS: Record<string, number> = { ArrowUp: AVK.UP, KeyW: AVK.UP, ArrowDown: AVK.DOWN, KeyS: AVK.DOWN, ArrowLeft: AVK.LEFT, KeyA: AVK.LEFT, ArrowRight: AVK.RIGHT, KeyD: AVK.RIGHT };
const order: number[] = [];
const input: InputState = {
  stick: { active: false, angle: 0, level: 0, key: 0, dx: 0, dy: 0 },
  isHeld: (k) => held.has(k),
  direction: () => order[order.length - 1] ?? 0,
};
let mode3d = true, useHeights = true;
addEventListener('keydown', (e) => {
  const k = KEYS[e.code];
  if (k) { if (!held.has(k)) { held.add(k); order.push(k); } e.preventDefault(); return; }
  const c = f3.cam;
  if (e.code === 'KeyQ') f3.view3d.turn(-1);
  else if (e.code === 'KeyE') f3.view3d.turn(1);
  else if (e.code === 'KeyR') c.pitch = Math.min(85, c.pitch + 5);
  else if (e.code === 'KeyF') c.pitch = Math.max(20, c.pitch - 5);
  else if (e.code === 'KeyZ') c.zoom = Math.min(2, +(c.zoom + 0.25).toFixed(2));
  else if (e.code === 'KeyX') c.zoom = Math.max(0.5, +(c.zoom - 0.25).toFixed(2));
  else if (e.code === 'KeyT') mode3d = !mode3d;
  else if (e.code === 'KeyH') { useHeights = !useHeights; f3.setHeights(useHeights ? heights : flat); }
});
addEventListener('keyup', (e) => {
  const k = KEYS[e.code];
  if (!k) return;
  held.delete(k);
  order.splice(order.indexOf(k), 1);
});

/** walk-layer move with the player's 16x8 foot box, 4 px per tick */
function step(w: Walker, key: number): void {
  w.walking = !!key;
  if (!key) return;
  const [vx, vy, d] = DIR_V[key];
  w.dir = d;
  const nx = w.x + vx * 4, ny = w.y + vy * 4;
  const ok = [[-8, -8], [7, -8], [-8, -1], [7, -1]].every(([dx, dy]) => f3.walkCell((nx + dx) >> 4, (ny + dy) >> 4));
  if (ok) { w.x = nx; w.y = ny; }
}

let tick = 0;
const view = f3.view3d;
function update(): void {
  tick++;
  view.tick();
  step(player, viewInput(input, view).direction());
  for (const [i, n] of npcs.entries()) {
    const k = [AVK.LEFT, AVK.DOWN, AVK.RIGHT, AVK.UP][(Math.floor(tick / 30) + i) & 3];
    step(n, tick % 60 < 40 ? k : 0);
  }
  for (const w of [player, ...npcs]) w.t++;
}

function drawable(w: Walker, q: number): Drawable {
  const d = worldDirToScreen(w.dir, q);
  return { cmfName: w.cmfName, cmf: w.cmf, frame: ROW[d] * 2 + (w.walking ? (w.t >> 2) & 1 : 0), x: w.x, y: w.y, mirror: d === 1, shadow: true, depth: w.y - 8 };
}

function draw(): void {
  const q = mode3d ? quarterOf(view.yaw) : 0;
  const ents = [...npcs.map((n) => drawable(n, q)), drawable(player, q)];
  const field = mode3d ? f3 : f2;
  const camX = Math.max(0, Math.min(field.width - VIEW_W, player.x - 240)), camY = Math.max(0, Math.min(field.height - VIEW_H, player.y - 200));
  field.render(camX, camY, ents);
  compositor.show();
  info.textContent = `${mode3d ? '2.5D' : '2D'}  yaw ${view.yaw}° (→${view.target}°)  pitch ${f3.cam.pitch}°  zoom ${f3.cam.zoom}  heights ${useHeights ? 'on' : 'off'}  ·  `
    + `(${player.x}, ${player.y})  ·  ${field.passes} passes`;
  (window as unknown as { __scene3d: unknown }).__scene3d = { ready: true, yaw: view.yaw, mode3d, player: { ...player, cmf: undefined } };
}

let last = performance.now(), acc = 0;
function frame(now: number): void {
  acc += now - last; last = now;
  while (acc >= 50) { update(); acc -= 50; }
  draw();
  requestAnimationFrame(frame);
}
draw();
requestAnimationFrame(frame);
