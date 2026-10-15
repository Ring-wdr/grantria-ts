// 일괄 판매 / 일괄 버리기 / 일괄 분해 (not in the original): which bag items an "everything up to grade N" order takes.
// Only plain equipment: no enhanced items, nothing with a gem in a socket, never quest / key / premium (0x1b, coupon
// shop) items or materials (the shop refuses those anyway, shop.ts precheck code 7). Equipped items are not in the
// bag list.
import type { Item } from './items';

export function bulkSellPick(items: readonly (Item | null | undefined)[], maxGrade: number): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (!it || it.type >= 0x10 || it.grade > maxGrade || it.enh > 0) return;
    if (it.sockets.some((g) => g !== 0xff)) return;
    out.push(i);
  });
  return out;
}

/** 조합서 일괄 버리기: recipes (0x19) up to a grade (0..3) */
export const RECIPE_GRADE_MAX = 3;
export function bulkRecipePick(items: readonly (Item | null | undefined)[], maxGrade: number): number[] {
  const out: number[] = [];
  items.forEach((it, i) => { if (it && it.type === 0x19 && it.grade <= maxGrade) out.push(i); });
  return out;
}
