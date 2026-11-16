// Images (.pal/.pxl -> PNG), composed player equipment and cmf_*.dat -> JSON, read from the player's APK:
// the parts of tools/grantria_gfx.py that tools/build_web_assets.py build_images / build_cmf use.
// Formats (static analysis of libGrantria.so, analysis/features/assets-graphics.md):
//   NAME.pal : u16 width, u16 height, then N x u16 RGB565 (LE), N = (size-4)/2
//   NAME.pxl : width*height palette indices (+1 trailing byte the loader drops); 0xF81F = transparent
//   cmf_*.dat: see parseCmf
import { encodePng } from './png';
import { jsonText, type ApkFiles, type Emit } from './zip';

export const COLORKEY = 0xf81f;

const ASSETS = 'assets/';

/** names directly in assets/ (os.listdir) */
function listAssets(files: ApkFiles): string[] {
  return files.list(ASSETS).map((p) => p.slice(ASSETS.length)).filter((f) => !f.includes('/'));
}

/** rgb565_to_rgba packed little-endian into a u32 (r | g<<8 | b<<16 | a<<24) */
function rgb565ToRgba(c: number): number {
  const r = (c >> 11) & 0x1f, g = (c >> 5) & 0x3f, b = c & 0x1f;
  const a = c === COLORKEY ? 0 : 255;
  return (((r << 3) | (r >> 2)) | (((g << 2) | (g >> 4)) << 8) | (((b << 3) | (b >> 2)) << 16) | (a << 24)) >>> 0;
}

const PAD = (255 | (255 << 16)) >>> 0;   // index past the palette: (255, 0, 255, 0)
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** class Image: an indexed image and its RGB565 palette */
export class Image {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly pal565: Uint16Array;
  readonly idx: Uint8Array;
  private rgbaCache: Uint8Array | null = null;
  constructor(name: string, w: number, h: number, pal565: Uint16Array, idx: Uint8Array) {
    this.name = name; this.w = w; this.h = h; this.pal565 = pal565; this.idx = idx;
  }

  /** Image.rgba: w*h*4 bytes */
  get rgba(): Uint8Array {
    if (!this.rgbaCache) {
      const lut = new Uint32Array(256).fill(PAD);
      for (let i = 0; i < this.pal565.length && i < 256; i++) lut[i] = rgb565ToRgba(this.pal565[i]);
      const n = this.idx.length, out = new Uint8Array(n * 4);
      if (LE) {
        const o32 = new Uint32Array(out.buffer);
        for (let i = 0; i < n; i++) o32[i] = lut[this.idx[i]];
      } else {
        for (let i = 0; i < n; i++) {
          const v = lut[this.idx[i]];
          out[i * 4] = v & 255; out[i * 4 + 1] = (v >> 8) & 255; out[i * 4 + 2] = (v >> 16) & 255; out[i * 4 + 3] = v >>> 24;
        }
      }
      this.rgbaCache = out;
    }
    return this.rgbaCache;
  }
}

/** per-APK caches (load_image's _img_cache, load_ddat's _ddat_cache) */
const imgCache = new WeakMap<ApkFiles, Map<string, Image | null>>();

/** load_image: NAME.pal + NAME.pxl, null when either is missing */
export function loadImage(files: ApkFiles, name: string): Image | null {
  let cache = imgCache.get(files);
  if (!cache) imgCache.set(files, cache = new Map());
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const pb = files.get(ASSETS + name + '.pal'), xb = files.get(ASSETS + name + '.pxl');
  let img: Image | null = null;
  if (pb && xb) {
    const dv = new DataView(pb.buffer, pb.byteOffset, pb.byteLength);
    const w = dv.getUint16(0, true), h = dv.getUint16(2, true);
    const n = (pb.length - 4) >> 1;
    const pal = new Uint16Array(n);
    for (let i = 0; i < n; i++) pal[i] = dv.getUint16(4 + i * 2, true);
    const idx = new Uint8Array(w * h);   // short .pxl: zero padded
    idx.set(xb.subarray(0, w * h));
    img = new Image(name, w, h, pal, idx);
  }
  cache.set(name, img);
  return img;
}

/** list_images: names with both .pal and .pxl, sorted */
export function listImages(files: ApkFiles): string[] {
  const names = listAssets(files);
  const have = new Set(names);
  return names.filter((f) => f.endsWith('.pal') && have.has(f.slice(0, -4) + '.pxl')).map((f) => f.slice(0, -4)).sort();
}

// ---------------------------------------------------------------- d.dat tables
// d.dat is copied verbatim to RAM 0x003dc324, so Ghidra DAT_X == d.dat[X - 0x3dc324].
export const DDAT_SHARED_CLIPS = 0x235db;   // u8[cmfId]: clips < n come from c.pxl (img 0)
export const DDAT_OBJ_SPLIT = 0x25465;      // u8[zone]: clip <= v -> o%d_0, else o%d_1
export const DDAT_EQ_SIZE = 0x23636;        // {u8 w, u8 h}[class*4+kind] composed equipment size
export const DDAT_EQ_START = 0x2364e;       // u8[class*4+kind (+1)] entry range
export const DDAT_EQ_RECTS = 0x2365b;       // entry*0x48 + item*6 : {sx, sy, w, h, dx, dy}
export const EQ_KINDS = 'whap';             // kind 0 weapon(w%d), 1 head(h%d), 2 a%d, 3 p%d (FUN_000f865c)
const EQ_ITEMS = 12;                        // build_web_assets.py: 0x48 bytes per rect entry / 6 per item

/** load_ddat: d.dat or null */
export const loadDdat = (files: ApkFiles): Uint8Array | null => files.get(ASSETS + 'd.dat') ?? null;

/** compose_equipment: reproduce FUN_000f865c, cut the equipped item out of atlas <kind><cls>.pxl */
export function composeEquipment(files: ApkFiles, cls: number, kind: number, item: number): Image | null {
  const d = loadDdat(files);
  const atlas = loadImage(files, EQ_KINDS[kind] + cls);
  if (!d || !atlas) return null;
  const i = cls * 4 + kind;
  const ow = d[DDAT_EQ_SIZE + 2 * i], oh = d[DDAT_EQ_SIZE + 2 * i + 1];
  const key = atlas.pal565.indexOf(COLORKEY);
  const buf = new Uint8Array(ow * oh).fill(key >= 0 ? key : 0);
  const A = atlas.idx, aw = atlas.w;
  const cp = (dstX: number, dstY: number, sx: number, sy: number, w: number, h: number) => {
    for (let r = 0; r < h; r++) {
      const so = (sy + r) * aw + sx, dO = (dstY + r) * ow + dstX;
      const seg = A.subarray(so, so + w);   // flat slice: may run into the next row or past the end
      if (dO + seg.length <= buf.length) buf.set(seg, dO);
    }
  };
  if (kind === 2 && cls === 1) cp(0, 0, 0, item * 8, 26, 8);              // a1: 8-row strips, width 26
  else if (kind === 2 && cls === 0) cp(0, 0, 0, item * 10, 26, 10);       // a0: 10-row strips, width 26
  else if (kind === 3 && cls === 1) cp(0, 0, (item & 1) * 58, (item >> 1) * 17, 58, 17);   // p1: 2 columns of 58x17
  else if (kind === 3 && cls === 2) cp(0, 0, (item % 3) * 30, Math.floor(item / 3) * 44, 30, 44);   // p2 (disasm 0xf89de)
  else {                                                                  // generic rect lists
    const sel = item === 0 && kind === 0 ? 6 : item * 6;
    const e0 = d[DDAT_EQ_START + i], e1 = d[DDAT_EQ_START + i + 1];
    for (let e = e0; e < e1; e++) {
      const o = DDAT_EQ_RECTS + e * 0x48 + sel;
      cp(d[o + 4], d[o + 5], d[o], d[o + 1], d[o + 2], d[o + 3]);
    }
  }
  return new Image(`eq_${EQ_KINDS[kind]}${cls}_${item}`, ow, oh, atlas.pal565, buf);
}

// ---------------------------------------------------------------- cmf

export interface CmfPart {
  clip: number; dx: number; dy: number;
  raw: number; hflip: number; rot: number; scale: number; blend: number; alpha8: number;
}
export interface CmfFrame {
  index: number; first_part: number; count: number;
  body_box: number[]; attack_box: number[]; parts: CmfPart[];
}
export interface CmfAnim { index: number; n: number; unk: number; frames: number[]; step: number[] }
export interface Cmf {
  n_frames: number; n_clips_raw: number; n_parts: number; clips: number[][];
  frames: CmfFrame[]; anims: CmfAnim[]; trailing_hex: string;
  clip_images?: (string | null)[] | null;
}

const s8 = (b: number) => (b << 24) >> 24;
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** parse_cmf:
 *  u16 nFrames, u16 nClips (low byte used), u16 nParts
 *  clips [nClips] u8 sx,sy,w,h; frames [nFrames] u16 firstPart, partCount;
 *  boxes [nFrames] s8 x,s8 y,u8 w,u8 h (body) + same (attack); parts [nParts] u8 clip, s8 dx, s8 dy, u16 flags;
 *  then animation records until a byte >= 0x80 (u8 n, u8 unk, u8 frame[n], s8 step[n]), then raw trailing bytes.
 *  flags: bit0 hflip, bits2-3 rotation, bits4-7 scale-1, bits8-12 blend, bits13-15 alpha reduction */
export function parseCmf(data: Uint8Array, withAnims: boolean | null = null): Cmf {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nf = dv.getUint16(0, true), nc = dv.getUint16(2, true), npart = dv.getUint16(4, true);
  const nclip = nc & 0xff;
  let o = 6;
  const clips: number[][] = [];
  for (let i = 0; i < nclip; i++) clips.push(Array.from(data.subarray(o + i * 4, o + i * 4 + 4)));
  o += nclip * 4;
  const fo = o;
  o += nf * 4;
  const bo = o;
  o += nf * 8;
  const po = o;
  o += npart * 5;
  const frames: CmfFrame[] = [];
  for (let i = 0; i < nf; i++) {
    const first = dv.getUint16(fo + i * 4, true), cnt = dv.getUint16(fo + i * 4 + 2, true);
    const b = bo + i * 8;
    const parts: CmfPart[] = [];
    for (let k = first; k < Math.min(first + cnt, npart); k++) {   // parts[first:first + cnt]
      const p = po + k * 5, f = dv.getUint16(p + 3, true);
      parts.push({
        clip: data[p], dx: s8(data[p + 1]), dy: s8(data[p + 2]),
        raw: f, hflip: f & 1, rot: (f >> 2) & 3, scale: ((f >> 4) & 0xf) + 1,   // decode_flags
        blend: (f >> 8) & 0x1f, alpha8: 8 - ((f >> 13) & 7),
      });
    }
    frames.push({
      index: i, first_part: first, count: cnt,
      body_box: [s8(data[b]), s8(data[b + 1]), data[b + 2], data[b + 3]],
      attack_box: [s8(data[b + 4]), s8(data[b + 5]), data[b + 6], data[b + 7]],
      parts,
    });
  }
  let rest = data.subarray(Math.min(o, data.length));
  const anims: CmfAnim[] = [];
  if (withAnims === null) withAnims = rest.length > 0;
  if (withAnims && rest.length) {
    let p = 0;
    while (p < rest.length && rest[p] < 0x80) {
      const n = rest[p];
      if (p + 2 + 2 * n > rest.length) break;
      anims.push({
        index: anims.length, n, unk: rest[p + 1],
        frames: Array.from(rest.subarray(p + 2, p + 2 + n)),
        step: Array.from(rest.subarray(p + 2 + n, p + 2 + 2 * n), s8),
      });
      p += 2 + 2 * n;
    }
    rest = p < rest.length ? rest.subarray(p + 1) : rest.subarray(rest.length);
  }
  let hex = '';
  for (let i = 0; i < rest.length; i++) hex += HEX[rest[i]];
  return { n_frames: nf, n_clips_raw: nc, n_parts: npart, clips, frames, anims, trailing_hex: hex };
}

/** cmf_names: cmf_*.dat names, sorted */
export const cmfNames = (files: ApkFiles): string[] =>
  listAssets(files).filter((f) => f.startsWith('cmf_') && f.endsWith('.dat')).map((f) => f.slice(0, -4)).sort();

/** objset_zone_map: objset -> zone, from m*.dat headers (byte 0 = zone, byte 4 = objset); zone 13 excluded */
export function objsetZoneMap(files: ApkFiles): Map<number, number> {
  const res = new Map<number, Map<number, number>>();
  for (const f of listAssets(files).sort()) {
    if (f.length === 8 && f[0] === 'm' && /^\d{3}$/.test(f.slice(1, 4)) && f.endsWith('.dat')) {
      const h = files.get(ASSETS + f);
      if (h && h.length >= 5 && h[0] !== 13) {   // zone 13 = net dungeons (split 255, mixed objsets)
        let z = res.get(h[4]);
        if (!z) res.set(h[4], z = new Map());
        z.set(h[0], (z.get(h[0]) ?? 0) + 1);
      }
    }
  }
  const out = new Map<number, number>();
  for (const [oset, z] of res) {
    let best = -1, bestN = -1;
    for (const [zone, n] of z) if (n > bestN) { best = zone; bestN = n; }
    out.set(oset, best);
  }
  return out;
}

/** Player class clip ranges from FUN_0003113c, after the d.dat shared-clip prefix (c.pxl). (upper_bound_exclusive, tag) */
const PLAYER_RANGES: Record<number, [number, string][]> = {
  0: [[0x3e, 'BODY'], [0x41, 'a'], [0x5b, 'e'], [0xa3, 'eN'], [0xa6, 'h'], [0xb4, 'p'], [0x100, 'w']],
  1: [[0x23, 'BODY'], [0x26, 'a'], [0x4c, 'e'], [0x7a, 'eN'], [0x7d, 'h'], [0x8b, 'p'], [0x100, 'w']],
  2: [[0x1b, 'BODY'], [0x28, 'a'], [0x4e, 'e'], [0x88, 'eN'], [0x8b, 'h'], [0x94, 'p'], [0x100, 'w']],
};

const isDigits = (s: string) => /^\d+$/.test(s);

/** bind_images: for each clip index -> image name ('EQ:<kind>:<class>' for composed equipment) or null */
export function bindImages(files: ApkFiles, cmfName: string, cmf: Cmf, zone: number | null = null): (string | null)[] {
  const n = cmf.clips.length;
  const base = cmfName.startsWith('cmf_') ? cmfName.slice(4) : cmfName;
  const d = loadDdat(files);
  const out: (string | null)[] = new Array(n).fill(null);
  if (base[0] === 'c' && isDigits(base.slice(1))) {
    const cid = parseInt(base.slice(1), 10);
    const shared = d && d.length ? d[DDAT_SHARED_CLIPS + cid] : 0;
    const ranges = PLAYER_RANGES[cid];
    if (ranges) {
      for (let i = 0; i < n; i++) {
        if (i < shared) { out[i] = 'c'; continue; }
        for (const [ub, tag] of ranges) {
          if (i < ub) {
            out[i] = tag === 'BODY' ? base : tag === 'e' ? 'e' : tag === 'eN' ? `e${cid}` : `EQ:${tag}:${cid}`;
            break;
          }
        }
      }
      return out;
    }
    return out.map((_, i) => i < shared ? 'c' : base);
  }
  if (base === 'oc') return out.fill('oc');
  if (base === 'title') return out.fill('title_bg');
  if (base === 'status') return out.fill('es');   // frames 0x51..0x5c use c.pxl, handled per frame
  if (base[0] === 'o' && isDigits(base.slice(1))) {
    const oset = parseInt(base.slice(1), 10);
    const z = zone ?? objsetZoneMap(files).get(oset) ?? oset;
    const t = d && d.length ? d[DDAT_OBJ_SPLIT + z] : 255;
    return out.map((_, k) => k <= t ? base + '_0' : base + '_1');
  }
  return out;
}

// ---------------------------------------------------------------- builders

const hasAlpha = (rgba: Uint8Array) => {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) return true;
  return false;
};

/** build_images: images/<name>.png for every image, images/eq/<k><cls>_<item>.png for composed equipment,
 *  images.json {name: [w, h]} */
export async function buildImages(files: ApkFiles, emit: Emit): Promise<number> {
  const meta: Record<string, [number, number]> = {};
  for (const name of listImages(files)) {
    const img = loadImage(files, name)!;
    await emit(`images/${name}.png`, await encodePng(img.w, img.h, img.rgba));
    meta[name] = [img.w, img.h];
  }
  for (let cls = 0; cls < 3; cls++) {
    for (let kind = 0; kind < EQ_KINDS.length; kind++) {
      for (let item = 0; item < EQ_ITEMS; item++) {
        const img = composeEquipment(files, cls, kind, item);
        if (!img || !hasAlpha(img.rgba)) continue;
        const name = `eq/${EQ_KINDS[kind]}${cls}_${item}`;
        await emit(`images/${name}.png`, await encodePng(img.w, img.h, img.rgba));
        meta[name] = [img.w, img.h];
      }
    }
  }
  await emit('images.json', jsonText(meta));
  return Object.keys(meta).length;
}

/** build_cmf: cmf/<name>.json, parsed cmf + clip_images (null for object sets: resolved at runtime per zone) */
export async function buildCmf(files: ApkFiles, emit: Emit): Promise<number> {
  const names = cmfNames(files);
  for (const name of names) {
    const cmf = parseCmf(files.get(ASSETS + name + '.dat')!);
    const base = name.slice(4);
    cmf.clip_images = base[0] === 'o' && isDigits(base.slice(1)) ? null : bindImages(files, name, cmf);
    await emit(`cmf/${name}.json`, jsonText(cmf));
  }
  return names.length;
}
