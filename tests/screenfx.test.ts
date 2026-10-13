// FUN_000f8b00 event screen filters against tests/data/screenfx_cases.json (random pixels, reference port checked in the emulator).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { blur8, smear } from '../src/game/screenfx.ts';

const data = JSON.parse(readFileSync(new URL('./data/screenfx_cases.json', import.meta.url), 'utf-8'));

test('event blur and smear match the original', () => {
  for (const c of data.cases as { W: number; H: number; src: number[]; blur: number[]; smear0: number[]; smear1: number[] }[]) {
    const run = (f: (b: Uint16Array) => void) => { const b = Uint16Array.from(c.src); f(b); return [...b]; };
    assert.deepEqual(run((b) => blur8(b, c.W, c.H)), c.blur, `blur ${c.W}x${c.H}`);
    assert.deepEqual(run((b) => smear(b, c.W, c.H, 0)), c.smear0, `smear0 ${c.W}x${c.H}`);
    assert.deepEqual(run((b) => smear(b, c.W, c.H, 1)), c.smear1, `smear1 ${c.W}x${c.H}`);
  }
});
