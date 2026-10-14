// 출석 보상 (not in the original): the first field frame of a new day (after the fortune) gives the next reward of
// a 7-day cycle; missing a day starts the streak again but not the cycle. Per slot, kept in the story counters
// (attendDay YYYYMMDD, attendStreak, attendCycle), so the slot save format does not change. The items come from the
// fortune's own table (d.dat 0x26ABF by level band, fortune.ts): 소길 slots on days 1..6, a 대길 slot on day 7,
// plus a 황금알 on day 7.

export interface AttendReward { day: number; items: { type: number; sub: number; count: number }[]; gold: number }

/** 황금알 (0x1b, 0x30): a server gift in the original, opened here into gold and a 대길 prize (fieldScene useMisc) */
export const GOLDEN_EGG: [number, number] = [0x1b, 0x30];

/** days between two YYYYMMDD dates */
function dayDiff(a: number, b: number): number {
  const t = (v: number) => Date.UTC(Math.floor(v / 10000), (Math.floor(v / 100) % 100) - 1, v % 100);
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** fortune table entry: band by level, slot 0..9 대길, 10..24 소길 */
export function fortunePrize(a: { d8(o: number): number }, level: number, slot: number): { type: number; sub: number; count: number } {
  const band = level < 30 ? 0 : level < 60 ? 1 : 2, o = 0x26abf + (band * 25 + slot) * 3;
  return { type: a.d8(o), sub: a.d8(o + 1), count: Math.max(1, a.d8(o + 2)) };
}

/** today's reward, or null when it was already taken; updates the counters */
export function attend(c: Record<string, number>, today: number, a: { d8(o: number): number }, level: number): AttendReward | null {
  const last = c.attendDay ?? 0;
  if (last === today) return null;
  c.attendStreak = last && dayDiff(last, today) === 1 ? (c.attendStreak ?? 0) + 1 : 1;
  c.attendDay = today;
  const day = (c.attendCycle ?? 0) % 7;
  c.attendCycle = day + 1;
  const items = [day === 6 ? fortunePrize(a, level, today % 10) : fortunePrize(a, level, 10 + ((day * 2 + today) % 15))];
  if (day === 6) items.push({ type: GOLDEN_EGG[0], sub: GOLDEN_EGG[1], count: 1 });
  return { day: day + 1, items, gold: level * 100 * (day + 1) };
}
