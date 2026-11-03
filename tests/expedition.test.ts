// 원정(가제): the run plan, the battle's timed defense and the negotiation, driven without a renderer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import { stagePlan } from '../src/core/expedition/expedition.ts';
import { STAGES } from '../src/core/expedition/stages.ts';
import { ALL_OUT, Battle, DODGE_MS, PARRY_MS, TALK_EXP } from '../src/core/expedition/battle.ts';
import { FK, FieldEnemy, FieldSim } from '../src/core/expedition/field.ts';
import type { InputState } from '../src/core/input.ts';
import type { Zone } from '../src/core/expedition/zone.ts';
import { Run, expToNext, gainExp, newHero, recruit } from '../src/core/expedition/run.ts';
import { SPECIES } from '../src/core/expedition/species.ts';
import { Talk } from '../src/core/expedition/talk.ts';

/** a field enemy as the battle reads it */
const foe = (species: number) => ({ species, sp: SPECIES[species], hp: SPECIES[species].stats.hp, hpMax: SPECIES[species].stats.hp }) as unknown as FieldEnemy;

test('stage plan: per stage three battle zones in order, a rest zone always right before its boss; stages in order', () => {
  for (let seed = 1; seed < 60; seed++) {
    const all = stagePlan(seed);
    assert.deepEqual([...new Set(all.map((p) => p.stage))], STAGES.map((_, i) => i), 'stages in order');
    for (let s = 0; s < STAGES.length; s++) {
      const p = all.filter((x) => x.stage === s).map((x) => x.kind);
      assert.equal(p.filter((k) => k === 'battle').length, 3);
      assert.deepEqual(p.slice(-2), ['rest', 'boss']);
      assert.equal(p[0], 'battle');
      assert.ok(!p.join(',').includes('rest,rest'));
    }
    assert.deepEqual(stagePlan(seed, 1), all.filter((x) => x.stage === 0), "stage 1's plan is as before");
  }
});

/** a battle in its enemy phase, the hero targeted by a one-hit move at t = 1000 ms */
function defending(): Battle {
  const b = new Battle(new Run(), [foe(1)], 'none', () => 0.5);
  b.phase = 'enemy';
  b.now = 0;
  b.enemyAct = { actor: b.enemies[0], by: b.enemies[0], move: SPECIES[1].moves[0], target: b.party[0], strikeAt: 1000, hits: [{ t: 1000, result: null, cue: 'any', late: false }],
    lockUntil: 0, whiff: null, endAt: Infinity, countered: false, charge: false };
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
  const t = new Talk(b.party[0], b.enemies[0], { potions: () => 3, usePotion: () => {}, block: null, release: [], showHints: false }, () => 0.3);
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

/** a shooter's shot fired at a hero on open ground: what happened by the time it is gone */
function shotAt(defend: 'parry' | 'dodge' | null): { events: string[]; shooter: FieldEnemy } {
  const W = 40, H = 20;
  const zone = { kind: 'battle', map: { header: { width: W, height: H } }, walk: new Uint8Array(W * H).fill(1), start: { x: 100, y: 160 }, exit: { x: 600, y: 160 }, spawns: [] } as unknown as Zone;
  const sim = new FieldSim(zone, 1);
  const shooter = new FieldEnemy(2, 260, 160, sim);
  sim.enemies.push(shooter);
  shooter.angle = Math.PI;
  sim.fire(shooter, SPECIES[2].field.shot!);
  const idle = { isHeld: () => false, stick: { active: false, level: 0, angle: 0, dx: 0, dy: 0 } } as unknown as InputState;
  const events: string[] = [];
  let pressed = false;
  for (let i = 0; i < 300 && sim.shots.length; i++) {
    const near = Math.abs(sim.shots[0].x - sim.hero.x) < 22 && !sim.shots[0].reflected;
    if (near && !pressed && defend === 'dodge') { sim.hero.invuln = 0.4; pressed = true; }
    sim.step(1 / 60, idle, near && !pressed && defend === 'parry' ? ((pressed = true), [{ key: FK.PARRY, t: 0 }]) : []);
    events.push(...sim.takeEvents().map((e) => e.kind));
  }
  return { events, shooter };
}

test('field shots: parried back into the shooter, dodged through, or a battle when they land', () => {
  const p = shotAt('parry');
  assert.ok(p.events.includes('parry'));
  assert.ok(!p.events.includes('battle'));
  assert.ok(p.shooter.brk > 0, 'the parried shot breaks its shooter');
  const d = shotAt('dodge');
  assert.ok(!d.events.includes('battle') && !d.events.includes('parry'));
  assert.ok(shotAt(null).events.includes('battle'));
});

/** a talk that wins every roll, answered with the cursor's first option (the given one at a release choice) */
function wonTalk(b: Battle, enemy: number, block: 'kin' | 'full' | null, release: { name: string; lv: number }[], pick = 0): Talk {
  const t = new Talk(b.party[0], b.enemies[enemy], { potions: () => 3, usePotion: () => {}, block, release, showHints: false }, () => 0.01);
  for (let i = 0; i < 40 && !t.outcome; i++) {
    if (t.step.kind === 'choose' && t.step.options.length === release.length + 1 && release.length) t.sel = pick;
    t.key(AVK.OK);
  }
  return t;
}

test('talk: one of a kind already along pays EXP with the win; a full party lets a member go or takes the EXP', () => {
  const run = new Run();
  run.party.push(recruit(0));
  const b = new Battle(run, [foe(0), foe(3)], 'none', () => 0.5);
  assert.equal(b.recruitBlock(b.enemies[0]), 'kin');                  // a 가시덩굴 already walks with the party
  assert.equal(b.recruitBlock(b.enemies[1]), null);
  run.party.push(recruit(1));
  assert.equal(b.recruitBlock(b.enemies[1]), 'full');
  b.actor = b.party[0];
  assert.equal(b.blocked('대화'), null);                            // talking is still open

  assert.equal(wonTalk(b, 0, 'kin', []).outcome, 'bonded');
  b.endTalk('bonded', b.enemies[0]);
  assert.ok(b.enemies[0].gone);
  assert.equal(b.bonusExp, Math.round(SPECIES[0].stats.exp * TALK_EXP));

  const names = [{ name: '가시덩굴', lv: 1 }, { name: '초원 사냥꾼', lv: 2 }];
  const kept = wonTalk(b, 1, 'full', names, 2);                       // the last option: nobody leaves
  assert.equal(kept.outcome, 'bonded');
  assert.equal(kept.released, null);
  const swap = wonTalk(b, 1, 'full', names, 1);
  assert.equal(swap.outcome, 'joined');
  assert.equal(swap.released, 1);
  const gone = run.party[2];
  b.release(gone);
  assert.ok(!run.party.includes(gone) && !b.party.some((u) => u.member === gone));
});

test('battle: with every enemy broken the commands are only 총공격 and 대화; 총공격 hits them all and they get up', () => {
  const run = new Run();
  run.party.push(recruit(1));
  const b = new Battle(run, [foe(0), foe(3)], 'party', () => 0.5);
  b.actor = b.party[1];                                              // a creature's turn: the hero still speaks
  b.phase = 'command';
  assert.deepEqual(b.commands(), [ALL_OUT, '대화']);
  assert.equal(b.blocked('대화'), null);
  assert.equal(b.talker, b.party[0]);
  const hp = b.enemies.map((e) => e.hp);
  b.sel = 0;
  b.menuKey(AVK.OK);
  assert.equal(b.act?.kind, 'allout');
  for (let i = 0; i < 100 && b.phase === 'act'; i++) b.frame(0.05, [], 0);
  assert.ok(b.enemies.every((e, i) => e.hp < hp[i]));
  assert.ok(b.enemies.every((e) => e.hp <= 0 || !e.broken));
  if (b.liveEnemies.length) {
    assert.ok(!b.commands().includes(ALL_OUT));
    assert.equal(b.blocked('대화'), '검사만 대화할 수 있다');          // back to the hero's own turn only
  }
});
