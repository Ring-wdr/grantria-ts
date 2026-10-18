// Text metrics of the original bitmap font (text-rendering.md §0.3), shared by the logic that wraps game text and
// the renderers that draw it, and the josa codes of game text.

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

/** josa codes (text-rendering.md §0.6): |[ 는/은, |] 가/이, |{ 를/을, |} 로/으로, |( 와/과 */
export function josa(s: string): string {
  return s.replace(/\|([[\]{}(])/g, (_m, c: string, off: number) => {
    let i = off - 1;
    while (i >= 1 && s[i - 1] === '|') i -= 2;
    const ch = s.charCodeAt(i);
    const hangul = ch >= 0xac00 && ch <= 0xd7a3;
    const jong = hangul ? (ch - 0xac00) % 28 : 1;
    const has = jong !== 0;
    switch (c) {
      case '[': return has ? '은' : '는';
      case ']': return has ? '이' : '가';
      case '{': return has ? '을' : '를';
      case '}': return has && jong !== 8 ? '으로' : '로';
      default: return has ? '과' : '와';
    }
  });
}
