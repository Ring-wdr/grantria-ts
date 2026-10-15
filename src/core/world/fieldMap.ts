// A loaded map as the game logic sees it: header, object sets, the mid layer with portal markers and the
// walk layers (FUN_0001da78). The web renderer (src/web/render/field.ts) extends this with drawing.
import type { Assets, Cmf, GameMap, MapObject } from '../data/assets';
import { buildWalk, buildWalkLayers } from './world';

export const TILE = 16;
/** warp stone object id in objLow (cmf_oc frame 35, unlit) */
export const STONE_OBJ = -35;

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
  /** animation of each midStatic entry (FUN_00018e6c record +6 / +8): length (0 = still) and counter */
  private midAnim: { len: number; cnt: number }[] = [];
  private walk = new Uint8Array(0);
  /** walk layers 0..3 (layer 0 = walk) */
  private layers: Uint8Array[] = [];
  /** story event-done lookup for the map-object rules below (set by the scene; nothing done by default) */
  storyDone: (e: number) => boolean = () => false;

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
    const a = this.assets, done = this.storyDone;
    let m = await a.map(mapId);
    // FUN_0003357c: after event 0x5d the wind barrier's slot on 0xd0 (the canyon bridge) draws the broken barrier 0x3f
    // at (188, 183) instead (a copy: the cached map stays as loaded)
    if (mapId === 0xd0 && done(0x5d)) m = { ...m, objLow: m.objLow.map((o) => (o.obj === 0x15 ? { ...o, obj: 0x3f, x: 188, y: 183 } : o)) };
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

    // the portal markers are 8-frame loops (the bob is in cmf_oc frames 112..143) starting at FUN_000f8490(3)
    this.midAnim = this.midStatic.map((_, i) => i < m.objMid.length ? { len: 0, cnt: 0 } : { len: 8, cnt: Math.floor(Math.random() * 3) });

    // FUN_0001da78: the wind barrier (object 0x15) of 0xd0 stops blocking once event 0x5c is done (the crystal piece is
    // brought), and object 5 of 0xad once event 0x61 is done
    const open = (o: MapObject) => (mapId === 0xd0 && o.obj === 0x15 && done(0x5c)) || (mapId === 0xad && o.obj === 5 && done(0x61));
    this.walk = buildWalk(m, (id) => { const [, c, f] = this.objCmf(id); return [c, f]; }, open);
    this.layers = buildWalkLayers(m, this.walk);
  }

  /** FUN_00063640, once per field frame: step the object animation counters */
  animateObjects(): void {
    for (const a of this.midAnim) if (a.len) { const c = a.cnt++; if (c % a.len === a.len - 1) a.cnt = 0; }
  }

  /** frame offset of midStatic[i] this frame (FUN_00032800: counter % length) */
  protected midOffset(i: number): number { const a = this.midAnim[i]; return a?.len ? a.cnt % a.len : 0; }

  /** warp stones (objLow id −35 = oc 35): drawn by the scene as oc 35 or the lit oc 36, never both (gimmicks.md §4.1) */
  stoneObjs(): MapObject[] { return this.map.objLow.filter((o) => o.obj === STONE_OBJ); }

  /** kind-0 portal markers (FUN_00025fe0: objMid entries with id 0xff90) for the minimap */
  kind0Markers(): { x: number; y: number }[] {
    return this.midStatic.filter((o) => o.obj === -112).map(({ x, y }) => ({ x, y }));
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
