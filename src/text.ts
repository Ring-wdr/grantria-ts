// Bitmap text from f.pxl, ported from analysis/features/text-rendering.md §0.3
// (FUN_00078664 DrawStringRaw, FUN_00077e58 glyph blit, FUN_00078474 colour codes).
// Strings are rasterised on the CPU into an RGBA canvas (pen / outline pixels, transparent
// elsewhere) and drawn as one quad; the original's global alpha becomes the quad opacity.
import * as THREE from 'three';
import type { Assets } from './assets';

// Hangul piece tables (.so 0x3a9cd8, 0x3a9d2c, 0x3a9d5c, 0x3a9d98, 0x3a9de4)
const KIND = [1, 1, 1, 1, 1, 1, 1, 1, 2, -1, -1, -1, 2, 2, -1, -1, -1, 2, 2, -1, 1];
const BV = [0, 1, 1, 1, 2, 3, 4, 4, 4, 5, 6, 7];
const JDX = [1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const BDY_CHO = [3, 3, 4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 5, 4, 5];
const BDY_JONG = [3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3];

/** '|a'..'|r' pen colours (RGB565). */
export const COLOR_CODES: Record<string, number> = {
  a: 0x0000, b: 0xffff, c: 0xf800, d: 0xffe0, e: 0x666c, f: 0x001f, g: 0xc99f, h: 0xed26, i: 0x34df,
  j: 0x9cd3, k: 0xfe6c, l: 0xab31, m: 0xfff5, n: 0xfc40, o: 0xfd5f, p: 0xafe0, r: 0xfd59,
};

export const WHITE = 0xffff;
/** outline colour meaning "no outline" */
export const NO_OUTLINE = 0xf81f;

export function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

const isHangul = (ch: number) => ch >= 0xac00 && ch <= 0xd7a3;

/** FUN_00078e84: 2 + 10 per Hangul, 6 per ASCII; '@' and '|x' count 0. */
export function stringWidth(s: string): number {
  let w = 2;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 0x7c) { i++; continue; }
    if (ch === 0x40) continue;
    w += isHangul(ch) ? 10 : ch < 0x80 ? 6 : 0;
  }
  return w;
}

export interface TextStyle {
  pen?: number;
  outline?: number;
  /** tick counter for '|q' blinking */
  frame?: number;
}

export interface RenderedText {
  texture: THREE.CanvasTexture;
  width: number;
  height: number;
}

const PAD_H = 16;

export class TextRenderer {
  private glyphs!: Uint8Array;      // per f.pxl pixel: 0 transparent, 1 body (0xFFFF), 2 outline (0x0000)
  private fw = 0;
  private cache = new Map<string, RenderedText>();

  constructor(private assets: Assets) {}

  async init(): Promise<void> {
    const res = await fetch(`${import.meta.env.BASE_URL}assets/images/f.png`);
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    this.fw = bmp.width;
    this.glyphs = new Uint8Array(bmp.width * bmp.height);
    for (let i = 0; i < this.glyphs.length; i++) {
      if (px[i * 4 + 3] === 0) continue;
      this.glyphs[i] = px[i * 4] > 128 ? 1 : 2;
    }
  }

  /** Rasterise s (UTF-16, control codes kept) as DrawString would at (0, 0). Cached. */
  render(s: string, style: TextStyle = {}): RenderedText {
    const pen0 = style.pen ?? WHITE, outline = style.outline ?? NO_OUTLINE;
    const hasBlink = s.includes('|q');
    const key = `${s}\u0000${pen0}\u0000${outline}\u0000${hasBlink ? style.frame ?? 0 : 0}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const width = Math.max(1, stringWidth(s) + 40 * (s.split('|0').length - 1) + 8);
    const out = new Uint8ClampedArray(width * PAD_H * 4);
    const ol = outline !== NO_OUTLINE;
    const cm = ol ? 2 : 0;
    let pen = pen0, prevPen = pen0;
    const olRgb = rgb565(outline);

    const G = (w: number, h: number, sx: number, sy: number, dx: number, dy: number, mode: number) => {
      const body = rgb565(pen);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const v = this.glyphs[(sy + j) * this.fw + sx + i];
        const x = dx + i, y = dy + j;
        if (!v || x < 0 || y < 0 || x >= width || y >= PAD_H) continue;
        let col: [number, number, number] | null = null;
        if (v === 1 && (mode === 0 || mode === 2)) col = body;
        else if (v === 2 && (mode === 1 || mode === 2)) col = olRgb;
        if (!col) continue;
        const o = (y * width + x) * 4;
        out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255;
      }
    };

    const hangul = (u: number, x: number, y: number) => {
      const sIdx = u - 0xac00;
      const cho = Math.trunc(sIdx / 588), jung = Math.trunc(sIdx / 28) % 21, jong = sIdx % 28;
      const kind = KIND[jung];
      if (jong === 0) {
        G(11, 13, 23, jung * 13, x, y, cm);
        if (kind === 1) G(7, 11, 0, cho * 11, x, y, cm);
        else if (kind === 2) G(9, 8, 7, cho * 8, x + 1, y, cm);
        else if (cho === 0) G(7, 8, 16, 0, x, y, cm);
        else if (cho === 15) G(7, 8, 16, 8, x, y, cm);
        else G(7, 7, 0, 209 + cho * 7, x, y, cm);
        return;
      }
      const bv = jung >= 8 && jung <= 19 ? BV[jung - 8] : -1;
      const jdx = jung >= 1 && jung <= 15 ? JDX[jung - 1] : 0;
      let bdy = 4;
      if (bv >= 0) {
        if ((jong >= 8 && jong <= 15) || jong === 25) {
          if (bv === 0 || bv === 2) bdy = BDY_CHO[cho];
          else if (bv >= 3 && bv <= 6) bdy = 3;
        }
        if (bv === 1) bdy = [0, 1, 9, 10, 12, 13, 14, 15].includes(cho) ? (jong >= 8 ? BDY_JONG[jong - 8] : 4) : 5;
      }
      for (const mode of ol ? [1, 0] : [0]) {
        G(11, 7, 34, (jong - 1) * 7, x + jdx, y + 6, mode);
        if (bv >= 0) G(11, 5, 23, 273 + bv * 5, x, y + bdy, mode);
        G(6, 9, 16, 149 + jung * 9, x + 5, y, mode);
        if (bv === 1 || bv === 4) G(7, 7, 16, 16 + cho * 7, x, y, mode);
        else if (kind === 2) G(9, 7, 7, 152 + cho * 7, x + 1, y, mode);
        else G(7, 7, 0, 209 + cho * 7, x, y, mode);
      }
    };

    const cls = this.assets.tables.fontClass;
    let x = 0;
    const y = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (isHangul(ch)) { hangul(ch, x, y); x += 10; continue; }
      if (ch >= 0x80) continue;                      // not representable in the original font
      const c = cls[ch];
      if (c === 0x7f) {                              // '|' colour / control code
        const code = s[i + 1] ?? '';
        i++;
        if (code === '0') x += 40;
        else if (code in COLOR_CODES) { prevPen = pen; pen = COLOR_CODES[code]; }
        else if (code === 'q') {
          const k = Math.abs(10 - ((style.frame ?? 0) % 20));
          const [b1, b2] = this.assets.tables.blinkColors[k];
          pen = ((b1 >> 3) << 11) | ((b2 >> 2) << 5) | (b1 >> 3);
        } else if (code === 's') pen = prevPen;
        continue;
      }
      if (c === 0x6e) G(7, 11, 45, (ch - 65) * 11, x, y + 1, cm);
      else if (c === 100) G(7, 11, 36, 188 + (ch - 48) * 11, x, y + 1, cm);
      else if (c === 0x78) G(7, 11, 52, (ch - 97) * 11, x, y, cm);
      else if (c === 0x7a) G(7, 11, 52, (ch - 97) * 11, x, y + 2, cm);
      else if (c !== -128) G(9, 11, 59, c * 11, x, y + 1, cm);
      x += 6;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = PAD_H;
    canvas.getContext('2d')!.putImageData(new ImageData(out, width, PAD_H), 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    const r = { texture, width, height: PAD_H };
    if (this.cache.size > 512) {
      for (const v of this.cache.values()) v.texture.dispose();
      this.cache.clear();
    }
    this.cache.set(key, r);
    return r;
  }
}
