#!/usr/bin/env python3
"""Corner correction of the player's walk (FUN_00071424 tail: FUN_000680b4 / FUN_00067f70 / FUN_00067d4c /
FUN_00067884 / FUN_00066284 / FUN_00068444), a Python port checked against the original Thumb code in the
emulator over 17,952 random ticks (x, y, vx, vy, block code, corner cell and flags all equal).

Usage: python -I tools/grantria_corner.py [N]
Writes tests/data/corner_cases.json for tests/corner.test.ts.
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEAD = {'dist_block': 0}


class Ent:
    pass


class World:
    def __init__(self, rows, mode=1):
        self.H, self.W = len(rows), len(rows[0])
        self.bits = [1 if ch == '.' else 0 for row in rows for ch in row]
        self.mode = mode
        self.code = 0; self.cell = 0; self.flags = 0

    def lin(self, i):  # MSB-first bit at linear index i (outside the layer -> 0)
        return self.bits[i] if 0 <= i < len(self.bits) else 0

    def walk(self, c, r):
        return self.lin(c + r * self.W)

    def walk_lsb(self, c, r):  # FUN_0007b240(p, ~b & 7): LSB-first read == cell b ^ 7
        b = c + r * self.W
        return self.lin(b ^ 7)


def L(e): return e.x + e.dx
def R(e): return e.x + e.dx + e.w
def T(e): return e.y + e.dy
def B(e): return e.y + e.dy + e.h


def cells(e):  # FUN_00067640
    e.c0 = ((L(e) & 0xfff) >> 4) if L(e) > 0 else 0
    e.c1 = (((R(e) - 1) & 0xfff) >> 4) if R(e) > 1 else 0
    e.r0 = ((T(e) & 0xfff) >> 4) if T(e) > 0 else 0
    e.r1 = (((B(e) - 1) & 0xfff) >> 4) if B(e) > 1 else 0


def blocked(w, e):  # FUN_00067d4c
    cells(e)
    for r in range(e.r0, e.r1 + 1):
        for c in range(e.c0, e.c1 + 1):
            if not w.walk(c, r):
                if e.cls <= 2:
                    f67884(w, e, c, r)
                return 1
    return 0


def f66284(w, k, p2, p3, p4, p5, p6, e, Lc):
    if p2 in (0, 1):
        if e.lastH == 1:
            Lc[2] = w.walk(p3, p4); Lc[3] = w.walk(p3, p6)
        elif e.lastH == 0:
            Lc[2] = w.walk(p5, p4); Lc[3] = w.walk(p5, p6)
        i11, i9, pidx = 2, 3, 0
    else:
        if e.lastV == 2:
            Lc[0] = w.walk(p5, p4); Lc[1] = w.walk(p3, p4)
        elif e.lastV == 3:
            Lc[0] = w.walk(p5, p6); Lc[1] = w.walk(p3, p6)
        i11, i9, pidx = 2 - p2, 3 - p2, p2
    A = Lc[pidx]
    if A != 0 and Lc[pidx + 1] != 0:
        DEAD['dist_block'] += 1
        raise RuntimeError('distance block reached')
    a, b = Lc[i11], Lc[i9]
    if (a == 0) == (b == 0):
        return 2 if (k == 3 and A == 0 and Lc[pidx + 1] == 0) else 0
    return 1


def f67884(w, e, cx, cy):
    iv9 = 1 if e.dir < 2 else 2
    Lc = [0, 0, 0, 0]
    if e.action != 0:
        return
    cells(e)
    for k in (1, 2):
        if iv9 == 2:
            res = f66284(w, k, 2, e.c0 + k, e.r0, e.c0 - k, e.r0 + 1, e, Lc)
        else:
            res = f66284(w, k, 1, e.c0 + 1, e.r0 - k, e.c0 - 1, e.r0 + k, e, Lc)
        if res == 1:
            break
        if res == 2:
            return
    code = 0
    if iv9 == 2:
        if e.dir == 2:
            if Lc[0] == 0:
                if Lc[1] and w.walk(cx + 1, cy) == 1 and w.walk_lsb(cx + 1, cy - 1) == 0:
                    code = 6
            elif w.walk(cx - 1, cy) == 1 and w.walk_lsb(cx - 1, cy - 1) == 0:
                code = 5
        elif e.dir == 3:
            if Lc[0] == 0:
                if Lc[1] and w.walk(cx + 1, cy) == 1 and w.walk_lsb(cx + 1, cy + 1) == 0:
                    code = 8
            elif w.walk(cx - 1, cy) == 1 and w.walk_lsb(cx - 1, cy + 1) == 0:
                code = 7
    else:
        if e.dir == 0:
            if Lc[2] == 0:
                if Lc[3] and w.walk(cx, cy + 1) == 1:
                    code = 7
            elif w.walk(cx, cy - 1) == 1:
                code = 5
        elif e.dir == 1:
            if Lc[2] == 0:
                if Lc[3] and w.walk(cx, cy + 1) == 1:
                    code = 8
            elif w.walk(cx, cy - 1) == 1:
                code = 6
    w.code = code
    w.cell = ((cx << 8) | (cy & 0xffff)) & 0xffff
    lo = (3 if Lc[2] == 0 else 2) if e.dir < 2 else (1 if Lc[0] == 0 else 0)
    w.flags = (lo | ((e.dir & 0xf) << 4)) & 0xff


def s8(v): return ((v + 128) & 0xff) - 128


def move_axis(w, e, axis):  # FUN_000680b4 / FUN_00067f70 (no actors)
    v0 = e.vx if axis == 'x' else e.vy
    v = v0
    while True:
        step = max(-16, min(16, v))
        if axis == 'x':
            e.vx = step; e.x += step
            if e.x + e.dx < 0: e.x = -e.dx
            elif e.x + e.dx + e.w >= w.W * 16: e.x = w.W * 16 - e.dx - e.w
        else:
            e.vy = step; e.y += step
            if e.y + e.dy < 0: e.y = -e.dy
            elif e.y + e.dy + e.h >= w.H * 16: e.y = w.H * 16 - e.dy - e.h
        if blocked(w, e):
            break
        v = s8(v - step)
        if v == 0:
            if axis == 'x': e.vx = abs(v0)
            else: e.vy = abs(v0)
            return
    if axis == 'x':
        e.x -= e.vx; e.vx = 0
        if w.code == 0: w.code = 1
    else:
        e.y -= e.vy; e.vy = 0
        if w.code < 2: w.code = 2


def f68444(w, e, p):
    if e.state == 1:
        return
    d = e.dir
    probe = None
    if d == 1: probe = ((R(e) + 16) >> 4, T(e) >> 4, 1)
    elif d == 0: probe = ((L(e) - 16) >> 4, T(e) >> 4, 1)
    elif d == 2: probe = (e.x >> 4, (T(e) - 16) >> 4, 2)
    elif d == 3: probe = (e.x >> 4, (B(e) + 16) >> 4, 2)
    if probe and not w.lin(probe[0] + probe[1] * w.W):
        f67884(w, e, probe[0], probe[1])
        p = w.code or probe[2]
    elif p == 0:
        return
    e.vx = e.vy = 0
    w.code = 0
    cells(e)
    fast = e.cls > 2 or w.mode == 1
    dist = 0
    goto = '868c'
    if p >= 3:
        fd, lo = w.flags >> 4, w.flags & 0xf
        cx, cy = w.cell >> 8, w.cell & 0xff
        if fd < 2:
            if lo == 2: dist = abs(cy * 16 - e.y)
            elif lo == 3: dist = abs(cy * 16 + 16 - T(e))
            if lo in (2, 3) and dist >= 5: goto = 'V'
        else:
            if lo == 0: dist = abs(cx * 16 - R(e))
            elif lo == 1: dist = abs(cx * 16 + 16 - L(e))
            if lo in (0, 1) and dist >= 7: goto = 'H'
    if goto == '868c':
        if p in (5, 6, 7, 8):
            if fast:
                e.vx = -dist if p & 1 else dist
                e.vy = -dist if p < 7 else dist
        elif p == 1: goto = 'V'
        elif p == 2: goto = 'H'
    Lc = [0, 0, 0, 0]
    if goto == 'V':
        k = 1
        while True:
            if e.c0 - 1 < 1 or e.c0 + 1 >= w.W or e.r0 - k < 1 or e.r0 + k >= w.H: return
            res = f66284(w, k, 1, e.c0 + 1, e.r0 - k, e.c0 - 1, e.r0 + k, e, Lc)
            if res == 2: return
            if res == 1: break
            k += 1
            if k == 4: break
        m = 4 if fast else 2
        e.vy = -m if Lc[2] else m
    elif goto == 'H':
        k = 1
        while True:
            if e.c0 - k < 1 or e.c0 + k >= w.W or e.r0 - 1 < 1 or e.r0 + 1 >= w.H: return
            res = f66284(w, k, 2, e.c0 + k, e.r0 - 1, e.c0 - k, e.r0 + 1, e, Lc)
            if res == 2: return
            if res == 1: break
            k += 1
            if k == 4: break
        m = 6 if fast else 3
        e.vx = -m if Lc[0] else m
    e.x += s8(e.vx); e.y += s8(e.vy)
    if blocked(w, e):
        e.x -= s8(e.vx); e.y -= s8(e.vy)
    e.vx = e.vy = 0


def tick(w, e):  # FUN_00071424 minus actors/portals
    move_axis(w, e, 'x')
    move_axis(w, e, 'y')
    if ((e.vx & 0xff) | (e.vy & 0xff)) and e.action == 0:
        f68444(w, e, w.code)



def rand_case(rng):
    W, H = rng.randint(8, 14), rng.randint(7, 12)
    return [''.join('#' if r in (0, H - 1) or c in (0, W - 1) or rng.random() < 0.28 else '.' for c in range(W)) for r in range(H)]


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    rng = random.Random(1)
    cases = []
    while len(cases) < n:
        rows = rand_case(rng)
        w = World(rows)
        e = Ent()
        e.dx, e.dy, e.w, e.h = -8, -8, 16, 8
        e.cls = rng.choice([0, 1, 2]); e.action = 0; e.state = 0
        e.dir = rng.randint(0, 3); e.lastH = rng.randint(0, 1); e.lastV = rng.choice([2, 3])
        for _ in range(200):
            e.x = rng.randint(8, w.W * 16 - 9); e.y = rng.randint(8, w.H * 16 - 1)
            w.code = 0
            if not blocked(w, e):
                break
        else:
            continue
        w.code = rng.choice([0, 0, 0, 1, 2]); w.cell = 0; w.flags = 0
        case = {'rows': rows, 'x': e.x, 'y': e.y, 'dir': e.dir, 'lastH': e.lastH, 'lastV': e.lastV, 'code': w.code, 'ticks': []}
        try:
            for _ in range(rng.randint(1, 8)):
                if rng.random() < 0.3:
                    vx, vy = rng.choice([6, -6]), rng.choice([3, -3])
                else:
                    s = rng.choice([4, 8])
                    vx, vy = [(-s, 0), (s, 0), (0, -s), (0, s)][e.dir]
                e.vx, e.vy = vx, vy
                tick(w, e)
                case['ticks'].append({'in': [vx, vy], 'out': [e.x, e.y, s8(e.vx), s8(e.vy), w.code]})
        except RuntimeError:
            continue
        cases.append(case)
    out = os.path.join(ROOT, 'tests/data/corner_cases.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'note': 'tools/grantria_corner.py: random maps, player body (-8,-8,16,8), stick mode 1', 'cases': cases}, f, separators=(',', ':'))
    print(out, len(cases), sum(len(c['ticks']) for c in cases))


if __name__ == '__main__':
    main()
