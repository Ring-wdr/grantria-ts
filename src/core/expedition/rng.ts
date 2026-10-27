// 원정(가제): a small seeded random source (mulberry32), so a zone can be built again from its seed.

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }

  /** 0 <= x < 1 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** a <= x < b */
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** a <= n <= b */
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.next() * xs.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  /** an index by weight */
  weighted(ws: readonly number[]): number {
    let r = this.next() * ws.reduce((s, w) => s + w, 0);
    for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) < 0) return i;
    return ws.length - 1;
  }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
    return xs;
  }
}
