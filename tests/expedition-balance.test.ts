// 원정(가제): the growth and reward rules of web/docs/expedition-balance.md: equipment on the whole party (and on whoever
// joins later), what creatures drop, the chests and the merchant's stock, the boss's unblockable roar and its enrage,
// the rare creature that runs (in the field and in battle), the night's damage and gold, and where chests stand in a
// grown zone.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import { Battle } from '../src/core/expedition/battle.ts';
import { FieldEnemy, FieldSim, MERCHANT_STEPS, RARE_RUN } from '../src/core/expedition/field.ts';
import type { InputState } from '../src/core/input.ts';
import { CHEST_DEPTH, DROP_CHANCE, FIELD_DROP_CHANCE, MAIN, POTION_PRICE, SLOT_TYPES, TIERS, chestRoll, creatureDrop, gearIcon, gearNamer, gearPrice, merchantStock, openChest, rareDrop,
  rollGear, type Gear, type Grade, type Stats } from '../src/core/expedition/loot.ts';
import { Rng } from '../src/core/expedition/rng.ts';
import { GUARD_MAX, Run, SHINY_MUL, recruit, statsWith } from '../src/core/expedition/run.ts';
import { ENEMY_HIT, RARE, SPECIES, zoneStats } from '../src/core/expedition/species.ts';
import type { Assets, Cmf, GameMap } from '../src/core/data/assets.ts';
import { TILE, buildField, walkDist, zoneSets, type Zone } from '../src/core/expedition/zone.ts';
import { SKILLBOOK, SKILL_AP, SKILL_MAX, loadSkills, skillAt } from '../src/core/expedition/skillbook.ts';

const foe = (species: number, rare = false) => ({ species, sp: SPECIES[species], hp: SPECIES[species].stats.hp, hpMax: SPECIES[species].stats.hp, rare }) as unknown as FieldEnemy;
const idle = { isHeld: () => false, stick: { active: false, level: 0, angle: 0, dx: 0, dy: 0 } } as unknown as InputState;
const open = (W: number, H: number) => ({ kind: 'battle', map: { header: { width: W, height: H } }, walk: new Uint8Array(W * H).fill(1), start: { x: 100, y: 160 }, exit: { x: 600, y: 160 }, spawns: [] }) as unknown as Zone;

const names = (type: number, sub: number) => `${type}:${sub}`;
const piece = (slot: 0 | 1 | 2 | 3, st: Stats, grade: Grade = 0): Gear => ({ ...st, slot, type: SLOT_TYPES[slot][0], sub: 0, grade, name: `p${slot}` });

test('equipment: on every member now and on whoever joins later; a slot holds one piece; guard is capped; a rare recruit is ×1.2', () => {
  const run = new Run();
  run.party.push(recruit(1));
  const before = run.party.map((m) => ({ ...m }));
  assert.equal(run.wear(piece(0, { atk: 2, spd: 1 })), null);
  assert.equal(run.wear(piece(1, { hpPct: 0.1 })), null);
  run.party.forEach((m, i) => {
    assert.equal(m.atk, before[i].atk + 2);
    assert.equal(m.spd, before[i].spd + 1);
    assert.equal(m.hpMax, before[i].hpMax + Math.round(before[i].hpMax * 0.1));
  });
  const old = run.equip[0]!;
  assert.equal(run.wear(piece(0, { atk: 4 })), old, 'the worn piece comes back (and is gone)');
  run.party.forEach((m, i) => { assert.equal(m.atk, before[i].atk + 4); assert.equal(m.spd, before[i].spd); });
  const late = recruit(2), base = { ...late };
  run.join(late);
  assert.equal(late.atk, base.atk + 4);
  assert.equal(late.hpMax, base.hpMax + Math.round(base.hpMax * 0.1));
  assert.ok(run.party.includes(late));
  const hero = run.party[0], hp0 = hero.hpMax - hero.gear!.hp;
  run.award(500);                                                   // a level-up refits max HP by the share
  assert.equal(hero.hpMax, hero.hpMax - hero.gear!.hp + Math.round((hero.hpMax - hero.gear!.hp) * 0.1));
  assert.ok(hero.hpMax - hero.gear!.hp > hp0);
  assert.equal(statsWith(hero, run.gearStats()).atk, hero.atk, 'statsWith the worn set is the member as it is');
  assert.equal(statsWith(hero, run.gearStats(piece(0, { atk: 1 }))).atk, hero.atk - 3, 'and with a piece swapped in, the comparison');
  run.wear(piece(2, { guard: 0.4 }));
  assert.equal(run.guardWith(piece(3, { guard: 0.3 })), GUARD_MAX);
  assert.equal(run.guard, 0.4);
  const shiny = recruit(1, true), plain = recruit(1);
  assert.ok(shiny.shiny);
  assert.equal(shiny.atk, Math.round(plain.atk * SHINY_MUL));
});

test('gear: a slot draws from its main-game types, tier 1..4 is item sub 0..3, one extra line per grade step', () => {
  const rng = new Rng(3);
  for (let i = 0; i < 300; i++) {
    const g = rollGear([1, 1, 1, 1], [1, 1, 1, 1, 1], rng, names, i % 3);
    assert.ok(SLOT_TYPES[g.slot].includes(g.type));
    assert.ok(g.sub >= 0 && g.sub < TIERS);
    assert.equal(g.name, `${g.type}:${g.sub}`);
    assert.equal(gearIcon(g), 11 * g.type + g.sub);
    const main = MAIN[g.slot][g.sub], extra = (g.atk ?? 0) - (main.atk ?? 0) + (g.spd ?? 0) - (main.spd ?? 0)
      + Math.round(((g.hpPct ?? 0) - (main.hpPct ?? 0)) / 0.05) + Math.round(((g.guard ?? 0) - (main.guard ?? 0)) / 0.04);
    assert.equal(extra, g.grade, `${JSON.stringify(g)}: ${g.grade} lines`);
  }
  assert.equal(gearPrice({ sub: 2, grade: 3 }), 120 + 200 + 300);
});

test("loot: creatures drop by zone, chests by zone and what they hold, the merchant's four slots", () => {
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
    const l = openChest(3, 1, rng, names);
    assert.ok(l.kind === 'gear' || l.kind === 'skill', 'a gold chest holds a piece or a skill');
    if (l.kind === 'skill') assert.ok(SKILLBOOK[l.id].tier >= 1, 'a gold chest holds a skill a tier up');
    if (l.kind === 'gear') { assert.ok(l.gear.grade >= 3, 'a gold chest holds 영웅 or 전설'); assert.ok(l.gear.sub >= 1, 'a tier above the zone'); }
    assert.ok(rareDrop(1, rng, names).grade >= 2, 'the rare creature drops 희귀 or better');
  }
  const t1 = [0, 0, 0, 0], t3 = [0, 0, 0, 0];
  for (let i = 0; i < 2000; i++) { t1[creatureDrop(1, rng, names).sub]++; t3[creatureDrop(3, rng, names).sub]++; }
  assert.ok(t1[0] > t1[1] && t1[3] === 0, `zone 1 tiers ${t1}`);
  assert.ok(t3[3] > t1[3] && t3[2] > t1[2], `zone 3 tiers ${t3}`);
  assert.ok(DROP_CHANCE > FIELD_DROP_CHANCE);
  const stock = merchantStock(2, rng, names);
  assert.equal(stock.length, 4);
  assert.equal(stock[0].gear, null);
  assert.equal(stock[0].price, POTION_PRICE);
  const wares = stock.slice(1).map((w) => w.gear!);
  assert.equal(new Set(wares.map((g) => g.slot)).size, 3, 'three different slots');
  for (const w of stock.slice(1)) { assert.ok(w.gear!.grade < 4); assert.equal(w.price, gearPrice(w.gear!)); }
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

const dat = asset('d.dat'), txt = asset('text.json');
test("gear names: the main game's equipment names from d.dat and text.json", { skip: !(existsSync(dat) && existsSync(txt)) && 'no generated assets' }, () => {
  const d = new Uint8Array(readFileSync(dat)), name = gearNamer({ d8: (o: number) => d[o], text: json<string[]>('text.json') });
  assert.deepEqual([0, 1, 2, 3].map((s) => name(0, s)), ['몽둥이', '브로드 소드', '나이트 소드', '본 블레이드']);
  assert.equal(name(3, 1), '견습기사의 투구');
  assert.equal(name(15, 0), '별장식 목걸이');
});

test('combat scale (§15, §17): a creature hits ×2.5 / ×3.5 / ×4 .. ×6.5 by its zone power 0..8, a boss as it is; crits ×1.8 either way', () => {
  const at = (power: number) => ({ species: 1, sp: SPECIES[1], stats: zoneStats(SPECIES[1].stats, power), hp: 1, hpMax: 1 }) as unknown as FieldEnemy;
  const b = new Battle(new Run(), [...ENEMY_HIT.map((_, p) => at(p)), foe(4), foe(9), foe(13)], 'none', () => 0.5);
  assert.deepEqual(b.enemies.map((e) => e.hitMul), [...ENEMY_HIT, 1, 1, 1]);
  assert.deepEqual(ENEMY_HIT.slice(0, 3), [2.5, 3.5, 4], 'stage 1 as before');
  assert.equal(b.party[0].hitMul, 1);
  const hit = (rnd: number) => {
    const x = new Battle(new Run(), [at(2)], 'none', () => rnd);
    return (x as unknown as { damage(f: unknown, t: unknown, p: number): number }).damage(x.enemies[0], x.party[0], 1);
  };
  const plain = hit(0.5), crit = hit(0.05);                         // 0.05 < CRIT_RATE: a crit (the ±10% roll is low too)
  assert.ok(crit > plain * 1.4, `crit ${crit} vs ${plain}`);
});

const skillData = existsSync(asset('d.dat')) && existsSync(asset('text.json'));
test('skills (§16): found ones level up to 10 and join the hero skills; a skill hits on each of its original hit ticks', { skip: !skillData && 'no generated assets' }, () => {
  const d = readFileSync(asset('d.dat'));
  loadSkills({ d16: (o: number) => d[o] | (d[o + 1] << 8), text: json<string[]>('text.json') });
  const run = new Run();
  assert.equal(run.learnSkill(7), 'new');
  assert.equal(run.learnSkill(7), 'up');
  assert.equal(run.skillLv[7], 2);
  for (let i = 0; i < 20; i++) run.learnSkill(7);
  assert.equal(run.skillLv[7], SKILL_MAX);
  assert.equal(run.learnSkill(7), 'max');
  const b = new Battle(run, [foe(1), foe(1)], 'none', () => 0.5);
  const hero = b.party[0], def = SKILLBOOK[7], sk = b.skills(hero).find((s) => s.name === def.name)!;
  assert.ok(sk && sk.all && sk.ap === SKILL_AP[2] && sk.lv === SKILL_MAX);
  assert.ok(def.dmg[0] > 0 && def.dmg[1] > 0, 'damage from the game data');
  assert.equal(sk.power, (def.dmg[0] + 9 * def.dmg[1]) / 100);
  // play it: five hits on both enemies, each landing at its tick
  b.phase = 'command'; b.actor = hero; b.ap = 9;
  for (const e of b.enemies) { e.hp = e.hpMax = 100000; }
  (b as unknown as { startAct(a: unknown): void }).startAct({ kind: 'skill', skill: sk, targets: b.liveEnemies });
  let pops = 0;
  for (let t = 0; t < 2; t += 0.02) { b.frame(0.02, [], 0); pops = Math.max(pops, b.popups.filter((p) => p.kind === 'dmg').length); if (b.phase !== 'act') break; }
  assert.equal(b.act, null);
  assert.ok(b.enemies.every((e) => e.hp < 100000));
  assert.equal(skillAt(SKILLBOOK[2], 1).hits!.length, 6, '드릴소드 hits six times');
  assert.deepEqual(SKILLBOOK.filter((x) => x.all).map((x) => x.id), [1, 4, 5, 7]);
});
