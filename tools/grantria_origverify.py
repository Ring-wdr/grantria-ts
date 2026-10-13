#!/usr/bin/env python3
"""Check web-built original save files against the game's own native code (Thumb emulator).

The web port (src/core/save/origfile.ts) writes save.dat / gamedata.dat / option.dat. This tool runs the
original functions of libGrantria.so on the same bytes:
  FUN_00035f28 / FUN_00035f94   XTEA block encrypt / decrypt (EncryptFile / DecryptFile inner loop)
  FUN_00021508                  slot checksum (writes the member number at +0x3340, sums [0, 0x3370))
  FUN_000212e0                  gamedata checksum (sum of 0x408050 .. 0x4083f8 = gd[0, 0x3a8))
  FUN_00021308                  option checksum (sum of 0x409668 .. 0x409698 = opt[0, 0x30))

usage: python -I tools/grantria_origverify.py DIR MEMBER [--so apk/lib/armeabi/libGrantria.so]
       DIR holds save.dat[.M], gamedata.dat[.M], option.dat[.M] (exported by the web); optional *.plain plaintexts.
"""
import argparse
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grantria_thumb_emu as emu  # noqa: E402

G = lambda a: a - 0x10000  # noqa: E731


class PltStubs(dict):
    """Any bl into the PLT (ghidra < 0x16000, e.g. __android_log_print) returns 0."""

    def get(self, k, d=None):
        v = dict.get(self, k)
        if v is None and k < G(0x16000):
            return lambda c: c.r.__setitem__(0, 0)
        return v if v is not None else d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir')
    ap.add_argument('member', type=int)
    ap.add_argument('--so', default='apk/lib/armeabi/libGrantria.so')
    a = ap.parse_args()
    so = open(a.so, 'rb').read()
    sfx = '.%d' % a.member if a.member else ''
    ok = True

    def blocks(name):
        enc = open(os.path.join(a.dir, name + sfx), 'rb').read()
        pp = os.path.join(a.dir, name + '.plain')
        if os.path.exists(pp):
            return enc, open(pp, 'rb').read()
        out = bytearray(enc)                           # no plaintext given: decrypt with the original code
        for o in range(0, len(enc) - len(enc) % 8, 8):
            m = emu.Mem(so)
            m.write(0x60000000, enc[o:o + 8])
            emu.CPU(m, PltStubs({-1: None})).call(G(0x35f94), [0x60000000, 0x60001000])
            out[o:o + 8] = bytes(m.r8(0x60001000 + i) for i in range(8))
        return enc, bytes(out)

    def check_cipher(name, enc, plain):
        nonlocal ok
        bad = 0
        for o in range(0, len(plain) - len(plain) % 8, 8):
            m = emu.Mem(so)
            A, B, C = 0x60000000, 0x60001000, 0x60002000
            m.write(A, plain[o:o + 8])
            emu.CPU(m, PltStubs({-1: None})).call(G(0x35f28), [A, B])
            e = bytes(m.r8(B + i) for i in range(8))
            m.write(C - 0x100, enc[o:o + 8])
            emu.CPU(m, PltStubs({-1: None})).call(G(0x35f94), [C - 0x100, C])
            d = bytes(m.r8(C + i) for i in range(8))
            if e != enc[o:o + 8] or d != plain[o:o + 8]:
                bad += 1
        print('%-12s cipher: %d blocks, %d mismatched (original encrypt and decrypt)' % (name, len(plain) // 8, bad))
        ok = ok and bad == 0

    enc, plain = blocks('gamedata.dat')
    check_cipher('gamedata', enc, plain)
    m = emu.Mem(so)
    m.write(G(0x408050), plain)
    s = emu.CPU(m, PltStubs({-1: None})).call(G(0x212e0)) & 0xff
    print('gamedata     checksum: original %02x, file %02x' % (s, plain[0x3a8]))
    ok = ok and s == plain[0x3a8]

    enc, plain = blocks('option.dat')
    check_cipher('option', enc, plain)
    m = emu.Mem(so)
    m.write(G(0x409668), plain)
    s = emu.CPU(m, PltStubs({-1: None})).call(G(0x21308)) & 0xff
    print('option       checksum: original %02x, file %02x' % (s, plain[0x30]))
    ok = ok and s == plain[0x30]

    enc, plain = blocks('save.dat')
    check_cipher('save', enc, plain)
    for slot in range(3):
        b = plain[slot * 0x3378:(slot + 1) * 0x3378]
        m = emu.Mem(so)
        S = 0x61000000
        m.write(S, b)
        m.write(G(0x3b3cd8), struct.pack('<q', a.member))      # g_memberNO used by the checksum
        s = emu.CPU(m, PltStubs({-1: None})).call(G(0x21508), [S]) & 0xff
        print('slot %d       checksum: original %02x, file %02x' % (slot, s, b[0x3370]))
        ok = ok and s == b[0x3370]
    print('OK' if ok else 'MISMATCH')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
