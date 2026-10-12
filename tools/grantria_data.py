#!/usr/bin/env python3
"""Grantria non-image data tool (text*.dat, m*.dat, d.dat, offset.dat, touchdata.dat).

Formats (static analysis of libGrantria.so, see analysis/features/assets-data.md):

text0..6.dat  CP949 plain text, one string per line, LF separated. Each file
              begins with '\n' and ends with '\n'; a trailing "//comment" is an
              author note stripped at runtime (FUN_000797b8). Global text id =
              d.dat s16[0x1a0 + 2*file] (file start id) + line index.
              Control codes: '|x' (x=a..s color, '|@' newline), '@' newline.

mNNN.dat      map/room. 16-byte header, 6 object/entity lists, portal blob,
              W*H tile bytes, (W*H>>3)+1 bytes walk bitmap (MSB first, 1=walkable).
              Loader FUN_00018a74, setup FUN_0001dd48. One cell = 16x16 px.

d.dat         0x270d0-byte game database copied verbatim to RAM 0x003dc324
              (Ghidra address) by FUN_00020bdc. Table offsets: see TABLES below.

Usage:
  grantria_data.py text  ASSETS_DIR OUT_DIR           dump text0-6 to JSON (+ all.json)
  grantria_data.py lookup ASSETS_DIR ID [ID...]       print text by global id
  grantria_data.py find  ASSETS_DIR WORD              search text (UTF-8 word)
  grantria_data.py map   ASSETS_DIR N [--json OUT] [--ascii] [--png OUT.png]
  grantria_data.py maps  ASSETS_DIR OUT_JSON          summary of all 447 maps
  grantria_data.py ddat  ASSETS_DIR OUT_JSON          dump known d.dat tables
  grantria_data.py offset ASSETS_DIR                  dump offset.dat
  grantria_data.py touch ASSETS_DIR                   dump touchdata.dat
"""
import argparse
import json
import os
import struct
import sys

TEXT_FILES = 7

# ----------------------------------------------------------------------------
# text
# ----------------------------------------------------------------------------

# '|x' color codes, FUN_00078474 (RGB565 -> hex RGB888 approximations)
COLOR_CODES = {
    '0': ('advance', 40),
    'a': 0x0000, 'b': 0xFFFF, 'c': 0xF800, 'd': 0xFFE0, 'e': 0x666C,
    'f': 0x001F, 'g': 0xC99F, 'h': 0xED26, 'i': 0x34DF, 'j': 0x9CD3,
    'k': 0xFE6C, 'l': 0xAB31, 'm': 0xFFF5, 'n': 0xFC40, 'o': 0xFD5F,
    'p': 0xAFE0, 'q': ('cycle', 'd.dat+0x22d27'), 'r': 0xFD59,
    's': ('restore', None),
}


def rgb565_to_hex(v):
    r = (v >> 11) & 0x1F
    g = (v >> 5) & 0x3F
    b = v & 0x1F
    return '#%02x%02x%02x' % ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2))


def read_ddat(assets):
    with open(os.path.join(assets, 'd.dat'), 'rb') as f:
        return f.read()


def text_start_ids(ddat):
    return list(struct.unpack_from('<8h', ddat, 0x1A0))


def load_texts(assets):
    """Return list of dicts: id, file, line, text, comment."""
    ddat = read_ddat(assets)
    starts = text_start_ids(ddat)
    out = []
    for fi in range(TEXT_FILES):
        raw = open(os.path.join(assets, 'text%d.dat' % fi), 'rb').read()
        nl = [i for i, b in enumerate(raw) if b == 0x0A]
        # strings sit between consecutive LF (FUN_00079678 records LF offsets)
        count = len(nl) - 1
        if starts[fi + 1] - starts[fi] != count:
            print('warning: text%d.dat has %d lines, d.dat says %d'
                  % (fi, count, starts[fi + 1] - starts[fi]), file=sys.stderr)
        for j in range(count):
            seg = raw[nl[j] + 1:nl[j + 1]]
            cut = seg.find(b'//')
            body, comment = (seg, b'') if cut < 0 else (seg[:cut], seg[cut + 2:])
            out.append({
                'id': starts[fi] + j,
                'file': fi,
                'line': j,
                'text': body.decode('cp949', 'replace'),
                'comment': comment.decode('cp949', 'replace'),
            })
    return out


def cmd_text(a):
    texts = load_texts(a.assets)
    os.makedirs(a.out, exist_ok=True)
    for fi in range(TEXT_FILES):
        part = [t for t in texts if t['file'] == fi]
        with open(os.path.join(a.out, 'text%d.json' % fi), 'w', encoding='utf-8') as f:
            json.dump(part, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, 'all.json'), 'w', encoding='utf-8') as f:
        json.dump({str(t['id']): t['text'] for t in texts}, f, ensure_ascii=False, indent=0)
    print('wrote %d strings to %s' % (len(texts), a.out))


def cmd_lookup(a):
    texts = load_texts(a.assets)
    for s in a.ids:
        i = int(s, 0)
        t = texts[i]
        print('%d (0x%x) text%d:%d  %s  //%s' % (i, i, t['file'], t['line'], t['text'], t['comment']))


def cmd_find(a):
    for t in load_texts(a.assets):
        if a.word in t['text'] or a.word in t['comment']:
            print('%d (0x%x) text%d:%d  %s  //%s' % (t['id'], t['id'], t['file'], t['line'], t['text'][:120], t['comment']))


# ----------------------------------------------------------------------------
# maps
# ----------------------------------------------------------------------------

HEADER_FIELDS = [
    'zone', 'width', 'height', 'tileset', 'objset', 'bgm', 'mapType',
    'monLevel', 'h8', 'nObjBg', 'nObjLow', 'nObjMid', 'nObjTop',
    'nGimmick', 'nActor', 'portalBytes']


def parse_map(data):
    h = data[:16]
    hdr = dict(zip(HEADER_FIELDS, h))
    W, H = hdr['width'], hdr['height']
    p = 16

    def objs(n, size):
        nonlocal p
        recs = []
        for _ in range(n):
            recs.append(list(struct.unpack_from('<%dh' % (size // 2), data, p)))
            p += size
        return recs

    m = {'header': hdr}
    m['objBg'] = [dict(zip(('obj', 'x', 'y'), r)) for r in objs(hdr['nObjBg'], 6)]
    m['objLow'] = [dict(zip(('obj', 'x', 'y'), r)) for r in objs(hdr['nObjLow'], 6)]
    m['objMid'] = [dict(zip(('obj', 'x', 'y'), r)) for r in objs(hdr['nObjMid'], 6)]
    m['objTop'] = [dict(zip(('obj', 'x', 'y'), r)) for r in objs(hdr['nObjTop'], 6)]
    # E list (8B) -> FUN_000176d8, actor slots 0x65.., kind from d.dat 0x2692b[type*4]
    m['gimmicks'] = [dict(zip(('type', 'x', 'y', 'param'), r)) for r in objs(hdr['nGimmick'], 8)]
    # F list (8B) -> FUN_0001bb8c, actor slots 0.., id<43 monster, >=43 NPC; name text 993+id
    m['actors'] = [dict(zip(('actor', 'x', 'y', 'param'), r)) for r in objs(hdr['nActor'], 8)]
    blob = data[p:p + hdr['portalBytes']]
    p += hdr['portalBytes']
    portals = []
    q = 0
    while q + 8 <= len(blob):
        tgt, dx, dy, n = struct.unpack_from('<4H', blob, q)
        q += 8
        rects = []
        for _ in range(n):
            a_, b_ = struct.unpack_from('<2H', blob, q)
            q += 4
            rects.append({'cx0': a_ >> 8, 'cy0': a_ & 0xFF, 'cx1': b_ >> 8, 'cy1': b_ & 0xFF})
        portals.append({'target': tgt, 'destX': dx, 'destY': dy, 'rects': rects})
    m['portals'] = portals
    m['portalTail'] = blob[q:].hex()
    tiles = data[p:p + W * H]
    p += W * H
    nb = ((W * H) >> 3) + 1
    bits = data[p:p + nb]
    p += nb
    m['tiles'] = [list(tiles[r * W:(r + 1) * W]) for r in range(H)]
    walk = []
    for r in range(H):
        row = []
        for c in range(W):
            i = r * W + c
            row.append((bits[i >> 3] >> (7 - (i & 7))) & 1)
        walk.append(row)
    m['walk'] = walk
    m['size_ok'] = (p == len(data))
    return m


def load_map(assets, n):
    with open(os.path.join(assets, 'm%03d.dat' % n), 'rb') as f:
        return parse_map(f.read())


def map_ascii(m):
    W, H = m['header']['width'], m['header']['height']
    grid = [['#' if not m['walk'][r][c] else '.' for c in range(W)] for r in range(H)]
    for r in range(H):
        for c in range(W):
            if m['tiles'][r][c] == 0 and grid[r][c] == '#':
                grid[r][c] = ' '
    for pt in m['portals']:
        for rc in pt['rects']:
            for y in range(rc['cy0'], rc['cy1'] + 1):
                for x in range(rc['cx0'], rc['cx1'] + 1):
                    if 0 <= y < H and 0 <= x < W:
                        grid[y][x] = 'P'
    for o in m['gimmicks']:
        x, y = o['x'] // 16, o['y'] // 16
        if 0 <= y < H and 0 <= x < W:
            grid[y][x] = 'G'
    for o in m['actors']:
        x, y = o['x'] // 16, o['y'] // 16
        if 0 <= y < H and 0 <= x < W:
            grid[y][x] = 'M' if o['actor'] < 43 else 'N'
    return '\n'.join(''.join(r) for r in grid)


def map_png(m, path, scale=8):
    try:
        try:
            from PIL import Image, ImageDraw
        except ImportError:  # python -I drops the user site; retry with it
            import site
            sys.path.append(site.getusersitepackages())
            from PIL import Image, ImageDraw
    except ImportError:
        print('Pillow not available', file=sys.stderr)
        return
    W, H = m['header']['width'], m['header']['height']
    img = Image.new('RGB', (W * scale, H * scale), (0, 0, 0))
    d = ImageDraw.Draw(img)
    for r in range(H):
        for c in range(W):
            t = m['tiles'][r][c]
            col = (40, 40, 40) if t == 0 else ((t * 53) % 200 + 40, (t * 97) % 200 + 40, (t * 29) % 200 + 40)
            if not m['walk'][r][c]:
                col = tuple(v // 3 for v in col)
            d.rectangle([c * scale, r * scale, (c + 1) * scale - 1, (r + 1) * scale - 1], fill=col)
    for pt in m['portals']:
        for rc in pt['rects']:
            d.rectangle([rc['cx0'] * scale, rc['cy0'] * scale, (rc['cx1'] + 1) * scale - 1,
                         (rc['cy1'] + 1) * scale - 1], outline=(255, 0, 255))
    for key, colr in (('objBg', (0, 160, 255)), ('objLow', (0, 255, 160)),
                      ('objMid', (255, 255, 0)), ('objTop', (255, 128, 0))):
        for o in m[key]:
            x, y = o['x'] * scale // 16, o['y'] * scale // 16
            d.rectangle([x - 1, y - 1, x + 1, y + 1], fill=colr)
    for o in m['gimmicks']:
        x, y = o['x'] * scale // 16, o['y'] * scale // 16
        d.rectangle([x - 3, y - 3, x + 3, y + 3], outline=(255, 255, 255))
    for o in m['actors']:
        x, y = o['x'] * scale // 16, o['y'] * scale // 16
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 0, 0) if o['actor'] < 43 else (0, 255, 0))
    img.save(path)


def cmd_map(a):
    m = load_map(a.assets, a.n)
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(m, f, ensure_ascii=False)
    if a.png:
        map_png(m, a.png)
    if a.ascii or not (a.json or a.png):
        h = m['header']
        print(json.dumps(h))
        for k in ('objBg', 'objLow', 'objMid', 'objTop', 'gimmicks', 'actors', 'portals'):
            print(k, json.dumps(m[k], ensure_ascii=False))
        print(map_ascii(m))


def cmd_maps(a):
    out = []
    for n in range(447):
        m = load_map(a.assets, n)
        out.append({'map': n, **m['header'],
                    'portals': [(p['target'], p['destX'], p['destY']) for p in m['portals']],
                    'name_text_id': 484 + n,
                    'gimmicks': [o['type'] for o in m['gimmicks']],
                    'actors': [o['actor'] for o in m['actors']],
                    'size_ok': m['size_ok']})
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print('wrote', a.out, 'bad sizes:', sum(not o['size_ok'] for o in out))


# ----------------------------------------------------------------------------
# d.dat  (RAM 0x003dc324 = d.dat+0; Ghidra DAT_X -> offset X-0x3dc324)
# ----------------------------------------------------------------------------

# name, offset, record format (struct), count, evidence/meaning
TABLES = [
    ('consts_u32', 0x0000, '<I', 104, 'misc game constants (prices, limits); semantics per use'),
    ('text_file_start_id', 0x01A0, '<h', 8, 'FUN_000797b8: first global text id of text0..6, [7]=total'),
    ('text_id_list_1b0', 0x01B0, '<h', 127, 'FUN_00051edc s16[p], 0xffff terminated at 0x2ae'),
    ('event_header', 0x02B0, '<5h', 164, 'FUN_0002bdc4/FUN_0006913c/FUN_0001d6c4: [kind, cellPos(x<<8|y), flagId, textBase, nLines]'),
    ('event_script', 0x0916, None, None, 'FUN_00065534: 6-byte cmds [time, cmd, arg]; addr = 0x916 + 6*s - 10*eventId'),
    ('event_script_start', 0x1841C, '<H', 164, 'FUN_0001d6c4 -> DAT_00408570'),
    ('event_script_end', 0x18564, '<H', 164, 'FUN_0001d6c4 -> DAT_00408572'),
    ('font_cp949_map', 0x11BCE, '<H', None, 'FUN_00077e24: CP949 (lead,trail) -> glyph code'),
    ('item_price_a', 0x1B5C2, '<H', None, 'FUN_0003967c: u16[cat*22 + hard*11 + sub] * coef/100'),
    ('item_cat_textbase', 0x1B998, '<H', 30, 'FUN_00036458/FUN_000365ac: text id base per item category'),
    ('quest', 0x2170C, '<8h', 151, 'FUN_0001f21c..FUN_0001fc94/FUN_00051edc: 16B quest records'),
    ('net_dungeon', 0x2208C, '<3H', 9, 'FUN_0001dd48/FUN_0002d640: [firstMap, startX, startY], 10 maps each (357..446)'),
    ('warp_points', 0x220C2, '<6h', 11, 'FUN_000619a0/FUN_00071424: [map, x0, y0, x, y, flag]'),
    ('zone_gate', 0x22146, '<6h', 4, 'FUN_0001dd48/FUN_00071424'),
    ('char_class_table', 0x22482, '<256b', 1, 'FUN_00078664: per-byte glyph class, 0x7f = "|" control'),
    ('neighbor_dxdy', 0x22AA8, '<2b', 8, 'FUN_000195b0: walk-layer dilation offsets (dx,dy)'),
    ('quest_target', 0x22AB8, '<2B', 20, 'FUN_0001878c: [actorId (name=993+v), ?]'),
    ('quest_reward4', 0x22AE0, '<4B', 38, 'FUN_0001f21c: [count, n, itemCat, ?]'),
    ('reward3', 0x22B78, '<3B', 92, 'FUN_00018d3c/FUN_0001c5cc: [itemCat, sub, idx]'),
    ('text_color_cycle', 0x22D27, '<2B', 11, 'FUN_00078474 code |q'),
    ('actor_type', 0x22D3D, '<8B', 260, 'FUN_00019c40/FUN_0001bb8c/AI FUN_0006xxxx: 8B per actor id'),
    ('gimmick_type', 0x2692B, '<4B', 29, 'FUN_000176d8: [kind(5/6), sprite, ?, ?] per E-list type'),
    ('respawn_point', 0x2699F, '<3B', 8, 'FUN_00062bb0: [map, x/16, y/16]'),
    ('tint_rgb', 0x26E0C, '<3b', 39, 'FUN_00030484/FUN_0001c7e0: RGB565 tint subtractors (weather/time)'),
    ('portal_marker_kind', 0x26F11, '<B', 256, 'FUN_00018e6c: portal target -> marker sprite kind 0..3'),
]


def cmd_ddat(a):
    ddat = read_ddat(a.assets)
    out = {}
    for name, off, fmt, count, ev in TABLES:
        ent = {'offset': '0x%05x' % off, 'ram': '0x%08x' % (0x3DC324 + off), 'evidence': ev}
        if fmt and count:
            sz = struct.calcsize(fmt)
            ent['stride'] = sz
            ent['rows'] = [list(struct.unpack_from(fmt, ddat, off + i * sz)) for i in range(count)]
        out[name] = ent
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print('wrote', a.out)


def cmd_offset(a):
    raw = open(os.path.join(a.assets, 'offset.dat'), 'rb').read()
    v = struct.unpack('<%dH' % (len(raw) // 2), raw)
    print('offset.dat: %d u16 = precomputed LF offsets of text0..6 (stale; not referenced by .so)' % len(v))
    print(v[:32], '...', v[-4:])


def cmd_touch(a):
    raw = open(os.path.join(a.assets, 'touchdata.dat'), 'rb').read()
    nstate = 62
    hdr = [struct.unpack_from('<2H', raw, 4 * i) for i in range(nstate)]
    base = 4 * nstate
    for st, (first, n) in enumerate(hdr):
        if not n:
            continue
        zones = [struct.unpack_from('<5H', raw, base + 10 * (first + k)) for k in range(n)]
        print('state %2d:' % st, ' '.join('(%d,%d,%d,%d,0x%04x)' % z for z in zones))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('text'); s.add_argument('assets'); s.add_argument('out'); s.set_defaults(f=cmd_text)
    s = sp.add_parser('lookup'); s.add_argument('assets'); s.add_argument('ids', nargs='+'); s.set_defaults(f=cmd_lookup)
    s = sp.add_parser('find'); s.add_argument('assets'); s.add_argument('word'); s.set_defaults(f=cmd_find)
    s = sp.add_parser('map'); s.add_argument('assets'); s.add_argument('n', type=int)
    s.add_argument('--json'); s.add_argument('--png'); s.add_argument('--ascii', action='store_true'); s.set_defaults(f=cmd_map)
    s = sp.add_parser('maps'); s.add_argument('assets'); s.add_argument('out'); s.set_defaults(f=cmd_maps)
    s = sp.add_parser('ddat'); s.add_argument('assets'); s.add_argument('out'); s.set_defaults(f=cmd_ddat)
    s = sp.add_parser('offset'); s.add_argument('assets'); s.set_defaults(f=cmd_offset)
    s = sp.add_parser('touch'); s.add_argument('assets'); s.set_defaults(f=cmd_touch)
    a = ap.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    a.f(a)


if __name__ == '__main__':
    main()
