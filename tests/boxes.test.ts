// Replays tests/fixtures/tier2_boxes.json (not in the repository): equipment boxes run through the original
// FUN_0003f6d8 -> GRAN_GET -> FUN_0003c944 chain in the emulator (clock 0). Checks the rand call order
// and the created items, normal and tier 2.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Inventory, ItemDb } from '../src/game/items.ts';
import { boxEquipment } from '../src/game/boxes.ts';
import { Rng } from '../src/game/rules.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url));
const skip = existsSync(new URL('../public/assets/d.dat', import.meta.url)) && existsSync(new URL('./fixtures/tier2_boxes.json', import.meta.url))
  ? false : 'needs npm run assets and tests/fixtures/tier2_boxes.json (emulator output of the original code)';
const ddat = skip ? new Uint8Array(0) : new Uint8Array(read('../public/assets/d.dat'));
const a = {
  ddat, d8: (o: number) => ddat[o], s8: (o: number) => (ddat[o] << 24) >> 24, d16: (o: number) => ddat[o] | (ddat[o + 1] << 8), text: [],
  json: async (p: string) => JSON.parse(read(`../public/assets/${p}`).toString('utf-8')),
} as never;
const cases = skip ? [] : JSON.parse(read('./fixtures/tier2_boxes.json').toString('utf-8')).cases;

test('equipment boxes match the original (rand order and items)', { skip }, async () => {
  const db = new ItemDb(a);
  await db.init();
  assert.ok(cases.length >= 18);
  for (const c of cases) {
    const tag = `box ${c.box_sub} L${c.level} lap ${c.lap} seed ${c.seed}`;
    db.tier2 = c.lap >= 2;
    const inv = new Inventory(db);
    const rng = new Rng(BigInt(c.seed), () => 0), log: number[][] = [];
    const raw = rng.rand.bind(rng);
    rng.rand = (n: number) => { const v = raw(n); log.push([n, v]); return v; };
    assert.equal(boxEquipment(db, inv, c.box_sub, c.level, c.class, rng), 'ok', tag);
    assert.deepEqual(log, c['rand_log[n,v,caller]'].map(([n, v]: number[]) => [n, v]), `${tag}: rand order`);
    assert.equal(inv.items.length, c.items.length, tag);
    c.items.forEach((e: Record<string, never>, i: number) => {
      const it = inv.items[i];
      assert.deepEqual([it.type, it.sub, it.grade, it.level, it.base, it.count, it.options],
        [e.type, e.sub, e.grade, e.level, e.base, e.count_or_sockets, e.options], `${tag}: item ${i}`);
    });
    assert.equal(db.tier2, c.tier2_after === 2, `${tag}: tier2 restored`);
  }
});
