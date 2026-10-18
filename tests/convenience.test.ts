import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadLog } from '../src/core/save/readLog.ts';
import { existsSync, readFileSync } from 'node:fs';
import { compareGear, equipSlot } from '../src/core/rules/compare.ts';
import { mainStat } from '../src/core/rules/shopRules.ts';
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

// option -> derived index d+0x22a6a; no sets or gems, a level 1 player with no stats (ATK = rdiv(weapon·(100 + %), 100) + 1)
const DDAT = new URL('../public/assets/d.dat', import.meta.url);
const skip = existsSync(DDAT) ? false : 'needs npm run assets (generated from your own APK)';
const ddat = skip ? new Uint8Array(0) : new Uint8Array(readFileSync(DDAT));
const tables = { optionIndex: Array.from({ length: 64 }, (_, i) => (ddat[0x22a6a + i] << 24) >> 24), setBonus: () => [], gemValue: () => 0 };
const P = { cls: 0, level: 1, stats: [0, 0, 0, 0] } as const;
const cmp = (it: Item, equip: (Item | null)[]) => compareGear(it, equip, { ...P, stats: [...P.stats] }, tables);

test('gear comparison: summed options, sockets', { skip }, () => {
  const worn = gear({ base: 30, options: [[2, 5], [7, 3], [0xff, 0]], sockets: [12, 0xff, 0xff, 0xff, 0xff] });
  const it = gear({ base: 42, count: 4, options: [[2, 2], [2, 4], [9, 1]] });
  const d = cmp(it, [worn]);
  assert.deepEqual(d.stat, [31, 43]);
  assert.deepEqual(d.options, [[2, 1], [7, -3], [9, 1]]);
  assert.deepEqual(d.gems, [0, 4]);
  assert.deepEqual(d.socketsOld, [1, 3]);
  assert.deepEqual(cmp(it, []).stat, [2, 43]);                                  // bare hands: ATK 1 + level
  assert.deepEqual([equipSlot(gear({ type: 0 })), equipSlot(gear({ type: 7 })), equipSlot(gear({ type: 15 }))], [0, 2, 5]);
  assert.equal(d.enh, null);
  // 공격력 % 0x1b and 0 (one text, one effect) are one line
  assert.deepEqual(cmp(gear({ options: [[0, 10], [0x1b, 5]] }), [gear({ options: [[0x1b, 3]] })]).options, [[0, 12]]);
});

test('gear comparison is the character stat after the swap: % rounding, enhancement, 총방어력, resistances', { skip }, () => {
  // the report: 29 with 공격력 +41% is rdiv(29 * 141, 100) = 41, the same as a plain 41
  const staff = gear({ base: 29, options: [[0x15, 14], [0x1b, 41], [0x27, 1]] });
  assert.deepEqual(mainStat(staff), { value: 41, bonus: 0 });
  assert.deepEqual(cmp(staff, [gear({ base: 41 })]).stat, [42, 42]);
  // weapon 100 +3 (bonus 12) with 10%: the % lifts the bonus too, rdiv(112 * 110, 100) = 123
  assert.deepEqual(cmp(gear({ base: 100, enh: 3, options: [[0x1b, 10]] }), [gear({ base: 110 })]).stat, [111, 124]);
  // armour 15 with 방어력 +10% and +13%: rdiv(15 * 123, 100) = 18 against 19
  const ar = gear({ type: 3, base: 15, options: [[2, 10], [0x21, 13]] });
  assert.deepEqual(mainStat(ar), { value: 18, bonus: 0 });
  assert.deepEqual(cmp(ar, [null, gear({ type: 3, base: 19 })]).stat, [19, 18]);
  // 총방어력 +30% multiplies the whole DEF: (20 + 50) -> rdiv(70 * 130, 100)
  const other = gear({ type: 6, base: 50 });
  assert.deepEqual(cmp(gear({ type: 3, base: 20, options: [[0x22, 30]] }), [null, gear({ type: 3, base: 20 }), other]).stat, [70, 91]);
  // accessory: the lowest of the three resistances
  assert.deepEqual(cmp(gear({ type: 15, base: 5, options: [[0x24, 3]] }), []).stat, [0, 8]);
  assert.deepEqual(cmp(gear({ type: 15, base: 5, options: [[3, 4]] }), []).stat, [0, 5]);
  // armour under base 10 takes the enhancement level as its bonus (FUN_00037238)
  assert.deepEqual(cmp(gear({ type: 3, base: 8, enh: 20 }), []).stat, [0, 28]);
  // gear it cannot wear adds nothing: the slot counts as empty
  const high = cmp(gear({ base: 90, reqLevel: 50 }), [gear({ base: 10 })]);
  assert.deepEqual([high.usable, high.stat], [false, [11, 2]]);
});

test('gear comparison: the armour enhancement effect', { skip }, () => {
  // armour type 3: +5 (crit 1) against +10 (crit round(1000 / 580) + 1 = 3) -> crit -2
  assert.deepEqual(cmp(gear({ type: 3, base: 20, enh: 5 }), [null, gear({ type: 3, base: 20, enh: 10 })]).enh, [0x1a, -2]);
  assert.deepEqual(cmp(gear({ type: 3, base: 20, enh: 5 }), []).enh, [0x1a, 1]);
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

test('bulk orders leave a locked item', async () => {
  const { bulkSellPick } = await import('../src/core/rules/bulkSell.ts');
  assert.deepEqual(bulkSellPick([gear({ grade: 0 }), gear({ grade: 0, lock: 1 }), gear({ grade: 1 })], 1), [0, 2]);
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

test('item detail lines: stat with options and enhancement bonus, armour enhancement effect', async () => {
  const { detailLines, enhEffect } = await import('../src/core/rules/shopRules.ts');
  const text: string[] = [];
  text[0x1afd] = 'A* %d + %d'; text[0x1afe] = 'A %d + %d'; text[0x1aff] = 'D* %d + %d'; text[0x1b00] = 'D %d + %d';
  text[0x1b01] = 'R* %d'; text[0x1b02] = 'R %d'; text[0x1c65] = '+%d:%s'; text[0x1acf] = '%s';
  text[0x7b4 + 0x1a] = 'crit %d%%'; text[0x7b4 + 0x25] = 'all %d';
  const a = { text } as never;
  // weapon base 100, +10% attack option, +3 (bonus 12): rdiv(100 * 110, 100) = 110, rdiv(112 * 110, 100) - 110 = 13
  assert.deepEqual(detailLines(a, gear({ type: 0, base: 100, enh: 3, options: [[0x1b, 10], [5, 3]] })), { stat: 'A* 110 + 13', enh: null });
  assert.equal(detailLines(a, gear({ type: 1, base: 100, enh: 0, options: [] })).stat, 'A 100 + 0');
  // armour type 3 (+5): crit = round(125 / 580) + 1 = 1; type 6 (+10): all stats = round(1000 / 200) + 5 = 10
  assert.equal(detailLines(a, gear({ type: 3, base: 20, enh: 5 })).enh, '+5:crit 1%');
  assert.equal(detailLines(a, gear({ type: 6, base: 20, enh: 10 })).enh, '+10:all 10');
  assert.equal(detailLines(a, gear({ type: 15, base: 7, options: [[0x24, 3]] })).stat, 'R* 10');
  assert.equal(enhEffect(gear({ type: 4, enh: 0 })), null);
});

test('title detail effects: option text with the worn and the owned value', async () => {
  const { titleEffectText } = await import('../src/core/rules/achievements.ts');
  const d = new Uint8Array(0x25473 + 5 * 4);
  d.set([1, 0, 5, 1, 0], 0x25473 + 5 * 3);
  const text: string[] = []; text[0x1b12] = '<%s>'; text[0x7b4] = 'atk +%d%%';
  assert.deepEqual(titleEffectText({ d8: (o: number) => d[o], text }, 3), { worn: '<atk +5%>', owned: '<atk +1%>' });
});
