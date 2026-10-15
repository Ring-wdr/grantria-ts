// Map viewer: renders any m%03d map with three.js at 1:1 pixels and compares it against
// the reference compositor output (public/ref/m%03d.png from tools/grantria_gfx.py map-render).
import * as THREE from 'three';
import { WebAssets } from '../assets';
import { ALL_LAYERS, MapScene, type ActorSpec, type MapLayers } from './mapScene';
import { compareWithReference, type CompareResult } from './compare';
import { Compositor } from '../render/compositor';
import { setPlatform } from '../../core/platform';
import { createWebPlatform } from '../platform';

setPlatform(createWebPlatform());

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mapInput = $<HTMLInputElement>('map');
const zoomSel = $<HTMLSelectElement>('zoom');
const playerBox = $<HTMLInputElement>('player');
const status = $('status');

const assets = new WebAssets();
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // raw RGB values, like the original framebuffer
renderer.setClearColor(0x000000, 1);
$('view').appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);   // y grows downward, units = pixels
const compositor = new Compositor(renderer);
const mapScene = new MapScene(assets);

const layers: MapLayers = { ...ALL_LAYERS };
for (const k of Object.keys(layers) as (keyof MapLayers)[]) {
  const label = document.createElement('label');
  label.innerHTML = `<input type="checkbox" checked /> ${k}`;
  label.querySelector('input')!.addEventListener('change', (e) => {
    layers[k] = (e.target as HTMLInputElement).checked;
    void show();
  });
  $('layers').appendChild(label);
}

/** Player (class 0, idle frame 0) on the walkable cell closest to the map centre. */
function playerSpawn(): ActorSpec | null {
  const { walk, header } = mapScene.map;
  let bestC = -1, bestR = -1, bestD = Infinity;
  walk.forEach((row, r) => row.forEach((v, c) => {
    const d = (r - header.height / 2) ** 2 + (c - header.width / 2) ** 2;
    if (v && d < bestD) { bestD = d; bestC = c; bestR = r; }
  }));
  if (bestC < 0) return null;
  return { cmf: 'cmf_c0', x: bestC * 16 + 8, y: bestR * 16 + 12, frame: 0 };
}

function draw(): void {
  const w = mapScene.width, h = mapScene.height, z = Number(zoomSel.value);
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = `${w * z}px`;
  renderer.domElement.style.height = `${h * z}px`;
  camera.right = w;
  camera.bottom = h;
  camera.updateProjectionMatrix();
  passes = compositor.render(mapScene.layer, camera, w, h).passes;
}

let passes = 0;

let seq = 0;
async function show(): Promise<void> {
  const id = Math.max(0, Math.min(446, Number(mapInput.value) | 0));
  mapInput.value = String(id);
  const mine = ++seq;
  status.textContent = '불러오는 중…';
  await mapScene.build(id, [], layers);
  if (playerBox.checked) {
    const p = playerSpawn();
    if (p) await mapScene.build(id, [p], layers);
  }
  if (mine !== seq) return;
  const hd = mapScene.map.header;
  $('title').textContent = `m${String(id).padStart(3, '0')} ${mapScene.name}`;
  $('info').textContent = `zone ${hd.zone} · ${hd.width}×${hd.height} · t${hd.tileset} · cmf_o${hd.objset} · bgm ${hd.bgm} · `
    + `몬스터Lv ${hd.monLevel} · 액터 ${mapScene.map.actors.length} · 포털 ${mapScene.map.portals.map((p) => p.target).join(',') || '-'}`;
  $('diffFig').hidden = true;
  draw();
  status.textContent = `${mapScene.layer.count} quads · ${passes} passes`;
  history.replaceState(null, '', `?map=${id}`);
}

async function compare(): Promise<CompareResult | null> {
  const id = Number(mapInput.value);
  const url = `${import.meta.env.BASE_URL}ref/m${String(id).padStart(3, '0')}.png`;
  try {
    const r = await compareWithReference(renderer.domElement, url);
    const pct = (100 * r.diffPixels / r.total).toFixed(3);
    $('diffCap').textContent = `참조와 차이: ${r.diffPixels}/${r.total} px (${pct}%), 최대 채널 차 ${r.maxDiff}, 허용 ${r.tolerance}`
      + (r.sizeMatch ? '' : ' — 크기 불일치');
    const z = Number(zoomSel.value);
    r.diffImage.style.width = `${r.width * z}px`;
    $('diff').replaceChildren(r.diffImage);
    $('diffFig').hidden = false;
    (window as unknown as { __compare: unknown }).__compare = { map: id, ...r, diffImage: undefined };
    return r;
  } catch (e) {
    status.textContent = `비교 실패: ${(e as Error).message} (npm run ref 로 참조 이미지를 만드세요)`;
    return null;
  }
}

$('prev').onclick = () => { mapInput.value = String(Number(mapInput.value) - 1); void show(); };
$('next').onclick = () => { mapInput.value = String(Number(mapInput.value) + 1); void show(); };
mapInput.onchange = () => void show();
zoomSel.onchange = () => draw();
playerBox.onchange = () => void show();
$('compare').onclick = () => void compare();
Object.assign(window, { grantria: { show, compare, mapScene } });

await assets.init();
mapInput.value = new URLSearchParams(location.search).get('map') ?? mapInput.value;
await show();
