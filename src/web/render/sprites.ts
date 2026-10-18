// Draws cmf frames as textured quads in painter's order, reproducing the original
// software blitter (see analysis/features/assets-graphics.md, tools/grantria_gfx.py blit()).
import * as THREE from 'three';
import type { Cmf, CmfPart } from '../../core/data/assets';
import type { WebAssets } from '../assets';

import { DEFAULT_EQUIP, type Equip, type SpriteFx } from '../../core/render';

export { DEFAULT_EQUIP, type Equip, type SpriteFx };

/** Image name for a clip: plain image, composed equipment, or zone-dependent object set. */
export function clipImage(
  assets: WebAssets, cmfName: string, cmf: Cmf, clip: number, zone: number, equip: Equip,
): string | null {
  if (cmf.clip_images) {
    const name = cmf.clip_images[clip] ?? null;
    if (name?.startsWith('EQ:')) {
      const [, kind, cls] = name.split(':') as [string, keyof Equip, string];
      return `eq/${kind}${cls}_${equip[kind]}`;
    }
    return name;
  }
  // object set o%d: clip <= split[zone] -> o%d_0, else o%d_1 (d.dat+0x25465)
  const base = cmfName.slice(4);
  return clip <= assets.tables.objSplit[zone] ? `${base}_0` : `${base}_1`;
}

export const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform float alpha;
uniform int mode;
uniform vec3 tint;
uniform float tintAmt;
uniform float grey;
uniform vec3 shift;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;            // colorkey 0xF81F
  vec3 c = clamp(t.rgb - shift, 0.0, 1.0);                      // day/night palette shift (FUN_0001cf0c)
  float L = (c.r * 31.0 * 612.0 + c.g * 63.0 * 601.0 + c.b * 31.0 * 234.0) / 1024.0;
  c = mix(c, vec3(L / 2.0 / 31.0, L / 63.0, L / 2.0 / 31.0), grey);   // SetGray first (L6 = 612 R5 + 601 G6 + 234 B5 >> 10)
  c = mix(c, tint, tintAmt);                                     // then the hit / death tint (FUN_00032800)
  if (mode == 1) gl_FragColor = vec4(c * alpha, 1.0);                       // add / screen
  else if (mode == 2) gl_FragColor = vec4(1.0 - alpha + alpha * c, 1.0);    // multiply
  else gl_FragColor = vec4(c, alpha);                                       // normal
}`;

// Modes that need the destination color in the shader. The compositor copies the frame rendered so far into
// dstTex right before drawing such a quad (see compositor.ts). This is the original blitter FUN_000cfc88 in RGB565
// integers (emulator-checked for every mode, channel and alpha): source palette shift -> grey -> tint (per-channel
// mixes truncated per term), the channel blend B(s, d) of the mode, then the alpha mix — per term for modes 0/10/11/
// 12/15 and for blue, after the sum for red / green of the others — with the blue-channel quirks of modes 1, 2, 9, 10.
export const DST_FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D dstTex;
uniform vec2 size;
uniform float grey;
uniform vec3 shift;
uniform vec3 tint;
uniform float tintAmt;
uniform float a32;
uniform int mode;
varying vec2 vUv;
float fdiv(float x, float y) { float q = floor(x / y); if ((q + 1.0) * y <= x) q += 1.0; else if (q * y > x) q -= 1.0; return q; }   // exact for x < 2^24
float tdiv(float x, float y) { float q = fdiv(abs(x), abs(y)); return ((x < 0.0) != (y < 0.0)) ? -q : q; }
float sh5(float x) { return floor(x / 32.0); }
float mixA(float d, float b, float a) { return sh5(d * (32.0 - a)) + sh5(b * a); }
float mixC(float d, float b, float a) { return sh5(d * (32.0 - a) + b * a); }
float bch(int m, float s, float d, float M) {
  float H = (M + 1.0) * 0.5;
  if (m == 1) return max(s, d);
  if (m == 2) return min(s, d);
  if (m == 3) return abs(s - d);
  if (m == 4) return M - fdiv((M - s) * (M - d), M + 1.0);
  if (m == 5) return s == M ? M : min(M, fdiv(d * d, M - s));
  if (m == 6) return d < H ? fdiv(2.0 * s * d, M) : M - fdiv(2.0 * (M - s) * (M - d), M);
  if (m == 7) return d == 0.0 ? 0.0 : max(0.0, M - fdiv((M - s) * (M - s), d));
  if (m == 8) return s < H ? fdiv(2.0 * s * d, M) : M - fdiv(2.0 * (M - s) * (M - d), M);
  if (m == 9) {
    if (s == M) return M;
    if (s < H) return s == 0.0 ? 0.0 : max(0.0, M - fdiv((M - d) * (M + 1.0), 2.0 * s));
    return min(M, fdiv(d * (M + 1.0), 2.0 * (M - s) + 1.0));
  }
  if (m == 10) return s < H ? clamp(d + 2.0 * s - M, 0.0, M) : min(M, d + 2.0 * (s - H));
  if (m == 11) return s == M ? M : min(M, fdiv(d * (M + 1.0), M - s));
  if (m == 12) return d == M ? M : min(M, fdiv(s * s, M - d));
  if (m == 13) return min(M, s + d);
  if (m == 14) return fdiv(s * d, M);
  if (m == 15) return clamp(2.0 * s + d - M, 0.0, M);
  return s;
}
float rg(int m, float sc, float dc, float M, float k, float a, bool sep) {
  if (m == 5) {
    float Bx = sc == M ? M * k : min(M * k, fdiv(dc * k * dc, M - sc));
    return floor(fdiv(dc * k * (32.0 - a) + Bx * a, 32.0) / k);
  }
  float B = bch(m, sc, dc, M);
  return sep ? mixA(dc, B, a) : mixC(dc, B, a);
}
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;                                    // colorkey 0xF81F
  vec3 M3 = vec3(31.0, 63.0, 31.0);
  vec3 s = floor(clamp(t.rgb - shift, 0.0, 1.0) * M3 + 0.5);   // day / night palette shift
  if (grey > 0.0) {                                          // SetGray: L6 = (612 R5 + 601 G6 + 234 B5) >> 10
    float L = floor((s.r * 612.0 + s.g * 601.0 + s.b * 234.0) / 1024.0);
    vec3 gt = vec3(floor(L / 2.0), L, floor(L / 2.0));
    s = floor(s * (32.0 - grey) / 32.0) + floor(gt * grey / 32.0);
  }
  if (tintAmt > 0.0) s = floor(s * (32.0 - tintAmt) / 32.0) + floor(floor(tint * M3 + 0.5) * tintAmt / 32.0);
  vec3 d = floor(texture2D(dstTex, gl_FragCoord.xy / size).rgb * M3 + 0.5);
  float a = a32;
  int m = mode;
  bool sep = m == 0 || m == 10 || m == 11 || m == 12 || m == 15;
  vec3 o;
  o.r = rg(m, s.r, d.r, 31.0, 2048.0, a, sep);
  o.g = rg(m, s.g, d.g, 63.0, 32.0, a, sep);
  if (m == 1 && s.b < d.b) o.b = d.b;
  else if (m == 2 && s.b > d.b) o.b = d.b;
  else if (m == 9 && s.b >= 16.0 && s.b < 31.0) {             // blue reads the whole 16-bit source pixel (original)
    float s16 = s.r * 2048.0 + s.g * 32.0 + s.b;
    float q = min(31.0, tdiv(d.b * 32.0, 63.0 - 2.0 * s16));
    o.b = mod(sh5(d.b * (32.0 - a)) + sh5(q * a), 32.0);
  } else if (m == 10 && s.b >= 16.0) {                        // blue upper half unclamped; its bit 5 goes into green
    float braw = d.b + 2.0 * (s.b - 16.0);
    o.b = mixA(d.b, mod(braw, 32.0), a);
    if (braw >= 32.0) { float Bg = bch(10, s.g, d.g, 63.0); if (mod(Bg, 2.0) == 0.0) Bg += 1.0; o.g = mixA(d.g, Bg, a); }
  } else o.b = mixA(d.b, bch(m, s.b, d.b, 31.0), a);
  gl_FragColor = vec4(o / M3, 1.0);
}`;

/** FUN_0007ac0c: nearest-neighbour zoom of everything drawn so far by k/256 around the target's centre (W/2, H/2):
 *  dst(x, y) = src(cx - tdiv((cx - x)·256, k), cy - tdiv((cy - y)·256, k)), rows counted from the top */
export const ZOOM_FRAG = /* glsl */ `
uniform sampler2D dstTex;
uniform vec2 size;
uniform float k;
float fdiv(float x, float y) { float q = floor(x / y); if ((q + 1.0) * y <= x) q += 1.0; else if (q * y > x) q -= 1.0; return q; }
float tdiv(float x, float y) { float q = fdiv(abs(x), abs(y)); return ((x < 0.0) != (y < 0.0)) ? -q : q; }
void main() {
  vec2 p = floor(gl_FragCoord.xy);
  float top = size.y - 1.0 - p.y;
  vec2 c = floor(size * 0.5);
  float qx = c.x - tdiv((c.x - p.x) * 256.0, k);
  float qy = c.y - tdiv((c.y - top) * 256.0, k);
  gl_FragColor = vec4(texture2D(dstTex, vec2(qx + 0.5, size.y - 1.0 - qy + 0.5) / size).rgb, 1.0);
}`;

/** Global grey amount 0..1 for everything drawn while set (FUN_0007a254 SetGray). */
export const greyUniform = { grey: { value: 0 }, shift: { value: new THREE.Vector3(0, 0, 0) } };
/** the same grey in the original's 0..32 steps for the RGB565 shader (kept in sync by setGrey) */
const greyAmt = { value: 0 };
/** SetGray amount 0..1 for both shader paths */
export function setGrey(v: number): void { greyUniform.grey.value = v; greyAmt.value = Math.round(v * 32); }
/** set the day/night shift from a d+0x26e0c row (dr, dg, db in RGB565 units) */
export function setDayShift(dr: number, dg: number, db: number): void { greyUniform.shift.value.set(dr / 31, dg / 63, db / 31); }
/** black through the current day/night shift and grey (FRAG), as 0xRRGGBB: the field outside the map */
export function shiftedBlack(): number {
  const s = greyUniform.shift.value, k = greyUniform.grey.value;
  const c = [Math.max(0, Math.min(1, -s.x)), Math.max(0, Math.min(1, -s.y)), Math.max(0, Math.min(1, -s.z))];
  const L = (c[0] * 31 * 612 + c[1] * 63 * 601 + c[2] * 31 * 234) / 1024;
  const g = [L / 2 / 31, L / 63, L / 2 / 31];
  return c.reduce((v, x, i) => (v << 8) | Math.round((x + (g[i] - x) * k) * 255), 0);
}

/** Shared destination snapshot, owned by the compositor. */
export const dstUniforms = {
  dstTex: { value: null as THREE.Texture | null },
  size: { value: new THREE.Vector2(1, 1) },
};

interface BlendSetup {
  shaderMode: number;
  src: THREE.BlendingSrcFactor;
  dst: THREE.BlendingDstFactor;
}

const NORMAL: BlendSetup = { shaderMode: 0, src: THREE.SrcAlphaFactor, dst: THREE.OneMinusSrcAlphaFactor };

/**
 * Original blend mode -> GL blending. Fixed-function for the common modes whose GL result is within 1 LSB of the
 * original (normal, screen, multiply, opaque add); everything else runs the RGB565 blitter in DST_FRAG (null here).
 */
function blendSetup(mode: number, alpha8: number): BlendSetup | null {
  switch (mode) {
    case 0: return NORMAL;
    case 13: return alpha8 === 8 ? { shaderMode: 1, src: THREE.OneFactor, dst: THREE.OneFactor } : null;
    case 4: return { shaderMode: 1, src: THREE.OneMinusDstColorFactor, dst: THREE.OneFactor };
    case 14: return { shaderMode: 2, src: THREE.ZeroFactor, dst: THREE.SrcColorFactor };
    case 1: case 2: case 3: case 5: case 6: case 7: case 8: case 9: case 10: case 11: case 12: case 15: return null;
    default: return null;     // modes > 15 skip the pixel; the shader draws nothing for them
  }
}

/** Images used by every frame of a cmf (for preloading animated sprites). */
export function cmfImages(assets: WebAssets, cmfName: string, cmf: Cmf, zone: number, equip: Equip): (string | null)[] {
  return cmf.frames.flatMap((fr) => fr.parts.map((p) => clipImage(assets, cmfName, cmf, p.clip, zone, equip)));
}

/**
 * Quads recorded in painter's order into one dynamic vertex buffer per layer (corners TL, TR, BR, BL; z stays 0).
 * The compositor draws runs of consecutive quads that share a material as one draw call (geometry groups of mesh).
 */
export class SpriteLayer {
  /** quads recorded since clear() */
  count = 0;
  /** per quad: its material, an index into mats */
  matIdx = new Uint16Array(0);
  /** per quad: the destination rect x0, y0, x1, y1 in layer units (the compositor's overlap test for blends reading
   *  the destination) */
  rects = new Float32Array(0);
  /** the materials used since clear(); also the material array of mesh */
  readonly mats: THREE.ShaderMaterial[] = [];
  readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mats);
  private slots = new Map<THREE.ShaderMaterial, number>();
  private pos = new Float32Array(0);
  private uv = new Float32Array(0);
  private cap = 0;
  private textures = new Map<string, THREE.Texture | null>();
  private materials = new Map<string, THREE.ShaderMaterial>();
  private zoomMats = new Map<number, THREE.ShaderMaterial>();
  /** Colour effect applied to quads drawn while set: tint colour, strength and alpha in 0..32. */
  fx: SpriteFx | null = null;

  private assets: WebAssets;
  constructor(assets: WebAssets) {
    this.assets = assets;
    this.mesh.frustumCulled = false;
  }

  async preload(names: Iterable<string | null>): Promise<void> {
    await Promise.all([...new Set(names)].filter((n): n is string => !!n && !this.textures.has(n))
      .map(async (n) => this.textures.set(n, await this.assets.texture(n))));
  }

  clear(): void {
    this.count = 0;
    this.mats.length = 0;
    this.slots.clear();
  }

  /** clear() and free the vertex buffers (they are allocated again on the next quad) */
  dispose(): void {
    this.clear();
    this.mesh.geometry.dispose();
    this.cap = 0;
    this.pos = this.uv = this.rects = new Float32Array(0);
    this.matIdx = new Uint16Array(0);
  }

  /** Mark the recorded part of the vertex buffers for upload (before drawing). */
  sync(): void {
    if (!this.count) return;
    const g = this.mesh.geometry;
    for (const [name, n] of [['position', 12], ['uv', 8]] as const) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * n);
      a.needsUpdate = true;
    }
  }

  private grow(): void {
    const cap = Math.max(256, this.cap * 2);
    const pos = new Float32Array(cap * 12), uv = new Float32Array(cap * 8), rects = new Float32Array(cap * 4), matIdx = new Uint16Array(cap);
    pos.set(this.pos); uv.set(this.uv); rects.set(this.rects); matIdx.set(this.matIdx);
    const index = cap * 4 > 0x10000 ? new Uint32Array(cap * 6) : new Uint16Array(cap * 6);
    for (let k = 0; k < cap; k++) index.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    this.cap = cap; this.pos = pos; this.uv = uv; this.rects = rects; this.matIdx = matIdx;
  }

  /** Append a quad covering (x0, y0)-(x1, y1) drawn with mat; returns its index (texture coordinates are the caller's). */
  private add(mat: THREE.ShaderMaterial, x0: number, y0: number, x1: number, y1: number): number {
    if (this.count === this.cap) this.grow();
    let s = this.slots.get(mat);
    if (s === undefined) {
      s = this.mats.length;
      this.mats.push(mat);
      this.slots.set(mat, s);
    }
    const k = this.count++, p = this.pos, o = k * 12, r = this.rects;
    this.matIdx[k] = s;
    p[o] = x0; p[o + 1] = y0; p[o + 3] = x1; p[o + 4] = y0; p[o + 6] = x1; p[o + 7] = y1; p[o + 9] = x0; p[o + 10] = y1;
    r[k * 4] = Math.min(x0, x1); r[k * 4 + 1] = Math.min(y0, y1); r[k * 4 + 2] = Math.max(x0, x1); r[k * 4 + 3] = Math.max(y0, y1);
    return k;
  }

  protected material(tex: THREE.Texture, blend: number, alpha8: number): THREE.ShaderMaterial {
    const fx = this.fx;
    const amt = fx?.amount ?? 0, a32 = fx?.alpha ?? 32, tint = fx?.tint ?? [0, 0, 0];
    const key = `${tex.uuid}|${blend}|${alpha8}|${tint.join(',')}|${amt}|${a32}`;
    let m = this.materials.get(key);
    if (!m) {
      const alpha = (alpha8 / 8) * (a32 / 32);
      const b = blendSetup(blend, alpha8 === 8 && a32 === 32 ? 8 : 0);
      const fxUniforms = {
        tint: { value: new THREE.Vector3(tint[0] / 255, tint[1] / 255, tint[2] / 255) },
        tintAmt: { value: amt / 32 },
      };
      const common = { vertexShader: VERT, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide };
      m = b
        ? new THREE.ShaderMaterial({
            ...common,
            uniforms: { map: { value: tex }, alpha: { value: alpha }, mode: { value: b.shaderMode }, ...fxUniforms, ...greyUniform },
            fragmentShader: FRAG,
            blending: THREE.CustomBlending,
            blendSrc: b.src,
            blendDst: b.dst,
            blendEquation: THREE.AddEquation,
            // keep the destination alpha (the frame buffer is opaque)
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
            blendEquationAlpha: THREE.AddEquation,
          })
        : new THREE.ShaderMaterial({
            ...common,
            uniforms: {
              map: { value: tex }, mode: { value: blend }, a32: { value: Math.floor((alpha8 * a32) / 8) }, ...dstUniforms,
              grey: greyAmt, shift: greyUniform.shift, tint: fxUniforms.tint, tintAmt: { value: amt },
            },
            fragmentShader: DST_FRAG,
            blending: THREE.NoBlending,
          });
      m.userData.readsDst = !b;
      this.materials.set(key, m);
    }
    return m;
  }

  /** A zoom pass (FUN_0007ac0c) over the rect covering the whole target, at this point of the draw order. */
  zoom(x: number, y: number, w: number, h: number, k: number): void {
    let m = this.zoomMats.get(k);
    if (!m) {
      m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: ZOOM_FRAG, uniforms: { ...dstUniforms, k: { value: k } },
        blending: THREE.NoBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      // it samples the snapshot away from its own pixels: it needs one taken right before it
      m.userData.readsDst = m.userData.readsAll = true;
      this.zoomMats.set(k, m);
    }
    const q = this.add(m, x, y, x + w, y + h) * 8, t = this.uv;
    t[q] = 0; t[q + 1] = 0; t[q + 2] = 1; t[q + 3] = 0; t[q + 4] = 1; t[q + 5] = 1; t[q + 6] = 0; t[q + 7] = 1;
  }

  /** Make an arbitrary texture drawable by quad(tex.uuid, ...). */
  register(tex: THREE.Texture): void {
    this.textures.set(tex.uuid, tex);
  }

  /** Draw a sub-rect of an arbitrary texture (rows top-down, e.g. rendered text) at (x, y). */
  texture(tex: THREE.Texture, sx: number, sy: number, w: number, h: number, x: number, y: number): void {
    this.textures.set(tex.uuid, tex);
    this.quad(tex.uuid, sx, sy, w, h, x, y);
  }

  /** Draw a render-target texture (rows bottom-up) 1:1 at (x, y). */
  target(tex: THREE.Texture, w: number, h: number, x = 0, y = 0): void {
    this.textures.set(tex.uuid, tex);
    this.quad(tex.uuid, 0, 0, w, h, x, y, 0, 0, 1, 0, 8, true);
  }

  /** One textured quad; rot = quarter turns clockwise, applied before hflip, then integer scale. */
  quad(name: string | null, sx: number, sy: number, w: number, h: number, x: number, y: number,
    rot = 0, hflip = 0, scale = 1, blend = 0, alpha8 = 8, bottomUp = false, drawW?: number, drawH?: number): void {
    const tex = name ? this.textures.get(name) : null;
    if (!tex) return;
    const img = tex.image as { width: number; height: number };
    const dw = drawW ?? ((rot & 1) ? h : w) * scale;
    const dh = drawH ?? ((rot & 1) ? w : h) * scale;
    const u0 = sx / img.width, u1 = (sx + w) / img.width;
    let v0 = sy / img.height, v1 = (sy + h) / img.height;
    if (bottomUp) [v0, v1] = [1 - v0, 1 - v1];
    this.emit(this.material(tex, blend, alpha8), x, y, dw, dh, u0, v0, u1, v1, rot, hflip);
  }

  /** Record one quad of quad() (legacy/sprites.ts: one mesh each, as 0.1.7). */
  protected emit(mat: THREE.ShaderMaterial, x: number, y: number, dw: number, dh: number,
    u0: number, v0: number, u1: number, v1: number, rot: number, hflip: number): void {
    const q = this.add(mat, x, y, x + dw, y + dh) * 8, t = this.uv;
    // source corners TL, TR, BR, BL; destination corner i samples src[(i - rot) mod 4], hflip swaps TL/TR and BL/BR
    for (let i = 0; i < 4; i++) {
      const s = ((hflip ? i ^ 1 : i) - rot + 4) & 3;
      t[q + i * 2] = s === 1 || s === 2 ? u1 : u0;
      t[q + i * 2 + 1] = s < 2 ? v0 : v1;
    }
  }

  /** One cmf part; mirror flips the whole frame around its origin (x -> -x - w, hflip toggled). */
  part(cmf: Cmf, image: string | null, p: CmfPart, ox: number, oy: number, mirror = false, s = 1): void {
    const c = cmf.clips[p.clip];
    if (!c) return;
    let dx = p.dx * s;
    if (mirror) dx = -dx - ((p.rot & 1) ? c[3] : c[2]) * p.scale * s;
    this.quad(image, c[0], c[1], c[2], c[3], ox + dx, oy + p.dy * s, p.rot, p.hflip ^ (mirror ? 1 : 0), p.scale * s, p.blend, p.alpha8);
  }

  /** Draw frame fi of a cmf with its origin at (ox, oy). */
  frame(cmfName: string, cmf: Cmf, fi: number, ox: number, oy: number, zone: number, equip: Equip, mirror = false, hideClips?: number[], s = 1): void {
    const fr = cmf.frames[fi];
    if (!fr) return;
    for (const p of fr.parts) {
      if (hideClips?.includes(p.clip)) continue;
      this.part(cmf, clipImage(this.assets, cmfName, cmf, p.clip, zone, equip), p, ox, oy, mirror, s);
    }
  }

  /** Images used by every frame of a cmf (for preloading animated sprites). */
  allImages(cmfName: string, cmf: Cmf, zone: number, equip: Equip): (string | null)[] {
    return cmfImages(this.assets, cmfName, cmf, zone, equip);
  }

  frameImages(cmfName: string, cmf: Cmf, fi: number, zone: number, equip: Equip): (string | null)[] {
    return (cmf.frames[fi]?.parts ?? []).map((p) => clipImage(this.assets, cmfName, cmf, p.clip, zone, equip));
  }
}
