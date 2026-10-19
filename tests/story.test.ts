// Checks the event / quest table reads against the analysis notes (events §0.1, §2.1, §3).
// Needs the built assets (npm run assets) for d.dat.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Story, StoryDb } from '../src/core/data/story.ts';

const DDAT = new URL('../public/assets/d.dat', import.meta.url);
const skip = existsSync(DDAT) ? false : 'needs npm run assets (generated from your own APK)';
const ddat = skip ? new Uint8Array(0) : new Uint8Array(readFileSync(DDAT));
const a = {
  ddat,
  d8: (o: number) => ddat[o],
  s8: (o: number) => (ddat[o] << 24) >> 24,
  d16: (o: number) => ddat[o] | (ddat[o + 1] << 8),
  text: [] as string[],
};
const db = skip ? (null as unknown as StoryDb) : new StoryDb(a as never);

test('event headers and script records', { skip }, () => {
  assert.deepEqual(db.headers[0], { map: -1, kind: 0, p1: 0, p2: 0, textBase: 3783 });
  assert.deepEqual(db.headers[110], { map: 20, kind: 2, p1: 0x0c05, p2: 0x1006, textBase: db.headers[110].textBase });
  assert.deepEqual(db.headers[1], { map: 22, kind: 3, p1: 62, p2: 109, textBase: 3832 });
  assert.deepEqual(db.range(0), [0, 159]);
  assert.deepEqual(db.rec(0, 0), { time: 0, cmd: 2, arg: 0 });
  assert.deepEqual(db.rec(0, 4), { time: 8, cmd: 0x16df + 48, arg: (16 << 8) | 11 });
});

test('quests and new-game states', { skip }, () => {
  assert.equal(db.quests[0].kind, 3);
  assert.equal(db.quests[0].report, 62);
  const s = Story.fresh(1);
  assert.equal(s.qs[0], 5);
  assert.equal(s.qs[19], 0);
  assert.equal(s.qs[57], 0);
  const r = Story.from(JSON.parse(JSON.stringify(s.toJSON())), 1);
  assert.deepEqual(Array.from(r.qs), Array.from(s.qs));
});

test('a main quest taken by an event is not refused by six side quests; stuck saves are repaired', { skip }, async () => {
  const { QuestLog } = await import('../src/core/rules/quests.ts');
  const gained: number[][] = [], popups: number[] = [];
  const host = {
    inv: { gold: 0, items: [], cap: 99, keyCount: () => 0, removeKey() {}, gain: (t: number, s: number) => { gained.push([t, s]); return true; } },
    rng: {}, questPopup: (p: number) => { popups.push(p); }, message() {}, grantExp() {}, sfx() {},
  };
  // the reported save: event 0x61 completed 0x8d with six side quests taken, so 0x8e was refused and
  // events 0x62 / 0x64 / 0x65 ran on without it
  const story = Story.fresh(1);
  for (let q = 57; q <= 0x8d; q++) story.qs[q] = 4;
  story.qs[0x8e] = 1;
  const sides = Array.from({ length: 152 }, (_, q) => q).filter((q) => q >= 57 && !db.mainQuest(q)).slice(0, 6);
  for (const q of sides) story.qs[q] = 2;
  story.active = sides.map((q) => ({ q, cnt: 0, pct: 0 }));
  const log = new QuestLog(db, story, host as never);
  assert.equal(log.accept(0x8e), true);                            // the seventh slot
  assert.equal(story.active[0].q, 0x8e);
  assert.equal(story.active.length, 7);
  assert.deepEqual(popups, [0x1e]);
  story.qs[0x8e] = 1; story.active.shift(); popups.length = 0;   // back to the stuck save
  for (const e of [0x61, 0x62, 0x64, 0x65]) story.set(e);
  assert.deepEqual(log.repairEventChain((e) => story.isDone(e)), [0x8e, 0x8f, 0x95, 0x96]);
  assert.deepEqual([0x8e, 0x8f, 0x95, 0x96].map((q) => story.qs[q]), [4, 4, 4, 3]);
  assert.ok(story.active.some((a) => a.q === 0x96));
  assert.deepEqual(gained, [[0x1d, 3]]);                           // 0x8f's reward
  assert.deepEqual(popups, []);
  assert.deepEqual(log.repairEventChain((e) => story.isDone(e)), []);
});
