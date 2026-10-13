// Replays tests/data/corner_cases.json (tools/grantria_corner.py: synthetic random maps run through a port of the player's
// walk tail checked against the original Thumb code): axis moves, block codes and the corner correction
// FUN_00068444 on random maps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Player } from '../src/core/combat/player.ts';

const data = JSON.parse(readFileSync(new URL('./data/corner_cases.json', import.meta.url), 'utf-8'));

test('corner correction matches the original walk tail', () => {
  let ticks = 0;
  for (const [ci, c] of (data.cases as { rows: string[]; x: number; y: number; dir: 0 | 1 | 2 | 3; lastH: 0 | 1; lastV: 2 | 3; code: number; ticks: { in: [number, number]; out: number[] }[] }[]).entries()) {
    const H = c.rows.length, W = c.rows[0].length, bits = c.rows.join('').split('').map((ch) => (ch === '.' ? 1 : 0));
    const field = {
      map: { header: { width: W, height: H } }, width: W * 16, height: H * 16,
      walkCell: (col: number, r: number) => col >= 0 && r >= 0 && col < W && r < H && bits[r * W + col] === 1,
      walkAt: (i: number) => (i >= 0 && i < bits.length ? bits[i] : 0),
    } as never;
    const p = new Player({ frames: [] } as never);
    Object.assign(p, { x: c.x, y: c.y, dir: c.dir, lastH: c.lastH, lastV: c.lastV, blockCode: c.code });
    for (const [ti, t] of c.ticks.entries()) {
      p.walkMove(t.in[0], t.in[1], field, { solid: [], monsters: [] });
      const got = [p.x, p.y, Math.abs(p.vx), Math.abs(p.vy), p.blockCode];
      assert.deepEqual(got, t.out.map((v, i) => (i === 2 || i === 3 ? Math.abs(v) : v)), `case ${ci} tick ${ti}`);
      ticks++;
    }
  }
  assert.ok(ticks > 1000);
});
