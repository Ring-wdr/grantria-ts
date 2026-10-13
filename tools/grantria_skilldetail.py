#!/usr/bin/env python3
"""Skill detail MENUPOP 2 texts, produced by the original code.

Runs FUN_0004f6a8(2) (the setup of the skill detail drawn by FUN_0002daec) in the Thumb emulator
over a grid of states and writes what it builds: the description (DAT_00403420) and the lines
DAT_0040f844 + 0x44*k, split into the footer (the first DAT_00410760 lines: cost, prerequisite and
level requirement, drawn under text 0x1A3F below max level) and the body (the rest up to
DAT_00410756: values, "다음 레벨", next level's values).

The port's skillDetail.ts is checked against this file (tests/skilldetail.test.ts). It is generated
from your own APK and not committed (npm run fixtures).

usage: python -I tools/grantria_skilldetail.py [--assets apk/assets] [--so apk/lib/armeabi/libGrantria.so] [--out tests/fixtures/skills]
"""
import argparse
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grantria_data  # noqa: E402
import grantria_thumb_emu as emu  # noqa: E402

G = lambda a: a - emu.GHIDRA_BASE  # noqa: E731
P = 0x3ceb78           # player: +0x31c9 class, +0x31cb ~skill points, +0x31cd ~level
MENU = 0x410750        # g_Menu: +2 sub tab, +4 sel (1-based), +6 line count, +0x10 footer line count
TEXT_TABLE = 0x3b61d4  # char* per text id, slot (id + 0x8fc) * 4 (FUN_000797b8 loads, FUN_00079c38 frees)
LEARNED, EFFECTIVE = 0x3d1cb8, 0x3d1c88   # [sub*9 + sel], sel 1-based (P+0x3141 / P+0x3111)
TRAITS = 0x4083ac      # [0] trait points, [k] trait k level
HEAP = 0x7e000000


def dbl(c, i):
    return struct.unpack('<d', struct.pack('<II', c.r[i], c.r[i + 1]))[0]


def put_dbl(c, v):
    c.r[0], c.r[1] = struct.unpack('<II', struct.pack('<d', v))


class Original:
    def __init__(self, so, ddat, texts):
        img = bytearray(so)
        base = G(0x3dc324)
        if len(img) < base + len(ddat):
            img += bytes(base + len(ddat) - len(img))
        img[base:base + len(ddat)] = ddat
        self.img = bytes(img)
        self.texts = texts

    def run(self, cls, sub, sel, learned, eff, points=99, level=99, others=0):
        m = emu.Mem(self.img)
        heap = [HEAP]

        def cstr(a, limit=100000):
            out = bytearray()
            while len(out) < limit:
                b = m.r8(a)
                if b == 0:
                    break
                out.append(b)
                a += 1
            return bytes(out)

        def text_load(c):
            data = self.texts.get(c.r[0], b'') + bytes(1)
            m.write(heap[0], data)
            m.w32(G(TEXT_TABLE) + (c.r[0] + 0x8fc) * 4, heap[0])
            heap[0] += (len(data) + 16) & ~7

        def memset(c):
            for i in range(c.r[2]):
                m.w8(c.r[0] + i, c.r[1])

        def strlen(c):
            c.r[0] = len(cstr(c.r[0]))

        def sprintf(c):
            dst, fmt = c.r[0], cstr(c.r[1])
            args = [c.r[2], c.r[3]] + [m.r32(c.r[13] + 4 * i) for i in range(12)]
            out, i, ai = bytearray(), 0, 0
            while i < len(fmt):
                if fmt[i] != 0x25:
                    out.append(fmt[i])
                    i += 1
                    continue
                j = i + 1
                while j < len(fmt) and fmt[j] in b'-+ #0123456789.l':
                    j += 1
                conv, spec = chr(fmt[j]), fmt[i:j + 1].decode('latin1').replace('l', '')
                if conv == '%':
                    out += b'%'
                elif conv in 'di':
                    out += (spec % emu.s32(args[ai])).encode()
                    ai += 1
                elif conv in 'uxX':
                    out += (spec % args[ai]).encode()
                    ai += 1
                elif conv == 's':
                    out += cstr(args[ai])
                    ai += 1
                elif conv in 'fgeFGE':
                    ai += ai % 2                     # doubles take an aligned register / stack pair
                    out += (spec % struct.unpack('<d', struct.pack('<II', args[ai], args[ai + 1]))[0]).encode()
                    ai += 2
                else:
                    raise RuntimeError('format %r' % spec)
                i = j + 1
            m.write(dst, bytes(out) + bytes(1))
            c.r[0] = len(out)

        def idivmod(c):
            x, y = emu.s32(c.r[0]), emu.s32(c.r[1])
            q = abs(x) // abs(y)
            q = q if (x < 0) == (y < 0) else -q
            c.r[0], c.r[1] = q & 0xffffffff, (x - q * y) & 0xffffffff

        def uidivmod(c):
            x, y = c.r[0], c.r[1]
            c.r[0], c.r[1] = x // y, x % y

        def dop(f):
            def g(c):
                put_dbl(c, f(dbl(c, 0), dbl(c, 2)))
            return g

        def dcmp(f):
            def g(c):
                c.r[0] = int(f(dbl(c, 0), dbl(c, 2)))
            return g

        def cflags(rev):
            def g(c):
                a, b = (dbl(c, 2), dbl(c, 0)) if rev else (dbl(c, 0), dbl(c, 2))
                c.Z, c.C, c.N, c.V = int(a == b), int(a >= b), int(a < b), 0
            return g

        stubs = {
            G(0x797b8): text_load, G(0x79c38): lambda c: None, G(0x13fbc): memset, G(0x14004): sprintf,
            G(0x13e54): strlen,
            G(0xfbcf0): uidivmod, G(0xfbd9c): uidivmod, G(0xfbdb4): idivmod, G(0xfbe90): idivmod,
            G(0xfbeb4): dop(lambda a, b: a + b), G(0xfbeb0): dop(lambda a, b: a - b), G(0xfbea8): dop(lambda a, b: b - a),
            G(0xfc260): dop(lambda a, b: a * b), G(0xfc4cc): dop(lambda a, b: a / b),
            G(0xfc160): lambda c: put_dbl(c, float(c.r[0])), G(0xfc184): lambda c: put_dbl(c, float(emu.s32(c.r[0]))),
            G(0xfc7fc): lambda c: c.r.__setitem__(0, int(dbl(c, 0)) & 0xffffffff),
            G(0xfc858): lambda c: c.r.__setitem__(0, max(0, int(dbl(c, 0))) & 0xffffffff),
            G(0xfc798): dcmp(lambda a, b: a == b), G(0xfc7ac): dcmp(lambda a, b: a < b), G(0xfc7c0): dcmp(lambda a, b: a <= b),
            G(0xfc7d4): dcmp(lambda a, b: a >= b), G(0xfc7e8): dcmp(lambda a, b: a > b),
            G(0xfc768): cflags(True), G(0xfc784): cflags(False),
        }
        m.w8(G(P + 0x31c9), cls)
        m.w8(G(P + 0x31cb), (~points) & 0xff)
        m.w8(G(P + 0x31cd), (~level) & 0xff)
        for i in range(27):
            m.w8(G(LEARNED) + i, others)
            m.w8(G(EFFECTIVE) + i, others)
        m.w8(G(LEARNED) + sub * 9 + sel, learned)
        m.w8(G(EFFECTIVE) + sub * 9 + sel, eff)
        m.w8(G(TRAITS), points)
        if sub == 2:
            m.w8(G(TRAITS) + sel, learned)
        m.w8(G(MENU + 2), sub)
        m.w8(G(MENU + 4), sel)
        emu.CPU(m, stubs).call(G(0x4f6a8), [2, 0], max_steps=3_000_000)
        dec = lambda b: b.decode('cp949')  # noqa: E731
        n_foot, n_all = m.r8(G(MENU + 0x10)), m.r8(G(MENU + 6))
        lines = [dec(cstr(G(0x40f844) + 0x44 * k)) for k in range(n_all)]
        return dec(cstr(G(0x403420))), lines[:n_foot], lines[n_foot:]


def sweep(orig):
    cases, descs = [], {}
    for cls in range(3):
        for sub, n, maxlv in ((0, 9, 10), (1, 7, 10), (2, 12, 5)):
            if sub == 2 and cls:
                continue                                # traits belong to the account, not the class
            for sel in range(1, n + 1):
                for learned in range(maxlv + 1):
                    for bonus in ((0, 2) if sub < 2 else (0,)):
                        eff = learned + bonus if learned else 0
                        for points in (99, 0):
                            for level, others in (((99, 0), (1, 5)) if sub == 0 else ((99, 0),)):
                                desc, foot, body = orig.run(cls, sub, sel, learned, eff, points, level, others)
                                descs['%d/%d/%d' % (cls, sub, sel)] = desc
                                cases.append({'cls': cls, 'sub': sub, 'sel': sel, 'learned': learned, 'eff': eff,
                                              'points': points, 'level': level, 'others': others,
                                              'footer': foot, 'body': body})
    return descs, cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--assets', default='apk/assets')
    ap.add_argument('--so', default='apk/lib/armeabi/libGrantria.so')
    ap.add_argument('--out', default='tests/fixtures/skills')
    a = ap.parse_args()
    texts = {t['id']: t['text'].encode('cp949', 'replace') for t in grantria_data.load_texts(a.assets)}
    orig = Original(open(a.so, 'rb').read(), open(os.path.join(a.assets, 'd.dat'), 'rb').read(), texts)
    descs, cases = sweep(orig)
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, 'detail.json')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('{\n "source": "FUN_0004f6a8(2) run in tools/grantria_thumb_emu.py (grantria_skilldetail.py)",\n')
        f.write(' "state": "learned / eff = DAT_003d1cb8 / DAT_003d1c88 [sub*9+sel] (traits: DAT_004083ac[sel]); '
                'points = skill points (and trait points); level = character level; others = every other skill level",\n')
        f.write(' "descriptions": %s,\n "cases": [\n' % json.dumps(descs, ensure_ascii=False))
        f.write(',\n'.join('  ' + json.dumps(c, ensure_ascii=False) for c in cases))
        f.write('\n ]\n}\n')
    print('wrote %s: %d cases' % (path, len(cases)))


if __name__ == '__main__':
    main()
