// 원정(가제): draws a zone. The main field renderer (render/field.ts) pre-renders the whole map into one texture, too
// big for a 190×160-tile zone; this draws only what is in view each frame: the tiles under the camera, the under-layer
// objects (objBg, objLow) found through a grid of 128 px buckets, then objMid and the actors depth-sorted, then objTop.
import * as THREE from 'three';
import type { Cmf, MapObject } from '../../core/data/assets';
import { VIEW_H, VIEW_W, type Drawable, type Equip } from '../../core/render';
import { actorDepth, depthSort, objDepth, type DepthItem } from '../../core/world/world';
import { objCmf, TILE, type Zone, type ZoneSets } from '../../core/expedition/zone';
import type { GameContext } from '../game/scene';
import { DEFAULT_EQUIP, type SpriteLayer } from '../render/sprites';

const BUCKET = 128;
/** objects reach this far from their anchor (trees, cliffs): the view is widened by it when looking them up */
const REACH = 160;

type Layer = 'objBg' | 'objLow' | 'objMid' | 'objTop';

export class WorldView {
  private readonly V: SpriteLayer;
  /** a second pass over the world (battle units over a darkened field) */
  private readonly V2: SpriteLayer;
  private readonly cam = new THREE.OrthographicCamera(0, VIEW_W, 0, VIEW_H, -1, 1);
  private zone: Zone | null = null;
  private sets: ZoneSets | null = null;
  /** per layer: bucket key -> indices of its objects (in file order) */
  private grid = new Map<Layer, Map<number, number[]>>();
  private cols = 0;

  constructor(private readonly ctx: GameContext) {
    this.V = ctx.compositor.newLayer(ctx.assets);
    this.V2 = ctx.compositor.newLayer(ctx.assets);
  }

  /** load sprites drawn by overlay() */
  async preloadSprites(sprites: { name: string; cmf: Cmf; equip?: Equip }[], extra: string[] = []): Promise<void> {
    const z = this.zone?.map.header.zone ?? 3, names: (string | null)[] = [...extra];
    for (const s of sprites) names.push(...this.V2.allImages(s.name, s.cmf, z, s.equip ?? DEFAULT_EQUIP));
    await Promise.all([this.V2.preload(names), this.V.preload(names)]);
  }

  /** draw sprites (screen coordinates) over what render() left in the target, in the order given */
  overlay(ents: Drawable[]): void {
    const V = this.V2, pad = this.ctx.compositor.pad, z = this.zone?.map.header.zone ?? 3;
    V.clear();
    for (const e of ents) {
      if (e.shadow) { V.fx = null; V.quad('shadow', 120, 0, 36, 20, e.x - 18, e.y - 10, 0, 0, 1, 14); }
      V.fx = e.fx ?? null;
      if (e.cmf) V.frame(e.cmfName, e.cmf, e.frame, e.x, e.y, z, e.equip ?? DEFAULT_EQUIP, e.mirror, e.hideClips, e.scale);
      V.fx = null;
    }
    this.cam.left = -pad; this.cam.right = VIEW_W + pad; this.cam.top = 0; this.cam.bottom = VIEW_H;
    this.cam.updateProjectionMatrix();
    this.ctx.compositor.draw(V, this.cam, VIEW_W + 2 * pad, VIEW_H, undefined, false);
  }

  /** index a zone and load everything it draws, plus the given sprites */
  async prepare(zone: Zone, sets: ZoneSets, sprites: { name: string; cmf: Cmf; equip?: Equip }[]): Promise<void> {
    const m = zone.map, names: (string | null)[] = [`t${m.header.tileset}`, 'shadow'];
    this.cols = Math.ceil((m.header.width * TILE) / BUCKET);
    this.grid.clear();
    for (const L of ['objBg', 'objLow', 'objMid', 'objTop'] as Layer[]) {
      const g = new Map<number, number[]>();
      m[L].forEach((o, i) => {
        const k = Math.floor(o.y / BUCKET) * this.cols + Math.floor(o.x / BUCKET);
        let b = g.get(k);
        if (!b) g.set(k, (b = []));
        b.push(i);
        const [name, cmf, f] = this.objSprite(sets, o.obj);
        names.push(...this.V.frameImages(name, cmf, f, m.header.zone, DEFAULT_EQUIP));
      });
      this.grid.set(L, g);
    }
    for (const s of sprites) names.push(...this.V.allImages(s.name, s.cmf, m.header.zone, s.equip ?? DEFAULT_EQUIP));
    await this.V.preload(names);
    this.zone = zone;
    this.sets = sets;
  }

  private objSprite(sets: ZoneSets, id: number): [string, Cmf, number] {
    const [cmf, f] = objCmf(sets, id);
    return [id < 0 ? 'cmf_oc' : 'cmf_o3', cmf, f];
  }

  /** objects of a layer whose anchor is near the view rect, in file order */
  private near(L: Layer, x0: number, y0: number, x1: number, y1: number): MapObject[] {
    const g = this.grid.get(L)!, out: number[] = [];
    const c0 = Math.max(0, Math.floor((x0 - REACH) / BUCKET)), c1 = Math.floor((x1 + REACH) / BUCKET);
    const r0 = Math.max(0, Math.floor((y0 - REACH) / BUCKET)), r1 = Math.floor((y1 + REACH) / BUCKET);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= Math.min(c1, this.cols - 1); c++) { const b = g.get(r * this.cols + c); if (b) out.push(...b); }
    const list = this.zone!.map[L];
    return out.sort((a, b) => a - b).map((i) => list[i]);
  }

  /** Render the view with its top-left at (camX, camY) into the compositor target; `over` draws on top of objTop
   *  (in map pixels) */
  render(camX: number, camY: number, ents: Drawable[], under?: (V: SpriteLayer) => void, over?: (V: SpriteLayer) => void): void {
    const zone = this.zone, sets = this.sets;
    if (!zone || !sets) return;
    const V = this.V, m = zone.map, z = m.header.zone, pad = this.ctx.compositor.pad;
    camX = Math.round(camX); camY = Math.round(camY);
    const x0 = camX - pad, x1 = camX + VIEW_W + pad, y0 = camY, y1 = camY + VIEW_H;
    V.clear();
    const ts = `t${m.header.tileset}`;
    const c0 = Math.max(0, Math.floor(x0 / TILE)), c1 = Math.min(m.header.width - 1, Math.floor(x1 / TILE));
    const r0 = Math.max(0, Math.floor(y0 / TILE)), r1 = Math.min(m.header.height - 1, Math.floor(y1 / TILE));
    for (let r = r0; r <= r1; r++) {
      const row = m.tiles[r];
      for (let c = c0; c <= c1; c++) {
        const v = row[c];
        if (!v) continue;
        const t = v - 1;
        V.quad(ts, (t & 7) * TILE, (t >> 3) * TILE, TILE, TILE, c * TILE, r * TILE);
      }
    }
    const draw = (o: MapObject) => { const [n, c, f] = this.objSprite(sets, o.obj); V.frame(n, c, f, o.x, o.y, z, DEFAULT_EQUIP); };
    for (const o of this.near('objBg', x0, y0, x1, y1)) draw(o);
    for (const o of this.near('objLow', x0, y0, x1, y1)) draw(o);
    under?.(V);
    const items: DepthItem[] = [
      ...ents.map((e): DepthItem => ({
        key: e.depth ?? (e.cmf ? actorDepth(e.y, e.cmf, e.frame) : e.y), kind: 0,
        draw: () => {
          if (e.shadow) { V.fx = null; V.quad('shadow', 120, 0, 36, 20, e.x - 18, e.y - 10, 0, 0, 1, 14); }
          V.fx = e.fx ?? null;
          if (e.img) V.quad(e.img.name, e.img.sx, e.img.sy, e.img.w, e.img.h, e.x, e.y, 0, 0, 1, e.img.blend ?? 0);
          else if (e.cmf) V.frame(e.cmfName, e.cmf, e.frame, e.x, e.y, z, e.equip ?? DEFAULT_EQUIP, e.mirror, e.hideClips, e.scale);
          V.fx = null;
        },
      })),
      ...this.near('objMid', x0, y0, x1, y1).map((o): DepthItem => {
        const [, c, f] = this.objSprite(sets, o.obj);
        return { key: objDepth(o, c, f), kind: 1, draw: () => draw(o) };
      }),
    ];
    for (const it of depthSort(items)) it.draw();
    for (const o of this.near('objTop', x0, y0, x1, y1)) draw(o);
    over?.(V);
    this.cam.left = x0; this.cam.right = x1; this.cam.top = y0; this.cam.bottom = y1;
    this.cam.updateProjectionMatrix();
    this.ctx.compositor.draw(V, this.cam, VIEW_W + 2 * pad, VIEW_H);
  }

  dispose(): void { this.V.dispose(); this.V2.dispose(); }
}
