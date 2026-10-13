// Class guide arrows (core/rules/guide.ts) with the tables the asset build extracts from libGrantria.so.
// Skipped without generated assets (public/assets comes from the player's own APK).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pickGuide } from '../src/core/rules/guide.ts';

const file = new URL('../public/assets/tables.json', import.meta.url);
const tables = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')).guideMarkers : undefined;

test('guide arrow follows class, map and the first main quest', { skip: !tables && 'no generated assets' }, () => {
  const none = () => false, main = () => true;
  const g = pickGuide(tables, 0, 18, none, [0], main);
  assert.ok(g && g !== 'keep' && g.x >= 0 && g.y >= 0);
  assert.equal(pickGuide(tables, 0, 18, (m) => m === 0x1e, [0], main), null);   // landmark visited
  assert.equal(pickGuide(tables, 0, 0x40, none, [0], main), null);               // outside the class range
  assert.equal(pickGuide(tables, 0, 18, none, [1], main), null);                 // quest without a column
  assert.equal(pickGuide(tables, 0, 18, none, [0], () => false), null);          // no main quest active
});
