// boss_boxes.json from the APK (src/extract/bosses.ts, FUN_000231e4 run by src/extract/thumbEmu.ts) against the
// Python build's output. Needs apk/ and public/assets (local only).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBossBoxes } from '../src/extract/bosses.ts';
import { apkDir, refBytes, refJson, skipExtract } from './extract-helper.ts';

test('boss_boxes.json matches the Python build', { skip: skipExtract }, async () => {
  const out = new Map<string, Uint8Array | string>();
  const t0 = performance.now();
  await buildBossBoxes(apkDir(), (p, data) => { out.set(p, data); });
  console.log(`buildBossBoxes ${(performance.now() - t0).toFixed(0)} ms`);
  const text = out.get('boss_boxes.json');
  assert.equal(typeof text, 'string');
  assert.deepStrictEqual(JSON.parse(text as string), refJson('boss_boxes.json'));
  // the same bytes, key order included
  assert.equal(text, new TextDecoder().decode(refBytes('boss_boxes.json')));
});
