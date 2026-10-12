// Checks the shop formulas (src/game/shopRules.ts) against tests/fixtures/shop/*.json, which
// tools/grantria_shop.py produces by running the original native code of your own APK (npm run fixtures).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { enhGold, enhRate, enhStones, itemPrice } from '../src/game/shopRules.ts';

const DDAT = new URL('../public/assets/d.dat', import.meta.url), FIX = new URL('./fixtures/shop/enhance.json', import.meta.url);
const skip = !existsSync(DDAT) || !existsSync(FIX) ? 'needs npm run assets and npm run fixtures (generated from your own APK)' : false;
const ddat = skip ? new Uint8Array(0) : new Uint8Array(readFileSync(DDAT));
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
