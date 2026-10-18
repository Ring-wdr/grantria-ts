// Checks the shop formulas (src/core/rules/shopRules.ts) against tests/fixtures/shop/*.json, which
// tools/grantria_shop.py produces by running the original native code of your own APK (npm run fixtures).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { enhGold, enhRate, enhStones, itemPrice, priceOf } from '../src/core/rules/shopRules.ts';

const DDAT = new URL('../public/assets/d.dat', import.meta.url), FIX = new URL('./fixtures/shop/enhance.json', import.meta.url);
const skip = !existsSync(DDAT) || !existsSync(FIX) ? 'needs npm run assets and npm run fixtures (generated from your own APK)' : false;
const noAssets = existsSync(DDAT) ? false : 'needs npm run assets (generated from your own APK)';
const ddat = noAssets ? new Uint8Array(0) : new Uint8Array(readFileSync(DDAT));
const a = { ddat, d8: (o: number) => ddat[o], s8: (o: number) => (ddat[o] << 24) >> 24, d16: (o: number) => ddat[o] | (ddat[o + 1] << 8), text: [] } as never;
const data = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/shop/${f}.json`, import.meta.url), 'utf-8'));
const item = (o: Record<string, number>) => ({ type: 0, sub: 0, grade: 0, base: 0, icon: 0, count: 0, enh: 0, level: 1, reqLevel: 1, aux: 0, sockets: [], options: [], name: '', ...o });

test('enhancement stones, gold and rate (normal and tier 2)', { skip }, () => {
  let n = 0;
  for (const row of data('enhance').table) {
    row.by_enh.forEach((e: { stones: number; gold: number; rate_pct: number }, enh: number) => {
      const it = item({ type: 0, sub: row.sub, grade: row.grade, enh, level: row.level, reqLevel: row.level });
      assert.equal(enhStones(a, it as never), e.stones, `stones sub ${row.sub} g ${row.grade} +${enh}`);
      assert.equal(enhGold(a, it as never), e.gold, `gold sub ${row.sub} g ${row.grade} +${enh}`);
      assert.equal(enhRate(a, enh), e.rate_pct);
      n++;
    });
  }
  assert.ok(n > 500);
});

test('shop stock prices', { skip }, () => {
  for (const reg of data('stock').regions) {
    for (const e of [...reg.equipment_shop, ...reg.item_shop, ...reg.equipment_shop_tier2, ...reg.item_shop_tier2]) {
      const lvl = e.level || 1;
      const it = item({ type: e.type, sub: e.sub, grade: e.grade, level: lvl, reqLevel: lvl });
      assert.equal(itemPrice(a, it as never), e.price, `region ${reg.region} ${e.type}/${e.sub}`);
    }
  }
});

test('a stored price of 0 is priced again (items that came back from an original export)', { skip: noAssets }, () => {
  const it = item({ type: 1, sub: 0, base: 29, count: 2, price: 0 });
  assert.equal(priceOf(a, it as never), itemPrice(a, it as never));
  assert.equal(it.price, 11);
  assert.equal(priceOf(a, item({ type: 1, sub: 0, count: 2, price: 55 }) as never), 55);   // a real stored price stays
});

test('items are priced at creation and keep it through enhancement and new sockets', { skip: noAssets }, async () => {
  const { ItemDb } = await import('../src/core/rules/items.ts');
  const { Rng } = await import('../src/core/rules/rules.ts');
  const json = (p: string) => JSON.parse(readFileSync(new URL(`../public/assets/items/${p}.json`, import.meta.url), 'utf-8'));
  const db = new ItemDb(a);
  db.t = Object.fromEntries(['options', 'consumables', 'sets', 'starting'].map((n) => [n, json(n)])) as never;
  const rng = new Rng(7n, () => 0);
  for (const [t, s, g] of [[1, 0, 0], [2, 1, 1], [0x10, 0, 0], [0x11, 0, 0], [0x13, 3, 0], [0x17, 0, 0], [0x18, 0, 0], [0x1b, 0x21, 0]]) {
    const it = db.create(t, s, g, rng);
    assert.equal(it.price, itemPrice(a, it), `type ${t} sub ${s}`);
    assert.ok(it.price! > 0, `type ${t} sub ${s}`);
  }
  const staff = db.create(1, 0, 0, rng), p = staff.price;
  staff.enh = 5; staff.count = 5;                                          // the original never prices again
  assert.equal(priceOf(a, staff), p);
});
