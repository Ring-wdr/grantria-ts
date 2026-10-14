// 일괄 판매 (not in the original): which bag items a "sell everything up to grade N" order takes. Only plain
// equipment: no enhanced items, nothing with a gem in a socket, never quest / key / premium items (the shop
// refuses those anyway, shop.ts precheck code 7). Equipped items are not in the bag list.
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
