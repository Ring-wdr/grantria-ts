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
import { CharSelectScene, LogoScene, MENU_CMFS, MENU_IMAGES, PlayScene, SlotScene, TitleScene } from './game/screens';
import { DataScene } from './game/dataScene';
import { RankingScene } from './game/ranking';
import { ReplayListScene } from './game/replay';
import { SandboxScene } from './game/sandbox';
import { AVK } from '../core/keys';
import { DomUi, beginDomFrame, endDomFrame, installBlink, padScroll } from './render/domUi';
import { GameAudio } from './audio';
import { loadOptions, optionFps } from '../core/save/options';
import { loadBindings } from './input/bindings';
import { platform } from '../core/platform';
import { dev } from '../core/rules/dev';
import { exportPerf, perf, perfRecordCount, setPerfSource, startPerf, stopPerf, type PerfContext } from './perfLog';

let tickMs = 50;

loadBindings();                                                  // key / pad bindings from the platform store
const stage = document.getElementById('stage')!;
const canvas = document.getElementById('screen') as HTMLCanvasElement;
const debug = document.getElementById('hud')!;
// the canvas is never read back (the compositor reads its own targets) and nothing is depth-tested: no preserved
// buffer (the browser swaps instead of copying each frame), no depth or stencil buffer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
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
  assets, renderer, compositor, ui, ui13, hud, cmfs, audio: new GameAudio(),
  options: loadOptions(),
  applyOptions() {
    this.audio.setEnabled(this.options.volume !== 0, this.options.bgm, this.options.sfx);
    tickMs = 1000 / optionFps(this.options);
    document.documentElement.style.setProperty('--tick', `${tickMs}ms`);
    fit();
  },
  input: new Input(canvas, VIEW_W, VIEW_H),
  go(s) {
    const old = scene;
    scene = s;
    if (old !== s) old?.dispose?.();
    ctx.input.padField = false; ctx.input.confirm = false;
  },
};
ctx.applyOptions();
scene = new LogoScene(ctx);

/** per scene: the UI reaching into the fullscreen margins (Scene.wide) and the page colour around the frame */
let wideNow = -1, backdropNow = -1;
function sceneFrame(): void {
  const wide = scene.wide && compositor.pad > 0 ? compositor.pad : 0;
  if (wide !== wideNow) { wideNow = wide; clip.classList.toggle('wide', wide > 0); ui.bleed = wide; }
  const bg = scene.backdrop ?? 0;
  if (bg !== backdropNow) {
    backdropNow = bg;
    compositor.clearColor = bg;
    document.body.style.background = bg ? `#${bg.toString(16).padStart(6, '0')}` : '';
  }
}

function drawScene(): void {
  sceneFrame();
  beginDomFrame();
  scene.draw();
  endDomFrame();
  if (import.meta.env.DEV) debug.textContent = scene.debugLine?.() ?? '';   // dev only: a string and a DOM write per tick
}

/** Animation frames are only requested around the ticks (a timer wakes the loop WAKE_MS before the next one is due),
 *  except while a gamepad is connected: then every frame, so short presses are not missed. Each animation frame runs
 *  a BeginMainFrame through Blink and the WebView compositor even when the tick draws nothing (3 of 4 frames at 15 Hz).
 *  A tick runs on the frame nearest its due time (up to EARLY_MS early;
 *  `acc` keeps the average rate exact). WAKE_MS leaves the timer some slack over EARLY_MS, or a timer firing a little
 *  late misses that frame and the tick lands a frame later (33 / 67 ms gaps instead of 50). CSS animations are
 *  unaffected: transform / opacity ones run on the compositor, others request their own frames from Blink. */
const WAKE_MS = 10, EARLY_MS = 8;
let acc = 0, last = performance.now();
function frame(now: number): void {
  const p = perf;                                                // 성능 기록 (perfLog.ts): null unless switched on
  p?.frame(now);
  ctx.input.pollPads();
  padScroll(ctx.input.padScrollY, Math.min(100, now - last));
  acc += Math.min(250, now - last);
  last = now;
  let stepped = false;
  while (acc >= tickMs - EARLY_MS) {
    const t0 = p ? performance.now() : 0;
    scene.update(ctx.input.takePresses());
    if (p) p.update(performance.now() - t0);
    acc -= tickMs;
    stepped = true;
  }
  if (stepped) {
    const t0 = p ? performance.now() : 0;
    drawScene();
    if (p) p.drawn(performance.now() - t0);
  }
  // from the frame time `now`, not from here: the tick and the draw above took part of the wait already
  const wait = tickMs - acc - WAKE_MS - (performance.now() - now);
  if (ctx.input.padConnected || wait < 20) requestAnimationFrame(frame);
  else setTimeout(() => requestAnimationFrame(frame), wait);
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
    perf: { start: startPerf, stop: stopPerf, export: exportPerf, count: perfRecordCount, recorder: () => perf },
  };
}

/** 성능 기록: what is on screen at the end of each minute. Release builds minify class names (constructor.name
 *  would be 'qa'), hence the explicit names for the main scenes. */
const SCENE_NAMES: [Function, string][] = [
  [PlayScene, 'play'], [TitleScene, 'title'], [LogoScene, 'logo'], [SlotScene, 'slot'], [CharSelectScene, 'charSelect'],
  [DataScene, 'data'], [RankingScene, 'ranking'], [ReplayListScene, 'replayList'], [SandboxScene, 'sandbox'],
];
function sceneName(s: Scene): string {
  for (const [cls, name] of SCENE_NAMES) if (s instanceof cls) return name;
  // screens.ts keeps these private; property names survive minification
  if ('tab' in s) return 'titleOption';
  if (s.backdrop !== undefined) return 'rating';
  return Object.keys(s).length === 1 ? 'loading' : `?${s.constructor.name}`;
}

function perfContext(): PerfContext {
  const field = scene instanceof PlayScene ? scene.field : null, o = ctx.options, info = renderer.info;
  return {
    scene: sceneName(scene), map: field ? field.field.mapId : null, monsters: field ? field.monsters.filter((m) => m.alive).length : null,
    options: { fps: Math.round(1000 / tickMs), speed: o.speed, effects: o.effects, fullscreen: o.fullscreen, minimap: o.minimap,
      shake: o.shake, flash: o.flash, volume: o.volume, bgm: o.bgm, sfx: o.sfx },
    renderer: { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
      calls: info.render.calls, triangles: info.render.triangles },
    view: { canvasW: canvas.width, canvasH: canvas.height, cssW: innerWidth, cssH: innerHeight, dpr: devicePixelRatio },
  };
}
setPerfSource(perfContext);
if (dev().unlocked && dev().perfLog) startPerf();

// mouse: pointer cursor over anything tappable (full-screen catch-alls such as modal backdrops excluded)
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const r = canvas.getBoundingClientRect();
  const pad = compositor.pad, x = ((e.clientX - r.left) * (VIEW_W + 2 * pad)) / r.width - pad, y = ((e.clientY - r.top) * VIEW_H) / r.height;
  const h = ui13.hitAt(x, y) ?? ui.hitAt(x, y) ?? hud.hitAt(x, y);
  const button = h ? h.w < VIEW_W || h.h < VIEW_H
    : ctx.input.zones.some((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
  canvas.style.cursor = button ? 'pointer' : '';
});

/** scale of the whole stage (canvas and UI layers together, so CSS blend modes reach the field): whole numbers
  *  keep the pixels even; below 2x (a phone in landscape) the stage is fitted to the screen instead.
  *  On a touch-first screen wider than 3:2 the frame spans the window and the field controls move into the
  *  side margins (Input.edge), so the stick and the buttons sit under the thumbs at the screen edges.
  *  Fullscreen (option, touch-first only): always fitted, and the field is drawn into the side margins too
  *  (compositor.pad); the menus and popups stay in the 480x320 middle. */
function fit(): void {
  const touch = platform().touchFirst(), full = touch && ctx.options.fullscreen === 1;
  const reserve = debug.offsetParent ? 32 : 0;                   // the debug line above the stage, when shown
  const fitS = Math.min(innerWidth / VIEW_W, (innerHeight - reserve) / VIEW_H);
  const s = !full && Math.floor(fitS) >= 2 ? Math.floor(fitS) : fitS;
  const side = Math.max(0, Math.floor((innerWidth / s - VIEW_W) / 2));
  const edge = touch && side >= 16 ? side : 0;
  const pad = full ? Math.max(0, Math.ceil((innerWidth / s - VIEW_W) / 2)) : 0;
  if (pad !== compositor.pad || canvas.width !== VIEW_W + 2 * pad) {
    compositor.setPad(pad);
    renderer.setSize(VIEW_W + 2 * pad, VIEW_H, false);
    canvas.style.left = `${-pad}px`;
    canvas.style.width = `${VIEW_W + 2 * pad}px`;
  }
  ctx.input.pad = pad;
  hud.bleed = pad;
  ctx.input.edge = edge;
  const margin = Math.max(edge, pad);                            // the frame spans the window when either reaches out
  stage.classList.toggle('edge', margin > 0);
  stage.style.transform = `scale(${s})`;
  stage.style.marginLeft = `${margin * s}px`;
  stage.parentElement!.style.width = `${Math.min(innerWidth, (VIEW_W + 2 * margin) * s)}px`;
  stage.parentElement!.style.height = `${VIEW_H * s}px`;
}
platform().onTouchFirstChange(fit);
addEventListener('resize', fit);
fit();

const quickMap = new URLSearchParams(location.search).get('map');
if (quickMap !== null) {
  const save = newGame(0);
  save.map = Number(quickMap);
  await PlayScene.start(ctx, 2, save);     // slot 3, not written until SAVE is pressed
}
// system back key (Android): on the logo / title the host offers to quit, anywhere else it is the
// cancel / menu key like Esc
platform().lifecycle.setBackHandler(() => {
  if (scene instanceof LogoScene || scene instanceof TitleScene) return false;
  ctx.input.inject([AVK.CLR], 'touch');
  return true;
});
requestAnimationFrame(frame);
Object.assign(window, { game: { ctx, scene: () => scene } });
