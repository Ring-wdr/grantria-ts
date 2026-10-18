// Text metrics of the original bitmap font (text-rendering.md §0.3), shared by the logic that wraps game text and
// the renderers that draw it.

export const isHangul = (ch: number): boolean => ch >= 0xac00 && ch <= 0xd7a3;

/** FUN_00078e84: 2 + 10 per Hangul, 6 per ASCII; '@' and '|x' count 0. */
export function stringWidth(s: string): number {
  let w = 2;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 0x7c) { i++; continue; }
    if (ch === 0x40) continue;
    w += isHangul(ch) ? 10 : ch < 0x80 ? 6 : 0;
  }
  return w;
}
