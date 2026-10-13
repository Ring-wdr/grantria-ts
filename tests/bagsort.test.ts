// 가방정리 (Inventory.sortBag, FUN_0003b3a8(0)): type groups in type order, the exchange sort on sub
// inside a group, item quick slots following their item. Needs no game data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Inventory, type Item, type ItemDb } from '../src/game/items.ts';

const item = (type: number, sub: number, tag: string, grade = 0) => ({ type, sub, grade, name: tag }) as unknown as Item;

test('sortBag groups by type and orders each group by sub', () => {
  const inv = new Inventory({} as ItemDb);
  inv.items = [item(0x11, 3, 'a'), item(2, 5, 'b'), item(0x11, 1, 'c'), item(2, 1, 'd'), item(0x1b, 0, 'e'), item(2, 5, 'f'), item(0, 9, 'g')];
  inv.sortBag();
  assert.deepEqual(inv.items.map((it) => `${it.type}:${it.sub}`), ['0:9', '2:1', '2:5', '2:5', '17:1', '17:3', '27:0']);
});

test('sortBag repeats the original exchange sort, not a stable sort', () => {
  // for i, for j < i: swap when sub[i] < sub[j]; equal subs keep the pass order this produces
  const inv = new Inventory({} as ItemDb);
  inv.items = [item(2, 5, 'x'), item(2, 5, 'y'), item(2, 1, 'z')];
  inv.sortBag();
  assert.deepEqual(inv.items.map((it) => it.name), ['z', 'y', 'x']);   // i=2, j=0 swaps z with x
});

test('sortBag moves item quick slots with their item', () => {
  const inv = new Inventory({} as ItemDb);
  inv.items = [item(0x11, 3, 'hp'), item(2, 0, 'sword')];
  Object.assign(inv.quick[0], { kind: 2, id: 0, itemType: 0x11, itemSub: 3 });
  inv.sortBag();
  assert.equal(inv.items[inv.quick[0].id].name, 'hp');
  assert.equal(inv.quick[0].id, 1);
});
