// Original save files: XTEA against tools/grantria_save.py, slot and gamedata round trips, checksums.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SLOT_SIZE, buildGamedata, buildOption, buildSlot, fileKind, memberFromName, parseGamedata, parseOption, parseSlot, xtea } from '../src/core/save/origfile.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sum8 = (b: Uint8Array, end: number) => b.subarray(0, end).reduce((s, x) => s + x, 0) & 0xff;

test('xtea matches grantria_save.encrypt and inverts', () => {
  const plain = Uint8Array.from({ length: 16 }, (_, i) => i);
  const enc = xtea(plain, true);
  assert.equal(hex(enc), '64c8b20fae38849ab21b56f98f994176');
  assert.deepEqual(xtea(enc, false), plain);
});

test('file names and kinds', () => {
  assert.equal(memberFromName('save.dat.123456789'), 123456789n);
  assert.equal(memberFromName('save.dat'), 0n);
  assert.equal(fileKind(0x9a68), 'save');
  assert.equal(fileKind(0x3d8), 'gamedata');
});

test('slot round trip keeps the web fields and a valid checksum', () => {
  const item = { type: 0, sub: 3, grade: 2, base: 120, icon: 5, count: 3, enh: 7, level: 25, reqLevel: 25, aux: 3,
    sockets: [101, 0xff, 0xff, 0xff, 0xff, 0xff], options: [[6, 6], [23, 10]] as [number, number][], name: '|b용사의 검', price: 900 };
  const save = {
    version: 1 as const, cls: 1 as const, level: 57, exp: 123456, gold: 777777, stats: [10, 20, 30, 40], statPoints: 3,
    map: 121, zone: 2, x: 664, y: 253, dir: 2 as const, hp: 500, mp: 200, playTicks: 99999, savedAt: 0,
    skills: [1, 2, 3, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0], skillPoints: 4, buffs: [[10, 1], [0, 0]] as [number, number][], day: 0, returnZone: 3,
    story: { done: [0, 5, 163], qs: new Array(152).fill(0).map((_, i) => i % 6), active: [{ q: 7, cnt: 2, pct: 0 }], zones: [], maps: [10, 18, 121],
      collect: [1, 2], chests: [86], doors: [3], stones: [3, 4], gather: { lv: 2, exp: 40 }, dimClears: 2, titles: [0, 29], title: 29,
      challenges: [0, 1], counters: { vermutKills: 1 } },
    inv: { items: [item], equip: [item, null, null, null, null, null], quick: [{ kind: 2, id: 0, cd: 0, maxCd: 100, itemType: 0, itemSub: 3 }], gold: 777777, bags: 1 },
  };
  const member = 4242n;
  const b = buildSlot(save as never, member);
  assert.equal(b.length, SLOT_SIZE);
  assert.equal(b[0x3370], sum8(b, 0x3370));
  const back = parseSlot(b, null, 0)!;
  for (const k of ['cls', 'level', 'exp', 'gold', 'stats', 'statPoints', 'map', 'zone', 'x', 'y', 'dir', 'hp', 'mp', 'playTicks', 'skills', 'skillPoints', 'returnZone'] as const) {
    assert.deepEqual(back[k], save[k], k);
  }
  const s = back.story!;
  assert.deepEqual([s.done, s.maps, s.collect, s.chests, s.doors, s.stones, s.titles, s.title, s.challenges, s.dimClears],
    [save.story.done, save.story.maps, save.story.collect, save.story.chests, save.story.doors, save.story.stones, [0, 29], 29, [0, 1], 2]);
  assert.deepEqual(s.active, save.story.active);
  const it = back.inv!.items[0];
  assert.deepEqual([it.type, it.sub, it.grade, it.base, it.count, it.enh, it.level, it.sockets, it.options, it.name],
    [0, 3, 2, 120, 3, 7, 25, item.sockets, item.options, item.name]);
  assert.equal(back.inv!.bags, 1);
  assert.equal(back.orig!.memberNo, '4242');
  assert.ok(back.orig!.checksumOk);
});

test('gamedata round trip with trait caches and checksum', () => {
  const d8 = (o: number) => (o >= 0x2543b && o < 0x2543b + 36 ? [100, 0, 0, 100, 0, 0, 4, 0, 0, 4, 0, 0, 4, 0, 0, 1, 0, 0, 1, 0, 0, 4, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 4][o - 0x2543b] ?? 0 : 0);
  const acc = { lap: [0, 2, 1], traitPoints: 3, traits: [1, 0, 0, 2, 0, 0, 0, 0, 5, 0, 0, 0], traitBought: 1 };
  const book = Array.from({ length: 40 }, (_, i) => (i === 3 ? { k: 12, d: 1, z: 2 } : null));
  const b = buildGamedata(acc as never, d8, book, [100, 0, 0], 77n);
  assert.equal(b[0x3a8], sum8(b, 0x3a8));
  const g = parseGamedata(b);
  assert.deepEqual([g.traitPoints, g.traits, g.traitBought, g.lap, g.day, g.memberNo, g.checksumOk], [3, acc.traits, 1, [0, 2, 1], [100, 0, 0], '77', true]);
  assert.deepEqual(g.book[3], { k: 12, d: 1, z: 2 });
  assert.equal(b[0x369], 2 * 4);                                     // track 4 cache = level × 4
});

test('option.dat round trip and checksum', () => {
  const o = { volume: 0, vibration: 1, speed: 0, effects: 1, minimap: 0 };
  const b = buildOption(o);
  assert.equal(b.length, 0x90);
  assert.equal(b[0x30], sum8(b, 0x30));
  const back = parseOption(b);
  assert.deepEqual([back.volume, back.vibration, back.speed, back.effects, back.minimap], [0, 1, 0, 1, 0]);
  assert.deepEqual([...b.subarray(0x3c, 0x41)], [0, 1, 0, 0, 1]);    // working copy: volume, vibration, speed, minimap, effects
});
