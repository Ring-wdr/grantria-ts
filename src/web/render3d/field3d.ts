// 2.5D field renderer (Arcturus / Ragnarok style): the pre-rendered under-layer of the 2D renderer (tiles, objBg,
// objLow) is laid on a ground mesh, and every sprite (actors, objMid, objTop, effects) stands up as a camera-facing
// card at its foot point. The game keeps its 2D pixel world: world (x, y) -> 3D (X = x, Y = height, Z = y).
//
// Passes: 1. 3D (ground writes depth; sprites test it, never write it, and are drawn far to near so the original
// painter's order holds among them) into a render target with a depth buffer. 2. a screen layer through the 2D
// compositor: the 3D image, then the quads whose blend reads the destination (the RGB565 blitter modes), placed at
// their projected position, then the overlay (warp, aura, banner). The day / night shift and grey are applied once,
// in pass 2, as in 2D.
import * as THREE from 'three';
import type { Cmf, MapObject } from '../../core/data/assets';
import { VIEW_H, VIEW_W, type Drawable } from '../../core/render';
import { ViewAngle } from '../../core/world/view';
import { actorDepth, bodyBox, objDepth } from '../../core/world/world';
import type { WebAssets } from '../assets';
import { Field } from '../render/field';
import type { Compositor } from '../render/compositor';
import { DEFAULT_EQUIP, SpriteLayer, greyUniform } from '../render/sprites';

const TILE = 16;

/** camera settings (degrees; zoom 1 = one world pixel per view pixel at the look-at point) */
export interface CameraSettings {
  /** angle below the horizon */
  pitch: number;
  /** vertical field of view; small keeps sprite sizes even from the top of the screen to the bottom */
  fov: number;
  zoom: number;
  /** internal resolution of the 3D pass as a multiple of the 480x320 view */
  scale: number;
}

export const DEFAULT_CAMERA: CameraSettings = { pitch: 55, fov: 30, zoom: 1, scale: 2 };

/** world units sprites are pulled toward the camera so their feet are not cut by the ground they stand on */
const DEPTH_BIAS = 24;

const GROUND_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }`;

interface Card {
  /** foot point on the ground (world pixels) */
  ax: number;
  ay: number;
  /** view depth of the sort point (larger = farther) */
  depth: number;
  /** 0 = actor, 1 = objMid (actors first on ties, as in 2D), 2 = objTop (after everything) */
  kind: number;
  order: number;
  draw: (L: SpriteLayer) => void;
}

export class Field3D extends Field {
  /** the view angle (the scene shares its own) */
  view3d = new ViewAngle();
  cam: CameraSettings = { ...DEFAULT_CAMERA };
  /** vertex heights, (W + 1) x (H + 1) tile corners; all 0 until map 3D data gives some */
  private heights = new Float32Array(0);
  private hW = 0;
  private hH = 0;
  private rt3d = new THREE.WebGLRenderTarget(1, 1, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, VIEW_W / VIEW_H, 1, 8000);
  private ground: THREE.Mesh;
  private groundMat: THREE.ShaderMaterial;
  private world: SpriteLayer;
  private screen: SpriteLayer;
  private screenCam = new THREE.OrthographicCamera(0, VIEW_W, 0, VIEW_H, -1, 1);
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  /** view pixels per world unit at the look-at distance */
  private pxScale = 1;

  constructor(assets: WebAssets, compositor: Compositor) {
    super(assets, compositor);
    this.rt3d.texture.generateMipmaps = false;
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.mapTarget.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: GROUND_FRAG,
      side: THREE.DoubleSide,
    });
    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), this.groundMat);
    this.ground.frustumCulled = false;
    this.scene.add(this.ground);
    this.world = new SpriteLayer(assets);
    this.world.depthTest = true;
    this.screen = new SpriteLayer(assets);
    this.world.dstSink = this.screen;
    this.scene.add(this.world.mesh);
  }

  override async load(mapId: number): Promise<void> {
    await super.load(mapId);
    const W = this.map.header.width, H = this.map.header.height;
    this.hW = W + 1; this.hH = H + 1;
    this.heights = new Float32Array(this.hW * this.hH);
    this.buildGround();
    await Promise.all([this.world.preload(this.preloadNames()), this.screen.preload(['shadow'])]);
    this.view3d.reset(undefined, 0);
  }

  private preloadNames(): (string | null)[] {
    const m = this.map, names: (string | null)[] = ['shadow', 'i0', 'i1', 'i2', 'i3'];
    for (const o of [...this.midStatic, ...m.objTop]) {
      const [n, c, f] = this.objCmf(o.obj);
      names.push(...this.world.frameImages(n, c, f, this.zone, DEFAULT_EQUIP));
    }
    return names;
  }

  override async preloadImages(names: string[]): Promise<void> {
    await Promise.all([super.preloadImages(names), this.world.preload(names), this.screen.preload(names)]);
  }

  override async preloadSprite(cmfName: string, cmf: Cmf, equip = DEFAULT_EQUIP): Promise<void> {
    const names = this.world.allImages(cmfName, cmf, this.zone, equip);
    await Promise.all([super.preloadSprite(cmfName, cmf, equip), this.world.preload(names), this.screen.preload(names)]);
  }

  override dispose(): void {
    super.dispose();
    this.world.dispose();
    this.screen.dispose();
    this.ground.geometry.dispose();
    this.groundMat.dispose();
    this.rt3d.dispose();
  }

  /** ground height at world pixel (x, y): bilinear over the tile-corner heights */
  heightAt(x: number, y: number): number {
    if (!this.heights.length) return 0;
    const fx = Math.max(0, Math.min(this.hW - 1.001, x / TILE)), fy = Math.max(0, Math.min(this.hH - 1.001, y / TILE));
    const c = Math.floor(fx), r = Math.floor(fy), u = fx - c, v = fy - r, h = this.heights, W = this.hW;
    const a = h[r * W + c], b = h[r * W + c + 1], d = h[(r + 1) * W + c], e = h[(r + 1) * W + c + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
  }

  /** set the tile-corner heights ((W + 1) x (H + 1), row-major) and rebuild the ground */
  setHeights(h: Float32Array): void {
    if (h.length !== this.hW * this.hH) throw new Error(`heights: ${h.length} != ${this.hW}x${this.hH}`);
    this.heights = h;
    this.buildGround();
  }

  /** one quad per tile, sharing corners, UVs into the under-layer target (rows bottom-up) */
  private buildGround(): void {
    const W = this.map.header.width, H = this.map.header.height, CW = W + 1;
    const pos = new Float32Array(CW * (H + 1) * 3), uv = new Float32Array(CW * (H + 1) * 2);
    for (let r = 0; r <= H; r++) for (let c = 0; c <= W; c++) {
      const i = r * CW + c;
      pos[i * 3] = c * TILE; pos[i * 3 + 1] = this.heights[i] ?? 0; pos[i * 3 + 2] = r * TILE;
      uv[i * 2] = c / W; uv[i * 2 + 1] = 1 - r / H;
    }
    const idx = new Uint32Array(W * H * 6);
    let k = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const a = r * CW + c, b = a + 1, d = a + CW, e = d + 1;
      idx.set([a, d, b, b, d, e], k); k += 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.ground.geometry.dispose();
    this.ground.geometry = g;
  }

  /** Place the camera looking at the 2D view's centre from the current yaw and pitch. */
  private aim(camX: number, camY: number): void {
    const { pitch, fov, zoom } = this.cam, width = this.compositor.width;
    const cx = camX + VIEW_W / 2, cy = camY + VIEW_H / 2, h = this.heightAt(cx, cy);
    const dist = VIEW_H / (2 * Math.tan((fov * Math.PI) / 360)) / zoom;
    const yaw = (this.view3d.yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
    const c = this.camera;
    c.fov = fov;
    c.aspect = width / VIEW_H;
    c.near = Math.max(1, dist * 0.1);
    c.far = dist * 6;
    c.position.set(cx - Math.sin(yaw) * Math.cos(p) * dist, h + Math.sin(p) * dist, cy + Math.cos(yaw) * Math.cos(p) * dist);
    c.up.set(0, 1, 0);
    c.lookAt(cx, h, cy);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.right.setFromMatrixColumn(c.matrixWorld, 0).normalize();
    this.up.setFromMatrixColumn(c.matrixWorld, 1).normalize();
    c.getWorldDirection(this.fwd);
    this.pxScale = zoom;
  }

  /** view depth of a ground point */
  private depthOf(x: number, y: number): number {
    return this.tmp.set(x, this.heightAt(x, y), y).sub(this.camera.position).dot(this.fwd);
  }

  override project(x: number, y: number, lift = 0): [number, number] {
    const v = this.tmp.set(x, this.heightAt(x, y), y).addScaledVector(this.up, lift).project(this.camera);
    return [((v.x + 1) / 2) * this.compositor.width - this.compositor.pad, ((1 - v.y) / 2) * VIEW_H];
  }

  /** Stand a card at foot (ax, ay): layer point (px, py) -> anchor + right·(px − ax) − up·(py − ay), on a plane
   *  facing the camera and pulled toward it (scaled back so it projects the same). The sink gets the same quad in
   *  view pixels. */
  private stand(ax: number, ay: number): void {
    const c = this.camera.position, A = new THREE.Vector3(ax, this.heightAt(ax, ay), ay);
    const toCam = c.clone().sub(A), d = toCam.length(), bias = Math.min(DEPTH_BIAS, d * 0.5);
    A.addScaledVector(toCam, bias / d);
    const s = (d - bias) / d, R = this.right, U = this.up;
    this.world.place = (x, y, out, o) => {
      const dx = (x - ax) * s, dy = (ay - y) * s;
      out[o] = A.x + R.x * dx + U.x * dy; out[o + 1] = A.y + R.y * dx + U.y * dy; out[o + 2] = A.z + R.z * dx + U.z * dy;
    };
    const [sx, sy] = this.project(ax, ay), k = this.pxScale * this.camDist() / Math.max(1, this.depthOf(ax, ay));
    this.screen.place = (x, y, out, o) => { out[o] = sx + (x - ax) * k; out[o + 1] = sy + (y - ay) * k; out[o + 2] = 0; };
  }

  /** a decal lying on the ground: layer point (x, y) is the ground point itself, a pixel above it */
  private flat(): void {
    this.world.place = (x, y, out, o) => { out[o] = x; out[o + 1] = this.heightAt(x, y) + 1; out[o + 2] = y; };
  }

  private camDist(): number { return this.depthOf(this.camX + VIEW_W / 2, this.camY + VIEW_H / 2); }

  /** The 3D view of the 2D camera at (camX, camY); see Field.render. overlay draws in view pixels around the
   *  first entity's foot (the player is drawn last: warp, aura, banner follow it). */
  override render(camX: number, camY: number, entities: Drawable[], beforeTop?: (V: SpriteLayer) => void): void {
    this.camX = camX;
    this.camY = camY;
    const gl = this.compositor.gl, width = this.compositor.width, sc = this.cam.scale;
    if (this.rt3d.width !== width * sc || this.rt3d.height !== VIEW_H * sc) this.rt3d.setSize(width * sc, VIEW_H * sc);
    this.aim(camX, camY);

    const W = this.world, S = this.screen;
    W.clear(); S.clear();
    S.place = null;
    S.quad(this.registerRt(), 0, 0, this.rt3d.width, this.rt3d.height, -this.compositor.pad, 0, 0, 0, 1, 0, 8, true, width, VIEW_H);

    const cards: Card[] = [];
    let order = 0;
    for (const e of entities) {
      const key = e.depth ?? (e.cmf ? actorDepth(e.y, e.cmf, e.frame) : e.y);
      cards.push({ ax: e.x, ay: e.img ? key : e.y, depth: this.depthOf(e.x, key), kind: 0, order: order++, draw: (L) => {
        if (e.shadow) { this.flat(); L.fx = null; L.quad('shadow', 120, 0, 36, 20, e.x - 18, e.y - 10, 0, 0, 1, 14); this.stand(e.x, e.img ? key : e.y); }
        L.fx = e.fx ?? null;
        if (e.img) L.quad(e.img.name, e.img.sx, e.img.sy, e.img.w, e.img.h, e.x, e.y, 0, 0, 1, e.img.blend ?? 0);
        else if (e.cmf) L.frame(e.cmfName, e.cmf, e.frame, e.x, e.y, this.zone, e.equip ?? DEFAULT_EQUIP, e.mirror, e.hideClips, e.scale);
        L.fx = null;
      } });
    }
    this.midStatic.forEach((o, i) => {
      const [ax, ay] = this.objFoot(o);
      cards.push({ ax, ay, depth: this.depthOf(ax, ay), kind: 1, order: order++, draw: (L) => this.drawObj(L, o, this.midOffset(i)) });
    });
    for (const o of this.map.objTop) {
      const [ax, ay] = this.objFoot(o);
      cards.push({ ax, ay, depth: this.depthOf(ax, ay), kind: 2, order: order++, draw: (L) => this.drawObj(L, o) });
    }
    // far to near; objTop after everything (as in 2D); actors before objects on ties
    cards.sort((a, b) => (a.kind === 2 ? 1 : 0) - (b.kind === 2 ? 1 : 0) || b.depth - a.depth || a.kind - b.kind || a.order - b.order);
    for (const cd of cards) { this.stand(cd.ax, cd.ay); cd.draw(W); }
    W.place = null;

    if (beforeTop) {                          // in view pixels around the player's foot (the last entity)
      const p = entities[entities.length - 1];
      const [px, py] = p ? this.project(p.x, p.y) : [VIEW_W / 2, VIEW_H / 2];
      const ox = p ? p.x : camX + VIEW_W / 2, oy = p ? p.y : camY + VIEW_H / 2;
      S.place = (x, y, out, o) => { out[o] = px + x - ox; out[o + 1] = py + y - oy; out[o + 2] = 0; };
      beforeTop(S);
      S.place = null;
    }

    // pass 1: the 3D scene without the colour shift (pass 2 applies it to the whole image)
    const shift = greyUniform.shift.value.clone(), grey = greyUniform.grey.value;
    greyUniform.shift.value.set(0, 0, 0); greyUniform.grey.value = 0;
    this.render3d(gl);
    greyUniform.shift.value.copy(shift); greyUniform.grey.value = grey;

    // pass 2: through the compositor, in view pixels
    const pad = this.compositor.pad;
    this.screenCam.left = -pad; this.screenCam.right = VIEW_W + pad; this.screenCam.top = 0; this.screenCam.bottom = VIEW_H;
    this.screenCam.updateProjectionMatrix();
    this.passes = this.compositor.draw(S, this.screenCam, width, VIEW_H) + 1;
  }

  /** foot of a map object: its body box's horizontal centre (origins are top-left) on its depth key row */
  private objFoot(o: MapObject): [number, number] {
    const [, c, f] = this.objCmf(o.obj), [bx, , bw] = bodyBox(c, f).map((v) => (v << 24) >> 24);
    return [bw > 0 ? o.x + bx + (bw >> 1) : o.x, objDepth(o, c, f)];
  }

  private registerRt(): string {
    this.screen.register(this.rt3d.texture);
    return this.rt3d.texture.uuid;
  }

  private render3d(gl: THREE.WebGLRenderer): void {
    const W = this.world, geo = W.mesh.geometry;
    W.sync();
    geo.clearGroups();
    for (let i = 0; i < W.count; i++) {
      const mi = W.matIdx[i], g = geo.groups[geo.groups.length - 1];
      if (g && g.materialIndex === mi && g.start + g.count === i * 6) g.count += 6;
      else geo.addGroup(i * 6, 6, mi);
    }
    W.mesh.visible = W.count > 0;
    W.mesh.renderOrder = 1;                   // after the ground
    const auto = gl.autoClear;
    gl.setRenderTarget(this.rt3d);
    gl.setClearColor(0x000000, 1);
    gl.autoClear = true;
    gl.render(this.scene, this.camera);
    gl.autoClear = auto;
    gl.setRenderTarget(null);
  }

}

/** the 2.5D renderer is the default; `?2d` in the page URL draws the field with the original 2D renderer */
export function use3d(): boolean {
  try { return !new URLSearchParams(globalThis.location?.search ?? '').has('2d'); } catch { return true; }
}
