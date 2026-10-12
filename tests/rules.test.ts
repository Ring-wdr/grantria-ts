// Checks the ported rules against the worked examples in analysis/features/game-rules.md.
// Run: npm test (node --test with built-in TypeScript type stripping)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Rng, cdiv, derive, expNeed, killExp, monsterHit, monsterStats, playerHit, rdiv } from '../src/game/rules.ts';

test('rounding helpers', () => {
  assert.equal(rdiv(7, 2), 4);
  assert.equal(rdiv(5, 3), 2);
  assert.equal(cdiv(5, 3), 2);
  assert.equal(cdiv(6, 4), 2);
});

test('experience curve (game-rules.md §2.1)', () => {
  assert.equal(expNeed(1), 84);
  assert.equal(expNeed(2), 183);
  assert.equal(expNeed(10), 4230);
  assert.equal(expNeed(50), 1410886);
  assert.equal(expNeed(100), 18017326);
  assert.equal(expNeed(199), 213659872);
});

test('monster stats (game-rules.md §3.5)', () => {
  assert.deepEqual(monsterStats(1, 3), { level: 1, hp: 106, atk: 3 });
  assert.deepEqual(monsterStats(10, 3), { level: 10, hp: 301, atk: 13 });
  assert.deepEqual(monsterStats(50, 3), { level: 50, hp: 4037, atk: 64 });
  assert.deepEqual(monsterStats(100, 3), { level: 100, hp: 14815, atk: 134 });
});

test('level 1 max HP/MP without equipment (game-rules.md §1.4)', () => {
  const base = (cls: 0 | 1 | 2, stats: number[]) => derive({ cls, level: 1, stats, weapon: null });
  assert.deepEqual([base(0, [5, 5, 3, 3]).maxHp, base(0, [5, 5, 3, 3]).maxMp], [140, 20]);
  assert.deepEqual([base(1, [3, 3, 3, 7]).maxHp, base(1, [3, 3, 3, 7]).maxMp], [134, 40]);
  assert.deepEqual([base(2, [7, 1, 5, 3]).maxHp, base(2, [7, 1, 5, 3]).maxMp], [170, 20]);
});

test('rng stays in range and is reproducible with a fixed clock', () => {
  const a = new Rng(1n, () => 0), b = new Rng(1n, () => 0);
  for (let i = 0; i < 1000; i++) {
    const r = a.rand(10000);
    assert.ok(r >= 0 && r < 10000);
    assert.equal(r, b.rand(10000));
  }
  assert.equal(a.rand(0), 0);
});

test('starting club gives ATK 30 at level 1 (game-rules.md §1.5)', () => {
  assert.equal(derive({ cls: 0, level: 1, stats: [5, 5, 3, 3], weapon: { base: 29, enh: 0 } }).atk, 30);
});

test('player basic hit vs Lv8 monster: scale 80%, +-10% spread', () => {
  const rng = new Rng(7n, () => 0);
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const r = playerHit(rng, { level: 1, atk: 30, acc: 0, crit: 0, critDmg: 0 }, { level: 8 });
    if (r.miss) continue;
    hits++;
    assert.ok(!r.crit);                         // crit needs roll < 50*diff (negative)
    assert.ok(r.dmg >= 21 && r.dmg <= 27, `dmg ${r.dmg}`);   // 24 * (0.9 .. 1.1)
  }
  // miss chance = 10*(85 + 51)/10000 = 13.6%
  assert.ok(hits > 2000 * 0.82 && hits < 2000 * 0.90, `hits ${hits}`);
});

test('monster hit vs no DEF: ATK +-10%, crit doubles', () => {
  const rng = new Rng(3n, () => 0);
  for (let i = 0; i < 2000; i++) {
    const r = monsterHit(rng, { level: 8, atk: 11 }, { level: 1, def: 0, evade: 0 });
    if (r.miss) continue;
    const base = r.crit ? r.dmg / 2 : r.dmg;
    assert.ok(base >= 10 && base <= 12, `dmg ${r.dmg}`);
  }
});

test('kill experience (game-rules.md §3.6)', () => {
  const rng = new Rng(1n, () => 0);
  for (let i = 0; i < 200; i++) {
    const e = killExp(rng, 8, 1, 0);            // 8*5 + 8 + rand(3) + (8-1)*1 = 55..57
    assert.ok(e >= 55 && e <= 57, `exp ${e}`);
  }
});
