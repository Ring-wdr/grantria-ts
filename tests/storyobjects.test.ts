// Map 0xd0 (the canyon bridge to the airship): the wind barrier (object 0x15) blocks the way to the airship until event 0x5c, as
// FUN_0001da78 skips its box once the crystal piece is brought; the map's walk file is open under it.
// Skipped without generated assets (public/assets comes from the player's own APK).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildWalk } from '../src/core/world/world.ts';
import type { Cmf, GameMap, MapObject } from '../src/core/data/assets.ts';

const asset = (p: string) => new URL(`../public/assets/${p}`, import.meta.url);
const have = existsSync(asset('maps/m208.json')) && existsSync(asset('cmf/cmf_oc.json'));
const json = <T>(p: string): T => JSON.parse(readFileSync(asset(p), 'utf8')) as T;

test('the wind barrier on 0xd0 blocks until the crystal piece opens it', { skip: !have && 'no generated assets' }, () => {
  const map = json<GameMap>('maps/m208.json');
  const zone = json<Cmf>(`cmf/cmf_o${map.header.objset}.json`), oc = json<Cmf>('cmf/cmf_oc.json');
  const objCmf = (id: number): [Cmf, number] => (id < 0 ? [oc, -id] : [zone, id]);
  const W = map.header.width, H = map.header.height;
  /** the bottom portal row (36) reaches the top portal row (1) */
  const crossable = (walk: Uint8Array): boolean => {
    const seen = new Set<number>(), q: number[] = [];
    for (let c = 13; c <= 16; c++) if (walk[36 * W + c]) { q.push(36 * W + c); seen.add(36 * W + c); }
    while (q.length) {
      const i = q.pop()!, r = Math.floor(i / W), c = i % W;
      if (r === 1) return true;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc, j = nr * W + nc;
        if (nr < 0 || nc < 0 || nr >= H || nc >= W || seen.has(j) || !walk[j]) continue;
        seen.add(j); q.push(j);
      }
    }
    return false;
  };
  assert.ok(map.objLow.some((o) => o.obj === 0x15));
  assert.equal(crossable(buildWalk(map, objCmf)), false);
  assert.equal(crossable(buildWalk(map, objCmf, (o: MapObject) => o.obj === 0x15)), true);
});
