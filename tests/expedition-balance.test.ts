// 원정(가제): the growth and reward rules of web/docs/expedition-balance.md: relics on the whole party (and on whoever
// joins later), the chests and the merchant's stock, the boss's unblockable roar and its enrage, the rare creature
// that runs (in the field and in battle), the night's damage and gold, and where chests stand in a grown zone.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import { Battle } from '../src/core/expedition/battle.ts';
import { FieldEnemy, FieldSim, MERCHANT_STEPS, RARE_RUN } from '../src/core/expedition/field.ts';
import type { InputState } from '../src/core/input.ts';
import { CHEST_DEPTH, PRICE, POTION_PRICE, RELICS, chestRoll, merchantStock, openChest, pickRelic, type Relic } from '../src/core/expedition/loot.ts';
import { Rng } from '../src/core/expedition/rng.ts';
import { GUARD_MAX, Run, SHINY_MUL, recruit } from '../src/core/expedition/run.ts';
import { RARE, SPECIES, zoneStats } from '../src/core/expedition/species.ts';
import type { Assets, Cmf, GameMap } from '../src/core/data/assets.ts';
import { TILE, buildField, walkDist, zoneSets, type Zone } from '../src/core/expedition/zone.ts';

const foe = (species: number, rare = false) => ({ species, sp: SPECIES[species], hp: SPECIES[species].stats.hp, hpMax: SPECIES[species].stats.hp, rare }) as unknown as FieldEnemy;
const idle = { isHeld: () => false, stick: { active: false, level: 0, angle: 0, dx: 0, dy: 0 } } as unknown as InputState;
const open = (W: number, H: number) => ({ kind: 'battle', map: { header: { width: W, height: H } }, walk: new Uint8Array(W * H).fill(1), start: { x: 100, y: 160 }, exit: { x: 600, y: 160 }, spawns: [] }) as unknown as Zone;

test('relics: on every member now and on whoever joins later; guard is capped; a rare recruit is ×1.2', () => {
  const run = new Run();
  run.party.push(recruit(1));
  const before = run.party.map((m) => ({ ...m }));
  run.addRelic({ id: 't', name: 't', grade: 2, atk: 2, spd: 1, hpPct: 0.1 });
  run.party.forEach((m, i) => {
    assert.equal(m.atk, before[i].atk + 2);
    assert.equal(m.spd, before[i].spd + 1);
    assert.equal(m.hpMax, before[i].hpMax + Math.round(before[i].hpMax * 0.1));
  });
  const late = recruit(2), base = { ...late };
  run.join(late);
  assert.equal(late.atk, base.atk + 2);
  assert.ok(run.party.includes(late));
  for (let i = 0; i < 8; i++) run.addRelic({ id: `g${i}`, name: 'g', grade: 0, guard: 0.1 });
  assert.equal(run.guard, GUARD_MAX);
  const shiny = recruit(1, true), plain = recruit(1);
  assert.ok(shiny.shiny);
  assert.equal(shiny.atk, Math.round(plain.atk * SHINY_MUL));
});

test('loot: chests by zone, what they hold, the merchant\'s four slots; 영웅 and 전설 come once a run', () => {
  const rng = new Rng(7);
  let gold = 0, wood = 0;
  for (let i = 0; i < 400; i++) {
    const ks = chestRoll(1 + (i % 3), rng);
    wood += ks.filter((k) => k === 0).length;
    gold += ks.filter((k) => k === 3).length;
    assert.ok(ks.filter((k) => k === 0).length >= 2);
  }
  assert.ok(wood / 400 > 2.3 && wood / 400 < 2.7, `wooden chests per zone ${wood / 400}`);
  assert.ok(gold / 400 > 0.05 && gold / 400 < 0.16, `gold chests per zone ${gold / 400}`);
  for (let i = 0; i < 50; i++) {
    const l = openChest(3, 3, rng, []);
    assert.equal(l.kind, 'relic');
    if (l.kind === 'relic') assert.ok(l.relic.grade >= 3, 'a gold chest holds 영웅 or 전설');
  }
  const legends = RELICS.filter((r) => r.grade === 4), owned: Relic[] = [...legends];
  for (let i = 0; i < 20; i++) assert.ok(!legends.includes(pickRelic(4, rng, owned)), 'an owned 전설 does not come again');
  const stock = merchantStock(2, rng, []);
  assert.equal(stock.length, 4);
  assert.equal(stock[0].relic, null);
  assert.equal(stock[0].price, POTION_PRICE);
  const relics = stock.slice(1).map((w) => w.relic!);
  assert.equal(new Set(relics).size, 3, 'three different relics');
  for (const w of stock.slice(1)) { assert.ok(w.relic!.grade < 4); assert.equal(w.price, PRICE[w.relic!.grade]); }
});

/** one boss turn played to its end; `parry` presses on every hit. Returns the clock after it and the move's name */
function bossTurn(b: Battle, now: number, parry: boolean): number {
  b.phase = 'enemy';
  b.now = now;
  (b as unknown as { startEnemy(u: unknown): void }).startEnemy(b.enemies[0]);
  const ea = b.enemyAct!;
  for (const h of ea.hits) b.frame(0.016, parry ? [{ key: AVK.K7, t: h.t }] : [], h.t);
  let t = ea.hits[ea.hits.length - 1].t;
  for (let i = 0; i < 200 && b.enemyAct; i++) b.frame(0.05, [], (t += 50));
  lastMove = ea.move.name;
  return t + 1000;
}
let lastMove = '';

test('boss: every third turn a roar on the whole party that parry cannot stop; enraged after twelve', () => {
  const run = new Run();
  run.party[0].hp = run.party[0].hpMax = 99999;
  run.party.push(recruit(1));
  run.party[1].hp = run.party[1].hpMax = 99999;
  const b = new Battle(run, [foe(4)], 'none', () => 0.5), boss = b.enemies[0], pat = SPECIES[4].boss!;
  assert.equal(b.enrageIn, pat.enrageAt);
  let now = 1000;
  now = bossTurn(b, now, true);
  now = bossTurn(b, now, true);
  assert.ok(b.party.every((p) => p.hp === 99999), 'parried turns do no harm');
  now = bossTurn(b, now, true);                                    // the third: the roar
  assert.equal(lastMove, pat.roar.name);
  assert.ok(b.party.every((p) => p.hp < 99999), 'the roar hit everyone through the parry');
  assert.ok(b.roarDmg > 0);
  assert.equal(b.enrageIn, pat.enrageAt - 3);
  const atk = boss.atk;
  while (boss.turns < pat.enrageAt) now = bossTurn(b, now, true);
  assert.ok(!boss.enraged);
  const hp = b.party[0].hp;
  now = bossTurn(b, now, true);
  assert.ok(boss.enraged);
  assert.equal(boss.atk, Math.round(atk * pat.enrageAtk));
  assert.ok(b.party[0].hp < hp, 'enraged, it roars every turn');
  assert.equal(b.enrageIn, null);
});

test('rare creature in battle: it may run (no reward); beaten, it pays ×5 gold and is listed for its drop', () => {
  const run = new Run();
  const ran = new Battle(run, [foe(1, true)], 'none', () => 0.1);    // 0.1 < RARE.flee: it runs on its turn
  (ran as unknown as { startEnemy(u: unknown): void }).startEnemy(ran.enemies[0]);
  assert.ok(ran.enemies[0].gone && ran.enemies[0].fled);
  const b = new Battle(run, [foe(1, true)], 'none', () => 0.9);
  b.goldMul = 1.3;
  b.enemies[0].hp = 0;
  (b as unknown as { win(): void }).win();
  assert.equal(b.gold, Math.round(SPECIES[1].stats.gold * 5 * 1.3));
  assert.equal(run.gold, b.gold);
  assert.deepEqual(b.rares, [b.enemies[0]]);
  assert.ok(RARE.flee > 0.1 && RARE.flee < 0.9);
});

test('night: the party takes ×takenMul damage', () => {
  const hit = (mul: number) => {
    const b = new Battle(new Run(), [foe(1)], 'none', () => 0.5);
    b.takenMul = mul;
    return (b as unknown as { damage(f: unknown, t: unknown, p: number): number }).damage(b.enemies[0], b.party[0], 2);
  };
  assert.ok(hit(1.2) > hit(1));
});

test('field: a rare creature runs from the hero, is gone 40 s after it was seen; chests open; the merchant stands 20..35 steps off', () => {
  const sim = new FieldSim(open(80, 40), 3);
  sim.hero.x = 300; sim.hero.y = 320;
  const r = new FieldEnemy(1, 360, 320, sim, true);
  sim.enemies.push(r);
  assert.equal(r.stats.hp, Math.round(zoneStats(SPECIES[1].stats, 0).hp * RARE.hp));
  sim.step(1 / 60, idle, []);
  assert.equal(r.state, 'flee');
  for (let i = 0; i < 60; i++) sim.step(1 / 60, idle, []);
  assert.ok(r.x > 380, `it ran away (${r.x})`);
  let gone = false;
  for (let i = 0; i < 60 * (RARE_RUN.vanish + 1) && !gone; i++) { sim.step(1 / 60, idle, []); gone = sim.takeEvents().some((e) => e.kind === 'vanish'); }
  assert.ok(gone && r.removed);

  const zone = { ...open(80, 40), chests: [{ x: 308, y: 320, kind: 2 }] } as unknown as Zone;
  const s2 = new FieldSim(zone, 3);
  s2.hero.x = 300; s2.hero.y = 320;
  assert.equal(s2.actHint(), '상자 열기');
  s2.step(1 / 60, idle, [{ key: AVK.K9, t: 0 }]);
  assert.ok(s2.takeEvents().some((e) => e.kind === 'chest'));
  assert.ok(s2.chests[0].opened);
  const m = s2.placeMerchant(), W = 80;
  const d = walkDist(zone.walk, W, 40, Math.floor(300 / TILE), Math.floor(320 / TILE))[Math.floor(m.y / TILE) * W + Math.floor(m.x / TILE)];
  assert.ok(d >= MERCHANT_STEPS[0] && d <= MERCHANT_STEPS[1], `merchant ${d} steps away`);
});

const asset = (p: string) => new URL(`../public/assets/${p}`, import.meta.url);
const have = existsSync(asset('maps/m120.json')) && existsSync(asset('cmf/cmf_o3.json'));
const json = <T>(p: string): T => JSON.parse(readFileSync(asset(p), 'utf8')) as T;
const assets = { map: async (id: number) => json<GameMap>(`maps/m${String(id).padStart(3, '0')}.json`), cmf: async (n: string) => json<Cmf>(`cmf/${n}.json`) } as unknown as Assets;

test('grown zones: chests stand off the way through (deeper for better ones), apart; a rare creature when rolled', { skip: !have && 'no generated assets' }, async () => {
  const sets = await zoneSets(assets);
  let chests = 0, rares = 0;
  for (const seed of [1, 2, 3, 7, 11]) {
    const z = await buildField(assets, sets, seed, 'battle', { w: 190, h: 160, groups: 14, species: [0, 1, 2, 3], zoneNo: 1 + (seed % 3), rare: 1 });
    const W = z.map.header.width, H = z.map.header.height, cell = (p: { x: number; y: number }): [number, number] => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];
    const [sc, sr] = cell(z.start), [ec, er] = cell(z.exit);
    const dS = walkDist(z.walk, W, H, sc, sr), dE = walkDist(z.walk, W, H, ec, er), L = dS[er * W + ec];
    assert.ok((z.chests ?? []).length >= 2, `seed ${seed}: ${(z.chests ?? []).length} chests`);
    for (const c of z.chests ?? []) {
      const [cc, cr] = cell(c), i = cr * W + cc;
      assert.ok(dS[i] >= 0, `seed ${seed}: chest reached`);
      assert.ok((dS[i] + dE[i] - L) / 2 >= CHEST_DEPTH[c.kind], `seed ${seed}: chest ${c.kind} off the way`);
      for (const o of z.chests ?? []) if (o !== c) assert.ok(Math.hypot(o.x - c.x, o.y - c.y) >= 25 * TILE - 1, `seed ${seed}: chests apart`);
    }
    chests += (z.chests ?? []).length;
    rares += z.spawns.filter((s) => s.rare).length;
  }
  assert.ok(chests >= 10);
  assert.equal(rares, 5, 'rare: 1 gives one in every zone');
});
