// 2.5D view angle: 45° snaps, input turning with the view, boss lock.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import type { InputState } from '../src/core/input.ts';
import { ViewAngle, quarterOf, screenKeyToWorld, viewInput, worldDirToScreen } from '../src/core/world/view.ts';

test('quarter of a yaw keeps the + mapping at 45° and rounds halfway down', () => {
  assert.deepEqual([0, 45, 90, 135, 180, 225, 270, 315, 360, -90].map(quarterOf), [0, 0, 1, 1, 2, 2, 3, 3, 0, 3]);
});

test('screen keys turn clockwise with the view and facings turn back', () => {
  assert.equal(screenKeyToWorld(AVK.UP, 1), AVK.RIGHT);
  assert.equal(screenKeyToWorld(AVK.LEFT, 1), AVK.UP);
  assert.equal(screenKeyToWorld(AVK.DOWN, 2), AVK.UP);
  assert.equal(screenKeyToWorld(AVK.OK, 3), AVK.OK);
  for (let q = 0; q < 4; q++) for (const [k, d] of [[AVK.LEFT, 0], [AVK.RIGHT, 1], [AVK.UP, 2], [AVK.DOWN, 3]] as const) {
    const w = screenKeyToWorld(k, q), wd = [AVK.LEFT, AVK.RIGHT, AVK.UP, AVK.DOWN].indexOf(w as never);
    assert.equal(worldDirToScreen(wd, q), d, `q ${q} key ${k}`);
  }
});

test('viewInput maps held keys, the acted direction and the stick', () => {
  const held = new Set<number>([AVK.UP]);
  const base: InputState = {
    stick: { active: true, angle: -90, level: 1, key: AVK.UP, dx: 0, dy: -36 },
    isHeld: (k) => held.has(k),
    direction: () => [...held][0] ?? 0,
  };
  const v = new ViewAngle();
  const inp = viewInput(base, v);
  assert.equal(inp.direction(), AVK.UP);
  v.turn(1); v.turn(1);                      // 90°: screen up is world right
  assert.equal(v.target, 90);
  assert.equal(inp.direction(), AVK.RIGHT);
  assert.equal(inp.isHeld(AVK.RIGHT), true);
  assert.equal(inp.isHeld(AVK.UP), false);
  assert.equal(inp.stick.key, AVK.RIGHT);
  assert.ok(Math.abs(inp.stick.angle) < 1e-9);
});

test('view eases to its target the short way and the lock sends it home', () => {
  const v = new ViewAngle();
  v.turn(-1);
  assert.equal(v.target, 315);
  for (let i = 0; i < 4; i++) v.tick();
  assert.equal(v.yaw, 324);
  v.tick();
  assert.equal(v.yaw, 315);
  v.lock(true);
  assert.equal(v.turn(1), false);
  assert.equal(v.target, 0);
  v.reset([0, 90], 90);
  assert.equal(v.yaw, 90);
  assert.equal(v.turn(1), false);                // still locked: stays home
  v.lock(false);
  assert.equal(v.turn(1), true);
  assert.equal(v.target, 0);
});
