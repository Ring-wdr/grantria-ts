#!/usr/bin/env python3
"""Build browser assets for the three.js port from the original APK assets.

Output layout (OUT defaults to web/public/assets):
  images/<name>.png         every .pal/.pxl image (RGBA, colorkey 0xF81F -> alpha 0)
  images/eq/<k><cls>_<item>.png  composed player equipment (FUN_000f865c), k in w,h,a,p
  images.json               {name: [w, h]}
  cmf/<name>.json           parsed cmf_*.dat (frames, parts, boxes, anims) + clip image binding
  maps/m%03d.json           parsed m*.dat
  text.json                 [text by global id] (control codes kept)
  tables.json               d.dat lookup tables used at runtime
  d.dat                     the game DB itself (read by address via Assets.dd)
  items/*.json              item rule tables (options, sets, gems, consumables, drops, starting, misc)
  sound/sN.ogg              BGM / SFX copied from res/raw

Usage: python -I tools/build_web_assets.py [ASSETS_DIR] [OUT_DIR]
"""
import json
import os
import shutil
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import grantria_data as gd  # noqa: E402
import grantria_gfx as gg  # noqa: E402

ROOT = os.path.dirname(HERE)
EQ_ITEMS = 12          # 0x48 bytes per rect entry / 6 bytes per item


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def build_images(assets, out):
    meta = {}
    for name in gg.list_images(assets):
        img = gg.load_image(assets, name)
        gg.write_png(os.path.join(out, 'images', name + '.png'), img.w, img.h, img.rgba)
        meta[name] = [img.w, img.h]
    for cls in range(3):
        for kind, k in enumerate(gg.EQ_KINDS):
            for item in range(EQ_ITEMS):
                img = gg.compose_equipment(assets, cls, kind, item)
                if img is None or not any(img.rgba[3::4]):
                    continue
                name = 'eq/%s%d_%d' % (k, cls, item)
                gg.write_png(os.path.join(out, 'images', name + '.png'), img.w, img.h, img.rgba)
                meta[name] = [img.w, img.h]
    dump(os.path.join(out, 'images.json'), meta)
    return len(meta)


def build_cmf(assets, out):
    names = gg.cmf_names(assets)
    for name in names:
        with open(os.path.join(assets, name + '.dat'), 'rb') as f:
            cmf = gg.parse_cmf(f.read())
        base = name[4:]
        # object sets depend on the map zone: resolved at runtime from tables.objSplit
        cmf['clip_images'] = None if (base.startswith('o') and base[1:].isdigit()) \
            else gg.bind_images(assets, name, cmf)
        dump(os.path.join(out, 'cmf', name + '.json'), cmf)
    return len(names)


def build_maps(assets, out):
    n = 0
    for f in sorted(os.listdir(assets)):
        if len(f) == 8 and f[0] == 'm' and f[1:4].isdigit() and f.endswith('.dat'):
            m = gd.load_map(assets, int(f[1:4]))
            dump(os.path.join(out, 'maps', f[:4] + '.json'), m)
            n += 1
    return n


def build_text(assets, out):
    texts = gd.load_texts(assets)
    by_id = [''] * (max(t['id'] for t in texts) + 1)
    for t in texts:
        by_id[t['id']] = t['text'].rstrip()
    dump(os.path.join(out, 'text.json'), by_id)
    return len(texts)


PLAYER_ACTIONS = (0x186ac, 0x18ed4, 0x1958c)   # d.dat action tables for classes 0/1/2
ACTION_MULT = 0x24b3a                          # FACING multipliers, 0xFF before each class


def player_actions(d):
    """Action records {n, frame, step, event, sound} (s16) per class (combat.md section 0)."""
    mult, cur = [], None
    for b in d[ACTION_MULT:ACTION_MULT + 128]:
        if b == 0xFF:
            if len(mult) == 3:
                break
            cur = []
            mult.append(cur)
        elif cur is not None:
            cur.append(b)
    actions = []
    for cls, off in enumerate(PLAYER_ACTIONS):
        recs = []
        for _ in range(len(mult[cls])):
            n = struct.unpack_from('<h', d, off)[0]
            if not 0 < n < 64:
                break
            arr = [list(struct.unpack_from('<%dh' % n, d, off + 2 + i * 2 * n)) for i in range(4)]
            recs.append(dict(zip(('frame', 'step', 'event', 'sound'), arr), n=n))
            off += 2 + 8 * n
        actions.append(recs)
    return {'playerActions': actions, 'actionMult': mult}


# class guide arrows (FUN_0001788c / 17980 / 17a78): per-map rows [map, (x, y, variant) x quest column] in
# the native library's .rodata (s16, file offset = address - 0x10000); src/core/rules/guide.ts
GUIDE_TABLES = (('c0', 0xfffec, 0x30c, 13), ('c1', 0x1002f8, 0x280, 16), ('c2', 0x100578, 0x270, 13))


def guide_markers(so):
    lib = open(so, 'rb').read()
    out = {}
    for name, addr, size, stride in GUIDE_TABLES:
        v = struct.unpack('<%dh' % (size // 2), lib[addr - 0x10000:addr - 0x10000 + size])
        out[name] = [list(v[i:i + stride]) for i in range(0, len(v), stride)]
    return out


def build_tables(assets, out, so):
    d = gg.load_ddat(assets)
    tables = {
        'sharedClips': list(d[gg.DDAT_SHARED_CLIPS:gg.DDAT_SHARED_CLIPS + 80]),
        'objSplit': list(d[gg.DDAT_OBJ_SPLIT:gg.DDAT_OBJ_SPLIT + 32]),
        'actorCmf': [d[gg.DDAT_ACTOR_TYPE + i * 8] for i in range(260)],
        'portalMarker': list(d[gg.DDAT_PORTAL_MARKER:gg.DDAT_PORTAL_MARKER + 256]),
        'portalMarkerIds': gg.PORTAL_MARKER_IDS,
        # actor type records d+0x22d3d (8 B): [0] cmf, [1] behaviour, [2] box kind, [4] exp bonus,
        # [5] direction mode (2/4), [7] sight range x8 px  (game-rules.md §3.5)
        'actorTypes': [list(d[gg.DDAT_ACTOR_TYPE + i * 8:gg.DDAT_ACTOR_TYPE + i * 8 + 8]) for i in range(260)],
        # d+0x251a3 (12 B per type): [0] element, [4..7] status attack  (game-rules.md §3.2/3.3)
        'actorElements': [list(d[0x251a3 + i * 12:0x251a3 + i * 12 + 12]) for i in range(64)],
        **player_actions(d),
        # font: ASCII byte -> glyph class (d+0x22482, s8) and '|q' blink colours (d+0x22d27, 11 x (b1, b2))
        'fontClass': [b - 256 if b > 127 else b for b in d[0x22482:0x22482 + 128]],
        'blinkColors': [list(d[0x22d27 + i * 2:0x22d27 + i * 2 + 2]) for i in range(11)],
        'guideMarkers': guide_markers(so),
    }
    dump(os.path.join(out, 'tables.json'), tables)


def main():
    # ASSETS_DIR = the assets/ folder of the decoded APK (apktool d grantria.apk -o apk); the native
    # library next to it (../lib/armeabi/libGrantria.so) is needed for the rule tables below.
    assets = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'apk', 'assets'))
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'public', 'assets')
    so = os.path.join(os.path.dirname(assets), 'lib', 'armeabi', 'libGrantria.so')
    work = os.path.join(ROOT, 'work', 'data')
    if not os.path.isfile(os.path.join(assets, 'd.dat')) or not os.path.isfile(so):
        sys.exit(f'need {assets}/d.dat and {so} (decode your own grantria.apk first)')
    for tool, sub in (('grantria_items.py', 'items'), ('grantria_bosses.py', 'bosses')):
        subprocess.run([sys.executable, '-I', os.path.join(HERE, tool), '--assets', assets, '--so', so,
                        '--out', os.path.join(work, sub)], check=True, cwd=ROOT)
    if os.path.isdir(out):
        shutil.rmtree(out)
    print('images', build_images(assets, out))
    print('cmf', build_cmf(assets, out))
    print('maps', build_maps(assets, out))
    print('text', build_text(assets, out))
    build_tables(assets, out, so)
    # item rule tables extracted by tools/grantria_items.py (catalog is recomputed from d.dat at runtime)
    items_src = os.path.join(work, 'items')
    os.makedirs(os.path.join(out, 'items'), exist_ok=True)
    for name in ('options', 'sets', 'gems', 'consumables', 'drops', 'starting', 'misc'):
        shutil.copyfile(os.path.join(items_src, name + '.json'), os.path.join(out, 'items', name + '.json'))
    # box overrides (FUN_000231e4 results from tools/grantria_bosses.py), keyed type -> frame: the bosses and
    # the normal monsters with a type case (12, 24, 27, 31, 37, 40, 41)
    bosses = json.load(open(os.path.join(work, 'bosses', 'bosses.json'), encoding='utf-8'))
    pick = lambda ovs: {str(o['frame']): {k: o[k] for k in ('attack', 'mirrored_attack', 'body', 'mirror', 'by_action') if k in o}
                        for o in ovs}  # noqa: E731
    boxes = {t: pick(b.get('box_overrides', [])) for t, b in bosses['bosses'].items()}
    boxes.update({t: pick(ovs) for t, ovs in bosses.get('normal_box_overrides', {}).items()})
    dump(os.path.join(out, 'boss_boxes.json'), boxes)
    # sounds: res/raw/sN.ogg (BGM 0..18, SFX 19..47 and 53, engine.md §5)
    raw = os.path.join(os.path.dirname(assets), 'res', 'raw')
    os.makedirs(os.path.join(out, 'sound'), exist_ok=True)
    for f in os.listdir(raw):
        if f.endswith('.ogg'):
            shutil.copyfile(os.path.join(raw, f), os.path.join(out, 'sound', f))
    # raw game DB for UI code that reads small d.dat tables by their original address
    shutil.copyfile(os.path.join(assets, 'd.dat'), os.path.join(out, 'd.dat'))
    print('tables ok ->', out)


if __name__ == '__main__':
    main()
