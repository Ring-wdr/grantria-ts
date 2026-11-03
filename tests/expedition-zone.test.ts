// 원정(가제): zones grown from t3 templates keep the original land's local look (every tile meeting and every object's
// ground occurs in the t3 maps, also in the land made new in the middle) and stay playable (the exit is reached from
// the start, groups stand on reached ground), and their open middle gets new rises and ponds.
// Skipped without generated assets (public/assets comes from the player's own APK).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Assets, Cmf, GameMap, MapObject } from '../src/core/data/assets.ts';
import { bodyBox } from '../src/core/world/world.ts';
import {
  BATTLE_TEMPLATES, EXIT_LIT, EXIT_OBJ, PAIR_SOURCES, REST_TEMPLATES, TILE, boxCells, buildBoss, buildField, detour, grassOf, objCmf, reachable, zoneSets,
  type Zone, type ZoneSets,
} from '../src/core/expedition/zone.ts';
import { STAGES } from '../src/core/expedition/stages.ts';

const asset = (p: string) => new URL(`../public/assets/${p}`, import.meta.url);
const have = existsSync(asset('maps/m120.json')) && existsSync(asset('cmf/cmf_o3.json'));
const json = <T>(p: string): T => JSON.parse(readFileSync(asset(p), 'utf8')) as T;
const mapFile = (id: number) => `maps/m${String(id).padStart(3, '0')}.json`;
/** the part of Assets the zone builder reads */
const assets = { map: async (id: number) => json<GameMap>(mapFile(id)), cmf: async (n: string) => json<Cmf>(`cmf/${n}.json`) } as unknown as Assets;

const LAYERS = ['objBg', 'objLow', 'objMid', 'objTop'] as const;

/** an object with the ground it stands on: its anchor cell and body box cells, plain grass counted as one tile */
function objKey(sets: ZoneSets, m: GameMap, o: MapObject, grass: Set<number>): string {
  const W = m.header.width, H = m.header.height, ac = Math.floor(o.x / TILE), ar = Math.floor(o.y / TILE);
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= W || r >= H ? 'out' : grass.has(m.tiles[r][c]) ? 'g' : String(m.tiles[r][c]));
  const cells = [`0,0:${at(ac, ar)}`];
  const [cmf, f] = objCmf(sets, o.obj), s8 = (v: number) => (v << 24) >> 24;
  const [bx, by, bw, bh] = bodyBox(cmf, f).map(s8);
  if (bw > 0 && bh > 0) {
    const [c0, r0, c1, r1] = boxCells([o.x + bx, o.y + by, o.x + bx + bw, o.y + by + bh]);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push(`${c - ac},${r - ar}:${at(c, r)}`);
  }
  return `${o.obj}|${o.x & 15},${o.y & 15}|${cells.join(' ')}`;
}

async function zones(): Promise<{ sets: ZoneSets; list: [string, Zone][] }> {
  const sets = await zoneSets(assets), list: [string, Zone][] = [];
  for (const seed of [1, 2, 3, 7, 11]) {
    list.push([`battle seed ${seed}`, await buildField(assets, sets, seed, 'battle', { w: 190, h: 160, groups: 14, species: [0, 1, 2] })]);
  }
  for (const t of BATTLE_TEMPLATES) list.push([`battle m${t}`, await buildField(assets, sets, 40 + t, 'battle', { w: 190, h: 160, groups: 14, species: [0], template: t })]);
  for (const t of REST_TEMPLATES) list.push([`rest m${t}`, await buildField(assets, sets, 90 + t, 'rest', { w: 60, h: 44, groups: 0, species: [], template: t })]);
  return { sets, list };
}

test('grown zones: every tile meeting and every object on its ground occurs in the t3 maps', { skip: !have && 'no generated assets' }, async () => {
  const sources = PAIR_SOURCES.map((id) => json<GameMap>(mapFile(id)));
  const h = new Set<string>(), v = new Set<string>();
  for (const m of sources) m.tiles.forEach((row, r) => row.forEach((t, c) => {
    if (c + 1 < row.length) h.add(`${t},${row[c + 1]}`);
    if (r + 1 < m.tiles.length) v.add(`${t},${m.tiles[r + 1][c]}`);
  }));
  const grass = new Set(grassOf(sources).tiles);
  const { sets, list } = await zones();
  const grounds = new Set<string>();
  for (const m of sources) for (const L of LAYERS) for (const o of m[L]) grounds.add(objKey(sets, m, o, grass));
  for (const [name, z] of list) {
    const m = z.map, W = m.header.width, H = m.header.height;
    assert.equal(m.tiles.length, H, name);
    for (let r = 0; r < H; r++) {
      assert.equal(m.tiles[r].length, W, `${name}: row ${r}`);
      assert.equal(m.walk[r].length, W, `${name}: walk row ${r}`);
      for (let c = 0; c < W; c++) {
        if (c + 1 < W) assert.ok(h.has(`${m.tiles[r][c]},${m.tiles[r][c + 1]}`), `${name}: ${m.tiles[r][c]} left of ${m.tiles[r][c + 1]} at ${c},${r}`);
        if (r + 1 < H) assert.ok(v.has(`${m.tiles[r][c]},${m.tiles[r + 1][c]}`), `${name}: ${m.tiles[r][c]} over ${m.tiles[r + 1][c]} at ${c},${r}`);
      }
    }
    for (const L of LAYERS) for (const o of m[L]) {
      if (o.obj === EXIT_LIT) continue;
      assert.ok(grounds.has(objKey(sets, m, o, grass)), `${name}: object ${o.obj} at ${o.x},${o.y} on ground no t3 map has it on`);
    }
  }
});

test('grown zones: the exit is reached from the start and every group stands on reached ground', { skip: !have && 'no generated assets' }, async () => {
  const { list } = await zones();
  for (const [name, z] of list) {
    const W = z.map.header.width, H = z.map.header.height, cell = (p: { x: number; y: number }) => Math.floor(p.y / TILE) * W + Math.floor(p.x / TILE);
    assert.equal(z.walk.length, W * H, name);
    const seen = reachable(z.walk, W, H, Math.floor(z.start.x / TILE), Math.floor(z.start.y / TILE));
    assert.ok(seen[cell(z.start)], `${name}: the start is walkable`);
    assert.ok(seen[cell(z.exit)], `${name}: the exit is reached`);
    assert.ok(z.exit.x - z.start.x > W * TILE / 2, `${name}: the exit lies east of the start`);
    // the exit stands in the open land, not behind a long cliff line only one route leads round
    const probe: number[] = [];
    for (let i = 0; i < W * H; i += 7) if (seen[i]) probe.push(i);
    const d = detour(seen, W, H, Math.floor(z.exit.x / TILE), Math.floor(z.exit.y / TILE), probe);
    assert.ok(d < 1.7, `${name}: the way to the exit is roundabout (${d.toFixed(2)})`);
    const stones = LAYERS.flatMap((L) => z.map[L]).filter((o) => o.obj === EXIT_OBJ || o.obj === EXIT_LIT);
    assert.equal(stones.length, 1, `${name}: one warp stone, the exit`);
    for (const s of z.spawns) assert.ok(seen[cell(s)], `${name}: group at ${s.x},${s.y} on reached ground`);
    if (z.kind === 'battle') {
      assert.ok(W >= 150, `${name}: ${W} columns`);
      if (z.template === 119) assert.ok(H >= 120, `${name}: ${H} rows`);
      // the open middle got new land (rises, ponds), not only grass
      assert.ok(z.middle && z.middle.terrain >= 0.02 * z.middle.cells, `${name}: ${z.middle?.terrain} of ${z.middle?.cells} middle cells raised`);
      assert.ok(z.spawns.length >= 10, `${name}: ${z.spawns.length} groups`);
    }
  }
});

test('stages 2 and 3 (§17): their zones keep the tile meetings of their own tileset, are crossed end to end, and their boss rooms are entered on walkable ground', { skip: !(have && existsSync(asset('cmf/cmf_o4.json')) && existsSync(asset('cmf/cmf_o6.json'))) && 'no generated assets' }, async () => {
  for (const st of STAGES.slice(1)) {
    const b = st.biome, sets = await zoneSets(assets, b.objset), sources = b.sources.map((id) => json<GameMap>(mapFile(id)));
    const h = new Set<string>(), v = new Set<string>();
    for (const m of sources) m.tiles.forEach((row, r) => row.forEach((t, c) => {
      if (c + 1 < row.length) h.add(`${t},${row[c + 1]}`);
      if (r + 1 < m.tiles.length) v.add(`${t},${m.tiles[r + 1][c]}`);
    }));
    const list: [string, Zone][] = [];
    for (const t of b.battle) list.push([`${st.name} m${t}`, await buildField(assets, sets, 40 + t, 'battle', { w: 190, h: 160, groups: 14, species: st.species, template: t, biome: b, zoneNo: 4 })]);
    for (const t of b.rest) list.push([`${st.name} rest m${t}`, await buildField(assets, sets, 90 + t, 'rest', { w: 60, h: 44, groups: 0, species: [], template: t, biome: b })]);
    for (const [name, z] of list) {
      const m = z.map, W = m.header.width, H = m.header.height;
      assert.equal(m.header.tileset, sources[0].header.tileset, name);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        if (c + 1 < W) assert.ok(h.has(`${m.tiles[r][c]},${m.tiles[r][c + 1]}`), `${name}: ${m.tiles[r][c]} left of ${m.tiles[r][c + 1]} at ${c},${r}`);
        if (r + 1 < H) assert.ok(v.has(`${m.tiles[r][c]},${m.tiles[r + 1][c]}`), `${name}: ${m.tiles[r][c]} over ${m.tiles[r + 1][c]} at ${c},${r}`);
      }
      const cell = (p: { x: number; y: number }) => Math.floor(p.y / TILE) * W + Math.floor(p.x / TILE);
      const seen = reachable(z.walk, W, H, Math.floor(z.start.x / TILE), Math.floor(z.start.y / TILE));
      assert.ok(seen[cell(z.exit)], `${name}: exit reached`);
      for (const s of z.spawns) assert.ok(seen[cell(s)], `${name}: group at ${s.x},${s.y} reached`);
      if (z.kind === 'battle') assert.ok(W * H >= 6000, `${name}: grown (${W}x${H})`);
    }
    const boss = await buildBoss(assets, sets, st.boss, b), BW = boss.map.header.width;
    assert.equal(boss.walk[Math.floor(boss.start.y / TILE) * BW + Math.floor(boss.start.x / TILE)], 1, `${st.name}: boss room entered on walkable ground`);
  }
});
