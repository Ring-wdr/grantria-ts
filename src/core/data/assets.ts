// Loaders for the assets produced by tools/build_web_assets.py.
import { platform, type AssetSource } from '../platform';

export interface CmfPart {
  clip: number;
  dx: number;
  dy: number;
  hflip: number;
  rot: number;
  scale: number;
  blend: number;
  alpha8: number;
}

export interface CmfFrame {
  index: number;
  body_box: number[];
  attack_box: number[];
  parts: CmfPart[];
}

export interface CmfAnim {
  n: number;
  unk: number;
  frames: number[];
  step: number[];
}

export interface Cmf {
  n_frames: number;
  clips: [number, number, number, number][];
  frames: CmfFrame[];
  anims: CmfAnim[];
  /** Image per clip; null for object sets (resolved per map zone at runtime). */
  clip_images: (string | null)[] | null;
  /** bytes after the anim records (monster AI table), hex */
  trailing_hex?: string;
}

export interface MapObject {
  obj: number;
  x: number;
  y: number;
}

export interface MapPortal {
  target: number;
  destX: number;
  destY: number;
  rects: { cx0: number; cy0: number; cx1: number; cy1: number }[];
}

export interface MapActor {
  actor: number;
  x: number;
  y: number;
  /** F list +6: default facing restored after NPC talk */
  param?: number;
}

export interface MapHeader {
  zone: number;
  width: number;
  height: number;
  tileset: number;
  objset: number;
  bgm: number;
  mapType: number;
  monLevel: number;
  /** floor index of the map tab floor view (DAT_0040f376) */
  h8: number;
}

export interface GameMap {
  header: MapHeader;
  objBg: MapObject[];
  objLow: MapObject[];
  objMid: MapObject[];
  objTop: MapObject[];
  actors: MapActor[];
  /** E list: {type, x, y, param} (gimmicks.md §1) */
  gimmicks?: { type: number; x: number; y: number; param: number }[];
  portals: MapPortal[];
  tiles: number[][];
  walk: number[][];
}

export interface Tables {
  sharedClips: number[];
  objSplit: number[];
  actorCmf: number[];
  portalMarker: number[];
  portalMarkerIds: Record<string, number>;
  actorTypes: number[][];
  actorElements: number[][];
  playerActions: ActionRecord[][];
  actionMult: number[][];
  fontClass: number[];
  blinkColors: number[][];
  /** class guide arrows (core/rules/guide.ts), from libGrantria.so .rodata; absent in older asset builds */
  guideMarkers?: { c0: number[][]; c1: number[][]; c2: number[][] };
}

/** Player action record (d.dat action tables, combat.md §1.2). */
export interface ActionRecord {
  n: number;
  frame: number[];
  step: number[];
  event: number[];
  sound: number[];
}

/** Game data (d.dat, text, tables, cmf, maps) read through an AssetSource; no rendering here. */
export class Assets {
  images: Record<string, [number, number]> = {};
  tables!: Tables;
  text: string[] = [];
  private cmfs = new Map<string, Promise<Cmf>>();
  private maps = new Map<number, Promise<GameMap>>();

  /** d.dat, loaded verbatim at RAM 0x003dc324 by the original (FUN_00020bdc) */
  ddat = new Uint8Array(0);

  constructor(readonly source: AssetSource = platform().assets) {}

  async init(): Promise<void> {
    [this.images, this.tables, this.text, this.ddat] = await Promise.all([
      this.json<Record<string, [number, number]>>('images.json'),
      this.json<Tables>('tables.json'),
      this.json<string[]>('text.json'),
      this.source.bytes('d.dat'),
    ]);
  }

  /** Unsigned byte / signed byte / u16 at a d.dat file offset. */
  d8(off: number): number { return this.ddat[off]; }
  s8(off: number): number { return (this.ddat[off] << 24) >> 24; }
  d16(off: number): number { return this.ddat[off] | (this.ddat[off + 1] << 8); }

  /** JSON under assets/ (e.g. items/options.json). */
  json<T>(path: string): Promise<T> { return this.source.json<T>(path); }

  /** Byte at a Ghidra address inside d.dat (DAT_X with 0x3dc324 <= X < 0x4033f4). */
  dd(addr: number, i = 0): number {
    return this.ddat[addr - 0x3dc324 + i];
  }

  cmf(name: string): Promise<Cmf> {
    let p = this.cmfs.get(name);
    if (!p) {
      p = this.json<Cmf>(`cmf/${name}.json`);
      this.cmfs.set(name, p);
    }
    return p;
  }

  map(id: number): Promise<GameMap> {
    let p = this.maps.get(id);
    if (!p) {
      p = this.json<GameMap>(`maps/m${String(id).padStart(3, '0')}.json`);
      this.maps.set(id, p);
    }
    return p;
  }

  mapCount(): number {
    return 447;
  }
}
