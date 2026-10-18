// Daily fortune (운세, analysis/features/fortune.md): popup 0x54 on the first field frame of a new day,
// the local draw FUN_00052610 (대길 10 % / 소길 50 % / 꽝 40 %), one item from d.dat 0x26ABF by level band,
// the 대길 counter (+0x2e24, max 30) for titles 0x18 / 0x19. The server only granted permission (op 0x28).
import type { Rng } from './rules';
import type { Cmf } from '../data/assets';

export interface FortuneResult { grade: 0 | 1 | 2; slot: number; type: number; sub: number; count: number }

/** today as YYYYMMDD (the original compared only the day of the month) */
export function today(): number { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

/** FUN_00052610(1): rand(10000) < 1000 대길 (slot rand(10)), < 6000 소길 (slot 10 + rand(15)), else 꽝 */
export function drawFortune(a: { d8(o: number): number }, rng: Rng, level: number): FortuneResult | null {
  const r = rng.rand(10000);
  if (r >= 6000) return null;
  const grade: 1 | 2 = r < 1000 ? 1 : 2, slot = grade === 1 ? rng.rand(10) : 10 + rng.rand(15);
  const band = level < 30 ? 0 : level < 60 ? 1 : 2, o = 0x26abf + (band * 25 + slot) * 3;
  return { grade, slot, type: a.d8(o), sub: a.d8(o + 1), count: Math.max(1, a.d8(o + 2)) };
}

/** the fortune teller in the portrait box: 어둠의 상인 (actor 0x9e / 0xcd, cmf c72) at an idle frame */
export interface FortuneArt { cmf: Cmf; frame: number }

/** cmf of the portrait: FUN_00051edc loads actor 0xcd on map 0x79, else 0x9e (both type 72) via FUN_0004ed94 */
export const FORTUNE_CMF = 'cmf_c72';
