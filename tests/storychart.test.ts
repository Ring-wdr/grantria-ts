// The 회상 chart (core/data/storyChart.ts) holds every replayable story event exactly once, and nothing else.
// The coverage check needs the built assets (npm run assets) for d.dat and skips without them.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EVENT_COUNT, StoryDb } from '../src/core/data/story.ts';
import { BRANCHES, CHAPTERS, replayable, seenAlongRoute } from '../src/core/data/storyChart.ts';

const DDAT = new URL('../public/assets/d.dat', import.meta.url);
const skip = existsSync(DDAT) ? false : 'needs npm run assets (generated from your own APK)';
const ddat = skip ? new Uint8Array(0) : new Uint8Array(readFileSync(DDAT));
const a = { ddat, d8: (o: number) => ddat[o], s8: (o: number) => (ddat[o] << 24) >> 24, d16: (o: number) => ddat[o] | (ddat[o + 1] << 8), text: [] as string[] };
const db = skip ? (null as unknown as StoryDb) : new StoryDb(a as never);

test('the 회상 chart lists every replayable event once', { skip }, () => {
  const chart = [...BRANCHES.flat(), ...CHAPTERS.flatMap((c) => c.events)];
  assert.deepEqual(chart.filter((e, i) => chart.indexOf(e) !== i), [], 'duplicates');
  assert.deepEqual(chart.filter((e) => !replayable(db, e)), [], 'not replayable');
  const all = Array.from({ length: EVENT_COUNT }, (_, e) => e).filter((e) => replayable(db, e));
  assert.deepEqual(all.filter((e) => !chart.includes(e)), [], 'missing');
});

test('seeing an event opens the route before it', () => {
  assert.deepEqual(seenAlongRoute(0, [9]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 109, 114, 115, 116, 117, 118, 119, 120]);
  assert.deepEqual(seenAlongRoute(1, [5]), [5]);                      // another class's arc opens nothing
  const shared = seenAlongRoute(2, [31]);
  assert.ok(BRANCHES[2].every((e) => shared.includes(e)) && shared.includes(30) && shared.includes(31) && !shared.includes(32));
  assert.ok(!shared.includes(0) && !shared.includes(10));
  assert.deepEqual(seenAlongRoute(0, []), []);
});
