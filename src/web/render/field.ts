// Field renderer: tiles + objBg + objLow are pre-rendered once per map into a map-sized
// target; every tick the 480x320 view draws that texture, then objMid / portal markers /
// entities depth-sorted (FUN_00063640), then objTop (same order as MapScene / grantria_gfx.py).
import * as THREE from 'three';
import type { Cmf, MapObject } from '../../core/data/assets';
import { VIEW_H, VIEW_W, type Drawable } from '../../core/render';
import { FieldMap, STONE_OBJ } from '../../core/world/fieldMap';
import { actorDepth, depthSort, objDepth, type DepthItem } from '../../core/world/world';
import type { WebAssets } from '../assets';
import { Compositor, createTarget } from './compositor';
import { SpriteLayer, DEFAULT_EQUIP, type Equip } from './sprites';

export { VIEW_H, VIEW_W, type Drawable };
const TILE = 16;

/** FieldMap plus the pre-rendered under-layer and the per-tick view pass. */
export class Field extends FieldMap {
  private mapTarget = createTarget(1, 1);
  private under: SpriteLayer;
  private view: SpriteLayer;
  private mapCam = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
  private viewCam = new THREE.OrthographicCamera(0, VIEW_W, 0, VIEW_H, -1, 1);
  passes = 0;

  constructor(protected override assets: WebAssets, private compositor: Compositor) {
    super(assets);
    this.under = new SpriteLayer(assets);
    this.view = new SpriteLayer(assets);
  }

  /** Load a map and pre-render its static under-layer. */
  async load(mapId: number): Promise<void> {
    await this.loadData(mapId);
    const m = this.map, hd = m.header;
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
    for (const o of [...m.objBg, ...m.objLow]) if (o.obj !== STONE_OBJ) this.drawObj(U, o);   // stones: the scene draws them
    this.mapTarget.setSize(this.width, this.height);
    this.mapCam.right = this.width;
    this.mapCam.bottom = this.height;
    this.mapCam.updateProjectionMatrix();
    this.compositor.draw(U.group, this.mapCam, this.width, this.height, this.mapTarget);
    U.clear();                                        // the tile quads live on in mapTarget: free their buffers now
  }

  /** Free the GPU side (the scene is being replaced: leaving the dimension reloads the save into a new one). */
  dispose(): void {
    this.under.clear();
    this.view.clear();
    this.mapTarget.dispose();
  }

  /** Load plain images drawn through Drawable.img (shadow, icons). */
  async preloadImages(names: string[]): Promise<void> { await this.view.preload(names); }

  /** Make sure every frame of an animated sprite has its textures loaded. */
  async preloadSprite(cmfName: string, cmf: Cmf, equip: Equip = DEFAULT_EQUIP): Promise<void> {
    await this.view.preload(this.view.allImages(cmfName, cmf, this.zone, equip));
  }

  private drawObj(L: SpriteLayer, o: MapObject, off = 0): void {
    const [n, c, f] = this.objCmf(o.obj);
    L.frame(n, c, f + off, o.x, o.y, this.zone, DEFAULT_EQUIP);
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
          if (e.shadow) { V.fx = null; V.quad('shadow', 120, 0, 36, 20, e.x - 18, e.y - 10, 0, 0, 1, 14); }   // multiply
          V.fx = e.fx ?? null;
          if (e.img) V.quad(e.img.name, e.img.sx, e.img.sy, e.img.w, e.img.h, e.x, e.y, 0, 0, 1, e.img.blend ?? 0);
          else if (e.cmf) V.frame(e.cmfName, e.cmf, e.frame, e.x, e.y, this.zone, e.equip ?? DEFAULT_EQUIP, e.mirror, e.hideClips, e.scale);
          V.fx = null;
        },
      })),
      ...this.midStatic.map((o, i): DepthItem => {
        const [, c, f] = this.objCmf(o.obj);
        return { key: objDepth(o, c, f), kind: 1, draw: () => this.drawObj(V, o, this.midOffset(i)) };
      }),
    ];
    for (const it of depthSort(items)) it.draw();
    beforeTop?.(V);                                   // FUN_00024b80 warp / banner, FUN_000250e8 aura: under objTop
    for (const o of this.map.objTop) this.drawObj(V, o);
    // fullscreen: the view reaches pad pixels past both sides of the 480-wide window at camX
    const pad = this.compositor.pad;
    this.viewCam.left = camX - pad;
    this.viewCam.right = camX + VIEW_W + pad;
    this.viewCam.top = camY;
    this.viewCam.bottom = camY + VIEW_H;
    this.viewCam.updateProjectionMatrix();
    this.passes = this.compositor.draw(V.group, this.viewCam, VIEW_W + 2 * pad, VIEW_H);
  }
}
