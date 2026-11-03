// 원정(가제): the battle decision kit and the bosses of web/docs/expedition-balance.md §18 — statuses, weaknesses,
// intents, the defense cues, the charge moves, the phases, the golem's armour and the hellhound's heads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import { Battle, DELAY_CT, MARK_MUL, PARRY_MS, PARRY_NARROW_MS, RUPTURE_PART, WEAK_MUL, type BUnit } from '../src/core/expedition/battle.ts';
import type { FieldEnemy } from '../src/core/expedition/field.ts';
import { Run, recruit } from '../src/core/expedition/run.ts';
import { SPECIES, type Move } from '../src/core/expedition/species.ts';

const foe = (species: number) => ({ species, sp: SPECIES[species], hp: SPECIES[species].stats.hp, hpMax: SPECIES[species].stats.hp }) as unknown as FieldEnemy;
type Inside = {
  hurt(to: BUnit, d: number, brk: number, type?: string): boolean; applyEffect(src: BUnit, to: BUnit, e: object): void; damage(f: BUnit, t: BUnit, p: number): number;
  startEnemy(u: BUnit): void; startMove(u: BUnit, by: BUnit, m: Move, c: boolean): void; nextTurn(): void; startAct(a: object): void; plan(u: BUnit): void;
};
const inside = (b: Battle) => b as unknown as Inside;

/** a sturdy party (the hero and a hunter) so the bosses can be played turn by turn */
function sturdy(): Run {
  const run = new Run();
  run.party.push(recruit(1));
  for (const m of run.party) m.hp = m.hpMax = 99999;
  return run;
}

/** one enemy turn played to its end, pressing `key` on every hit (or nothing) */
function enemyTurn(b: Battle, u: BUnit, now: number, key: number | null): number {
  b.phase = 'enemy';
  b.now = now;
  inside(b).startEnemy(u);
  let t = now;
  while (b.enemyAct) {
    const ea = b.enemyAct;
    for (const h of ea.hits) if (!h.result) b.frame(0.016, key === null ? [] : [{ key, t: h.t }], h.t);
    t = ea.hits[ea.hits.length - 1].t;
    for (let i = 0; i < 200 && b.enemyAct === ea; i++) b.frame(0.05, [], (t += 50));
  }
  return t + 1000;
}

test('bleed ticks at the start of its turn and wanes; 절개 bursts what is left; a boss halves each next delay', () => {
  const b = new Battle(new Run(), [foe(1)], 'none', () => 0.5), e = b.enemies[0], hero = b.party[0];
  inside(b).applyEffect(hero, e, { bleed: 3 });
  assert.equal(e.st.bleed, 3);
  const per = e.st.bleedPer, hp = e.hp;
  assert.equal(per, Math.round(hero.atk * 0.3));
  for (const u of b.units) u.ct = 0;
  e.ct = 99;                                                        // its turn next
  inside(b).nextTurn();
  assert.equal(e.hp, hp - 3 * per);
  assert.equal(e.st.bleed, 2);
  const hp2 = e.hp;
  inside(b).applyEffect(hero, e, { rupture: true });
  assert.equal(e.st.bleed, 0);
  assert.equal(e.hp, Math.max(0, hp2 - Math.round(per * 3 * RUPTURE_PART)));

  const bb = new Battle(new Run(), [foe(4)], 'none', () => 0.5), boss = bb.enemies[0];
  const ct = boss.ct;
  inside(bb).applyEffect(bb.party[0], boss, { delay: true });
  inside(bb).applyEffect(bb.party[0], boss, { delay: true });
  assert.equal(boss.ct, ct - DELAY_CT - DELAY_CT / 2);
});

test('mark: a single-target action hits ×1.5 and spends it; weakened hits ×0.7; a shield takes a hit whole; a taunter draws single-target moves', () => {
  const b = new Battle(new Run(), [foe(1), foe(1)], 'none', () => 0.5), [e] = b.enemies, hero = b.party[0];
  const plain = inside(b).damage(hero, e, 1);
  e.st.mark = true;
  b.actor = hero;
  inside(b).startAct({ kind: 'attack', targets: [e] });
  const hp = e.hp;
  for (let i = 0; i < 40 && b.act; i++) b.frame(0.05, [], i * 50);
  assert.equal(hp - e.hp, Math.max(1, Math.round((hero.atk * MARK_MUL - e.def * 0.6))), 'the marked hit');
  assert.ok(!e.st.mark, 'spent');
  hero.st.weak = 1;
  assert.equal(inside(b).damage(hero, e, 1), Math.max(1, Math.round(plain * WEAK_MUL)));
  hero.st.weak = 0;
  hero.st.shield = 1;
  assert.equal(inside(b).hurt(hero, 50, 0), false);
  assert.equal(hero.st.shield, 0);
  const run = new Run();
  run.party.push(recruit(6));
  const t = new Battle(run, [foe(1)], 'none', () => 0.9);
  t.party[1].st.taunt = 2;
  inside(t).plan(t.enemies[0]);
  if (!t.enemies[0].intent!.move.all) assert.equal(t.enemies[0].intent!.target, t.party[1]);
});

test('weakness: a hit of the type the enemy is weak to breaks it twice as fast and is found for the run', () => {
  const run = new Run(), b = new Battle(run, [foe(1), foe(1)], 'none', () => 0.5), [e, f] = b.enemies;
  inside(b).hurt(e, 1, 10, 'slash');
  assert.equal(e.brk, 10);
  inside(b).hurt(f, 1, 10, 'pierce');                               // the hunter is weak to 찌르기
  assert.equal(f.brk, 20);
  assert.ok(run.seenWeak.has('1:pierce'));
});

test('intents: every enemy shows its next action from the start; a hunter that bleeds says so', () => {
  const b = new Battle(new Run(), [foe(1), foe(5)], 'none', () => 0.4);
  for (const e of b.enemies) { assert.ok(e.intent); assert.ok(b.intentText(e)); }
});

test('cues: a dodge-only hit ignores a parry; a parry-only one is parried within ±60 ms only and a full parry is a big counter that marks', () => {
  const b = new Battle(sturdy(), [foe(9)], 'none', () => 0.5), golem = b.enemies[0], hero = b.party[0];
  const red: Move = { name: 'r', windup: 0.5, hits: [0], power: 1, cues: ['dodge'] };
  b.now = 0;
  inside(b).startMove(golem, golem, red, false);
  const h0 = b.enemyAct!.hits[0];
  b.phase = 'enemy';
  b.frame(0.016, [{ key: AVK.K7, t: h0.t }], h0.t - 10);
  assert.equal(h0.result, null, 'a parry does nothing on a red hit');
  const white: Move = { name: 'w', windup: 0.5, hits: [0], power: 1, cues: ['parry'] };
  const c = new Battle(sturdy(), [foe(9)], 'none', () => 0.5), g2 = c.enemies[0];
  c.now = 0;
  inside(c).startMove(g2, g2, white, false);
  c.phase = 'enemy';
  const h1 = c.enemyAct!.hits[0];
  c.frame(0.016, [{ key: AVK.K3, t: h1.t }], h1.t - 10);
  assert.equal(h1.result, null, 'a dodge does nothing on a black-and-white hit');
  const d = new Battle(sturdy(), [foe(9)], 'none', () => 0.5), g3 = d.enemies[0];
  d.now = 0;
  inside(d).startMove(g3, g3, white, false);
  d.phase = 'enemy';
  const h2 = d.enemyAct!.hits[0], ap = d.ap;
  d.frame(0.016, [{ key: AVK.K7, t: h2.t + PARRY_NARROW_MS + 10 }], h2.t - 10);
  assert.equal(h2.result, null, `outside ±${PARRY_NARROW_MS} ms`);
  assert.ok(PARRY_NARROW_MS < PARRY_MS);
  const e = new Battle(sturdy(), [foe(9)], 'none', () => 0.5), g4 = e.enemies[0];
  e.now = 0;
  inside(e).startMove(g4, g4, white, false);
  e.phase = 'enemy';
  const h3 = e.enemyAct!.hits[0];
  e.frame(0.016, [{ key: AVK.K7, t: h3.t + PARRY_NARROW_MS - 5 }], h3.t - 10);
  assert.equal(h3.result, 'parry');
  assert.equal(e.ap, ap + 2, 'a parry-only parry pays an extra AP');
  for (let t = h3.t; e.enemyAct && t < h3.t + 3000; t += 50) e.frame(0.05, [], t);
  assert.ok(g4.st.mark, 'a perfect parry marks the attacker');
  assert.ok(hero.hp === 99999);
});

test('charge: announced turns ahead, it fires on the whole party; breaking the boss first calls it off and pushes the enrage back', () => {
  const b = new Battle(sturdy(), [foe(4)], 'none', () => 0.5), boss = b.enemies[0], pat = SPECIES[4].boss!;
  let now = 1000;
  now = enemyTurn(b, boss, now, AVK.K7);
  assert.equal(boss.charge, pat.chargeTurns, 'announced after its first turn');
  for (let i = 0; i < pat.chargeTurns; i++) now = enemyTurn(b, boss, now, AVK.K7);
  assert.ok(boss.intent?.charge, 'the charge is its next action');
  const hp = b.party.map((p) => p.hp);
  now = enemyTurn(b, boss, now, AVK.K7);                            // parrying every hit: the red first one gets through
  assert.ok(b.party.every((p, i) => p.hp < hp[i]), 'the dodge-only first hit lands on everyone through a parry');
  assert.ok(b.roarDmg > 0);
  assert.equal(boss.charge, null);

  const c = new Battle(sturdy(), [foe(4)], 'none', () => 0.5), k = c.enemies[0];
  enemyTurn(c, k, 1000, AVK.K7);
  assert.notEqual(k.charge, null);
  const ein = c.enrageIn!;
  inside(c).hurt(k, 1, 9999, 'slash');
  assert.ok(k.broken);
  assert.equal(k.charge, null, 'called off');
  assert.equal(c.enrageIn, ein + 2, 'enrage pushed back');
});

test('phases: the panther calls hunters at 60%; the golem starts in stone armour that, once off, doubles the next break', () => {
  const b = new Battle(sturdy(), [foe(4)], 'none', () => 0.5), boss = b.enemies[0];
  inside(b).hurt(boss, Math.ceil(boss.hpMax * 0.45), 0);
  assert.equal(boss.phase, 1);
  assert.equal(b.enemies.filter((e) => e.summoned).length, 2);
  assert.ok(b.blocked('대화'), 'neither the boss nor its hunters can be talked to');

  const g = new Battle(sturdy(), [foe(9)], 'none', () => 0.5), golem = g.enemies[0];
  assert.equal(golem.st.shield, 3);
  for (let i = 0; i < 3; i++) assert.equal(inside(g).hurt(golem, 100, 10, 'slash'), false);
  assert.ok(golem.exposed);
  inside(g).hurt(golem, 1, 10, 'blunt');                             // weak to 타격 ×2, exposed ×2
  assert.equal(golem.brk, 40);
  inside(g).applyEffect(g.party[0], golem, { bleed: 3 });
  assert.equal(golem.st.bleed, 0, 'immune to bleed');
});

test('heads: the hellhound is picked by its three heads; two broken call its charge off, all three bring it down', () => {
  const b = new Battle(sturdy(), [foe(13)], 'none', () => 0.5), dog = b.enemies[0];
  assert.equal(b.targets().length, 3);
  assert.ok(b.targets().every((t) => t.body === dog));
  enemyTurn(b, dog, 1000, AVK.K7);
  assert.notEqual(dog.charge, null);
  const [l, m, r] = dog.heads;
  const hp = dog.hp;
  inside(b).hurt(l, 10, 9999, 'pierce');
  assert.equal(dog.hp, hp - 10, 'a head passes its damage to the body');
  assert.notEqual(dog.charge, null);
  inside(b).hurt(m, 1, 9999, 'pierce');
  assert.equal(dog.charge, null, 'two heads broken: called off');
  assert.ok(!dog.broken);
  inside(b).hurt(r, 1, 9999, 'pierce');
  assert.ok(dog.broken, 'all three: down');
  assert.ok(b.allBroken);
});
