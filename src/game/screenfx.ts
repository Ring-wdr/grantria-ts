// Event screen filters of FUN_00030734 on the RGB565 screen buffer (FUN_000f8b00), events.md §0.4: the 8-tap box
// blur (mode 2) and the in-place smear (mode 6, an IIR pass that brightens: weights sum to 9/8). Indices are linear
// (y*W + x), so neighbours wrap across rows like the original.

const ch = (v: number, sh: number, m: number) => (v >> sh) & m;

/** f8b00(·, 2): rows 1..H-2, columns 2..W-1 average 8 samples (the 3x3 block without its bottom-right), read from a copy */
export function blur8(b: Uint16Array, W: number, H: number): void {
  const s = b.slice();
  for (let y = 1; y <= H - 2; y++) for (let x = 2; x <= W - 1; x++) {
    const i = y * W + x, n = [i - W - 1, i - W, i - W + 1, i - 1, i, i + 1, i + W - 1, i + W];
    let r = 0, g = 0, bl = 0;
    for (const k of n) { const v = s[k]; r += ch(v, 11, 31); g += ch(v, 5, 63); bl += v & 31; }
    b[i] = ((r >> 3) << 11) | ((g >> 3) << 5) | (bl >> 3);
  }
}

/** f8b00(s, 6), s = 0 or 1: from the centre (W-2, H-2) backwards by s+1, four pixels get the weighted sum >> 3 (saturated) */
export function smear(b: Uint16Array, W: number, H: number, s: 0 | 1): void {
  let C = (H - 1) * W - 2;
  for (let n = (H - 2) * ((W - 2) >> s); n > 0; n--, C -= s + 1) {
    const A = C - W - 1, P = C - W, Q0 = C, Q1 = C + 1, B = C + W - 1, R = C + W;
    if (A < 0) break;
    const one = (sh: number, m: number) => Math.min(m, (2 * ch(b[A], sh, m) + ch(b[P], sh, m) + 2 * ch(b[Q1], sh, m) + ch(b[Q0], sh, m) + 2 * ch(b[B], sh, m) + ch(b[R], sh, m)) >> 3);
    const o = (one(11, 31) << 11) | (one(5, 63) << 5) | one(0, 31);
    b[A] = b[Q1] = b[Q0] = b[B] = o;
  }
}
