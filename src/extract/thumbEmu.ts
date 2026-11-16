// A small Thumb-1 interpreter for running libGrantria.so functions offline, the port of
// tools/grantria_thumb_emu.py (bosses.ts runs FUN_000231e4 with it for the per-type box overrides).
//
// Address space: ELF virtual addresses (va; Ghidra address = va + 0x10000). The .so maps 1:1 (file offset ==
// va) and its GOT/data pointers are unrelocated va values, so no fixups are needed while everything stays in va
// space. The whole Thumb-1 ISA minus swi/coprocessor; unknown `bl` targets can be stubbed by va.
//
// Built for many short calls: memory is a flat copy of the image (plus its bss) and lazily made 4 KiB pages
// above it, reset between calls by restoring only the pages that were written. No allocation per instruction.

export const SENTINEL = 0x0dead000;
const PAGE_BITS = 12, PAGE = 1 << PAGE_BITS, PAGE_MASK = PAGE - 1;

export const s32 = (v: number): number => v | 0;
export const s16 = (v: number): number => (v << 16) >> 16;
export const s8 = (v: number): number => (v << 24) >> 24;

export class Mem {
  private readonly image: Uint8Array;
  /** the image and the zero memory right after it (bss), addresses 0 .. lowSize */
  private readonly low: Uint8Array;
  private readonly lowSize: number;
  private readonly dirty: Uint8Array;
  private readonly dirtyList: number[] = [];
  /** pages above lowSize, zero-filled when made */
  private readonly high = new Map<number, Uint8Array>();
  private cachePage = -1;
  private cache: Uint8Array = new Uint8Array(0);

  /** image: the .so file; lowSize: bytes kept flat (the image plus its bss), rounded up to whole pages */
  constructor(image: Uint8Array, lowSize = 0x400000) {
    this.image = image;
    this.lowSize = (Math.max(lowSize, image.length) + PAGE_MASK) & ~PAGE_MASK;
    this.low = new Uint8Array(this.lowSize);
    this.low.set(image);
    this.dirty = new Uint8Array(this.lowSize >>> PAGE_BITS);
  }

  /** back to the state right after construction: the image, everything else zero */
  reset(): void {
    for (const p of this.dirtyList) {
      const a = p << PAGE_BITS;
      const end = Math.min(a + PAGE, this.image.length);
      if (a < end) this.low.set(this.image.subarray(a, end), a);
      if (end < a + PAGE) this.low.fill(0, Math.max(a, end), a + PAGE);
      this.dirty[p] = 0;
    }
    this.dirtyList.length = 0;
    for (const pg of this.high.values()) pg.fill(0);
  }

  private page(a: number): Uint8Array {
    const p = a >>> PAGE_BITS;
    if (p === this.cachePage) return this.cache;
    let pg = this.high.get(p);
    if (pg === undefined) { pg = new Uint8Array(PAGE); this.high.set(p, pg); }
    this.cachePage = p;
    this.cache = pg;
    return pg;
  }

  r8(a: number): number {
    a >>>= 0;
    return a < this.lowSize ? this.low[a] : this.page(a)[a & PAGE_MASK];
  }

  w8(a: number, v: number): void {
    a >>>= 0;
    if (a < this.lowSize) {
      const p = a >>> PAGE_BITS;
      if (!this.dirty[p]) { this.dirty[p] = 1; this.dirtyList.push(p); }
      this.low[a] = v;
    } else {
      this.page(a)[a & PAGE_MASK] = v;
    }
  }

  r16(a: number): number {
    a >>>= 0;
    if (a + 1 < this.lowSize) return this.low[a] | (this.low[a + 1] << 8);
    return this.r8(a) | (this.r8(a + 1) << 8);
  }

  r32(a: number): number {
    a >>>= 0;
    if (a + 3 < this.lowSize) {
      const l = this.low;
      return (l[a] | (l[a + 1] << 8) | (l[a + 2] << 16) | (l[a + 3] << 24)) >>> 0;
    }
    return (this.r16(a) | (this.r16(a + 2) << 16)) >>> 0;
  }

  w16(a: number, v: number): void {
    this.w8(a, v);
    this.w8(a + 1, v >>> 8);
  }

  w32(a: number, v: number): void {
    this.w16(a, v);
    this.w16(a + 2, v >>> 16);
  }

  write(a: number, data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) this.w8(a + i, data[i]);
  }
}

export type Stub = (cpu: CPU) => void;

export class CPU {
  readonly m: Mem;
  readonly r = new Uint32Array(16);
  N = 0; Z = 0; C = 0; V = 0;
  readonly stubs: Map<number, Stub>;

  constructor(mem: Mem, stubs: Map<number, Stub> = new Map()) {
    this.m = mem;
    this.stubs = stubs;
  }

  /** registers and flags back to zero (a fresh CPU) */
  reset(): void {
    this.r.fill(0);
    this.N = this.Z = this.C = this.V = 0;
  }

  private nz(v: number): number {
    v >>>= 0;
    this.N = v >>> 31;
    this.Z = v === 0 ? 1 : 0;
    return v;
  }

  private addFlags(a: number, b: number, c: number): number {
    const r = a + b + c;  // a, b are u32: exact as a double
    const res = r >>> 0;
    this.C = r > 0xffffffff ? 1 : 0;
    this.V = ((a ^ res) & (b ^ res) & 0x80000000) !== 0 ? 1 : 0;
    return this.nz(res);
  }

  private subFlags(a: number, b: number, c = 1): number {
    return this.addFlags(a, ~b >>> 0, c);
  }

  private cond(c: number): boolean {
    const { N, Z, C, V } = this;
    switch (c) {
      case 0: return Z === 1;
      case 1: return Z === 0;
      case 2: return C === 1;
      case 3: return C === 0;
      case 4: return N === 1;
      case 5: return N === 0;
      case 6: return V === 1;
      case 7: return V === 0;
      case 8: return C === 1 && Z === 0;
      case 9: return C === 0 || Z === 1;
      case 10: return N === V;
      case 11: return N !== V;
      case 12: return Z === 0 && N === V;
      case 13: return Z === 1 || N !== V;
      case 14: return true;
      default: return false;
    }
  }

  /** run the function at va with r0.. = args until it returns to the sentinel; returns r0 */
  call(va: number, args: readonly number[] = [], sp = 0x7ff00000, maxSteps = 200000): number {
    const r = this.r;
    for (let i = 0; i < args.length; i++) r[i] = args[i];
    r[13] = sp;
    r[14] = SENTINEL | 1;
    let pc = (va & ~1) >>> 0;
    let steps = 0;
    while (pc !== SENTINEL) {
      if (++steps > maxSteps) throw new Error(`step limit at 0x${pc.toString(16)}`);
      pc = this.step(pc);
    }
    return r[0];
  }

  step(pc: number): number {
    const m = this.m, r = this.r;
    const h = m.r16(pc);
    const top5 = h >>> 11;
    const nxt = pc + 2;
    if (top5 <= 2) {                                    // shift imm
      const rd = h & 7, rs = (h >>> 3) & 7;
      let imm = (h >>> 6) & 31;
      let v = r[rs];
      if (top5 === 0) {
        if (imm) {
          this.C = (v >>> (32 - imm)) & 1;
          v = (v << imm) >>> 0;
        }
      } else if (top5 === 1) {
        imm = imm || 32;
        this.C = (v >>> (imm - 1)) & 1;
        v = imm === 32 ? 0 : v >>> imm;
      } else {
        imm = imm || 32;
        this.C = imm < 32 ? (v >>> (imm - 1)) & 1 : v >>> 31;
        v = (v | 0) >> Math.min(imm, 31);
      }
      r[rd] = this.nz(v);
      return nxt;
    }
    if (top5 === 3) {                                   // add/sub reg/imm3
      const rd = h & 7, rs = (h >>> 3) & 7, v = (h >>> 6) & 7;
      const op2 = (h >>> 10) & 1 ? v : r[v];
      r[rd] = (h >>> 9) & 1 ? this.subFlags(r[rs], op2) : this.addFlags(r[rs], op2, 0);
      return nxt;
    }
    if (h >>> 13 === 1) {                               // mov/cmp/add/sub imm8
      const op = (h >>> 11) & 3, rd = (h >>> 8) & 7, imm = h & 0xff;
      if (op === 0) r[rd] = this.nz(imm);
      else if (op === 1) this.subFlags(r[rd], imm);
      else if (op === 2) r[rd] = this.addFlags(r[rd], imm, 0);
      else r[rd] = this.subFlags(r[rd], imm);
      return nxt;
    }
    if (h >>> 10 === 0x10) {                            // ALU
      const op = (h >>> 6) & 15, rd = h & 7, rs = (h >>> 3) & 7;
      const a = r[rd], b = r[rs];
      switch (op) {
        case 0: r[rd] = this.nz(a & b); break;
        case 1: r[rd] = this.nz(a ^ b); break;
        case 2: case 3: case 4: case 7: {
          let s = b & 0xff;
          let res: number;
          if (s === 0) res = a;
          else if (op === 2) {
            this.C = s <= 32 ? (a >>> (32 - s)) & 1 : 0;
            res = s < 32 ? (a << s) >>> 0 : 0;
          } else if (op === 3) {
            this.C = s <= 32 ? (a >>> (s - 1)) & 1 : 0;
            res = s < 32 ? a >>> s : 0;
          } else if (op === 4) {
            if (s >= 32) {
              this.C = a >>> 31;
              res = a >>> 31 ? 0xffffffff : 0;
            } else {
              this.C = (a >>> (s - 1)) & 1;
              res = ((a | 0) >> s) >>> 0;
            }
          } else {
            s &= 31;
            res = s ? ((a >>> s) | (a << (32 - s))) >>> 0 : a;
            this.C = res >>> 31;
          }
          r[rd] = this.nz(res);
          break;
        }
        case 5: r[rd] = this.addFlags(a, b, this.C); break;
        case 6: r[rd] = this.subFlags(a, b, this.C); break;
        case 8: this.nz(a & b); break;
        case 9: r[rd] = this.subFlags(0, b); break;
        case 10: this.subFlags(a, b); break;
        case 11: this.addFlags(a, b, 0); break;
        case 12: r[rd] = this.nz(a | b); break;
        case 13: r[rd] = this.nz(Math.imul(a, b)); break;
        case 14: r[rd] = this.nz(a & ~b); break;
        default: r[rd] = this.nz(~b); break;
      }
      return nxt;
    }
    if (h >>> 10 === 0x11) {                            // hi reg ops / bx
      const op = (h >>> 8) & 3;
      const rd = (h & 7) | ((h >>> 4) & 8);
      const rm = (h >>> 3) & 15;
      const vm = rm === 15 ? pc + 4 : r[rm];
      if (op === 3) {
        if (h & 0x80) r[14] = (pc + 2) | 1;
        return (vm & ~1) >>> 0;
      }
      const vd = rd === 15 ? pc + 4 : r[rd];
      let res: number;
      if (op === 0) res = (vd + vm) >>> 0;
      else if (op === 1) { this.subFlags(vd, vm); return nxt; }
      else res = vm >>> 0;
      if (rd === 15) return (res & ~1) >>> 0;
      r[rd] = res;
      return nxt;
    }
    if (h >>> 11 === 9) {                               // ldr pc-rel
      r[(h >>> 8) & 7] = m.r32(((pc + 4) & ~3) + (h & 0xff) * 4);
      return nxt;
    }
    if (h >>> 12 === 5) {                               // ld/st reg offset
      const rd = h & 7, rb = (h >>> 3) & 7, ro = (h >>> 6) & 7;
      const a = (r[rb] + r[ro]) >>> 0;
      const op = (h >>> 10) & 3;
      if (((h >>> 9) & 1) === 0) {
        if (op === 0) m.w32(a, r[rd]);
        else if (op === 1) m.w8(a, r[rd] & 0xff);
        else if (op === 2) r[rd] = m.r32(a);
        else r[rd] = m.r8(a);
      } else {
        if (op === 0) m.w16(a, r[rd] & 0xffff);
        else if (op === 1) r[rd] = s8(m.r8(a));
        else if (op === 2) r[rd] = m.r16(a);
        else r[rd] = s16(m.r16(a));
      }
      return nxt;
    }
    if (h >>> 13 === 3) {                               // ld/st imm
      const b = (h >>> 12) & 1, l = (h >>> 11) & 1;
      const imm = (h >>> 6) & 31;
      const rd = h & 7, rb = (h >>> 3) & 7;
      const a = (r[rb] + (b ? imm : imm * 4)) >>> 0;
      if (l) r[rd] = b ? m.r8(a) : m.r32(a);
      else if (b) m.w8(a, r[rd] & 0xff);
      else m.w32(a, r[rd]);
      return nxt;
    }
    if (h >>> 12 === 8) {                               // ldrh/strh imm
      const rd = h & 7, rb = (h >>> 3) & 7;
      const a = (r[rb] + ((h >>> 6) & 31) * 2) >>> 0;
      if ((h >>> 11) & 1) r[rd] = m.r16(a);
      else m.w16(a, r[rd] & 0xffff);
      return nxt;
    }
    if (h >>> 12 === 9) {                               // sp-rel
      const rd = (h >>> 8) & 7;
      const a = (r[13] + (h & 0xff) * 4) >>> 0;
      if ((h >>> 11) & 1) r[rd] = m.r32(a);
      else m.w32(a, r[rd]);
      return nxt;
    }
    if (h >>> 12 === 10) {                              // add rd, pc/sp
      const base = (h >>> 11) & 1 ? r[13] : (pc + 4) & ~3;
      r[(h >>> 8) & 7] = base + (h & 0xff) * 4;
      return nxt;
    }
    if (h >>> 8 === 0xb0) {                             // add/sub sp
      const v = (h & 0x7f) * 4;
      r[13] = h & 0x80 ? r[13] - v : r[13] + v;
      return nxt;
    }
    if (h >>> 12 === 0xb && ((h >>> 9) & 3) === 2) {    // push/pop
      if ((h >>> 11) & 1) {
        let a = r[13];
        for (let i = 0; i < 8; i++) {
          if (h & (1 << i)) { r[i] = m.r32(a); a += 4; }
        }
        let ret = nxt;
        if (h & 0x100) { ret = (m.r32(a) & ~1) >>> 0; a += 4; }
        r[13] = a;
        return ret;
      }
      let n = (h & 0x100) ? 1 : 0;
      for (let i = 0; i < 8; i++) if (h & (1 << i)) n++;
      let a = (r[13] - 4 * n) >>> 0;
      r[13] = a;
      for (let i = 0; i < 8; i++) {
        if (h & (1 << i)) { m.w32(a, r[i]); a += 4; }
      }
      if (h & 0x100) m.w32(a, r[14]);
      return nxt;
    }
    if (h >>> 12 === 0xc) {                             // ldmia/stmia
      const rb = (h >>> 8) & 7, load = (h >>> 11) & 1;
      let a = r[rb];
      for (let i = 0; i < 8; i++) {
        if (h & (1 << i)) {
          if (load) r[i] = m.r32(a);
          else m.w32(a, r[i]);
          a += 4;
        }
      }
      if (!(load && h & (1 << rb))) r[rb] = a;
      return nxt;
    }
    if (h >>> 12 === 0xd) {                             // cond branch
      const c = (h >>> 8) & 15;
      if (c >= 14) throw new Error(`swi/udf at 0x${pc.toString(16)}`);
      return this.cond(c) ? pc + 4 + s8(h & 0xff) * 2 : nxt;
    }
    if (h >>> 11 === 0x1c) {                            // b
      let o = h & 0x7ff;
      if (o & 0x400) o -= 0x800;
      return pc + 4 + o * 2;
    }
    if (h >>> 11 === 0x1e) {                            // bl/blx prefix
      const h2 = m.r16(pc + 2);
      let hi = h & 0x7ff;
      if (hi & 0x400) hi -= 0x800;
      let tgt = pc + 4 + hi * 4096 + ((h2 & 0x7ff) << 1);
      const blx = h2 >>> 11 === 0x1d;
      if (blx) tgt = (tgt & ~3) >>> 0;
      const ret = pc + 4;
      const stub = this.stubs.get(tgt);
      if (stub !== undefined) {
        stub(this);
        return ret;
      }
      if (blx) throw new Error(`blx to ARM 0x${tgt.toString(16)} at 0x${pc.toString(16)}`);
      r[14] = ret | 1;
      return tgt;
    }
    throw new Error(`unknown insn ${h.toString(16).padStart(4, '0')} at 0x${pc.toString(16)}`);
  }
}
