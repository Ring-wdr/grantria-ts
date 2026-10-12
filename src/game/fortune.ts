// Daily fortune (운세, analysis/features/fortune.md): popup 0x54 on the first field frame of a new day,
// the local draw FUN_00052610 (대길 10 % / 소길 50 % / 꽝 40 %), one item from d.dat 0x26ABF by level band,
// the 대길 counter (+0x2e24, max 30) for titles 0x18 / 0x19. The server only granted permission (op 0x28).
import type { Rng } from './rules';
import type { Ui } from './ui';

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

/** popup 0x55 contents (FUN_00051cc4 state 3 / 4), popup coordinates */
export function drawFortuneResult(u: Ui, text: string[], res: FortuneResult | null, item: { name: string; icon: { image: string; sx: number; sy: number } } | null): void {
  u.roundFill(8, 8, 206, 71, 0, 2);
  u.roundFill(8, 85, 206, 81, 0, 2);
  if (!res || !item) {
    u.string(text[0x1b60] ?? '', 155, 35, 'center');
    u.string(text[0x1b61] ?? '', 111, 120, 'center', { pen: 0xf800 });
    return;
  }
  u.string(text[0x1b5f] ?? '', 155, 30, 'center');
  u.string(text[res.grade === 1 ? 0x1c23 : 0x1c24] ?? '', 155, 50, 'center', { pen: 0xffe0 });
  u.paragraph(text[res.grade === 1 ? 0x99 + res.slot : 0xa3 + res.slot - 10] ?? '', 111, 92, 198, 'center', 15, { pen: 0xffe0 });
  u.image(item.icon.image, item.icon.sx, item.icon.sy, 16, 16, 64, 129);
  u.string(`${item.name} X ${res.count}`, 84, 129);
}
