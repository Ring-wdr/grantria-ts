// The day/night palette shift reaches only the sheets FUN_0001cf0c recolours (misc-systems.md §4.3).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { SpriteLayer, greyUniform, setDayShift, shiftless } from '../src/web/render/sprites.ts';

test('the day/night shift skips UI, item icons, faces, effects and the shadow', () => {
  for (const n of ['c', 't', 'i0', 'i3', 'face0', 'face_s_1', 'e', 'e2', 'ec', 'es', 'sIcon', 'shadow']) assert.ok(shiftless(n), n);
  for (const n of ['t0', 't9', 'oc', 'o3_1', 'c0', 'c75', 'eq/a0_3', 'w1', 'h2']) assert.ok(!shiftless(n), n);
});

test('a shiftless sheet gets a zero shift, a recoloured one and the map target the live one', async () => {
  const tex = () => { const t = new THREE.Texture(); t.image = { width: 64, height: 64 }; return t; };
  const L = new SpriteLayer({ texture: async () => tex() } as never);
  await L.preload(['es', 't0', 'i0']);
  const map = tex();
  L.target(map, 64, 64);
  for (const n of ['es', 't0', 'i0']) L.quad(n, 0, 0, 16, 16, 0, 0, 0, 0, 1, 4, 6);
  setDayShift(1, 0, -12);                                           // night row 26
  const mats = (L as unknown as { mats: THREE.ShaderMaterial[] }).mats;
  const shift = (i: number) => mats[i].uniforms.shift.value as THREE.Vector3;
  assert.equal(shift(0), greyUniform.shift.value);                  // the map target: tiles take the shift through it
  assert.deepEqual(shift(1).toArray(), [0, 0, 0]);                  // es: the sparkle's black stays black
  assert.equal(shift(2), greyUniform.shift.value);                  // t0
  assert.deepEqual(shift(3).toArray(), [0, 0, 0]);                  // i0: item icons
  setDayShift(0, 0, 0);
});
