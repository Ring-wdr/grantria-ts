// Field minimap (polish.md §4): bitmap FUN_00025fe0 built at map load from the file walk bits (before
// object stamps), drawn by FUN_00022228 in the (0, 45) 120×108 window through the shadow.pxl mask.
import * as THREE from 'three';
import type { GameMap } from '../../core/data/assets';
import type { WebAssets } from '../assets';
import type { Ui } from './ui';

/** palette: 0 transparent, 1 white, 2 dark grey 0x3186, 3 green 0x67E0, 4 white */
const PAL: (number[] | null)[] = [null, [255, 255, 255], [49, 48, 49], [99, 252, 0], [255, 255, 255]];

export class Minimap {
  private bw = 0;
  private bh = 0;
  private bits = new Uint8Array(0);
  private mask: Uint8Array | null = null;
  private canvas = document.createElement('canvas');
  private ctx2d: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;

  constructor(assets: WebAssets) {
    this.canvas.width = 120; this.canvas.height = 108;
    this.ctx2d = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    Object.assign(this.tex, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false, flipY: false, colorSpace: THREE.NoColorSpace });
    void assets.texture('shadow').then((t) => {                     // R channel of the left 120×108 of shadow.pxl (156×108)
      const img = t?.image as CanvasImageSource & { width: number; height: number } | undefined;
      if (!img) return;
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, 156, 108).data;
      this.mask = new Uint8Array(156 * 108);
      for (let i = 0; i < this.mask.length; i++) this.mask[i] = d[i * 4] >> 3;
    });
  }

  /** §4.1: layer 0 = file walk bits, layer 1 = cell and its linear 4-neighbours walkable; then two scans, portal markers */
  build(map: GameMap, markers: { x: number; y: number }[]): void {
    const W = map.header.width, H = map.header.height, BW = 2 * W, BH = 2 * H;
    const L0 = new Uint8Array(W * H);
    map.walk.forEach((row, r) => row.forEach((v, c) => { L0[r * W + c] = v ? 1 : 0; }));
    const at = (i: number) => (i >= 0 && i < W * H ? L0[i] : 0);
    const L1 = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) L1[i] = L0[i] && at(i - W) && at(i + 1) && at(i + W) && at(i - 1) ? 1 : 0;
    const b = new Uint8Array((W + 1) * (H + 1) * 4);
    let col = 0, row = 0, u = W * H * 4;
    for (let p = 0; p < W * H * 4; p++) {
      const i = row * W + col;
      if (i < W * H) b[p] = L1[i] ? 2 : L0[i] ? 1 : 0;
      if (u % 2 === 0) col++;
      if (col >= W) col = 0;
      if (u % (4 * W) === 0) row++;
      u--;
    }
    const I = (x: number, y: number) => y * BW + x;
    const scan = (down: boolean) => {
      for (let yy = 0; yy < BH; yy++) for (let xx = 0; xx < BW; xx++) {
        const y = down ? yy : BH - 1 - yy, x = down ? xx : BW - 1 - xx;
        if (b[I(x, y)] !== 2) continue;
        const yu = y === 0 ? 0 : y - 1, xl = x === 0 ? 0 : x - 1;
        const U = I(x, yu), L = I(xl, y), R = I(x + 1, y), D = I(x, y + 1);
        if (b[U] === 1 && b[L] === 1) b[I(xl, yu)] = 4;
        if (b[U] === 1 && b[R] === 1) b[I(x + 1, yu)] = 4;
        if (b[L] === 1 && b[D] === 1) b[I(xl, y + 1)] = 4;
        if (b[D] === 1 && b[R] === 1) b[I(x + 1, y + 1)] = 4;
        for (const k of down ? [U, L] : [D, R]) if (b[k] !== 4) b[k] = 2;
      }
    };
    scan(true); scan(false);
    for (const m of markers) for (let k = 0; k < 2; k++) {               // FUN_00025fe0(1): kind-0 portal markers, green 2×2
      const r = ((m.y >> 3) + k) * BW + (m.x >> 3);
      if (r - 1 >= 0 && r < b.length) { b[r - 1] = 3; b[r] = 3; }
    }
    this.bits = b; this.bw = BW; this.bh = BH;
  }

  /** §4.2: player at (px, py), objects as dots (monsters red, others yellow) */
  draw(u: Ui, px: number, py: number, dots: { x: number; y: number; monster: boolean }[]): void {
    if (!this.mask || !this.bw) return;
    const BW = this.bw, BH = this.bh, px8 = px >> 3, py8 = py >> 3;
    let srcX: number, offX: number, limX: number, srcY: number, offY: number, limY: number;
    if (BW < 80) { srcX = -20; offX = px8 - 40; limX = 99; }
    else if (px8 - 62 < -20) { srcX = -20; offX = px8 - 42; limX = 99; }
    else if (px8 + 58 - BW < 21) { srcX = px8 - 62; offX = 0; limX = px8 + 57; }
    else { srcX = BW - 100; offX = px8 + 38 - BW; limX = BW + 19; }
    if (BH < 68) { srcY = -20; offY = py8 - 40; limY = 87; }
    else if (py8 - 58 < -20) { srcY = -20; offY = py8 - 38; limY = 87; }
    else if (py8 + 50 - BH < 21) { srcY = py8 - 58; offY = 0; limY = py8 + 49; }
    else { srcY = BH - 88; offY = py8 + 30 - BH; limY = BH + 19; }
    let w = BW > limX ? 120 : BW - srcX, h = BH > limY ? 108 : BH - srcY;
    let dx = 0, dy = 0, mx = 0, my = 0;
    if (srcX < 0) { dx -= srcX; w += srcX; mx -= srcX; srcX = 0; }
    if (srcY < 0) { dy -= srcY; h += srcY; my -= srcY; srcY = 0; }
    if (srcX + w > BW) srcX = BW - w;
    if (srcY + h > BH) srcY = BH - h;
    const img = this.ctx2d.createImageData(120, 108), out = img.data;
    for (let j = 0; j < h && dy + j < 108; j++) for (let i = 0; i < w && dx + i < 120; i++) {
      const c = PAL[this.bits[(srcY + j) * BW + srcX + i]];
      if (!c) continue;
      const o = ((dy + j) * 120 + dx + i) * 4, a = this.mask[(my + j) * 156 + mx + i] ?? 0;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = Math.round((a * 255) / 31);
    }
    const dot = (x: number, y: number, c: number[]) => { if (x < 0 || y < 0 || x >= 120 || y >= 108) return; const o = (y * 120 + x) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; };
    dot(60 + offX, 56 + offY, [255, 255, 255]);
    for (const d of dots) {
      const ox = (d.x >> 3) - px8, oy = (d.y >> 3) + 2 - py8;
      if (ox < -29 || ox > 29 || oy < -26 || oy > 26) continue;
      dot(60 + ox + offX, 54 + oy + offY, d.monster ? [255, 17, 0] : [255, 255, 0]);
    }
    this.ctx2d.putImageData(img, 0, 0);
    this.tex.needsUpdate = true;
    u.texture(this.tex, 120, 108, 0, 45);
  }
}
