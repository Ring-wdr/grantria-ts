// 원정(가제): recovery choices and zone pacing (web/docs/expedition-balance.md §20). A tempered piece grows its main
// effect by item level and keeps its grade lines; battle zones place their groups by beat along the way through — none
// in the breather, the gatekeeper on a shortest way near the exit, a guard by the best chest, the first chest in the
// breather when it can be.
// The zone half is skipped without generated assets (public/assets comes from the player's own APK).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Assets, Cmf, GameMap } from '../src/core/data/assets.ts';
import { BEATS, CHEST_GUARD, GATE, TILE, buildField, walkDist, zoneSets } from '../src/core/expedition/zone.ts';
import { STAGES } from '../src/core/expedition/stages.ts';
import { SPECIES } from '../src/core/expedition/species.ts';
import { TEMPER_MAX, mainStats, makeGear, temper } from '../src/core/expedition/loot.ts';
import { Rng } from '../src/core/expedition/rng.ts';
import { CAMP_CHOICES, EXIT_HEAL } from '../src/core/expedition/expedition.ts';

const asset = (p: string) => new URL(`../public/assets/${p}`, import.meta.url);
const have = existsSync(asset('maps/m120.json')) && existsSync(asset('cmf/cmf_o3.json')) && existsSync(asset('cmf/cmf_o4.json')) && existsSync(asset('cmf/cmf_o6.json'));
const json = <T>(p: string): T => JSON.parse(readFileSync(asset(p), 'utf8')) as T;
const assets = { map: async (id: number) => json<GameMap>(`maps/m${String(id).padStart(3, '0')}.json`), cmf: async (n: string) => json<Cmf>(`cmf/${n}.json`) } as unknown as Assets;

test('recovery (§20.3): the exit heals 25%; a rest zone offers 휴식 / 단련 / 수색', () => {
  assert.equal(EXIT_HEAL, 0.25);
  assert.deepEqual(CAMP_CHOICES.map((c) => c.name), ['휴식', '단련', '수색']);
});

test('temper (§20.3): item level +2 up to 10, the main effect of the new level, the grade lines kept', () => {
  const name = () => 'x';
  for (let slot = 0; slot < 4; slot++) for (const grade of [0, 2, 4] as const) {
    const g = makeGear(slot as 0 | 1 | 2 | 3, 2, grade, new Rng(slot * 7 + grade), name, 3), t = temper(g, 2);
    assert.equal(t.ilv, 5);
    const was = mainStats(g.slot, g.sub, 3), now = mainStats(g.slot, g.sub, 5);
    for (const k of ['atk', 'spd', 'hpPct', 'guard'] as const) {
      const lines = (g[k] ?? 0) - (was[k] ?? 0), after = (t[k] ?? 0) - (now[k] ?? 0);
      assert.ok(Math.abs(lines - after) < 1e-9, `slot ${slot} grade ${grade} ${k}: lines ${lines} → ${after}`);
    }
    assert.equal(t.name, g.name);
    assert.equal(t.grade, g.grade);
  }
  const top = makeGear(0, 0, 0, new Rng(1), name, 9);
  assert.equal(temper(top, 2).ilv, TEMPER_MAX);
});

test('zone pacing (§20.4): groups by beat, none in the breather, the gatekeeper by the exit, a guard by the best chest', { skip: !have && 'no generated assets' }, async () => {
  for (let si = 0; si < STAGES.length; si++) {
    const st = STAGES[si], b = st.biome, sets = await zoneSets(assets, b.objset);
    for (const t of b.battle) {
      const groups = 10;
      const z = await buildField(assets, sets, 40 + t + si, 'battle', { w: 190, h: 160, groups, species: st.species, template: t, biome: b, zoneNo: si * 3 + 2 });
      const W = z.map.header.width, H = z.map.header.height, cell = (p: { x: number; y: number }) => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)] as const;
      const [sc, sr] = cell(z.start), [ec, er] = cell(z.exit);
      const dS = walkDist(z.walk, W, H, sc, sr), dE = walkDist(z.walk, W, H, ec, er), L = dS[er * W + ec];
      const at = (s: { x: number; y: number }) => { const [c, r] = cell(s); return r * W + c; };
      const paced = z.spawns.filter((s) => typeof s.beat === 'number');
      const label = `stage ${si + 1} m${t}`;
      assert.ok(paced.length >= groups - 3, `${label}: ${paced.length} paced groups of ${groups}`);
      for (const s of paced) {
        const bt = BEATS[s.beat as number], tt = Math.min(1, dS[at(s)] / L);
        assert.ok(bt.share > 0, `${label}: a group in the breather`);
        assert.ok(tt >= bt.t[0] && tt < bt.t[1], `${label}: a ${bt.name} group at t ${tt.toFixed(2)}`);
        assert.ok((s.pack ?? 0) >= bt.pack[0] && (s.pack ?? 0) <= bt.pack[1], `${label}: pack ${s.pack} in ${bt.name}`);
      }
      const gate = z.spawns.filter((s) => s.beat === 'gate');
      assert.equal(gate.length, 1, `${label}: one gatekeeper`);
      const gi = at(gate[0]);
      assert.ok(dE[gi] >= GATE.from && dE[gi] <= GATE.to && dS[gi] + dE[gi] <= L + GATE.slack[GATE.slack.length - 1], `${label}: the gatekeeper ${dE[gi]} steps from the exit, ${dS[gi] + dE[gi] - L} off the way`);
      assert.equal(gate[0].pack, GATE.pack);
      assert.equal(SPECIES[gate[0].species].tier, 'normal');
      const best = (z.chests ?? []).reduce((m, c) => (c.kind > m.kind ? c : m), z.chests![0]);
      const guard = z.spawns.find((s) => s.beat === 'guard');
      if (guard) assert.ok(Math.hypot(guard.x - best.x, guard.y - best.y) <= CHEST_GUARD * TILE + 1, `${label}: the guard by the best chest`);
    }
  }
});
