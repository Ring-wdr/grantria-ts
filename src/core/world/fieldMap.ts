// A loaded map as the game logic sees it: header, object sets, the mid layer with portal markers and the
// walk layers (FUN_0001da78). The web renderer (src/web/render/field.ts) extends this with drawing.
import type { Assets, Cmf, GameMap, MapObject } from '../data/assets';
import { buildWalk, buildWalkLayers } from './world';

export const TILE = 16;

export class FieldMap {
  map!: GameMap;
  mapId = -1;
  width = 0;
  height = 0;
  protected zone = 0;
  protected objName = '';
  protected ocmf!: Cmf;
  protected ccmf!: Cmf;
  /** objMid plus the portal markers (FUN_00018e6c marker kinds) */
  protected midStatic: MapObject[] = [];
  private walk = new Uint8Array(0);
  /** walk layers 0..3 (layer 0 = walk) */
  private layers: Uint8Array[] = [];

  constructor(protected assets: Assets) {}

  get name(): string {
    return this.assets.text[484 + this.mapId] ?? '';
  }

  /** cmf_oc (common objects: chests, barriers, warp stones, markers) and the zone object cmf */
  get oc(): Cmf { return this.ccmf; }
  get objSet(): [string, Cmf] { return [this.objName, this.ocmf]; }

  protected objCmf(id: number): [string, Cmf, number] {
    return id < 0 ? ['cmf_oc', this.ccmf, -id] : [this.objName, this.ocmf, id];
  }

  /** Load the map data, its object sets and the walk layers. */
  async loadData(mapId: number): Promise<void> {
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
