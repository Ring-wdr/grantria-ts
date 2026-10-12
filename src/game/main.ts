// Game bootstrap: fixed 20 Hz loop (engine.md §1: game speed = frames, no dt) driving the
// current scene. ?map=N skips the menus and starts a throwaway class-0 game on map N.
import * as THREE from 'three';
import { Assets, type Cmf } from '../assets';
import { Compositor } from '../compositor';
import { DEFAULT_EQUIP } from '../sprites';
import { VIEW_H, VIEW_W } from './field';
import { Input } from './input';
import { newGame } from './save';
import type { GameContext, Scene } from './scene';
import { LogoScene, MENU_CMFS, MENU_IMAGES, PlayScene } from './screens';
import { Ui } from './ui';
import { GameAudio } from './audio';
import { loadOptions, optionFps } from './options';

let tickMs = 50;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const debug = document.getElementById('hud')!;
overlay.width = VIEW_W;
overlay.height = VIEW_H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(VIEW_W, VIEW_H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const assets = new Assets();
await assets.init();
const compositor = new Compositor(renderer);
const ui = new Ui(assets, compositor);
const ui13 = new Ui(assets, compositor, 1.3);
const cmfs: Record<string, Cmf> = {};
await Promise.all(MENU_CMFS.map(async (n) => { cmfs[n] = await assets.cmf(n); }));
const spriteImages = MENU_CMFS.flatMap((n) => ui.layer.allImages(n, cmfs[n], 0, DEFAULT_EQUIP)).filter((n): n is string => !!n);
await Promise.all([ui.init([...MENU_IMAGES, ...spriteImages]), ui13.init([...MENU_IMAGES, 'face_s_0', 'face_s_1', 'face_s_2'])]);

let scene: Scene;
const ctx: GameContext = {
  assets, renderer, overlay, compositor, ui, ui13, cmfs, audio: new GameAudio(),
  options: loadOptions(),
  applyOptions() {
    this.audio.setEnabled(this.options.volume !== 0);
    tickMs = 1000 / optionFps(this.options);
  },
  input: new Input(canvas, VIEW_W, VIEW_H),
  go(s) { scene = s; },
};
ctx.applyOptions();
scene = new LogoScene(ctx);

let acc = 0, last = performance.now();
function frame(now: number): void {
  acc += Math.min(250, now - last);
  last = now;
  let stepped = false;
  while (acc >= tickMs) {
    scene.update(ctx.input.takePresses());
    acc -= tickMs;
    stepped = true;
  }
  if (stepped) {
    scene.draw();
    debug.textContent = scene.debugLine?.() ?? '';
  }
  requestAnimationFrame(frame);
}

// dev-only test hook: advance ticks without requestAnimationFrame (hidden panes throttle it)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    ctx,
    scene: () => scene,
    step(n = 1, keys: number[] = []) {
      for (let i = 0; i < n; i++) scene.update(i === 0 ? [...keys, ...ctx.input.takePresses()] : ctx.input.takePresses());
      scene.draw();
      debug.textContent = scene.debugLine?.() ?? '';
      return debug.textContent;
    },
  };
}

function fit(): void {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_W, (innerHeight - 32) / VIEW_H)));
  for (const el of [canvas, overlay]) {
    el.style.width = `${VIEW_W * s}px`;
    el.style.height = `${VIEW_H * s}px`;
  }
}
addEventListener('resize', fit);
fit();

const quickMap = new URLSearchParams(location.search).get('map');
if (quickMap !== null) {
  const save = newGame(0);
  save.map = Number(quickMap);
  await PlayScene.start(ctx, 2, save);     // slot 3, not written until SAVE is pressed
}
requestAnimationFrame(frame);
Object.assign(window, { game: { ctx, scene: () => scene } });
