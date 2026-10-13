// Screen-space UI layer over the field: image blits, text and number fonts in the original
// 480x320 coordinates (text-rendering.md §0, §3; engine.md draw primitives).
// Ui holds the drawing API and the composite widgets built from the primitives; GlUi draws into
// the WebGL compositor (world-space effects), DomUi (domUi.ts) builds HTML elements styled by CSS.
import * as THREE from 'three';
import type { Assets, Cmf } from '../assets';
import type { Compositor } from '../compositor';
import { AVK } from './input';
import { SpriteLayer, DEFAULT_EQUIP, clipImage, type SpriteFx } from '../sprites';
import { TextRenderer, stringWidth, type TextStyle } from '../text';
import { VIEW_H, VIEW_W } from './field';
import type { VNode } from './view';

/** Number font styles of FUN_00078af4: image, glyph size, source of digit d, step. */
const NUMBER_STYLES: Record<number, { img: string; w: number; h: number; sx: (d: number) => number; sy: (d: number) => number; step: number; scale?: number }> = {
  0: { img: 'c', w: 5, h: 7, sx: (d) => 167 + 5 * d, sy: () => 102, step: 4 },
  1: { img: 'f', w: 7, h: 11, sx: () => 36, sy: (d) => 188 + 11 * d, step: 6 },
  2: { img: 't', w: 10, h: 14, sx: (d) => 10 * d, sy: () => 41, step: 10 },
  6: { img: 't', w: 8, h: 11, sx: (d) => 100 + 8 * d, sy: () => 41, step: 8 },
  7: { img: 't', w: 12, h: 18, sx: (d) => 12 * d, sy: () => 104, step: 12 },
  8: { img: 't', w: 16, h: 24, sx: (d) => 16 * d, sy: () => 122, step: 16 },
  9: { img: 't', w: 12, h: 18, sx: (d) => 12 * d, sy: () => 104, step: 20, scale: 2 },
  10: { img: 't', w: 16, h: 24, sx: (d) => 16 * d, sy: () => 122, step: 28, scale: 2 },
};

export type Align = 'left' | 'center' | 'right';

export abstract class Ui {
  /** drawing origin (FUN_0007a07c translate stack) */
  ox = 0;
  oy = 0;
  private stack: [number, number][] = [];
  /** global alpha 0..32 applied to subsequent draws (FUN_0007abd4) */
  alpha = 32;
  /** tappable areas registered while drawing (layer coordinates) */
  hits: { x: number; y: number; w: number; h: number; act: () => number[] | void }[] = [];

  /**
   * zoom = 1.3 gives the overlay layer L1 (popups, game menu, tab screens), which the original
   * shows magnified 1.3x around the screen centre (FUN_00016428).
   */
  constructor(protected assets: Assets, readonly zoom = 1) {}

  abstract init(images: string[]): Promise<void>;

  /** start a drawing pass: origin, alpha and the translate stack are reset */
  begin(): void {
    this.alpha = 32;
    this.ox = this.oy = 0;
    this.stack = [];
  }

  /** Composite the UI onto a cleared target (full-screen menus). */
  abstract endClear(): void;
  /** Composite the UI over the frame already drawn. */
  abstract end(): void;

  /**
   * DrawImage (FUN_000fb1b4 / FUN_000fa3c4 flip / FUN_000f9ec8 flags): flags bit0 hflip,
   * bits2-3 quarter turns clockwise, bits4-7 scale-1, bits8-12 blend, bits13-15 alpha reduction.
   */
  abstract image(name: string, sx: number, sy: number, w: number, h: number, x: number, y: number, flags?: number, fx?: SpriteFx): void;
  /** an arbitrary texture (rows top-down) at (x, y), e.g. the minimap */
  abstract texture(tex: THREE.Texture, w: number, h: number, x: number, y: number): void;
  /** FillRect (FUN_0007a370) with an RGB888 colour at the current alpha. */
  abstract fill(x: number, y: number, w: number, h: number, rgb?: number): void;
  /** DrawString / DrawStringCenter / DrawStringRight (FUN_00078e58 / 78ec4 / 79b98). */
  abstract string(s: string, x: number, y: number, align?: Align, style?: TextStyle): void;

  /**
   * Group the following draws (until groupEnd) so they can be animated together, e.g. a popup
   * opening. cls names the CSS animation; the GL backend ignores groups.
   */
  group(_cls: string, _cx: number, _cy: number, _id = ''): void { /* GL: no-op */ }
  groupEnd(): void { /* GL: no-op */ }

  /** declarative HTML view laid out by CSS in the (x, y, w, h) box (view.ts); DOM only */
  view(_id: string, _x: number, _y: number, _w: number, _h: number, _root: VNode): void { /* GL: no-op */ }

  /** mount a view into a named slot of a view drawn earlier this frame (menu window body); DOM only */
  mount(_slot: string, _id: string, _root: VNode): void { /* GL: no-op */ }

  /** gamepad button hint badge (glyph text) with its top-left at (x, y); DOM only */
  padHint(_glyph: string, _kind: string, _button: string, _x: number, _y: number): void { /* GL: no-op */ }

  /** register a tappable area at local (x, y); act may mutate state and/or return keys to press */
  hit(x: number, y: number, w: number, h: number, act: () => number[] | void): void {
    this.hits.push({ x: x + this.ox, y: y + this.oy, w, h, act });
  }
  /** layer coordinates of a screen point (480×320) */
  toLayer(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - VIEW_W / 2) / this.zoom + VIEW_W / 2, y: (sy - VIEW_H / 2) / this.zoom + VIEW_H / 2 };
  }
  /** topmost hit under a screen point, or null */
  hitAt(sx: number, sy: number): Ui['hits'][number] | null {
    const { x: lx, y: ly } = this.toLayer(sx, sy);
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (lx >= h.x && lx < h.x + h.w && ly >= h.y && ly < h.y + h.h) return h;
    }
    return null;
  }
  /** run the topmost hit under a screen point (480×320); null when none */
  tapAt(sx: number, sy: number): number[] | null {
    const h = this.hitAt(sx, sy);
    return h ? h.act() ?? [] : null;
  }

  push(x: number, y: number): void {
    this.stack.push([this.ox, this.oy]);
    this.ox += x;
    this.oy += y;
  }

  /** FUN_0007a170: origin of the 220x220 dialog box centred on screen (130, 50). */
  pushCenter220(): void {
    this.push((VIEW_W - 220) >> 1, (VIEW_H - 220) >> 1);
  }

  pop(): void {
    [this.ox, this.oy] = this.stack.pop() ?? [0, 0];
  }

  /** FUN_000fb054 window: black / 0x999999 borders, 0x203145 fill at alpha 28, c.pxl corners. */
  window(x: number, y: number, w: number, h: number): void {
    this.fill(x + 5, y, w - 10, 2, 0);
    this.fill(x + 5, y + 2, w - 10, 2, 0x999999);
    this.fill(x + 5, y + h - 2, w - 10, 2, 0);
    this.fill(x + 5, y + h - 4, w - 10, 2, 0x999999);
    this.fill(x, y + 3, 2, h - 10, 0);
    this.fill(x + 2, y + 5, 2, h - 10, 0x999999);
    this.fill(x + w - 2, y + 3, 2, h - 10, 0);
    this.fill(x + w - 4, y + 5, 2, h - 10, 0x999999);
    const a = this.alpha;
    this.alpha = 28;
    this.fill(x + 4, y + 4, w - 8, h - 8, 0x203145);
    this.alpha = 32;
    for (let i = 0; i < 4; i++) this.image('c', 0x68, 0x25, 8, 8, (i % 3 !== 0 ? w - 8 : 0) + x, (i >> 1) * (h - 8) + y, i << 2);
    this.alpha = a;
  }

  /** FUN_000fa0dc popup frame: alpha 24, 0xd5d5d5 outline, black fill, 13x13 corners. */
  popupFrame(x: number, y: number, w: number, h: number): void {
    this.alpha = 24;
    this.fill(x + 1, y + 1, w - 2, 1, 0xd5d5d5);
    this.fill(x + 1, y + h - 2, w - 2, 1, 0xd5d5d5);
    this.fill(x + 1, y + 2, 1, h - 4, 0xd5d5d5);
    this.fill(x + w - 2, y + 2, 1, h - 4, 0xd5d5d5);
    this.fill(x + 5, y, w - 10, 1, 0xd5d5d5);
    this.fill(x + 5, y + h - 1, w - 10, 1, 0xd5d5d5);
    this.fill(x, y + 5, 1, h - 10, 0xd5d5d5);
    this.fill(x + w - 1, y + 5, 1, h - 10, 0xd5d5d5);
    this.fill(x + 2, y + 2, w - 4, h - 4, 0);
    for (let i = 0; i < 4; i++) this.image('c', 0x70, 0x1e, 13, 13, (i % 3 !== 0 ? w - 13 : 0) + x, (i >> 1) * (h - 13) + y, i << 2);
    this.alpha = 32;
  }

  /** FUN_0004b89c rounded glow (each fill blends separately, overlaps get stronger). */
  roundGlow(x: number, y: number, w: number, h: number, r = 2, rgb = 0x8df1f2): void {
    let x6 = x;
    for (let i = 0; i < r; i++) {
      const q = (r - i) ** 2, v = (q + r) * -2;
      this.fill(x + r + q, y + i, w + v, 1, rgb);
      this.fill(x + r + q, y + h - i - 1, w + v, 1, rgb);
      this.fill(x6, q + y + r, 1, h + v, rgb);
      this.fill(x + w - i - 1, q + y + r, 1, h + v, rgb);
      x6++;
    }
    this.fill(x + r, y + r, w - 2 * r, h - 2 * r, rgb);
  }

  /** FUN_0004b980 pulsing selection glow: alpha = 2 * tri(t % 32, 16). */
  glow(x: number, y: number, w: number, h: number, t: number): void {
    if (w < 10 || h < 10) return;
    let k = t % 32;
    if (k > 16) k = 32 - k;
    const a = this.alpha;
    this.alpha = k * 2;
    this.roundGlow(x, y, w, h);
    this.alpha = a;
  }

  /** FUN_0002ee84 slot glow: alpha = tri(t >> 2, 6) << 2. */
  slotGlow(x: number, y: number, w: number, h: number, t: number): void {
    const a = this.alpha;
    this.alpha = tri(t >> 2, 6) << 2;
    this.roundGlow(x, y, w, h);
    this.alpha = a;
  }

  /** Close / back button at C220 (230, y). */
  closeButton(y = 10): void {
    this.pushCenter220();
    this.button(0xe6, y, 0x22, 0x22, 3, 0);
    this.hit(0xe6 - 6, y - 6, 0x22 + 12, 0x22 + 12, () => [AVK.CLR]);
    this.image('c', 0xa4, 0x3a, 0x12, 0x11, 0xec, y + 6);
    this.pop();
  }

  /** FUN_0007ab44 bevelled cell: c1 top/left, c2 bottom/right (corners left empty), fill inside. */
  bevel(x: number, y: number, w: number, h: number, c1: number, fill: number, c2 = c1): void {
    this.fill(x + 1, y + 1, w - 2, h - 2, fill);
    this.fill(x + 1, y, w - 2, 1, c1);
    this.fill(x, y + 1, 1, h - 2, c1);
    this.fill(x + w - 1, y + 1, 1, h - 2, c2);
    this.fill(x + 1, y + h - 1, w - 2, 1, c2);
  }

  /** FUN_00024fdc: effect bank frame id at (x, y) (combat.md §3.9). Clips choose ec / c / oc / t. */
  effect(id: number, x: number, y: number): void {
    const a = this.assets;
    const first = a.d16(0x20cd6 + id * 4), n = a.d16(0x20cd6 + id * 4 + 2);
    for (let i = first; i < first + n; i++) {
      const o = 0x1c1b8 + i * 10;
      const clip = a.d8(o), sdx = (a.d16(o + 2) << 16) >> 16, sdy = (a.d16(o + 4) << 16) >> 16;
      const flags = a.d8(o + 6) | (a.d8(o + 7) << 8);
      const c = 0x24b96 + clip * 4;
      const img = clip <= 0x46 ? 'ec' : clip <= 0x68 ? 'c' : clip <= 0x6c ? 'oc' : 't';
      this.image(img, a.d8(c), a.d8(c + 1), a.d8(c + 2), a.d8(c + 3), x + sdx, y + sdy, flags);
    }
  }

  /** FUN_0002d850 c.pxl sprite frame f (d.dat 0x400de3 + f*4 = {sx, sy, w, h}); centre = FUN_0002d7a0. */
  cSprite(f: number, x: number, y: number, centre = false): void {
    const a = this.assets, o = Math.abs(f) * 4;
    const sx = a.dd(0x400de3, o), sy = a.dd(0x400de3, o + 1), w = a.dd(0x400de3, o + 2), h = a.dd(0x400de3, o + 3);
    if (centre && f >= 0) { x -= w >> 1; y -= h >> 1; }
    this.image('c', sx, sy, w, h, x, y, f < 0 ? 1 : 0);
  }

  /** FUN_0004c768 finger pointer: d.dat 0x400dcb {frame, dx, dy} x 6, i = min(cnt % 12, 5). */
  finger(x: number, y: number, cnt: number): void {
    const i = Math.min(cnt % 12, 5) * 3, a = this.assets;
    this.cSprite(a.dd(0x400dcb, i), x + a.dd(0x400dcb, i + 1), y + a.dd(0x400dcb, i + 2));
  }

  /** FUN_00049f18 t.pxl 5x7 glyphs: g = (s8) d.dat 0x22502[byte] (letters either case 0..25, ':' '/' '+' '-' '*' '#'
   *  '%' '(' ')' '.' '~' 26..36, digits 37..46, space 47), drawn from t(g*5+50, 34); every byte advances 6. Glyphs
   *  past the image width (from '3' on, and space) draw nothing. */
  tfont(s: string, x: number, y: number): void {
    for (const ch of s) {
      const g = (this.assets.d8(0x22502 + (ch.charCodeAt(0) & 0x7f)) << 24) >> 24;
      if (g >= 0 && g * 5 + 55 <= 246) this.image('t', g * 5 + 50, 34, 5, 7, x, y);
      x += 6;
    }
  }

  /** Multi-line text split on '|@' (and wrapped by width), centred or left aligned, 15 px lines. */
  paragraph(s: string, x: number, y: number, maxW: number, align: Align = 'center', lineH = 15, style?: TextStyle): number {
    const lines: string[] = [];
    for (const part of s.split('|@')) {
      let cur = '';
      for (const ch of part) {
        if (stringWidth(cur + ch) > maxW && cur) { lines.push(cur); cur = ch === ' ' ? '' : ch; } else cur += ch;
      }
      lines.push(cur);
    }
    lines.forEach((ln, i) => this.string(ln, x, y + i * lineH, align, style));
    return lines.length;
  }

  /** FUN_0007aadc: rounded fill made of three rects. */
  roundFill(x: number, y: number, w: number, h: number, rgb: number, r: number): void {
    this.fill(x + r, y, w - 2 * r, h, rgb);
    this.fill(x, y + r, r, h - 2 * r, rgb);
    this.fill(x + w - r, y + r, r, h - 2 * r, rgb);
  }

  /** FUN_00049fb4: c.pxl capital font (d.dat 0x3fe826 glyph map, 0x400d07 sx, 0x400d37 widths). */
  cfont(s: string, x: number, y: number, style = 0, fx?: SpriteFx): void {
    const a = this.assets;
    const sy = a.dd(0x400dc7, style * 2), h = a.dd(0x400dc7, style * 2 + 1);
    for (const ch of s) {
      const g = a.dd(0x3fe826, ch.charCodeAt(0) & 255);
      if (g >= 0x80) continue;
      const sx = a.dd(0x400d07, style * 0x60 + g), w = a.dd(0x400d37, style * 0x60 + g);
      this.image('c', sx, style === 0 && ch >= '0' && ch <= '9' ? 0x3d : sy, w, h, x, y, 0, fx);
      x += style === 0 ? w - 1 : w + 1;
    }
  }

  /** FUN_0004a2ac: centred c-font string. */
  cfontCenter(s: string, cx: number, y: number, style = 0, fx?: SpriteFx): void {
    let wsum = 0, n = 0;
    for (const ch of s) {
      const g = this.assets.dd(0x3fe826, ch.charCodeAt(0) & 255);
      if (g < 0x80) { wsum += this.assets.dd(0x400d37, style * 0x60 + g); n++; }
    }
    this.cfont(s, cx - Math.trunc((wsum - n + 1) / 2), y, style, fx);
  }

  /** d.dat slice tables of the 9-slice button (0x4010c8 row by style, 0x4010d2 edge, 0x4010d7 bottom). */
  buttonSlices(style: number, variant: number): { row: number[]; edge: number[]; bot: number[] } {
    const a = this.assets;
    const read = (addr: number, off: number) => Array.from({ length: 5 }, (_, i) => a.dd(addr, off + i));
    const row = read(0x4010c8, style < 3 ? style * 5 : 5), edge = read(0x4010d2, 0), bot = read(0x4010d7, 0);
    for (const arr of [row, edge, bot]) arr[2] += variant * 6;
    return { row, edge, bot };
  }

  /** drawn width of a button (style 1 is fixed, style 2 fits its text) */
  buttonWidth(style: number, w: number, textId?: number): number {
    if (style === 1) return 0x3e;
    if (style === 0) return Math.max(w, 0x14);
    if (style === 2 && textId !== undefined) return stringWidth(this.assets.text[textId] ?? '') + 0x1c;
    return w;
  }

  /** FUN_0004ad90: 9-slice button from t.pxl (d.dat tables 0x4010c8 / 0x4010d2 / 0x4010d7). */
  button(x: number, y: number, w: number, h: number, style: number, variant: number, textId?: number): void {
    const { row, edge, bot } = this.buttonSlices(style, variant);
    const W = this.buttonWidth(style, w, textId);
    const rows = h >= 0x12 ? h - 0x11 : 0;
    const [c0, c1, c2, c3, c4] = row;
    this.image('t', c2, c3, c0, c1, x, y);
    const xr = x - c0 + W;
    this.image('t', c2, c3, c0, c1, xr, y, 1);
    for (let r = 0; r < rows; r++) this.image('t', edge[2], edge[3], edge[0], edge[4], x, y + c1 + r);
    for (let j = 0; j < W - 2 * c0; j++) {
      const xx = x + c0 + j;
      this.image('t', c2 + c0, c3, c4, c1, xx, y);
      for (let r = 0; r < rows; r++) this.image('t', edge[0] + edge[2], edge[3], edge[4], 1, xx, y + c1 + r);
      if (style !== 0) this.image('t', edge[0] + edge[2], edge[3], edge[4], edge[1], xx, y + c1 + rows);
    }
    if (style !== 0) {
      this.image('t', bot[2], bot[3], bot[0], bot[1], xr, y + c1 + rows, 1);
      this.image('t', bot[2], bot[3], bot[0], bot[1], x, y + c1 + rows);
    }
    for (let r = 0; r < rows; r++) this.image('t', edge[2], edge[3], edge[0], edge[4], xr, y + c1 + r, 1);
    if (style !== 0 && style !== 3 && textId !== undefined) this.textId(textId, x + (W >> 1), y + 5, 'center');
  }

  /** Draw a cmf frame (UI animations such as the title logo); image overrides every clip's image. */
  frame(cmfName: string, cmf: Cmf, fi: number, x: number, y: number, image?: string, fx?: SpriteFx): void {
    for (const p of cmf.frames[fi]?.parts ?? []) {
      const c = cmf.clips[p.clip];
      const img = image ?? clipImage(this.assets, cmfName, cmf, p.clip, 0, DEFAULT_EQUIP);
      if (!c || !img) continue;
      const flags = (p.hflip & 1) | ((p.rot & 3) << 2) | (((p.scale - 1) & 15) << 4) | ((p.blend & 31) << 8) | (((8 - p.alpha8) & 7) << 13);
      this.image(img, c[0], c[1], c[2], c[3], x + p.dx, y + p.dy, flags, fx);
    }
  }

  /** text*.dat string by id */
  textOf(id: number): string {
    return this.assets.text[id] ?? '';
  }

  /** FUN_00078e84 width of a text id. */
  width(id: number): number {
    return stringWidth(this.assets.text[id] ?? '');
  }

  /** Text by id from text*.dat. */
  textId(id: number, x: number, y: number, align: Align = 'left', style?: TextStyle): void {
    this.string(this.assets.text[id] ?? '', x, y, align, style);
  }

  /**
   * FUN_00078af4(value, x, y, style, align, minDigits, p7): digits drawn right to left from the
   * computed right edge. align 0 left (x += width), 1 centre (x += width/2), 2 right. The width
   * function (FUN_0004907c) only knows styles 0 and 1, as in the original.
   */
  number(value: number, x: number, y: number, style = 0, align = 0, minDigits = 0, p7 = 0, fx?: SpriteFx): void {
    const st = NUMBER_STYLES[style];
    if (!st) return;
    let v = Math.abs(Math.trunc(value));
    const digits = Math.max(String(v).length, minDigits);
    const base = style === 0 ? 4 * digits : style === 1 ? 8 * digits : 0;
    const w = p7 === 0 ? (style === 0 ? base + 1 : base - 1) : style === 0 ? base + 9 : style === 6 ? base - 1 : base - p7 - 1;
    if (align === 0) x += w; else if (align === 1) x += Math.trunc(w / 2);
    let cx = x + (style === 9 ? 16 : style === 10 ? 24 : style === 0 ? -1 : 1);
    const scale = st.scale ?? 1;
    for (let i = 0; i < digits; i++) {
      cx -= st.step;
      const d = v % 10;
      this.image(st.img, st.sx(d), st.sy(d), st.w, st.h, cx, y, (scale - 1) << 4, fx);
      v = Math.trunc(v / 10);
    }
  }

  /** one digit centred on x (FUN_00078af4 with align 1), as the per-digit damage numbers draw it */
  numberGlyph(d: number, x: number, y: number, style: number, fx?: SpriteFx): void { this.number(d, x, y, style, 1, 0, 0, fx); }
}

/** WebGL backend: quads in painter's order through the compositor (world-space effects). */
export class GlUi extends Ui {
  readonly layer: SpriteLayer;
  readonly text: TextRenderer;
  private cam: THREE.OrthographicCamera;
  private white: THREE.DataTexture;

  constructor(assets: Assets, private compositor: Compositor, zoom = 1) {
    super(assets, zoom);
    const hw = VIEW_W / 2 / zoom, hh = VIEW_H / 2 / zoom;
    this.cam = new THREE.OrthographicCamera(VIEW_W / 2 - hw, VIEW_W / 2 + hw, VIEW_H / 2 - hh, VIEW_H / 2 + hh, -1, 1);
    this.layer = new SpriteLayer(assets);
    this.text = new TextRenderer(assets);
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    this.layer.register(this.white);
  }

  async init(images: string[]): Promise<void> {
    await Promise.all([this.text.init(), this.layer.preload(images)]);
  }

  override begin(): void {
    super.begin();
    this.hits = [];
    this.layer.clear();
  }

  private withAlpha(fn: () => void, fx?: SpriteFx): void {
    this.layer.fx = this.alpha < 32 || fx ? { ...fx, alpha: Math.round(((fx?.alpha ?? 32) * this.alpha) / 32) } : null;
    fn();
    this.layer.fx = null;
  }

  image(name: string, sx: number, sy: number, w: number, h: number, x: number, y: number, flags = 0, fx?: SpriteFx): void {
    if (w <= 0 || h <= 0) return;
    const alpha8 = 8 - ((flags >> 13) & 7);
    x += this.ox; y += this.oy;
    this.withAlpha(() => this.layer.quad(name, sx, sy, w, h, x, y, (flags >> 2) & 3, flags & 1,
      ((flags >> 4) & 15) + 1, (flags >> 8) & 31, alpha8), fx);
  }

  texture(tex: THREE.Texture, w: number, h: number, x: number, y: number): void {
    this.withAlpha(() => this.layer.texture(tex, 0, 0, w, h, x + this.ox, y + this.oy));
  }

  fill(x: number, y: number, w: number, h: number, rgb = 0): void {
    if (w <= 0 || h <= 0) return;
    const tint: [number, number, number] = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
    x += this.ox; y += this.oy;
    this.withAlpha(() => this.layer.quad(this.white.uuid, 0, 0, 1, 1, x, y, 0, 0, 1, 0, 8, false, w, h), { tint, amount: 32 });
  }

  string(s: string, x: number, y: number, align: Align = 'left', style?: TextStyle): void {
    const w = stringWidth(s);
    const x0 = align === 'center' ? x - Math.trunc(w / 2) : align === 'right' ? x - w : x;
    const r = this.text.render(s, style);
    this.withAlpha(() => this.layer.texture(r.texture, 0, 0, r.width, r.height, x0 + this.ox, y + this.oy));
  }

  endClear(): void {
    this.compositor.draw(this.layer.group, this.cam, VIEW_W, VIEW_H, undefined, true);
  }

  end(): void {
    this.compositor.draw(this.layer.group, this.cam, VIEW_W, VIEW_H, undefined, false);
  }
}

/** FUN_00049458 triangle wave. */
export function tri(t: number, n: number): number {
  const r = t % n;
  return r > n >> 1 ? n - r : r;
}
