// 원정(가제): the run plan, the battle's timed defense and the negotiation, driven without a renderer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import { stagePlan } from '../src/core/expedition/expedition.ts';
import { Battle, DODGE_MS, PARRY_MS } from '../src/core/expedition/battle.ts';
import type { FieldEnemy } from '../src/core/expedition/field.ts';
import { Run, expToNext, gainExp, newHero } from '../src/core/expedition/run.ts';
import { SPECIES } from '../src/core/expedition/species.ts';
import { Talk } from '../src/core/expedition/talk.ts';

/** a field enemy as the battle reads it */
const foe = (species: number) => ({ species, sp: SPECIES[species], hp: SPECIES[species].stats.hp, hpMax: SPECIES[species].stats.hp }) as unknown as FieldEnemy;

test('stage plan: three battle zones in order, a rest zone always right before the boss', () => {
  for (let seed = 1; seed < 60; seed++) {
    const p = stagePlan(seed);
    assert.equal(p.filter((k) => k === 'battle').length, 3);
    assert.deepEqual(p.slice(-2), ['rest', 'boss']);
    assert.equal(p[0], 'battle');
    assert.ok(!p.join(',').includes('rest,rest'));
  }
});

/** a battle in its enemy phase, the hero targeted by a one-hit move at t = 1000 ms */
function defending(): Battle {
  const b = new Battle(new Run(), [foe(1)], 'none', () => 0.5);
  b.phase = 'enemy';
  b.now = 0;
  b.enemyAct = { actor: b.enemies[0], move: SPECIES[1].moves[0], target: b.party[0], strikeAt: 1000, hits: [{ t: 1000, result: null }], lockUntil: 0, whiff: null, endAt: Infinity, countered: false };
  return b;
}

test('battle defense: judged by the press time; parry ±95 ms, dodge wider, a whiff locks out', () => {
  let b = defending();
  b.frame(0.016, [{ key: AVK.K7, t: 1000 + PARRY_MS - 1 }], 900);
  assert.equal(b.enemyAct!.hits[0].result, 'parry');
  assert.equal(b.ap, 2);                                            // +1 for the parry
  assert.equal(b.enemies[0].rapport, 1);

  b = defending();
  b.frame(0.016, [{ key: AVK.K7, t: 1000 - PARRY_MS - 20 }], 900);   // too early: a whiff
  assert.equal(b.enemyAct!.hits[0].result, null);
  b.frame(0.016, [{ key: AVK.K7, t: 1000 }], 950);                   // locked out still
  assert.equal(b.enemyAct!.hits[0].result, null);

  b = defending();
  b.frame(0.016, [{ key: AVK.K3, t: 1000 - DODGE_MS + 5 }], 900);
  assert.equal(b.enemyAct!.hits[0].result, 'dodge');

  b = defending();
  const hp = b.party[0].hp;
  b.frame(0.016, [], 1000 + DODGE_MS + 1);                            // nothing pressed: the hit lands
  assert.equal(b.enemyAct!.hits[0].result, 'hit');
  assert.ok(b.party[0].hp < hp);
});

test('battle: a party-first encounter starts with every enemy broken; the boss refuses talk and flight', () => {
  const b = new Battle(new Run(), [foe(0), foe(3)], 'party', () => 0.5);
  assert.ok(b.enemies.every((e) => e.broken));
  const boss = new Battle(new Run(), [foe(4)], 'none', () => 0.5);
  assert.equal(boss.blocked('도주'), '도망칠 수 없다');
  assert.equal(boss.blocked('대화'), SPECIES[4].talkReason);
});

test('negotiation reaches an outcome; liked answers raise the mood', () => {
  const b = new Battle(new Run(), [foe(0)], 'none', () => 0.3);
  const t = new Talk(b.party[0], b.enemies[0], { potions: () => 3, usePotion: () => {}, room: true, showHints: false }, () => 0.3);
  for (let i = 0; i < 40 && !t.outcome; i++) {
    if (t.step.kind === 'choose') {
      const tones = t.step.tones, likes = t.temper.likes;
      t.sel = tones[0] ? tones.reduce((bi, tn, j) => (likes[tn!] > likes[tones[bi]!] ? j : bi), 0) : 0;
    }
    t.key(AVK.OK);
  }
  assert.ok(t.outcome);
  assert.ok(b.enemies[0].mood > 0);
});

test('run: EXP levels the party up', () => {
  const m = newHero();
  assert.equal(gainExp(m, expToNext(1) + expToNext(2)), 2);
  assert.equal(m.lv, 3);
  assert.ok(m.hpMax > 120 && m.atk > 14);
});
