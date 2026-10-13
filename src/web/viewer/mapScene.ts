// Composites one m%03d map like the original: tiles -> objBg -> objLow ->
// (objMid + portal markers + actors, depth sorted) -> objTop.
// Mirrors tools/grantria_gfx.py render_map(); mid-layer depth keys from FUN_00063640 (world.ts).
import type { Cmf, GameMap, MapObject } from '../../core/data/assets';
import type { WebAssets } from '../assets';
import { SpriteLayer, type Equip, DEFAULT_EQUIP } from '../render/sprites';
import { actorDepth, depthSort, objDepth, type DepthItem } from '../../core/world/world';

export interface ActorSpec {
  cmf: string;
  x: number;
  y: number;
  frame: number;
}

export interface MapLayers {
  bg: boolean;
  low: boolean;
  mid: boolean;
  top: boolean;
  portal: boolean;
  actor: boolean;
}

export const ALL_LAYERS: MapLayers = { bg: true, low: true, mid: true, top: true, portal: true, actor: true };

type MidEntry = { kind: 'obj'; o: MapObject } | { kind: 'actor'; a: ActorSpec };

const TILE = 16;

export class MapScene {
  readonly layer: SpriteLayer;
  map!: GameMap;
  width = 0;
  height = 0;

  constructor(private assets: WebAssets) {
    this.layer = new SpriteLayer(assets);
  }

  get name(): string {
    return this.assets.text[484 + this.mapId] ?? '';
  }

  mapId = 0;

  async build(mapId: number, extraActors: ActorSpec[] = [], layers: MapLayers = ALL_LAYERS,
    equip: Equip = DEFAULT_EQUIP): Promise<void> {
    const a = this.assets;
    const m = await a.map(mapId);
    this.map = m;
    this.mapId = mapId;
    const hd = m.header;
    this.width = hd.width * TILE;
    this.height = hd.height * TILE;
    const zone = hd.zone;
    const objName = `cmf_o${hd.objset}`;
    const [ocmf, ccmf] = await Promise.all([a.cmf(objName), a.cmf('cmf_oc')]);

    const mid: MidEntry[] = [];
    if (layers.mid) mid.push(...m.objMid.map((o): MidEntry => ({ kind: 'obj', o })));
    if (layers.portal) {
      for (const pt of m.portals) {
        if (!pt.rects.length) continue;
        const r0 = pt.rects[0], r1 = pt.rects[pt.rects.length - 1];
        const kind = pt.target < 256 ? a.tables.portalMarker[pt.target] : 0;
        const id = a.tables.portalMarkerIds[String(kind)];
        if (id === undefined) continue;
        const x = (((r1.cx1 + 1) * TILE - r0.cx0 * TILE) >> 1) + r0.cx0 * TILE - 5;
        const y = r0.cy0 * TILE - 20 + (((r1.cy1 + 1) * TILE - r0.cy0 * TILE) >> 1);
        mid.push({ kind: 'obj', o: { obj: id, x, y } });
      }
    }
    if (layers.actor) {
      for (const ac of m.actors) {
        if (ac.actor < 0 || ac.actor >= 260) continue;
        mid.push({ kind: 'actor', a: { cmf: `cmf_c${a.tables.actorCmf[ac.actor]}`, x: ac.x, y: ac.y, frame: 0 } });
      }
    }
    for (const s of extraActors) mid.push({ kind: 'actor', a: s });

    // load every cmf and texture before drawing so draw order stays synchronous
    const actorCmfs = new Map<string, Cmf>();
    await Promise.all([...new Set(mid.filter((e) => e.kind === 'actor').map((e) => (e as { a: ActorSpec }).a.cmf))]
      .map(async (n) => { try { actorCmfs.set(n, await a.cmf(n)); } catch { /* missing cmf */ } }));
    const objCmf = (id: number): [string, Cmf, number] => (id < 0 ? ['cmf_oc', ccmf, -id] : [objName, ocmf, id]);
    const allObjs = [...(layers.bg ? m.objBg : []), ...(layers.low ? m.objLow : []), ...(layers.top ? m.objTop : []),
      ...mid.filter((e) => e.kind === 'obj').map((e) => (e as { o: MapObject }).o)];
    const L = this.layer;
    const names: (string | null)[] = [`t${hd.tileset}`];
    for (const o of allObjs) { const [n, c, f] = objCmf(o.obj); names.push(...L.frameImages(n, c, f, zone, equip)); }
    for (const e of mid) {
      if (e.kind !== 'actor') continue;
      const c = actorCmfs.get(e.a.cmf);
      if (c) names.push(...L.frameImages(e.a.cmf, c, e.a.frame, zone, equip));
    }
    await L.preload(names);

    L.clear();
    const drawObj = (o: MapObject) => { const [n, c, f] = objCmf(o.obj); L.frame(n, c, f, o.x, o.y, zone, equip); };
    // 1. tiles: value v != 0 -> tile v-1 of t<tileset>, 8 columns of 16x16 (FUN_00030484); v == 0 stays black
    m.tiles.forEach((row, r) => row.forEach((v, c) => {
      if (!v) return;
      const t = v - 1;
      L.quad(`t${hd.tileset}`, (t & 7) * TILE, (t >> 3) * TILE, TILE, TILE, c * TILE, r * TILE);
    }));
    if (layers.bg) m.objBg.forEach(drawObj);
    if (layers.low) m.objLow.forEach(drawObj);
    // depth order (FUN_00063640): actors are inserted in descending index, then objMid
    const items: DepthItem[] = [];
    for (const e of mid.filter((x) => x.kind === 'actor').reverse()) {
      const a = (e as { a: ActorSpec }).a;
      const c = actorCmfs.get(a.cmf);
      if (c) items.push({ key: actorDepth(a.y, c, a.frame), kind: 0, draw: () => L.frame(a.cmf, c, a.frame, a.x, a.y, zone, equip) });
    }
    for (const e of mid) {
      if (e.kind !== 'obj') continue;
      const [, c, f] = objCmf(e.o.obj);
      items.push({ key: objDepth(e.o, c, f), kind: 1, draw: () => drawObj(e.o) });
    }
    for (const it of depthSort(items)) it.draw();
    if (layers.top) m.objTop.forEach(drawObj);
  }
}
