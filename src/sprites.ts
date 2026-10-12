// Draws cmf frames as textured quads in painter's order, reproducing the original
// software blitter (see analysis/features/assets-graphics.md, tools/grantria_gfx.py blit()).
import * as THREE from 'three';
import type { Assets, Cmf, CmfPart } from './assets';

export type Equip = Record<'w' | 'h' | 'a' | 'p', number>;

export interface SpriteFx {
  tint?: [number, number, number];
  /** tint strength 0..32 */
  amount?: number;
  /** extra opacity 0..32 */
  alpha?: number;
}

export const DEFAULT_EQUIP: Equip = { w: 0, h: 0, a: 0, p: 0 };

/** Image name for a clip: plain image, composed equipment, or zone-dependent object set. */
export function clipImage(
  assets: Assets, cmfName: string, cmf: Cmf, clip: number, zone: number, equip: Equip,
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

const VERT = /* glsl */ `
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
  vec3 c = mix(clamp(t.rgb - shift, 0.0, 1.0), tint, tintAmt);   // day/night palette shift (FUN_0001cf0c)  // hit / death colour effect (FUN_00032800)
  c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), grey);   // SetGray (game over)
  if (mode == 1) gl_FragColor = vec4(c * alpha, 1.0);                       // add / screen
  else if (mode == 2) gl_FragColor = vec4(1.0 - alpha + alpha * c, 1.0);    // multiply
  else gl_FragColor = vec4(c, alpha);                                       // normal
}`;

// Modes that need the destination color in the shader. The compositor copies the frame
// rendered so far into dstTex right before drawing such a quad (see compositor.ts).
const DST_FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D dstTex;
uniform vec2 size;
uniform float grey;
uniform float alpha;
uniform int mode;
varying vec2 vUv;
float ch(float s, float d) {
  if (mode == 13) return min(1.0, s + d);                                  // add
  if (mode == 1) return max(s, d);                                         // lighten
  if (mode == 2) return min(s, d);                                         // darken
  if (mode == 3) return abs(s - d);                                        // difference [추정]
  if (mode == 5) return s >= 1.0 ? 1.0 : min(1.0, d / (1.0 - s));          // color dodge
  if (mode == 6) return d < 0.5 ? 2.0 * s * d : 1.0 - 2.0 * (1.0 - s) * (1.0 - d); // overlay [추정]
  if (mode == 8) return s < 0.5 ? 2.0 * s * d : 1.0 - 2.0 * (1.0 - s) * (1.0 - d); // hard light [추정]
  if (mode == 10 || mode == 15) return clamp(2.0 * s + d - 1.0, 0.0, 1.0); // linear light
  return s;
}
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  vec3 d = texture2D(dstTex, gl_FragCoord.xy / size).rgb;
  vec3 b = vec3(ch(t.r, d.r), ch(t.g, d.g), ch(t.b, d.b));
  vec3 o = mix(d, b, alpha);
  gl_FragColor = vec4(mix(o, vec3(dot(o, vec3(0.299, 0.587, 0.114))), grey), 1.0);
}`;

/** Global grey amount 0..1 for everything drawn while set (FUN_0007a254 SetGray). */
export const greyUniform = { grey: { value: 0 }, shift: { value: new THREE.Vector3(0, 0, 0) } };
/** set the day/night shift from a d+0x26e0c row (dr, dg, db in RGB565 units) */
export function setDayShift(dr: number, dg: number, db: number): void { greyUniform.shift.value.set(dr / 31, dg / 63, db / 31); }

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
 * Original blend mode -> GL blending. Result must equal lerp(dst, blend(src, dst), alpha8/8)
 * (tools/grantria_gfx.py _blend_ch). Fixed-function where exact: normal, screen, multiply,
 * opaque add; everything else reads the destination (null here).
 */
function blendSetup(mode: number, alpha8: number): BlendSetup | null {
  switch (mode) {
    case 0: return NORMAL;
    case 13: return alpha8 === 8 ? { shaderMode: 1, src: THREE.OneFactor, dst: THREE.OneFactor } : null;
    case 4: return { shaderMode: 1, src: THREE.OneMinusDstColorFactor, dst: THREE.OneFactor };
    case 14: return { shaderMode: 2, src: THREE.ZeroFactor, dst: THREE.SrcColorFactor };
    case 1: case 2: case 3: case 5: case 6: case 8: case 10: case 15: return null;
    default: return NORMAL;   // 7, 9, 11, 12: unidentified, drawn as normal like the Python tool
  }
}

export class SpriteLayer {
  readonly group = new THREE.Group();
  private order = 0;
  private textures = new Map<string, THREE.Texture | null>();
  private materials = new Map<string, THREE.ShaderMaterial>();
  /** Colour effect applied to quads drawn while set: tint colour, strength and alpha in 0..32. */
  fx: SpriteFx | null = null;

  constructor(private assets: Assets) {}

  async preload(names: Iterable<string | null>): Promise<void> {
    await Promise.all([...new Set(names)].filter((n): n is string => !!n && !this.textures.has(n))
      .map(async (n) => this.textures.set(n, await this.assets.texture(n))));
  }

  clear(): void {
    for (const m of this.group.children as THREE.Mesh[]) m.geometry.dispose();
    this.group.clear();
    this.order = 0;
  }

  private material(tex: THREE.Texture, blend: number, alpha8: number): THREE.ShaderMaterial {
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
            uniforms: { map: { value: tex }, alpha: { value: alpha }, mode: { value: blend }, ...dstUniforms, ...greyUniform },
            fragmentShader: DST_FRAG,
            blending: THREE.NoBlending,
          });
      m.userData.readsDst = !b;
      this.materials.set(key, m);
    }
    return m;
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
    // source corners TL, TR, BR, BL; destination corner i samples src[(i - rot) mod 4]
    const src = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const rotated = [0, 1, 2, 3].map((i) => src[(i - rot + 4) & 3]);
    const corners = hflip ? [rotated[1], rotated[0], rotated[3], rotated[2]] : rotated;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [x, y, 0, x + dw, y, 0, x + dw, y + dh, 0, x, y + dh, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(corners.flat(), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geo, this.material(tex, blend, alpha8));
    mesh.renderOrder = this.order++;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  /** One cmf part; mirror flips the whole frame around its origin (x -> -x - w, hflip toggled). */
  part(cmf: Cmf, image: string | null, p: CmfPart, ox: number, oy: number, mirror = false): void {
    const c = cmf.clips[p.clip];
    if (!c) return;
    let dx = p.dx;
    if (mirror) dx = -dx - ((p.rot & 1) ? c[3] : c[2]) * p.scale;
    this.quad(image, c[0], c[1], c[2], c[3], ox + dx, oy + p.dy, p.rot, p.hflip ^ (mirror ? 1 : 0), p.scale, p.blend, p.alpha8);
  }

  /** Draw frame fi of a cmf with its origin at (ox, oy). */
  frame(cmfName: string, cmf: Cmf, fi: number, ox: number, oy: number, zone: number, equip: Equip, mirror = false, hideClips?: number[]): void {
    const fr = cmf.frames[fi];
    if (!fr) return;
    for (const p of fr.parts) {
      if (hideClips?.includes(p.clip)) continue;
      this.part(cmf, clipImage(this.assets, cmfName, cmf, p.clip, zone, equip), p, ox, oy, mirror);
    }
  }

  /** Images used by every frame of a cmf (for preloading animated sprites). */
  allImages(cmfName: string, cmf: Cmf, zone: number, equip: Equip): (string | null)[] {
    return cmf.frames.flatMap((_, i) => this.frameImages(cmfName, cmf, i, zone, equip));
  }

  frameImages(cmfName: string, cmf: Cmf, fi: number, zone: number, equip: Equip): (string | null)[] {
    return (cmf.frames[fi]?.parts ?? []).map((p) => clipImage(this.assets, cmfName, cmf, p.clip, zone, equip));
  }
}
