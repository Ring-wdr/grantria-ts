// Replays tests/data/path_cases.json: FUN_00066c70 searches on synthetic random maps from the
// emulator-checked Python port (field-state goal fix, start-cell snap, stale DAT_003b3bf2).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findPath, setPathMemory } from '../src/game/pathfind.ts';

const data = JSON.parse(readFileSync(new URL('./data/path_cases.json', import.meta.url), 'utf-8'));

test('path finder matches the original', () => {
  for (const [i, c] of (data.cases as { W: number; H: number; walk: string; x: number; y: number; box: [number, number, number, number]; lastH: number; lastV: number; tx: number; ty: number; field: boolean; bf2: number; path: [number, number][] | null }[]).entries()) {
    const walk = (col: number, r: number) => { const k = col + r * c.W; return k >= 0 && k < c.W * c.H && c.walk[k] === '1'; };
    setPathMemory(c.bf2);
    const got = findPath(walk, c.W, c.H, { x: c.x, y: c.y, lastH: c.lastH, lastV: c.lastV, body: c.box }, c.tx, c.ty, c.field);
    assert.deepEqual(got, c.path, `case ${i}`);
  }
});
