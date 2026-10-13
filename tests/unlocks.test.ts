// Permanent unlock items (0x1b sub 1 / 9 / 10 / 13, +0x32a5 bits): GRAN_GET sets the bit instead of taking a
// bag slot, and old saves are migrated. No game data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Inventory, UNLOCK_1B, type Item, type ItemDb } from '../src/game/items.ts';
import { Rng } from '../src/game/rules.ts';

const fakeDb = { a: { text: [] as string[] }, model: () => 0 } as unknown as ItemDb;
const rng = new Rng(1n, () => 0);

test('gaining an unlock item sets its bit and takes no bag slot', () => {
  const inv = new Inventory(fakeDb);
  for (const [bit, sub] of UNLOCK_1B.entries()) {
    assert.equal(inv.unlocked(sub), false);
    assert.equal(inv.gain(0x1b, sub, 0, 1, rng), true);
    assert.equal(inv.unlocked(sub), true);
    assert.ok(inv.unlocks & (1 << bit));
  }
  assert.equal(inv.items.length, 0);
  assert.equal(inv.unlocks, 0b1111);
});

test('unlock items left in an old bag become bits and free their slots', () => {
  const inv = new Inventory(fakeDb);
  const it = (type: number, sub: number) => ({ type, sub, grade: 0 }) as unknown as Item;
  inv.items = [it(0x11, 1), it(0x1b, 9), it(0x1b, 0x1b), it(0x1b, 13)];
  Object.assign(inv.quick[0], { kind: 2, id: 2, itemType: 0x1b, itemSub: 0x1b });
  inv.migrateUnlocks();
  assert.deepEqual(inv.items.map((x) => x.sub), [1, 0x1b]);
  assert.equal(inv.unlocked(9) && inv.unlocked(13) && !inv.unlocked(1) && !inv.unlocked(10), true);
  assert.equal(inv.quick[0].id, 1);                                   // the coupon slot followed its item
});
