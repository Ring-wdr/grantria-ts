#!/usr/bin/env python3
"""Tiny Thumb-1 interpreter for running small libGrantria.so functions offline.

Used by tools/grantria_bosses.py to evaluate FUN_000231e4 (per-type/per-frame box
overrides) without hand-decoding its tangled branch fragments.

Address space: ELF virtual addresses (va). Ghidra address = va + 0x10000.
The .so file maps 1:1 (file offset == va) for both LOAD segments, and GOT/data
pointers are stored as unrelocated va values, so no relocation fixups are needed
as long as everything stays in va space.

Only what FUN_000231e4 needs is implemented (whole Thumb-1 ISA minus swi/coproc).
Unknown `bl` targets can be stubbed via `stubs = {va: callable(cpu)}`.
"""
import struct

GHIDRA_BASE = 0x10000
SENTINEL = 0x0DEAD000


class Mem:
    PAGE = 0x1000

    def __init__(self, image):
        self.image = image
        self.pages = {}

    def _page(self, a):
        p = a // self.PAGE
        pg = self.pages.get(p)
        if pg is None:
            base = p * self.PAGE
            pg = bytearray(self.PAGE)
            if base < len(self.image):
                chunk = self.image[base:base + self.PAGE]
                pg[:len(chunk)] = chunk
            self.pages[p] = pg
        return pg

    def r8(self, a):
        a &= 0xffffffff
        return self._page(a)[a % self.PAGE]

    def w8(self, a, v):
        a &= 0xffffffff
        self._page(a)[a % self.PAGE] = v & 0xff

    def r16(self, a):
        return self.r8(a) | (self.r8(a + 1) << 8)

    def r32(self, a):
        return self.r16(a) | (self.r16(a + 2) << 16)

    def w16(self, a, v):
        self.w8(a, v)
        self.w8(a + 1, v >> 8)

    def w32(self, a, v):
        self.w16(a, v)
        self.w16(a + 2, v >> 16)

    def write(self, a, data):
        for i, b in enumerate(data):
            self.w8(a + i, b)


def s32(v):
    v &= 0xffffffff
    return v - 0x100000000 if v & 0x80000000 else v


def s16(v):
    v &= 0xffff
    return v - 0x10000 if v & 0x8000 else v


def s8(v):
    v &= 0xff
    return v - 0x100 if v & 0x80 else v


class CPU:
    def __init__(self, mem, stubs=None):
        self.m = mem
        self.r = [0] * 16
        self.N = self.Z = self.C = self.V = 0
        self.stubs = stubs or {}
        self.trace = None

    # flags helpers
    def nz(self, v):
        v &= 0xffffffff
        self.N = v >> 31
        self.Z = int(v == 0)
        return v

    def add_flags(self, a, b, c=0):
        r = (a & 0xffffffff) + (b & 0xffffffff) + c
        res = r & 0xffffffff
        self.C = int(r > 0xffffffff)
        self.V = int(((a ^ res) & (b ^ res) & 0x80000000) != 0)
        return self.nz(res)

    def sub_flags(self, a, b, c=1):
        return self.add_flags(a, (~b) & 0xffffffff, c)

    def cond(self, c):
        N, Z, C, V = self.N, self.Z, self.C, self.V
        return [Z, not Z, C, not C, N, not N, V, not V, C and not Z, (not C) or Z,
                N == V, N != V, (not Z) and N == V, Z or N != V, True, False][c]

    def call(self, va, args=(), sp=0x7ff00000, max_steps=200000):
        r = self.r
        for i, a in enumerate(args):
            r[i] = a & 0xffffffff
        r[13] = sp
        r[14] = SENTINEL | 1
        pc = va & ~1
        steps = 0
        while pc != SENTINEL:
            steps += 1
            if steps > max_steps:
                raise RuntimeError('step limit at 0x%x' % pc)
            pc = self.step(pc)
        return r[0]

    def step(self, pc):
        m, r = self.m, self.r
        h = m.r16(pc)
        if self.trace is not None:
            self.trace.append(pc)
        top5 = h >> 11
        nxt = pc + 2
        if top5 <= 2:                                   # shift imm
            rd, rs, imm = h & 7, (h >> 3) & 7, (h >> 6) & 31
            v = r[rs]
            if top5 == 0:
                if imm:
                    self.C = (v >> (32 - imm)) & 1
                    v = (v << imm) & 0xffffffff
            elif top5 == 1:
                imm = imm or 32
                self.C = (v >> (imm - 1)) & 1
                v = 0 if imm == 32 else v >> imm
            else:
                imm = imm or 32
                self.C = (v >> (imm - 1)) & 1 if imm < 32 else v >> 31
                v = (s32(v) >> min(imm, 31)) & 0xffffffff
            r[rd] = self.nz(v)
            return nxt
        if top5 == 3:                                   # add/sub reg/imm3
            rd, rs = h & 7, (h >> 3) & 7
            v = (h >> 6) & 7
            op2 = v if (h >> 10) & 1 else r[v]
            r[rd] = self.sub_flags(r[rs], op2) if (h >> 9) & 1 else self.add_flags(r[rs], op2)
            return nxt
        if (h >> 13) == 1:                              # mov/cmp/add/sub imm8
            op, rd, imm = (h >> 11) & 3, (h >> 8) & 7, h & 0xff
            if op == 0:
                r[rd] = self.nz(imm)
            elif op == 1:
                self.sub_flags(r[rd], imm)
            elif op == 2:
                r[rd] = self.add_flags(r[rd], imm)
            else:
                r[rd] = self.sub_flags(r[rd], imm)
            return nxt
        if (h >> 10) == 0x10:                           # ALU
            op, rd, rs = (h >> 6) & 15, h & 7, (h >> 3) & 7
            a, b = r[rd], r[rs]
            if op == 0:
                r[rd] = self.nz(a & b)
            elif op == 1:
                r[rd] = self.nz(a ^ b)
            elif op in (2, 3, 4, 7):
                s = b & 0xff
                if s == 0:
                    res = a
                elif op == 2:
                    self.C = (a >> (32 - s)) & 1 if s <= 32 else 0
                    res = (a << s) & 0xffffffff if s < 32 else 0
                elif op == 3:
                    self.C = (a >> (s - 1)) & 1 if s <= 32 else 0
                    res = a >> s if s < 32 else 0
                elif op == 4:
                    if s >= 32:
                        self.C = a >> 31
                        res = 0xffffffff if a >> 31 else 0
                    else:
                        self.C = (a >> (s - 1)) & 1
                        res = (s32(a) >> s) & 0xffffffff
                else:
                    s &= 31
                    res = ((a >> s) | (a << (32 - s))) & 0xffffffff if s else a
                    self.C = res >> 31
                r[rd] = self.nz(res)
            elif op == 5:
                r[rd] = self.add_flags(a, b, self.C)
            elif op == 6:
                r[rd] = self.sub_flags(a, b, self.C)
            elif op == 8:
                self.nz(a & b)
            elif op == 9:
                r[rd] = self.sub_flags(0, b)
            elif op == 10:
                self.sub_flags(a, b)
            elif op == 11:
                self.add_flags(a, b)
            elif op == 12:
                r[rd] = self.nz(a | b)
            elif op == 13:
                r[rd] = self.nz((a * b) & 0xffffffff)
            elif op == 14:
                r[rd] = self.nz(a & ~b)
            else:
                r[rd] = self.nz(~b)
            return nxt
        if (h >> 10) == 0x11:                           # hi reg ops / bx
            op = (h >> 8) & 3
            rd = (h & 7) | ((h >> 4) & 8)
            rm = (h >> 3) & 15
            vm = (pc + 4) if rm == 15 else r[rm]
            if op == 3:
                if h & 0x80:
                    r[14] = (pc + 2) | 1
                return vm & ~1
            vd = (pc + 4) if rd == 15 else r[rd]
            if op == 0:
                res = (vd + vm) & 0xffffffff
            elif op == 1:
                self.sub_flags(vd, vm)
                return nxt
            else:
                res = vm & 0xffffffff
            if rd == 15:
                return res & ~1
            r[rd] = res
            return nxt
        if (h >> 11) == 9:                              # ldr pc-rel
            lit = ((pc + 4) & ~3) + (h & 0xff) * 4
            r[(h >> 8) & 7] = m.r32(lit)
            return nxt
        if (h >> 12) == 5:                              # ld/st reg offset
            rd, rb, ro = h & 7, (h >> 3) & 7, (h >> 6) & 7
            a = (r[rb] + r[ro]) & 0xffffffff
            if (h >> 9) & 1 == 0:
                op = (h >> 10) & 3
                if op == 0:
                    m.w32(a, r[rd])
                elif op == 1:
                    m.w8(a, r[rd])
                elif op == 2:
                    r[rd] = m.r32(a)
                else:
                    r[rd] = m.r8(a)
            else:
                op = (h >> 10) & 3
                if op == 0:
                    m.w16(a, r[rd])
                elif op == 1:
                    r[rd] = s8(m.r8(a)) & 0xffffffff
                elif op == 2:
                    r[rd] = m.r16(a)
                else:
                    r[rd] = s16(m.r16(a)) & 0xffffffff
            return nxt
        if (h >> 13) == 3:                              # ld/st imm
            b, l = (h >> 12) & 1, (h >> 11) & 1
            imm = (h >> 6) & 31
            rd, rb = h & 7, (h >> 3) & 7
            a = (r[rb] + (imm if b else imm * 4)) & 0xffffffff
            if l:
                r[rd] = m.r8(a) if b else m.r32(a)
            elif b:
                m.w8(a, r[rd])
            else:
                m.w32(a, r[rd])
            return nxt
        if (h >> 12) == 8:                              # ldrh/strh imm
            rd, rb = h & 7, (h >> 3) & 7
            a = (r[rb] + ((h >> 6) & 31) * 2) & 0xffffffff
            if (h >> 11) & 1:
                r[rd] = m.r16(a)
            else:
                m.w16(a, r[rd])
            return nxt
        if (h >> 12) == 9:                              # sp-rel
            rd = (h >> 8) & 7
            a = (r[13] + (h & 0xff) * 4) & 0xffffffff
            if (h >> 11) & 1:
                r[rd] = m.r32(a)
            else:
                m.w32(a, r[rd])
            return nxt
        if (h >> 12) == 10:                             # add rd, pc/sp
            rd = (h >> 8) & 7
            base = r[13] if (h >> 11) & 1 else ((pc + 4) & ~3)
            r[rd] = (base + (h & 0xff) * 4) & 0xffffffff
            return nxt
        if (h >> 8) == 0xb0:                            # add/sub sp
            v = (h & 0x7f) * 4
            r[13] = (r[13] - v if h & 0x80 else r[13] + v) & 0xffffffff
            return nxt
        if (h >> 12) == 0xb and ((h >> 9) & 3) == 2:    # push/pop
            regs = [i for i in range(8) if h & (1 << i)]
            if (h >> 11) & 1:
                a = r[13]
                for i in regs:
                    r[i] = m.r32(a)
                    a += 4
                ret = None
                if h & 0x100:
                    ret = m.r32(a) & ~1
                    a += 4
                r[13] = a & 0xffffffff
                return ret if ret is not None else nxt
            extra = [14] if h & 0x100 else []
            allr = regs + extra
            a = r[13] - 4 * len(allr)
            r[13] = a & 0xffffffff
            for i in allr:
                m.w32(a, r[i])
                a += 4
            return nxt
        if (h >> 12) == 0xc:                            # ldmia/stmia
            rb = (h >> 8) & 7
            a = r[rb]
            for i in range(8):
                if h & (1 << i):
                    if (h >> 11) & 1:
                        r[i] = m.r32(a)
                    else:
                        m.w32(a, r[i])
                    a += 4
            if not ((h >> 11) & 1 and h & (1 << rb)):
                r[rb] = a & 0xffffffff
            return nxt
        if (h >> 12) == 0xd:                            # cond branch
            c = (h >> 8) & 15
            if c >= 14:
                raise RuntimeError('swi/udf at 0x%x' % pc)
            o = s8(h & 0xff)
            return pc + 4 + o * 2 if self.cond(c) else nxt
        if (h >> 11) == 0x1c:                           # b
            o = h & 0x7ff
            if o & 0x400:
                o -= 0x800
            return pc + 4 + o * 2
        if (h >> 11) == 0x1e:                           # bl/blx prefix
            h2 = m.r16(pc + 2)
            hi = h & 0x7ff
            if hi & 0x400:
                hi -= 0x800
            tgt = pc + 4 + (hi << 12) + ((h2 & 0x7ff) << 1)
            if (h2 >> 11) == 0x1d:
                tgt &= ~3
            ret = pc + 4
            stub = self.stubs.get(tgt)
            if stub is not None:
                stub(self)
                return ret
            if (h2 >> 11) == 0x1d:
                raise RuntimeError('blx to ARM 0x%x at 0x%x' % (tgt, pc))
            r[14] = ret | 1
            return tgt
        raise RuntimeError('unknown insn %04x at 0x%x' % (h, pc))
