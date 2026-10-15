import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadLog } from '../src/core/save/readLog.ts';
import { compareGear, equipSlot } from '../src/core/rules/compare.ts';
import type { Item } from '../src/core/rules/items.ts';

test('read log marks, persists and reloads text ids', () => {
  const r = ReadLog.load();
  assert.equal(r.has(0x5ac), false);
  r.mark(0x5ac); r.mark(7); r.mark(0xffff); r.mark(-1); r.mark(0x10000);
  assert.equal(r.has(0x5ac), true);
  assert.equal(r.count, 3);
  r.flush();
  const back = ReadLog.load();
  assert.deepEqual([back.has(0x5ac), back.has(7), back.has(0xffff), back.has(8)], [true, true, true, false]);
});

const gear = (o: Partial<Item>): Item => ({ type: 0, sub: 0, grade: 0, base: 10, icon: 0, count: 3, enh: 0, level: 1, reqLevel: 1,
  aux: 0, sockets: [0xff, 0xff, 0xff, 0xff, 0xff], options: [], name: '', ...o });

test('gear comparison: main stat, summed options, sockets', () => {
  const worn = gear({ base: 30, options: [[2, 5], [7, 3], [0xff, 0]], sockets: [12, 0xff, 0xff, 0xff, 0xff] });
  const it = gear({ base: 42, count: 4, options: [[2, 2], [2, 4], [9, 1]] });
  const d = compareGear(it, worn);
  assert.equal(d.base, 12);
  assert.deepEqual(d.options, [[2, 1], [7, -3], [9, 1]]);
  assert.deepEqual(d.gems, [0, 4]);
  assert.deepEqual(d.socketsOld, [1, 3]);
  assert.equal(compareGear(it, null).base, 42);
  assert.deepEqual([equipSlot(gear({ type: 0 })), equipSlot(gear({ type: 7 })), equipSlot(gear({ type: 15 }))], [0, 2, 5]);
});

test('bulk sell takes plain gear up to the grade only', async () => {
  const { bulkSellPick } = await import('../src/core/rules/bulkSell.ts');
  const items = [
    gear({ grade: 0 }), gear({ grade: 2 }), gear({ grade: 1, enh: 3 }), gear({ grade: 1, sockets: [5, 0xff, 0xff, 0xff, 0xff] }),
    gear({ type: 0x11, grade: 0 }), gear({ type: 15, grade: 1 }), null,
  ];
  assert.deepEqual(bulkSellPick(items, 1), [0, 5]);
  assert.deepEqual(bulkSellPick(items, 2), [0, 1, 5]);
});

test('recipe bulk discard takes recipes up to the grade only', async () => {
  const { bulkRecipePick } = await import('../src/core/rules/bulkSell.ts');
  const items = [gear({ type: 0x19, grade: 0 }), gear({ grade: 0 }), gear({ type: 0x19, grade: 2 }), null, gear({ type: 0x1b, grade: 0 }), gear({ type: 0x19, grade: 3 })];
  assert.deepEqual(bulkRecipePick(items, 0), [0]);
  assert.deepEqual(bulkRecipePick(items, 3), [0, 2, 5]);
});

test('특성의 구슬 purchase count survives a trait reset and a deleted slot', async () => {
  const acc = await import('../src/core/rules/account.ts');
  const sv = await import('../src/core/save/save.ts');
  const a = acc.account();
  a.traitBought = 10; a.traitPoints = 2; a.traits = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]; acc.saveAccount();
  acc.traitReset();
  assert.deepEqual([acc.account().traitBought, acc.account().traitPoints, acc.account().traits.every((v) => v === 0)], [10, 10, true]);
  sv.deleteSlot(0); sv.setLap(0, 0);
  assert.equal(acc.account().traitBought, 10);
});

test('attendance: one reward a day, streak and the 7-day cycle', async () => {
  const { attend } = await import('../src/core/rules/attendance.ts');
  const a = { d8: (o: number) => o % 7 };
  const c: Record<string, number> = {};
  const r1 = attend(c, 20261013, a, 40)!;
  assert.equal(r1.day, 1);
  assert.equal(attend(c, 20261013, a, 40), null);
  attend(c, 20261014, a, 40);
  assert.equal(c.attendStreak, 2);
  attend(c, 20261101, a, 40);                       // a gap: streak again from 1, cycle goes on
  assert.equal(c.attendStreak, 1);
  assert.equal(c.attendCycle, 3);
  for (const d of [20261102, 20261103, 20261104]) attend(c, d, a, 40);
  const r7 = attend(c, 20261105, a, 40)!;
  assert.equal(r7.day, 7);
  assert.equal(r7.items.length, 2);
  assert.equal(attend(c, 20261106, a, 40)!.day, 1);
});

test('records: item book, boss records, rush and abyss', async () => {
  const r = await import('../src/core/rules/records.ts');
  r.resetRecordsCache();
  assert.equal(r.recordItem(0, 3, 1), true);
  assert.equal(r.recordItem(0, 3, 0), false);
  assert.equal(r.recordItem(0, 3, 2), false);
  assert.equal(r.records().items['0:3'], 2);
  r.recordBoss(5, 400, false, 77); r.recordBoss(5, 300, true, 90);
  assert.deepEqual(r.records().bosses[5], { k: 2, best: 300, clean: true, map: 77 });
  assert.equal(r.recordRush(1000, 3, 0, 1), true);
  assert.equal(r.recordRush(900, 2, 0, 2), false);
  assert.equal(r.recordRush(1200, 4, 0, 3, true), true);
  r.recordAbyss(2, 3); r.recordAbyss(2, 1);
  assert.equal(r.deepestAbyss(), 3);
  r.resetRecordsCache();
  assert.equal(r.records().rush?.bosses, 4);                // persisted
});

test('extra challenges are reported once', async () => {
  const { extraCheck, extraKey } = await import('../src/core/rules/extraChallenges.ts');
  const s = { bossKinds: 10, cleanBoss: false, itemKinds: 120, rushBosses: 0, rushAll: false, abyss: 0, attendance: 1, replays: 0, lap: 0 };
  const c: Record<string, number> = {};
  assert.deepEqual(extraCheck(c, s).map((x) => x.id), [0, 2]);
  c[extraKey(0)] = 1;
  assert.deepEqual(extraCheck(c, s).map((x) => x.id), [2]);
});

test('extra challenge gold is paid once per account', async () => {
  const r = await import('../src/core/rules/records.ts');
  r.resetRecordsCache();
  assert.equal(r.extraPaid(3), false);
  r.markExtraPaid(3); r.markExtraPaid(3);
  assert.equal(r.extraPaid(3), true);
  r.resetRecordsCache();
  assert.deepEqual(r.records().extraPaid, [3]);             // persisted, a new slot sees it
});

test('a restored backup is read again, not overwritten by the loaded copies', async () => {
  const r = await import('../src/core/rules/records.ts');
  const { readLog, resetReadLogCache } = await import('../src/core/save/readLog.ts');
  const { platform } = await import('../src/core/platform.ts');
  r.resetRecordsCache(); r.records(); readLog();
  platform().storage.set('grantria.records', JSON.stringify({ items: {}, bosses: {}, abyss: {}, replays: 42 }));
  platform().storage.set('grantria.read', JSON.stringify(''));
  r.resetRecordsCache(); resetReadLogCache();
  assert.equal(r.records().replays, 42);
  assert.equal(readLog().has(0x5ac), false);
});

test('회상: seen story events are kept per class, account-wide', async () => {
  const r = await import('../src/core/rules/records.ts');
  r.resetRecordsCache();
  r.addSeen(0, [5, 0, 5]); r.addSeen(1, [10]);
  assert.deepEqual(r.seenEvents(0), [0, 5]);
  assert.deepEqual(r.seenEvents(2), []);
  assert.equal(r.records().seenFromSlots, false);
  r.markSeenFromSlots();
  r.resetRecordsCache();
  assert.deepEqual([r.seenEvents(0), r.seenEvents(1), r.records().seenFromSlots], [[0, 5], [10], true]);   // persisted
});
