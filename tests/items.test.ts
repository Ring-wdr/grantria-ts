// Item description text ids (ItemDb.descId) follow the item detail of the original (FUN_00032344):
// equipment 0xa50 + model, gems one text per kind, later types 0x18 lower than their model.
// Recipes are named and levelled after their product (FUN_0003c944 case 0x19), item levels follow
// FUN_000369b0. Needs the assets generated from your own APK (npm run assets).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ItemDb } from '../src/game/items.ts';

const DDAT = new URL('../public/assets/d.dat', import.meta.url);
const skip = existsSync(DDAT) ? false : 'needs npm run assets (generated from your own APK)';
const ddat = skip ? new Uint8Array(0) : new Uint8Array(readFileSync(DDAT));
const text = skip ? [] : JSON.parse(readFileSync(new URL('../public/assets/text.json', import.meta.url), 'utf-8')) as string[];
const a = { ddat, d8: (o: number) => ddat[o], s8: (o: number) => (ddat[o] << 24) >> 24, d16: (o: number) => ddat[o] | (ddat[o + 1] << 8), text } as never;
const db = new ItemDb(a);
const desc = (type: number, sub: number, grade = 0) => text[db.descId(type, sub, grade)];
const name = (type: number, sub: number, grade = 0) => text[0x7fc + db.model(type, sub, grade)];

test('equipment descriptions are 1:1 with the model', { skip }, () => {
  assert.equal(db.descId(0, 0, 0), 0xa50 + db.model(0, 0, 0));
});

test('gems share one description per kind', { skip }, () => {
  for (let kind = 0; kind < 6; kind++) {
    for (let s = 1; s < 5; s++) assert.equal(desc(0x10, kind * 5 + s), desc(0x10, kind * 5), `kind ${kind}`);
    if (kind) assert.notEqual(desc(0x10, kind * 5), desc(0x10, (kind - 1) * 5));
  }
});

test('types after the gems sit 0x18 below their model', { skip }, () => {
  // the empty bottles' descriptions open with their own names only when the shift is right
  for (let s = 0; s < 6; s++) assert.ok(desc(0x17, s).startsWith(name(0x17, s)), `bottle ${s}`);
  assert.equal(db.descId(0x18, 0, 0), 0xa50 + db.model(0x18, 0, 0) - 0x18);
});

test('recipes are named and levelled after their product (FUN_0003c944 case 0x19)', { skip }, () => {
  const rng = { rand: () => 0 } as never;
  const rec = db.create(0x19, (1 << 4) | 2, 1, rng);                       // product: type 1, sub 2, grade 1
  assert.equal(rec.name, `|e${name(1, 2, 1)} ${name(0x19, 0x12, 1)}`);
  assert.equal(rec.level, db.levelOf(2));
});

test('item levels follow FUN_000369b0 (consumables read d+0x2466b)', { skip }, () => {
  const rng = { rand: () => 0 } as never;
  for (let s = 0; s < 42; s++) {
    const it = db.create(0x11, s, 0, rng);
    assert.equal(it.reqLevel, ddat[0x2466b + s]);
    assert.equal(it.level, it.reqLevel);
  }
  assert.equal(db.create(0x18, 0, 0, rng).reqLevel, 1);                    // other types: 1
  assert.equal(db.itemLevel(0, 4), ddat[0x24655 + 4]);                     // equipment: d+0x24655
});
