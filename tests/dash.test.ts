// Dash (2.5D): distance, sub-step walls, monsters passed, invulnerable ticks, cooldown, combo-window cancel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DASH, Player, type Blockers } from '../src/core/combat/player.ts';
import type { FieldMap } from '../src/core/world/fieldMap.ts';
import type { InputState } from '../src/core/input.ts';
import type { Cmf } from '../src/core/data/assets.ts';
import { AVK } from '../src/core/keys.ts';

const W = 40, H = 20;
function field(wallCol = -1): FieldMap {
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < W && r < H && c !== wallCol;
  return {
    width: W * 16, height: H * 16, map: { header: { width: W, height: H } },
    walkCell: open, walkAt: (i: number) => (open(i % W, Math.floor(i / W)) ? 1 : 0),
  } as unknown as FieldMap;
}
const cmf = { n_frames: 0, clips: [], frames: [], anims: [], clip_images: [] } as Cmf;
const keys = (...held: number[]): InputState => ({
  stick: { active: false, angle: 0, level: 0, key: 0, dx: 0, dy: 0 }, isHeld: (k) => held.includes(k), direction: () => held[0] ?? 0,
});
const none: Blockers = { solid: [], monsters: [] };
function player(x = 100, y = 100): Player { const p = new Player(cmf); p.place(x, y); return p; }

test('a dash covers ticks × speed toward the held key', () => {
  const p = player(), f = field();
  assert.equal(p.startDash(keys(AVK.RIGHT)), true);
  for (let i = 0; i < DASH.ticks; i++) p.update(keys(), f, none);
  assert.equal(p.x, 100 + DASH.ticks * DASH.speed);
  assert.equal(p.dir, 1);
  p.update(keys(), f, none);
  assert.equal(p.x, 100 + DASH.ticks * DASH.speed, 'no drift after the dash');
});

test('a one-cell wall stops the dash; monsters do not', () => {
  const p = player(100, 100), f = field(9);                 // wall cells at x 144..159
  p.startDash(keys(AVK.RIGHT));
  for (let i = 0; i < DASH.ticks; i++) p.update(keys(), f, { solid: [], monsters: [[110, 80, 140, 120]] });
  assert.ok(p.x + 8 <= 144, `stopped before the wall at ${p.x}`);
  assert.ok(p.x > 120, 'passed the monster box');
});

test('invulnerable for the first ticks, then a cooldown', () => {
  const p = player(), f = field();
  p.startDash(keys(AVK.DOWN));
  const inv: boolean[] = [];
  for (let i = 0; i < 6; i++) { p.update(keys(), f, none); inv.push(p.dashInvuln); }
  assert.deepEqual(inv, [true, true, true, false, false, false]);
  assert.equal(p.startDash(keys(AVK.DOWN)), false, 'cooling down');
  for (let i = 0; i < DASH.ticks + DASH.cooldown; i++) p.update(keys(), f, none);
  assert.equal(p.startDash(keys(AVK.DOWN)), true);
});

test('basic attacks cancel only in their combo window; skills and knockback never', () => {
  const p = player(), f = field();
  p.actions = [{ n: 8, frame: new Array(8).fill(0), step: new Array(8).fill(0), event: new Array(8).fill(0), sound: new Array(8).fill(0) }];
  p.startAttack();
  p.update(keys(), f, none);
  assert.equal(p.startDash(keys(AVK.LEFT)), false, 'early in the swing');
  for (let i = 0; i < 5; i++) p.update(keys(), f, none);
  assert.equal(p.startDash(keys(AVK.LEFT)), true, 'last ticks of the swing');
  assert.equal(p.action, 0);
  const q = player();
  q.startSkill(1);
  assert.equal(q.startDash(keys(AVK.LEFT)), false);
  const k = player();
  k.startKnock(6, 0, 100);
  assert.equal(k.startDash(keys(AVK.LEFT)), false);
});
