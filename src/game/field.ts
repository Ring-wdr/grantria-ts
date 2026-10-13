// Field renderer: tiles + objBg + objLow are pre-rendered once per map into a map-sized
// target; every tick the 480x320 view draws that texture, then objMid / portal markers /
// entities depth-sorted (FUN_00063640), then objTop (same order as MapScene / grantria_gfx.py).
import * as THREE from 'three';
import type { Assets, Cmf, GameMap, MapObject } from '../assets';
import { Compositor, createTarget } from '../compositor';
import { SpriteLayer, DEFAULT_EQUIP, type Equip, type SpriteFx } from '../sprites';
import { actorDepth, buildWalk, buildWalkLayers, depthSort, objDepth, type DepthItem } from '../world';

export const VIEW_W = 480;
export const VIEW_H = 320;
const TILE = 16;

/** Something drawn in the y-sorted mid layer. */
export interface Drawable {
  cmfName: string;
  /** absent for image drawables */
  cmf?: Cmf;
  frame: number;
  x: number;
  y: number;
  mirror?: boolean;
  equip?: Equip;
  /** depth key; defaults to y + body box dy of the frame */
  depth?: number;
  /** tint / fade */
  fx?: SpriteFx;
  /** parts skipped by clip number (PART_HIDE, FUN_00021fc8) */
  hideClips?: number[];
  /** whole-frame scale around the origin (+0x8c, FUN_00030cec) */
  scale?: number;
  /** draw a plain image rect at (x, y) instead of a cmf frame (ground items) */
  img?: { name: string; sx: number; sy: number; w: number; h: number; blend?: number };
}

export class Field {
  map!: GameMap;
  mapId = -1;
  width = 0;
  height = 0;
  private zone = 0;
  private objName = '';
  private ocmf!: Cmf;
  private ccmf!: Cmf;
  private midStatic: MapObject[] = [];
  private walk = new Uint8Array(0);
  /** walk layers 0..3 (layer 0 = walk) */
  private layers: Uint8Array[] = [];
  private mapTarget = createTarget(1, 1);
  private under: SpriteLayer;
  private view: SpriteLayer;
  private mapCam = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
  private viewCam = new THREE.OrthographicCamera(0, VIEW_W, 0, VIEW_H, -1, 1);
  passes = 0;

  constructor(private assets: Assets, private compositor: Compositor) {
    this.under = new SpriteLayer(assets);
    this.view = new SpriteLayer(assets);
  }

  get name(): string {
    return this.assets.text[484 + this.mapId] ?? '';
  }

  /** cmf_oc (common objects: chests, barriers, warp stones, markers) and the zone object cmf */
  get oc(): Cmf { return this.ccmf; }
  get objSet(): [string, Cmf] { return [this.objName, this.ocmf]; }

  private objCmf(id: number): [string, Cmf, number] {
    return id < 0 ? ['cmf_oc', this.ccmf, -id] : [this.objName, this.ocmf, id];
  }

  /** Load a map and pre-render its static under-layer. */
  async load(mapId: number): Promise<void> {
    const a = this.assets;
    const m = await a.map(mapId);
    const hd = m.header;
    this.map = m;
    this.mapId = mapId;
    this.width = hd.width * TILE;
    this.height = hd.height * TILE;
    this.zone = hd.zone;
    this.objName = `cmf_o${hd.objset}`;
    [this.ocmf, this.ccmf] = await Promise.all([a.cmf(this.objName), a.cmf('cmf_oc')]);

    // portal markers join the mid layer (FUN_00018e6c marker kinds)
    this.midStatic = [...m.objMid];
    for (const pt of m.portals) {
      if (!pt.rects.length) continue;
      const r0 = pt.rects[0], r1 = pt.rects[pt.rects.length - 1];
      const id = a.tables.portalMarkerIds[String(pt.target < 256 ? a.tables.portalMarker[pt.target] : 0)];
      if (id === undefined) continue;
      this.midStatic.push({
        obj: id,
        x: (((r1.cx1 + 1) * TILE - r0.cx0 * TILE) >> 1) + r0.cx0 * TILE - 5,
        y: r0.cy0 * TILE - 20 + (((r1.cy1 + 1) * TILE - r0.cy0 * TILE) >> 1),
      });
    }

    this.walk = buildWalk(m, (id) => { const [, c, f] = this.objCmf(id); return [c, f]; });
    this.layers = buildWalkLayers(m, this.walk);

    const names: (string | null)[] = [`t${hd.tileset}`];
    for (const o of [...m.objBg, ...m.objLow, ...this.midStatic, ...m.objTop]) {
      const [n, c, f] = this.objCmf(o.obj);
      names.push(...this.under.frameImages(n, c, f, this.zone, DEFAULT_EQUIP));
    }
    await Promise.all([this.under.preload(names), this.view.preload([...names, 'i0', 'i1', 'i2', 'i3'])]);

    const U = this.under;
    U.clear();
    m.tiles.forEach((row, r) => row.forEach((v, c) => {
      if (!v) return;
      const t = v - 1;
      U.quad(`t${hd.tileset}`, (t & 7) * TILE, (t >> 3) * TILE, TILE, TILE, c * TILE, r * TILE);
    }));
    for (const o of [...m.objBg, ...m.objLow]) this.drawObj(U, o);
    this.mapTarget.setSize(this.width, this.height);
    this.mapCam.right = this.width;
    this.mapCam.bottom = this.height;
    this.mapCam.updateProjectionMatrix();
    this.compositor.draw(U.group, this.mapCam, this.width, this.height, this.mapTarget);
  }

  /** Load plain images drawn through Drawable.img (shadow, icons). */
  async preloadImages(names: string[]): Promise<void> { await this.view.preload(names); }

  /** Make sure every frame of an animated sprite has its textures loaded. */
  async preloadSprite(cmfName: string, cmf: Cmf, equip: Equip = DEFAULT_EQUIP): Promise<void> {
    await this.view.preload(this.view.allImages(cmfName, cmf, this.zone, equip));
  }

  private drawObj(L: SpriteLayer, o: MapObject): void {
    const [n, c, f] = this.objCmf(o.obj);
    L.frame(n, c, f, o.x, o.y, this.zone, DEFAULT_EQUIP);
  }

  /** Render the view with its top-left corner at world (camX, camY) into the compositor target
   * (call compositor.show() after any UI passes). */
  render(camX: number, camY: number, entities: Drawable[], beforeTop?: (V: SpriteLayer) => void): void {
    const V = this.view;
    V.clear();
    V.target(this.mapTarget.texture, this.width, this.height);
    // entities are given in insertion order (descending actor index, player last)
    const items: DepthItem[] = [
      ...entities.map((e): DepthItem => ({
        key: e.depth ?? (e.cmf ? actorDepth(e.y, e.cmf, e.frame) : e.y), kind: 0,
        draw: () => {
          V.fx = e.fx ?? null;
          if (e.img) V.quad(e.img.name, e.img.sx, e.img.sy, e.img.w, e.img.h, e.x, e.y, 0, 0, 1, e.img.blend ?? 0);
          else if (e.cmf) V.frame(e.cmfName, e.cmf, e.frame, e.x, e.y, this.zone, e.equip ?? DEFAULT_EQUIP, e.mirror, e.hideClips, e.scale);
          V.fx = null;
        },
      })),
      ...this.midStatic.map((o): DepthItem => {
        const [, c, f] = this.objCmf(o.obj);
        return { key: objDepth(o, c, f), kind: 1, draw: () => this.drawObj(V, o) };
      }),
    ];
    for (const it of depthSort(items)) it.draw();
    beforeTop?.(V);                                   // FUN_00024b80 warp / banner, FUN_000250e8 aura: under objTop
    for (const o of this.map.objTop) this.drawObj(V, o);
    this.viewCam.left = camX;
    this.viewCam.right = camX + VIEW_W;
    this.viewCam.top = camY;
    this.viewCam.bottom = camY + VIEW_H;
    this.viewCam.updateProjectionMatrix();
    this.passes = this.compositor.draw(V.group, this.viewCam, VIEW_W, VIEW_H);
  }

  /** Walk layer 0 (file bits + stamped object boxes): 1 = passable; outside the map is blocked. */
  walkCell(c: number, r: number): boolean {
    const W = this.map.header.width;
    return r >= 0 && c >= 0 && r < this.map.header.height && c < W && this.walk[r * W + c] === 1;
  }

  /** walk layer 0 by linear index r*W + c (rows run into each other like the original bitmap); outside is 0 */
  walkAt(i: number): number { return i >= 0 && i < this.walk.length && this.walk[i] === 1 ? 1 : 0; }

  /** walk layer k (buildWalkLayers): 1 = set; outside the map is not set */
  walkLayer(k: number, c: number, r: number): boolean {
    const W = this.map.header.width;
    return r >= 0 && c >= 0 && r < this.map.header.height && c < W && this.layers[k]?.[r * W + c] === 1;
  }
}
