// Synthetic game data for the 2.5D test scene (scene3d.html): a small map, a tileset, an object set, a character and
// the shadow, all drawn here with canvas 2D in the formats tools/build_web_assets.py produces. No original asset is
// needed, so the renderer can be checked anywhere (CI, a machine without the APK).
import type { AssetSource } from '../../core/platform';
import type { Cmf, GameMap, Tables } from '../../core/data/assets';

const TILE = 16;
export const MAP_W = 40;
export const MAP_H = 30;
/** plateau rows 0..PLATEAU-1, wall face rows PLATEAU..PLATEAU+FACE-1 (unwalkable), ground below */
export const PLATEAU = 8;
export const FACE = 2;
/** plateau height in world pixels (the face rows become a slope up to it, plan §4.2) */
export const PLATEAU_H = 40;

type Paint = (g: CanvasRenderingContext2D) => void;

function image(w: number, h: number, paint: Paint): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  paint(g);
  return c.toDataURL('image/png');
}

const px = (g: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) => { g.fillStyle = color; g.fillRect(x, y, w, h); };

/** tileset t0: 8 columns; 0 grass, 1 stone path, 2 wall face, 3 water, 4 plateau grass, 5 flowers */
function tileset(): string {
  return image(128, 16, (g) => {
    for (let t = 0; t < 6; t++) {
      const ox = t * TILE;
      const base = ['#4c8a3c', '#9a9a92', '#7a5a3a', '#2e5ea8', '#5c9a48', '#4c8a3c'][t];
      px(g, base, ox, 0, TILE, TILE);
      for (let i = 0; i < 16; i++) {
        const x = (i * 7 + t * 3) % 16, y = (i * 11 + t * 5) % 16;
        if (t === 0 || t === 4) px(g, i & 1 ? '#3e7a30' : '#68a850', ox + x, y);
        if (t === 5) px(g, ['#e85a5a', '#f0d040', '#f0f0f0', '#a060e0'][i & 3], ox + x, y, 2, 2);
      }
      if (t === 1) { for (let y = 0; y < 16; y += 8) { px(g, '#7a7a74', ox, y, 16, 1); px(g, '#7a7a74', ox + ((y >> 3) & 1 ? 4 : 12), y, 1, 8); } }
      if (t === 2) { for (let y = 0; y < 16; y += 4) px(g, '#5a3e24', ox, y, 16, 1); px(g, '#94704a', ox, 0, 16, 1); }
      if (t === 3) { px(g, '#5a8ad0', ox + 2, 4, 6, 1); px(g, '#5a8ad0', ox + 9, 11, 5, 1); }
    }
  });
}

/** object set o0 (one image o0_0): frame 0 tree (48x64), 1 pillar (16x40), 2 fence (32x16) */
function objects(): string {
  return image(128, 64, (g) => {
    px(g, '#6a4628', 20, 40, 8, 24);                                   // tree trunk
    g.fillStyle = '#2f6e2a'; g.beginPath(); g.arc(24, 24, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a9a3a'; g.beginPath(); g.arc(19, 19, 12, 0, Math.PI * 2); g.fill();
    px(g, '#c8c8c0', 50, 0, 16, 40); px(g, '#a0a098', 50, 0, 3, 40); px(g, '#e0e0d8', 48, 0, 20, 4); px(g, '#e0e0d8', 48, 36, 20, 4);
    for (let x = 0; x < 32; x += 6) px(g, '#2a2a2a', 72 + x, 0, 2, 16);
    px(g, '#2a2a2a', 72, 3, 32, 2); px(g, '#2a2a2a', 72, 11, 32, 2);
  });
}

/** character c_test: 3 facing rows (0 down, 1 left, 2 up) of 24x40, 2 walk frames each */
function character(color: string): string {
  return image(48, 120, (g) => {
    for (let row = 0; row < 3; row++) for (let f = 0; f < 2; f++) {
      const ox = f * 24, oy = row * 40, step = f ? 1 : 0;
      px(g, '#3a2a20', ox + 7 + step, oy + 30, 4, 10); px(g, '#3a2a20', ox + 13 - step, oy + 30, 4, 10);   // legs
      px(g, color, ox + 5, oy + 14, 14, 17);                           // body
      px(g, '#f0c8a0', ox + 7, oy + 2, 10, 12);                        // head
      if (row === 0) { px(g, '#000', ox + 9, oy + 7, 2, 2); px(g, '#000', ox + 13, oy + 7, 2, 2); }
      if (row === 1) { px(g, '#000', ox + 8, oy + 7, 2, 2); px(g, '#f0c8a0', ox + 3, oy + 18, 3, 6); }   // faces left
      if (row === 2) px(g, '#5a3a20', ox + 7, oy + 2, 10, 8);          // hair seen from the back
    }
  });
}

function shadow(): string {
  return image(160, 20, (g) => {
    g.fillStyle = '#808080';
    g.beginPath(); g.ellipse(120 + 18, 10, 16, 7, 0, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-over'; px(g, '#ffffff', 120, 0, 36, 20);
  });
}

const part = (clip: number, dx: number, dy: number) => ({ clip, dx, dy, hflip: 0, rot: 0, scale: 1, blend: 0, alpha8: 8 });

function characterCmf(img: string): Cmf {
  const clips: [number, number, number, number][] = [];
  for (let row = 0; row < 3; row++) for (let f = 0; f < 2; f++) clips.push([f * 24, row * 40, 24, 40]);
  return {
    n_frames: 6, clips, anims: [], clip_images: clips.map(() => img),
    frames: clips.map((_, i) => ({ index: i, body_box: [-8, -8, 16, 8, 0, 0, 0, 0], attack_box: [0, 0, 0, 0], parts: [part(i, -12, -40)] })),
  };
}

function objectCmf(): Cmf {
  const clips: [number, number, number, number][] = [[0, 0, 48, 64], [48, 0, 20, 40], [72, 0, 32, 16]];
  const boxes = [[18, 56, 12, 8], [2, 32, 16, 8], [0, 10, 32, 6]];
  return {
    n_frames: 3, clips, anims: [], clip_images: null,
    frames: clips.map((_, i) => ({ index: i, body_box: [...boxes[i], 0, 0, 0, 0], attack_box: [0, 0, 0, 0], parts: [part(i, 0, 0)] })),
  };
}

function gameMap(): GameMap {
  const tiles: number[][] = [], walk: number[][] = [];
  for (let r = 0; r < MAP_H; r++) {
    const tr: number[] = [], wr: number[] = [];
    for (let c = 0; c < MAP_W; c++) {
      let t = 0, w = 1;
      if (r < PLATEAU) t = 4;
      else if (r < PLATEAU + FACE) { t = 2; w = 0; }
      if (r >= PLATEAU + FACE && (c === 18 || c === 19)) t = 1;                 // path south
      if (r === 18 && c >= 4 && c < 36) t = 1;                                // path east-west
      if (r >= 22 && r < 27 && c >= 28 && c < 35) { t = 3; w = 0; }           // pond
      if (r >= 12 && r < 15 && c >= 6 && c < 12) t = 5;                       // flower bed
      tr.push(t + 1); wr.push(w);
    }
    tiles.push(tr); walk.push(wr);
  }
  const objMid = [
    ...[[4, 12], [24, 11], [30, 14], [8, 22], [14, 26], [36, 20], [6, 2], [26, 3], [34, 1]].map(([c, r]) => ({ obj: 0, x: c * TILE, y: r * TILE })),
    ...[[17, 16], [20, 16], [17, 20], [20, 20]].map(([c, r]) => ({ obj: 1, x: c * TILE, y: r * TILE - 24 })),
    ...[0, 2, 4, 6].map((k) => ({ obj: 2, x: (22 + k) * TILE, y: 21 * TILE })),
  ];
  return {
    header: { zone: 0, width: MAP_W, height: MAP_H, tileset: 0, objset: 0, bgm: 0, mapType: 0, monLevel: 1, h8: 0 },
    objBg: [], objLow: [], objMid, objTop: [], actors: [], portals: [], tiles, walk,
  };
}

/** plan §4.2: plateau corners at PLATEAU_H, the face rows a slope down to the ground, (W + 1) x (H + 1) corners */
export function syntheticHeights(): Float32Array {
  const W = MAP_W + 1, h = new Float32Array(W * (MAP_H + 1));
  for (let r = 0; r <= MAP_H; r++) {
    const v = r <= PLATEAU ? PLATEAU_H : r >= PLATEAU + FACE ? 0 : PLATEAU_H * (1 - (r - PLATEAU) / FACE);
    for (let c = 0; c < W; c++) h[r * W + c] = v;
  }
  return h;
}

/** An AssetSource serving the synthetic data (images as data: URLs). */
export function syntheticSource(): AssetSource {
  const images: Record<string, string> = {
    t0: tileset(), o0_0: objects(), o0_1: objects(), c_test: character('#c04040'), c_npc: character('#4060c0'), shadow: shadow(),
  };
  const sizes: Record<string, [number, number]> = { t0: [128, 16], o0_0: [128, 64], o0_1: [128, 64], c_test: [48, 120], c_npc: [48, 120], shadow: [160, 20] };
  const tables: Partial<Tables> = { objSplit: new Array(16).fill(255), portalMarker: [], portalMarkerIds: {}, sharedClips: [], actorCmf: [] };
  const oc: Cmf = { n_frames: 0, clips: [], frames: [], anims: [], clip_images: [] };
  const json: Record<string, unknown> = {
    'images.json': sizes, 'tables.json': tables, 'text.json': [],
    'maps/m000.json': gameMap(), 'cmf/cmf_o0.json': objectCmf(), 'cmf/cmf_oc.json': oc,
    'cmf/cmf_test.json': characterCmf('c_test'), 'cmf/cmf_npc.json': characterCmf('c_npc'),
  };
  return {
    bytes: async () => new Uint8Array(0),
    json: async <T>(path: string) => {
      if (!(path in json)) throw new Error(`synthetic asset missing: ${path}`);
      return structuredClone(json[path]) as T;
    },
    url: (path: string) => images[path.replace(/^images\/|\.png$/g, '')] ?? '',
  };
}
