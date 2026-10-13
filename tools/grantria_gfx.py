#!/usr/bin/env python3
"""Grantria graphics tool: .pal/.pxl -> PNG, cmf_*.dat -> JSON, cmf frames -> PNG sheet.

Formats (static analysis of libGrantria.so, see analysis/features/assets-graphics.md):

  NAME.pal  : u16 width, u16 height, then N x u16 RGB565 (LE), N = (size-4)/2 (<=256)
              loaded by FUN_000f9aac via FUN_000f9874(type 6)
  NAME.pxl  : width*height bytes of 8-bit palette indices, row-major, stride = width,
              plus 1 trailing byte (usually 0x31) that the loader drops (memcpy size-1).
  colorkey  : any palette entry == 0xF81F (magenta) is transparent (FUN_000fb1b4, FUN_0007d02c..)

  cmf_*.dat : u16 nFrames, u16 nClips (low byte used), u16 nParts
              clips  [nClips]  : u8 sx, u8 sy, u8 w, u8 h          (rect in the bound image)
              frames [nFrames] : u16 firstPart, u16 partCount
              boxes  [nFrames] : s8 x,s8 y,u8 w,u8 h (body box) + s8 x,s8 y,u8 w,u8 h (attack box)
              parts  [nParts]  : u8 clip, s8 dx, s8 dy, u16 flags (LE)
              (cmf_c3..c73 only) animation records until a byte >= 0x80:
                       u8 n, u8 unk, u8 frame[n], s8 step[n]
              then trailing bytes (AI/attack pattern data, kept raw)
  part flags: bit0 hflip, bits2-3 rotation (0,90cw,180,270cw; rotation first, then hflip),
              bits4-7 integer scale-1, bits8-12 blend mode (0 normal, 13 add, 4 screen ...),
              bits13-15 alpha reduction: alpha = (8-n)/8

Usage:
  grantria_gfx.py png ASSETS_DIR NAME [-o OUT.png] [--index]
  grantria_gfx.py png-all ASSETS_DIR OUT_DIR
  grantria_gfx.py cmf ASSETS_DIR cmf_c10 [-o OUT.json]
  grantria_gfx.py cmf-all ASSETS_DIR OUT_DIR
  grantria_gfx.py render ASSETS_DIR cmf_c10 [-o OUT.png] [--frames 0-20] [--scale 2] [--cols 12]
  grantria_gfx.py render-all ASSETS_DIR OUT_DIR [--equip w,h,a,p]
  grantria_gfx.py map-render ASSETS_DIR 18 [-o m018.png] [--scale 2] [--actor cmf_c0:x:y:frame] [--equip 1,1,1,1]

  Lookup tables come from d.dat (loaded verbatim to RAM 0x3dc324): shared clip count
  d.dat+0x235db, o%d_0/_1 split d.dat+0x25465[zone], equipment composition d.dat+0x23636..
"""
import argparse
import json
import os
import struct
import sys
import zlib

COLORKEY = 0xF81F

# ---------------------------------------------------------------- PNG


def write_png(path, w, h, rgba):
    """rgba: bytes/bytearray of w*h*4."""
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


def rgb565_to_rgba(c):
    r = (c >> 11) & 0x1F
    g = (c >> 5) & 0x3F
    b = c & 0x1F
    return ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 0 if c == COLORKEY else 255)


# ---------------------------------------------------------------- images


class Image:
    def __init__(self, name, w, h, pal565, idx):
        self.name, self.w, self.h, self.pal565, self.idx = name, w, h, pal565, idx
        self.pal = [rgb565_to_rgba(c) for c in pal565]
        self._rgba = None

    @property
    def rgba(self):
        if self._rgba is None:
            lut = [bytes(p) for p in self.pal]
            pad = bytes((255, 0, 255, 0))
            out = bytearray()
            for i in self.idx:
                out += lut[i] if i < len(lut) else pad
            self._rgba = out
        return self._rgba

    def crop(self, sx, sy, w, h):
        """Return (w, h, list of rows of RGBA tuples) clipped to the image (out of range = transparent)."""
        rgba = self.rgba
        rows = []
        for y in range(sy, sy + h):
            row = []
            for x in range(sx, sx + w):
                if 0 <= x < self.w and 0 <= y < self.h:
                    o = (y * self.w + x) * 4
                    row.append(tuple(rgba[o:o + 4]))
                else:
                    row.append((0, 0, 0, 0))
            rows.append(row)
        return rows


_img_cache = {}


def load_image(assets, name):
    key = (os.path.abspath(assets), name)
    if key in _img_cache:
        return _img_cache[key]
    pal_p = os.path.join(assets, name + '.pal')
    pxl_p = os.path.join(assets, name + '.pxl')
    if not (os.path.isfile(pal_p) and os.path.isfile(pxl_p)):
        _img_cache[key] = None
        return None
    pb = open(pal_p, 'rb').read()
    w, h = struct.unpack_from('<HH', pb, 0)
    n = (len(pb) - 4) // 2
    pal = list(struct.unpack_from('<%dH' % n, pb, 4))
    xb = open(pxl_p, 'rb').read()
    need = w * h
    idx = xb[:need]
    if len(idx) < need:
        idx = idx + bytes(need - len(idx))
    img = Image(name, w, h, pal, idx)
    _img_cache[key] = img
    return img


def image_info(img, xb_len):
    keys = [i for i, c in enumerate(img.pal565) if c == COLORKEY]
    return {'name': img.name, 'width': img.w, 'height': img.h, 'palette_entries': len(img.pal565),
            'colorkey_indices': keys, 'pxl_extra_bytes': xb_len - img.w * img.h}


# ---------------------------------------------------------------- cmf

ROT_NAMES = ['0', '90cw', '180', '270cw']


def decode_flags(f):
    return {'raw': f, 'hflip': f & 1, 'rot': (f >> 2) & 3, 'scale': ((f >> 4) & 0xF) + 1,
            'blend': (f >> 8) & 0x1F, 'alpha8': 8 - ((f >> 13) & 7)}


def parse_cmf(data, with_anims=None):
    nf, nc, npart = struct.unpack_from('<HHH', data, 0)
    nclip = nc & 0xFF
    o = 6
    clips = [list(data[o + i * 4:o + i * 4 + 4]) for i in range(nclip)]
    o += nclip * 4
    frames = [struct.unpack_from('<HH', data, o + i * 4) for i in range(nf)]
    o += nf * 4
    boxes = []
    for i in range(nf):
        b = struct.unpack_from('<bbBBbbBB', data, o + i * 8)
        boxes.append({'body': list(b[0:4]), 'attack': list(b[4:8])})
    o += nf * 8
    parts = []
    for i in range(npart):
        c, dx, dy, fl = struct.unpack_from('<BbbH', data, o + i * 5)
        parts.append((c, dx, dy, fl))
    o += npart * 5
    res = {'n_frames': nf, 'n_clips_raw': nc, 'n_parts': npart, 'clips': clips,
           'frames': [], 'anims': [], 'trailing_hex': ''}
    for i, (first, cnt) in enumerate(frames):
        res['frames'].append({
            'index': i, 'first_part': first, 'count': cnt,
            'body_box': boxes[i]['body'], 'attack_box': boxes[i]['attack'],
            'parts': [dict(clip=c, dx=dx, dy=dy, **{k: v for k, v in decode_flags(fl).items()})
                      for (c, dx, dy, fl) in parts[first:first + cnt]]})
    rest = data[o:]
    if with_anims is None:
        with_anims = len(rest) > 0
    if with_anims and rest:
        p = 0
        while p < len(rest) and rest[p] < 0x80:
            n = rest[p]
            if p + 2 + 2 * n > len(rest):
                break
            unk = rest[p + 1]
            fr = list(rest[p + 2:p + 2 + n])
            st = [b - 256 if b >= 128 else b for b in rest[p + 2 + n:p + 2 + 2 * n]]
            res['anims'].append({'index': len(res['anims']), 'n': n, 'unk': unk, 'frames': fr, 'step': st})
            p += 2 + 2 * n
        rest = rest[p + 1:] if p < len(rest) else b''
    res['trailing_hex'] = rest.hex()
    return res


# ---------------------------------------------------------------- d.dat tables
# d.dat is copied verbatim to RAM 0x003dc324 (FUN_00020bdc -> FUN_0001ab88), so Ghidra
# DAT_X (0x3dc324 <= X < 0x4033f4) == d.dat[X - 0x3dc324].
DDAT_SHARED_CLIPS = 0x235db   # DAT_003ff8ff  u8[cmfId]: clips < n come from c.pxl (img 0)
DDAT_OBJ_SPLIT = 0x25465      # DAT_00401789  u8[zone]: clip <= v -> o%d_0 (0x32), else o%d_1 (0x33)
DDAT_EQ_SIZE = 0x23636        # DAT_003ff95a  {u8 w, u8 h}[class*4+kind]  composed equipment size
DDAT_EQ_START = 0x2364e       # DAT_003ff972  u8[class*4+kind (+1)] entry range
DDAT_EQ_RECTS = 0x2365b       # DAT_003ff97f  entry*0x48 + item*6 : {sx, sy, w, h, dx, dy}
EQ_KINDS = 'whap'             # kind 0 weapon(w%d), 1 head(h%d), 2 a%d, 3 p%d  (FUN_000f865c)

_ddat_cache = {}


def load_ddat(assets):
    k = os.path.abspath(assets)
    if k not in _ddat_cache:
        p = os.path.join(assets, 'd.dat')
        _ddat_cache[k] = open(p, 'rb').read() if os.path.isfile(p) else None
    return _ddat_cache[k]


def objset_zone_map(assets):
    """objset -> zone, from m*.dat headers (byte 0 = zone, byte 4 = objset). Every objset is
    used by zones with identical split values, except zone 13 (excluded)."""
    res = {}
    for f in sorted(os.listdir(assets)):
        if len(f) == 8 and f[0] == 'm' and f[1:4].isdigit() and f.endswith('.dat'):
            h = open(os.path.join(assets, f), 'rb').read(5)
            if len(h) == 5 and h[0] != 13:   # zone 13 = net dungeons (split 255, mixed objsets)
                res.setdefault(h[4], {}).setdefault(h[0], 0)
                res[h[4]][h[0]] += 1
    return {o: max(z.items(), key=lambda kv: kv[1])[0] for o, z in res.items()}


# Equipment selection used when composing player equipment images: item index per kind.
# 0 = "none" for h/a/p; weapon 0 uses item 1 rects (FUN_000f865c).
EQUIP = {'w': 0, 'h': 0, 'a': 0, 'p': 0}


def compose_equipment(assets, cls, kind, item):
    """Reproduce FUN_000f865c: cut the equipped item out of atlas <kind><cls>.pxl."""
    d = load_ddat(assets)
    atlas = load_image(assets, '%s%d' % (EQ_KINDS[kind], cls))
    if d is None or atlas is None:
        return None
    i = cls * 4 + kind
    ow, oh = d[DDAT_EQ_SIZE + 2 * i], d[DDAT_EQ_SIZE + 2 * i + 1]
    key = next((k for k, c in enumerate(atlas.pal565) if c == COLORKEY), None)
    buf = bytearray([key if key is not None else 0]) * (ow * oh)
    A, aw = atlas.idx, atlas.w

    def cp(dst_x, dst_y, sx, sy, w, h):
        for r in range(h):
            so = (sy + r) * aw + sx
            do = (dst_y + r) * ow + dst_x
            seg = A[so:so + w]
            if do + len(seg) <= len(buf):
                buf[do:do + len(seg)] = seg

    if kind == 2 and cls == 1:          # a1: 8-row strips, width 26
        cp(0, 0, 0, item * 8, 26, 8)
    elif kind == 2 and cls == 0:        # a0: 10-row strips, width 26
        cp(0, 0, 0, item * 10, 26, 10)
    elif kind == 3 and cls == 1:        # p1: 2 columns of 58x17
        cp(0, 0, (item & 1) * 58, (item >> 1) * 17, 58, 17)
    elif kind == 3 and cls == 2:        # p2: 3 columns of 30x44 (disasm 0xf89de)
        cp(0, 0, (item % 3) * 30, (item // 3) * 44, 30, 44)
    else:                               # generic rect lists
        sel = 6 if (item == 0 and kind == 0) else item * 6
        e0, e1 = d[DDAT_EQ_START + i], d[DDAT_EQ_START + i + 1]
        for e in range(e0, e1):
            sx, sy, w, h, dx, dy = d[DDAT_EQ_RECTS + e * 0x48 + sel:DDAT_EQ_RECTS + e * 0x48 + sel + 6]
            cp(dx, dy, sx, sy, w, h)
    return Image('eq_%s%d_%d' % (EQ_KINDS[kind], cls, item), ow, oh, atlas.pal565, bytes(buf))


def get_image(assets, name):
    """name: plain asset name, or 'EQ:<kind>:<class>' (composed with current EQUIP)."""
    if name and name.startswith('EQ:'):
        _, k, c = name.split(':')
        key = (os.path.abspath(assets), name, EQUIP[k])
        if key not in _img_cache:
            _img_cache[key] = compose_equipment(assets, int(c), EQ_KINDS.index(k), EQUIP[k])
        return _img_cache[key]
    return load_image(assets, name) if name else None


# Player class clip ranges from FUN_0003113c (DAT_003b3c54 != 1 branch), after the
# d.dat shared-clip prefix (c.pxl). (upper_bound_exclusive, tag)
PLAYER_RANGES = {
    0: [(0x3E, 'BODY'), (0x41, 'a'), (0x5B, 'e'), (0xA3, 'eN'), (0xA6, 'h'), (0xB4, 'p'), (0x100, 'w')],
    1: [(0x23, 'BODY'), (0x26, 'a'), (0x4C, 'e'), (0x7A, 'eN'), (0x7D, 'h'), (0x8B, 'p'), (0x100, 'w')],
    2: [(0x1B, 'BODY'), (0x28, 'a'), (0x4E, 'e'), (0x88, 'eN'), (0x8B, 'h'), (0x94, 'p'), (0x100, 'w')],
}


def fits(img, clip):
    return img is not None and clip[0] + clip[2] <= img.w and clip[1] + clip[3] <= img.h


def bind_images(assets, cmf_name, cmf, zone=None):
    """Return list: for each clip index -> image name (see get_image) or None."""
    clips = cmf['clips']
    n = len(clips)
    base = cmf_name[4:] if cmf_name.startswith('cmf_') else cmf_name
    d = load_ddat(assets)
    out = [None] * n
    if base.startswith('c') and base[1:].isdigit():
        cid = int(base[1:])
        shared = d[DDAT_SHARED_CLIPS + cid] if d else 0
        if cid in PLAYER_RANGES:
            for i in range(n):
                if i < shared:
                    out[i] = 'c'
                    continue
                for ub, tag in PLAYER_RANGES[cid]:
                    if i < ub:
                        out[i] = {'BODY': base, 'e': 'e', 'eN': 'e%d' % cid}.get(tag, 'EQ:%s:%d' % (tag, cid))
                        break
            return out
        return ['c' if i < shared else base for i in range(n)]
    if base == 'oc':
        return ['oc'] * n
    if base == 'title':
        return ['title_bg'] * n
    if base == 'status':
        return ['es'] * n          # frames 0x51..0x5c use c.pxl, handled per frame
    if base.startswith('o') and base[1:].isdigit():
        oset = int(base[1:])
        if zone is None:
            zone = objset_zone_map(assets).get(oset, oset)
        t = d[DDAT_OBJ_SPLIT + zone] if d else 255
        return [base + '_0' if k <= t else base + '_1' for k in range(n)]
    return out


# ---------------------------------------------------------------- rendering


def transform(rows, rot, hflip, scale):
    for _ in range(rot):  # rotate 90 cw: dst(X,Y) = src(Y, h-1-X)
        h = len(rows)
        w = len(rows[0]) if h else 0
        rows = [[rows[h - 1 - X][Y] for X in range(h)] for Y in range(w)]
    if hflip:
        rows = [r[::-1] for r in rows]
    if scale > 1:
        rows = [[p for p in r for _ in range(scale)] for r in rows for _ in range(scale)]
    return rows


def _blend_ch(mode, s, d):
    """Per-channel 8-bit blend for the fixed-function modes (0 / 4 / 13 / 14) and transparent sprite sheets;
    opaque canvases use blend565 for the shader modes."""
    if mode == 13:                       # add (saturating) [정적]
        return min(255, s + d)
    if mode == 4:                        # screen [정적]
        return 255 - (255 - s) * (255 - d) // 255
    if mode == 1:                        # lighten [정적]
        return max(s, d)
    if mode == 2:                        # darken [정적]
        return min(s, d)
    if mode == 14:                       # multiply [정적]
        return s * d // 255
    if mode in (10, 15):                 # linear light 2s+d-255 [정적]
        return max(0, min(255, 2 * s + d - 255))
    if mode == 6:                        # overlay [추정]
        return 2 * s * d // 255 if d < 128 else 255 - 2 * (255 - s) * (255 - d) // 255
    if mode == 8:                        # hard light [추정]
        return 2 * s * d // 255 if s < 128 else 255 - 2 * (255 - s) * (255 - d) // 255
    if mode == 5:                        # color dodge [정적]
        return 255 if s >= 255 else min(255, d * 255 // (255 - s))
    if mode == 3:                        # difference [추정]
        return abs(s - d)
    return s                             # 0 normal (and unknown modes)


# ---- FUN_000cfc88 in RGB565 integers (emulator-checked for every mode / channel / alpha; web sprites.ts DST_FRAG) ----
def _cl(v, M):
    return max(0, min(M, v))


def _bch565(mode, s, d, M):
    H = (M + 1) // 2
    if mode == 1: return max(s, d)
    if mode == 2: return min(s, d)
    if mode == 3: return abs(s - d)
    if mode == 4: return M - (((M - s) * (M - d)) >> (5 if M == 31 else 6))
    if mode == 5: return M if s == M else min(M, d * d // (M - s))
    if mode == 6: return 2 * s * d // M if d < H else M - 2 * (M - s) * (M - d) // M
    if mode == 7: return 0 if d == 0 else max(0, M - (M - s) * (M - s) // d)
    if mode == 8: return 2 * s * d // M if s < H else M - 2 * (M - s) * (M - d) // M
    if mode == 9:
        if s == M: return M
        if s < H: return 0 if s == 0 else max(0, M - (M - d) * (M + 1) // (2 * s))
        return min(M, d * (M + 1) // (2 * (M - s) + 1))
    if mode == 10: return _cl(d + 2 * s - M, M) if s < H else _cl(d + 2 * (s - H), M)
    if mode == 11: return M if s == M else min(M, d * (M + 1) // (M - s))
    if mode == 12: return M if d == M else min(M, s * s // (M - d))
    if mode == 13: return min(M, s + d)
    if mode == 14: return s * d // M
    if mode == 15: return _cl(2 * s + d - M, M)
    return s


def blend565(mode, s, d, a):
    """s, d: RGB565 pixels, a: effective alpha 0..32 -> RGB565 (A/C rounding, blue quirks of modes 1/2/9/10)."""
    sc = [s >> 11, (s >> 5) & 63, s & 31]
    dc = [d >> 11, (d >> 5) & 63, d & 31]
    out, braw = [], None
    for i, M in enumerate((31, 63, 31)):
        sv, dv, sh = sc[i], dc[i], (11, 5, 0)[i]
        if i == 2:
            if mode == 1 and sv < dv: out.append(dv); continue
            if mode == 2 and sv > dv: out.append(dv); continue
            if mode == 9 and 16 <= sv < 31:
                den, num = 63 - 2 * s, dv * 32
                q = abs(num) // abs(den)
                q = min(q if (num < 0) == (den < 0) else -q, 31)
                out.append((((dv * (32 - a)) >> 5) + ((q * a) >> 5)) & 31); continue
            if mode == 10 and sv >= 16:
                braw = dv + 2 * (sv - 16); B = braw & 31
            else:
                B = _bch565(mode, sv, dv, M)
            out.append(((dv * (32 - a)) >> 5) + ((B * a) >> 5)); continue
        B = _bch565(mode, sv, dv, M)
        if mode in (0, 10, 11, 12, 15):
            out.append(((dv * (32 - a)) >> 5) + ((B * a) >> 5))
        elif mode == 5:
            Bx = M << sh if sv == M else min(M << sh, ((dv << sh) * dv) // (M - sv))
            out.append(((((dv << sh) * (32 - a)) + Bx * a) >> 5) >> sh)
        else:
            out.append((dv * (32 - a) + B * a) >> 5)
    if mode == 10 and braw is not None and braw >= 32:
        B = _bch565(10, sc[1], dc[1], 63) | 1
        out[1] = ((dc[1] * (32 - a)) >> 5) + ((B * a) >> 5)
    return (out[0] << 11) | (out[1] << 5) | out[2]


#: modes the web draws through the RGB565 shader (the others are fixed-function GL blends)
DST_MODES = {1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15}


def _to565(r, g, b):
    return (int(r * 31 / 255 + 0.5) << 11) | (int(g * 63 / 255 + 0.5) << 5) | int(b * 31 / 255 + 0.5)


def _from565(v):
    return (round((v >> 11) * 255 / 31), round(((v >> 5) & 63) * 255 / 63), round((v & 31) * 255 / 31))


def blit(canvas, cw, ch, rows, ox, oy, blend, alpha8):
    """Draw RGBA rows onto canvas: result = lerp(dst, blend(src,dst), alpha8/8)."""
    a = alpha8 / 8.0
    for y, r in enumerate(rows):
        yy = oy + y
        if yy < 0 or yy >= ch:
            continue
        for x, p in enumerate(r):
            if p[3] == 0:
                continue
            xx = ox + x
            if xx < 0 or xx >= cw:
                continue
            o = (yy * cw + xx) * 4
            dr, dg, db, da = canvas[o:o + 4]
            if blend == 0:
                br, bg, bb = p[0], p[1], p[2]
                na = max(da, int(255 * a))
            elif blend in DST_MODES and da:
                canvas[o:o + 3] = bytes(_from565(blend565(blend, _to565(*p[:3]), _to565(dr, dg, db), alpha8 * 4)))
                continue
            elif blend > 15:
                continue
            else:
                br, bg, bb = _blend_ch(blend, p[0], dr), _blend_ch(blend, p[1], dg), _blend_ch(blend, p[2], db)
                # on a transparent canvas (sprite sheets) give blended pixels alpha from brightness
                na = da if da else int(255 * a * max(p[0], p[1], p[2]) / 255)
            canvas[o:o + 4] = bytes((int(br * a + dr * (1 - a)), int(bg * a + dg * (1 - a)),
                                     int(bb * a + db * (1 - a)), na))


def frame_parts_resolved(assets, cmf_name, cmf, binding, fi):
    fr = cmf['frames'][fi]
    out = []
    base = cmf_name[4:] if cmf_name.startswith('cmf_') else cmf_name
    for p in fr['parts']:
        c = p['clip']
        if c >= len(cmf['clips']):
            continue
        name = binding[c]
        if base == 'status' and 0x51 <= fi <= 0x5C:
            name = 'c'
        img = get_image(assets, name)
        sx, sy, w, h = cmf['clips'][c]
        rot = p['rot']
        dw, dh = (h, w) if rot & 1 else (w, h)
        out.append((img, (sx, sy, w, h), p, dw * p['scale'], dh * p['scale']))
    return out


def render_frame(assets, cmf_name, cmf, binding, fi, bbox=None):
    parts = frame_parts_resolved(assets, cmf_name, cmf, binding, fi)
    if bbox is None:
        xs = [p['dx'] for _, _, p, _, _ in parts] + [p['dx'] + dw for _, _, p, dw, _ in parts]
        ys = [p['dy'] for _, _, p, _, _ in parts] + [p['dy'] + dh for _, _, p, _, dh in parts]
        bbox = (min(xs + [0]), min(ys + [0]), max(xs + [1]), max(ys + [1]))
    x0, y0, x1, y1 = bbox
    cw, ch = x1 - x0, y1 - y0
    canvas = bytearray(cw * ch * 4)
    missing = 0
    for img, (sx, sy, w, h), p, dw, dh in parts:
        if img is None:
            # unresolved image (composed equipment): draw a translucent outline placeholder
            missing += 1
            for xx in range(dw):
                for yy in (0, dh - 1):
                    X, Y = p['dx'] - x0 + xx, p['dy'] - y0 + yy
                    if 0 <= X < cw and 0 <= Y < ch:
                        canvas[(Y * cw + X) * 4:(Y * cw + X) * 4 + 4] = bytes((0, 255, 255, 160))
            for yy in range(dh):
                for xx in (0, dw - 1):
                    X, Y = p['dx'] - x0 + xx, p['dy'] - y0 + yy
                    if 0 <= X < cw and 0 <= Y < ch:
                        canvas[(Y * cw + X) * 4:(Y * cw + X) * 4 + 4] = bytes((0, 255, 255, 160))
            continue
        rows = img.crop(sx, sy, w, h)
        rows = transform(rows, p['rot'], p['hflip'], p['scale'])
        blit(canvas, cw, ch, rows, p['dx'] - x0, p['dy'] - y0, p['blend'], p['alpha8'])
    return cw, ch, canvas, bbox, missing


def parse_range(s, n):
    if not s:
        return list(range(n))
    out = []
    for part in s.split(','):
        if '-' in part:
            a, b = part.split('-')
            out += list(range(int(a), min(int(b), n - 1) + 1))
        else:
            out.append(int(part))
    return [i for i in out if 0 <= i < n]


def render_sheet(assets, cmf_name, out_path, frames=None, cols=12, scale=1, mark_origin=True):
    data = open(os.path.join(assets, cmf_name + '.dat'), 'rb').read()
    cmf = parse_cmf(data)
    binding = bind_images(assets, cmf_name, cmf)
    idxs = parse_range(frames, cmf['n_frames'])
    cells = []
    for fi in idxs:
        if cmf['frames'][fi]['count'] == 0:
            continue
        cells.append((fi,) + render_frame(assets, cmf_name, cmf, binding, fi))
    if not cells:
        return None
    cell_w = max(c[1] for c in cells) + 4
    cell_h = max(c[2] for c in cells) + 4
    cols = max(1, min(cols, len(cells)))
    rows_n = (len(cells) + cols - 1) // cols
    W, H = cell_w * cols, cell_h * rows_n
    sheet = bytearray(W * H * 4)
    # checker background so transparency is visible
    for y in range(H):
        for x in range(W):
            v = 60 if ((x >> 3) ^ (y >> 3)) & 1 else 40
            sheet[(y * W + x) * 4:(y * W + x) * 4 + 4] = bytes((v, v, v + 10, 255))
    total_missing = 0
    for k, (fi, cw, ch, canvas, bbox, missing) in enumerate(cells):
        total_missing += missing
        cx, cy = (k % cols) * cell_w + 2, (k // cols) * cell_h + 2
        for y in range(ch):
            for x in range(cw):
                o = (y * cw + x) * 4
                a = canvas[o + 3]
                if a == 0:
                    continue
                so = ((cy + y) * W + cx + x) * 4
                for c in range(3):
                    sheet[so + c] = (canvas[o + c] * a + sheet[so + c] * (255 - a)) // 255
        if mark_origin:  # red dot at the entity origin (0,0)
            ox, oy = cx - bbox[0], cy - bbox[1]
            if 0 <= ox < W and 0 <= oy < H:
                sheet[(oy * W + ox) * 4:(oy * W + ox) * 4 + 4] = bytes((255, 0, 0, 255))
    if scale > 1:
        big = bytearray()
        for y in range(H):
            row = bytearray()
            for x in range(W):
                row += sheet[(y * W + x) * 4:(y * W + x) * 4 + 4] * scale
            big += bytes(row) * scale
        sheet, W, H = big, W * scale, H * scale
    write_png(out_path, W, H, sheet)
    return {'cells': len(cells), 'unresolved_parts': total_missing, 'size': [W, H],
            'binding': sorted(set(b for b in binding if b)), 'unbound_clips': binding.count(None)}


# ---------------------------------------------------------------- map rendering

DDAT_ACTOR_TYPE = 0x22d3d      # 8B per actor id, +0 = graphics set (cmf_c id)
DDAT_PORTAL_MARKER = 0x26f11   # u8[targetMap] -> marker kind (FUN_00018e6c)
PORTAL_MARKER_IDS = {0: -112, 1: -120, 2: -128, 3: -136}   # 0xff90/88/80/78 -> cmf_oc frame -id


def _load_map_module():
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import grantria_data  # noqa: E402  (tools/grantria_data.py, same directory)
    return grantria_data


def draw_cmf_frame(canvas, cw, ch, assets, cmf_name, cmf, binding, fi, ox, oy):
    """Draw frame fi with its origin at canvas pixel (ox, oy)."""
    if fi < 0 or fi >= cmf['n_frames']:
        return False
    for img, (sx, sy, w, h), p, dw, dh in frame_parts_resolved(assets, cmf_name, cmf, binding, fi):
        if img is None:
            continue
        rows = transform(img.crop(sx, sy, w, h), p['rot'], p['hflip'], p['scale'])
        blit(canvas, cw, ch, rows, ox + p['dx'], oy + p['dy'], p['blend'], p['alpha8'])
    return True


def load_cmf(assets, name, zone=None):
    cmf = parse_cmf(open(os.path.join(assets, name + '.dat'), 'rb').read())
    return cmf, bind_images(assets, name, cmf, zone=zone)


def render_map(assets, map_id, out_path, actors=(), scale=1, layers='bg,low,mid,top,portal,actor'):
    """Composite m%03d.dat: tiles(t%d) + objBg -> objLow -> (objMid + portal markers + actors,
    depth-sorted like FUN_00063640) -> objTop.  Camera offset 0: world pixel == canvas pixel."""
    gd = _load_map_module()
    m = gd.load_map(assets, map_id)
    hd = m['header']
    W, H = hd['width'] * 16, hd['height'] * 16
    canvas = bytearray(W * H * 4)
    for i in range(W * H):
        canvas[i * 4 + 3] = 255                      # v=0 cells: black (weather tint ignored)
    lay = set(layers.split(','))
    # 1. tiles: v != 0 -> tile v-1 of t<tileset>, 8 columns of 16x16 (FUN_00030484)
    ts = load_image(assets, 't%d' % hd['tileset'])
    for r, row in enumerate(m['tiles']):
        for c, v in enumerate(row):
            if v and ts is not None:
                t = v - 1
                rows = ts.crop((t & 7) * 16, (t >> 3) * 16, 16, 16)
                blit(canvas, W, H, rows, c * 16, r * 16, 0, 8)
    oname = 'cmf_o%d' % hd['objset']
    ocmf, obind = load_cmf(assets, oname, zone=hd['zone'])
    ccmf, cbind = load_cmf(assets, 'cmf_oc')
    d = load_ddat(assets)

    def draw_obj(o):
        oid = o['obj']
        if oid < 0:   # bank 0xd: cmf_oc frame -id (FUN_0002c60c)
            return draw_cmf_frame(canvas, W, H, assets, 'cmf_oc', ccmf, cbind, -oid, o['x'], o['y'])
        return draw_cmf_frame(canvas, W, H, assets, oname, ocmf, obind, oid, o['x'], o['y'])

    if 'bg' in lay:
        for o in m['objBg']:
            draw_obj(o)
    if 'low' in lay:
        for o in m['objLow']:
            draw_obj(o)
    mid = []
    if 'mid' in lay:
        mid += [('obj', o) for o in m['objMid']]
    if 'portal' in lay and d is not None:
        for pt in m['portals']:
            if not pt['rects']:
                continue
            a, b = pt['rects'][0], pt['rects'][-1]
            kind = d[DDAT_PORTAL_MARKER + pt['target']] if pt['target'] < 256 else 0
            x = (((b['cx1'] + 1) * 16 - a['cx0'] * 16) >> 1) + a['cx0'] * 16 - 5
            y = a['cy0'] * 16 - 20 + (((b['cy1'] + 1) * 16 - a['cy0'] * 16) >> 1)
            if kind in PORTAL_MARKER_IDS:
                mid.append(('obj', {'obj': PORTAL_MARKER_IDS[kind], 'x': x, 'y': y}))
    if 'actor' in lay and d is not None:
        # F list: actor id -> graphics set d.dat+0x22d3d[id*8] = cmf_c id (FUN_00019c40/FUN_00019bc4)
        for ac in m['actors']:
            if 0 <= ac['actor'] < 260:
                cid = d[DDAT_ACTOR_TYPE + ac['actor'] * 8]
                if os.path.isfile(os.path.join(assets, 'cmf_c%d.dat' % cid)):
                    mid.append(('actor', ('cmf_c%d' % cid, ac['x'], ac['y'], 0)))
    for spec in actors:   # (cmf_name, x, y, frame)
        mid.append(('actor', spec))
    # depth order (FUN_00063640, analysis/features/locomotion.md section 7): actor key = y + body dy,
    # objMid key = y + box.y (u8) + box.h/2; actors inserted in descending index; ties: actors first
    def depth(entry):
        kind, e = entry
        if kind == 'obj':
            c, fi = (ccmf, -e['obj']) if e['obj'] < 0 else (ocmf, e['obj'])
            b = c['frames'][fi]['body_box'] if 0 <= fi < c['n_frames'] else [0, 0, 0, 0]
            return (e['y'] + (b[1] & 0xFF) + ((b[3] & 0xFF) >> 1), 1)
        name, x, y, fi = e
        c, _ = load_cmf(assets, name)
        b = c['frames'][fi]['body_box'] if 0 <= fi < c['n_frames'] else [0, 0, 0, 0]
        return (y + b[1], 0)
    actors_desc = [m_ for m_ in mid if m_[0] == 'actor'][::-1]
    mid = sorted(actors_desc + [m_ for m_ in mid if m_[0] == 'obj'], key=depth)
    for kind, e in mid:
        if kind == 'obj':
            draw_obj(e)
        else:
            name, x, y, fi = e
            cmf, bind = load_cmf(assets, name)
            draw_cmf_frame(canvas, W, H, assets, name, cmf, bind, fi, x, y)
    if 'top' in lay:
        for o in m['objTop']:
            draw_obj(o)
    if scale > 1:
        big = bytearray()
        for y in range(H):
            row = bytearray()
            for x in range(W):
                row += canvas[(y * W + x) * 4:(y * W + x) * 4 + 4] * scale
            big += bytes(row) * scale
        canvas, W, H = big, W * scale, H * scale
    write_png(out_path, W, H, canvas)
    return {'map': map_id, 'size': [W, H], 'header': hd}


# ---------------------------------------------------------------- CLI


def list_images(assets):
    return sorted(f[:-4] for f in os.listdir(assets) if f.endswith('.pal')
                  and os.path.isfile(os.path.join(assets, f[:-4] + '.pxl')))


def cmd_png(a):
    img = load_image(a.assets, a.name)
    if img is None:
        sys.exit('missing %s.pal/.pxl' % a.name)
    out = a.output or a.name + '.png'
    write_png(out, img.w, img.h, img.rgba)
    print(json.dumps(image_info(img, os.path.getsize(os.path.join(a.assets, a.name + '.pxl')))))


def cmd_png_all(a):
    os.makedirs(a.out, exist_ok=True)
    meta = []
    for n in list_images(a.assets):
        img = load_image(a.assets, n)
        write_png(os.path.join(a.out, n + '.png'), img.w, img.h, img.rgba)
        meta.append(image_info(img, os.path.getsize(os.path.join(a.assets, n + '.pxl'))))
    with open(os.path.join(a.out, 'images.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print('%d images' % len(meta))


def cmd_cmf(a):
    name = a.name[:-4] if a.name.endswith('.dat') else a.name
    cmf = parse_cmf(open(os.path.join(a.assets, name + '.dat'), 'rb').read())
    cmf['clip_images'] = bind_images(a.assets, name, cmf)
    s = json.dumps(cmf, indent=1)
    if a.output:
        open(a.output, 'w').write(s)
    else:
        print(s)


def cmf_names(assets):
    return sorted(f[:-4] for f in os.listdir(assets) if f.startswith('cmf_') and f.endswith('.dat'))


def cmd_cmf_all(a):
    os.makedirs(a.out, exist_ok=True)
    for n in cmf_names(a.assets):
        cmf = parse_cmf(open(os.path.join(a.assets, n + '.dat'), 'rb').read())
        cmf['clip_images'] = bind_images(a.assets, n, cmf)
        with open(os.path.join(a.out, n + '.json'), 'w') as f:
            json.dump(cmf, f, indent=1)
    print('done')


def cmd_render(a):
    set_equip(a.equip)
    name = a.name[:-4] if a.name.endswith('.dat') else a.name
    r = render_sheet(a.assets, name, a.output or name + '.png', a.frames, a.cols, a.scale)
    print(json.dumps(r))


def cmd_render_all(a):
    set_equip(a.equip)
    os.makedirs(a.out, exist_ok=True)
    for n in cmf_names(a.assets):
        r = render_sheet(a.assets, n, os.path.join(a.out, n + '.png'), a.frames, a.cols, 1)
        print(n, json.dumps(r))


def set_equip(spec):
    if spec:
        for k, v in zip(EQ_KINDS, spec.split(',')):
            EQUIP[k] = int(v)


def cmd_map_render(a):
    set_equip(a.equip)
    actors = []
    for spec in a.actor or []:
        name, x, y, *rest = spec.split(':')
        actors.append((name, int(x), int(y), int(rest[0]) if rest else 0))
    out = a.output or 'm%03d.png' % a.map
    print(json.dumps(render_map(a.assets, a.map, out, actors, a.scale, a.layers)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('png'); p.add_argument('assets'); p.add_argument('name'); p.add_argument('-o', '--output')
    p.set_defaults(fn=cmd_png)
    p = sp.add_parser('png-all'); p.add_argument('assets'); p.add_argument('out'); p.set_defaults(fn=cmd_png_all)
    p = sp.add_parser('cmf'); p.add_argument('assets'); p.add_argument('name'); p.add_argument('-o', '--output')
    p.set_defaults(fn=cmd_cmf)
    p = sp.add_parser('cmf-all'); p.add_argument('assets'); p.add_argument('out'); p.set_defaults(fn=cmd_cmf_all)
    for nm, fn in (('render', cmd_render), ('render-all', cmd_render_all)):
        p = sp.add_parser(nm); p.add_argument('assets')
        if nm == 'render':
            p.add_argument('name'); p.add_argument('-o', '--output'); p.add_argument('--scale', type=int, default=1)
        else:
            p.add_argument('out')
        p.add_argument('--frames'); p.add_argument('--cols', type=int, default=12)
        p.add_argument('--equip', help='player item index per kind w,h,a,p (default 0,0,0,0)')
        p.set_defaults(fn=fn)
    p = sp.add_parser('map-render'); p.add_argument('assets'); p.add_argument('map', type=int)
    p.add_argument('-o', '--output'); p.add_argument('--scale', type=int, default=1)
    p.add_argument('--layers', default='bg,low,mid,top,portal,actor')
    p.add_argument('--actor', action='append', help='cmf_name:x:y[:frame] (world px), y-sorted with objMid')
    p.add_argument('--equip', help='player item index per kind w,h,a,p')
    p.set_defaults(fn=cmd_map_render)
    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
