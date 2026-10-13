// Game bootstrap: fixed 20 Hz loop (engine.md §1: game speed = frames, no dt) driving the
// current scene. The field is drawn with WebGL on the tick; the UI is HTML/CSS (domUi.ts) whose
// animations run at the display rate, and gamepads are polled every animation frame.
// ?map=N skips the menus and starts a throwaway class-0 game on map N.
// Shared by every host: the entry (src/web/main.ts, src/tauri/main.ts) installs its platform first.
import * as THREE from 'three';
import galmuriUrl from 'galmuri/dist/Galmuri9.woff2?url';
import './styles/ui.css';
import { type Cmf } from '../core/data/assets';
import { WebAssets } from './assets';
import { Compositor } from './render/compositor';
import { DEFAULT_EQUIP, SpriteLayer } from './render/sprites';
import { VIEW_H, VIEW_W } from './render/field';
import { Input } from './input/input';
import { newGame } from '../core/save/save';
import type { GameContext, Scene } from './game/scene';
import { LogoScene, MENU_CMFS, MENU_IMAGES, PlayScene, TitleScene } from './game/screens';
import { AVK } from '../core/keys';
import { DomUi, beginDomFrame, endDomFrame, installBlink, padScroll } from './render/domUi';
import { GameAudio } from './audio';
import { loadOptions, optionFps } from '../core/save/options';
import { loadBindings } from './input/bindings';

let tickMs = 50;

loadBindings();                                                  // key / pad bindings from the platform store
const stage = document.getElementById('stage')!;
const canvas = document.getElementById('screen') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const debug = document.getElementById('hud')!;
overlay.width = VIEW_W;
overlay.height = VIEW_H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(VIEW_W, VIEW_H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const font = new FontFace('Galmuri', `url(${galmuriUrl})`);
const assets = new WebAssets();
await Promise.all([assets.init(), font.load().then((f) => document.fonts.add(f)).catch(() => { /* system font fallback */ })]);
installBlink(assets.tables.blinkColors as [number, number][]);
const compositor = new Compositor(renderer);
// DOM layers in paint order: field HUD, screen UI, the 1.3x overlay layer L1
// the screen UI and L1 stay inside 480x320 (.stage-clip); only the HUD may reach into the side margins (edge layout)
const clip = document.createElement('div');
clip.className = 'stage-clip';
const hud = new DomUi(assets, compositor, stage, 'hud');
stage.append(clip);
const ui = new DomUi(assets, compositor, clip, 'main');
const ui13 = new DomUi(assets, compositor, clip, 'zoom', 1.3);
const cmfs: Record<string, Cmf> = {};
await Promise.all(MENU_CMFS.map(async (n) => { cmfs[n] = await assets.cmf(n); }));
const layer = new SpriteLayer(assets);
const spriteImages = MENU_CMFS.flatMap((n) => layer.allImages(n, cmfs[n], 0, DEFAULT_EQUIP)).filter((n): n is string => !!n);
await Promise.all([ui.init([...MENU_IMAGES, ...spriteImages]), ui13.init([...MENU_IMAGES, 'face_s_0', 'face_s_1', 'face_s_2']),
  hud.init(['touch', 'sIcon', 'shadow'])]);

let scene: Scene;
for (const l of [hud, ui, ui13]) l.onKeys = (keys, pointerType) => ctx.input.inject(keys, pointerType);
const ctx: GameContext = {
  assets, renderer, overlay, compositor, ui, ui13, hud, cmfs, audio: new GameAudio(),
  options: loadOptions(),
  applyOptions() {
    this.audio.setEnabled(this.options.volume !== 0);
    tickMs = 1000 / optionFps(this.options);
    document.documentElement.style.setProperty('--tick', `${tickMs}ms`);
  },
  input: new Input(canvas, VIEW_W, VIEW_H),
  go(s) { scene = s; ctx.input.padField = false; },
};
ctx.applyOptions();
scene = new LogoScene(ctx);

function drawScene(): void {
  beginDomFrame();
  scene.draw();
  endDomFrame();
  debug.textContent = scene.debugLine?.() ?? '';
}

let acc = 0, last = performance.now();
function frame(now: number): void {
  ctx.input.pollPads();
  padScroll(ctx.input.padScrollY, Math.min(100, now - last));
  acc += Math.min(250, now - last);
  last = now;
  let stepped = false;
  while (acc >= tickMs) {
    scene.update(ctx.input.takePresses());
    acc -= tickMs;
    stepped = true;
  }
  if (stepped) drawScene();
  requestAnimationFrame(frame);
}

// dev-only test hook: advance ticks without requestAnimationFrame (hidden panes throttle it)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    ctx,
    scene: () => scene,
    step(n = 1, keys: number[] = []) {
      ctx.input.pollPads();
      for (let i = 0; i < n; i++) scene.update(i === 0 ? [...keys, ...ctx.input.takePresses()] : ctx.input.takePresses());
      drawScene();
      return debug.textContent;
    },
  };
}

// mouse: pointer cursor over anything tappable (full-screen catch-alls such as modal backdrops excluded)
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) * VIEW_W) / r.width, y = ((e.clientY - r.top) * VIEW_H) / r.height;
  const h = ui13.hitAt(x, y) ?? ui.hitAt(x, y) ?? hud.hitAt(x, y);
  const button = h ? h.w < VIEW_W || h.h < VIEW_H
    : ctx.input.zones.some((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
  canvas.style.cursor = button ? 'pointer' : '';
});

/** scale of the whole stage (canvas and UI layers together, so CSS blend modes reach the field): whole numbers
  *  keep the pixels even; below 2x (a phone in landscape) the stage is fitted to the screen instead.
  *  On a touch-first screen wider than 3:2 the frame spans the window and the field controls move into the
  *  side margins (Input.edge), so the stick and the buttons sit under the thumbs at the screen edges. */
const touchFirst = matchMedia('(pointer: coarse)');
function fit(): void {
  const reserve = debug.offsetParent ? 32 : 0;                   // the debug line above the stage, when shown
  const fitS = Math.min(innerWidth / VIEW_W, (innerHeight - reserve) / VIEW_H);
  const s = Math.floor(fitS) >= 2 ? Math.floor(fitS) : fitS;
  const side = Math.max(0, Math.floor((innerWidth / s - VIEW_W) / 2));
  const edge = touchFirst.matches && side >= 16 ? side : 0;
  ctx.input.edge = edge;
  stage.classList.toggle('edge', edge > 0);
  stage.style.transform = `scale(${s})`;
  stage.style.marginLeft = `${edge * s}px`;
  stage.parentElement!.style.width = `${(VIEW_W + 2 * edge) * s}px`;
  stage.parentElement!.style.height = `${VIEW_H * s}px`;
}
touchFirst.addEventListener('change', fit);
addEventListener('resize', fit);
fit();

const quickMap = new URLSearchParams(location.search).get('map');
if (quickMap !== null) {
  const save = newGame(0);
  save.map = Number(quickMap);
  await PlayScene.start(ctx, 2, save);     // slot 3, not written until SAVE is pressed
}
// Android back button (MainActivity.kt asks this first): on the logo / title the shell asks to quit,
// anywhere else it is the cancel / menu key like Esc
(window as unknown as { __grantriaBack?: () => string }).__grantriaBack = () => {
  if (scene instanceof LogoScene || scene instanceof TitleScene) return 'exit';
  ctx.input.inject([AVK.CLR], 'touch');
  return 'handled';
};
requestAnimationFrame(frame);
Object.assign(window, { game: { ctx, scene: () => scene } });
