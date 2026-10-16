import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultOptions, fxScale, loadOptions, optionFps, saveOptions } from '../src/core/save/options.ts';
import { platform } from '../src/core/platform.ts';

test('편의 설정 defaults keep the original behaviour', () => {
  const o = defaultOptions();
  assert.equal(o.textSpeed, 0);
  assert.equal(o.auto, 0);
  assert.equal(o.shake, 0);
  assert.equal(o.flash, 0);
  assert.equal(o.bgm, 10);
  assert.equal(o.sfx, 10);
  assert.equal(o.abyss, 0);
  assert.equal(o.hudNumbers, 0);                            // no HP / MP / EXP numbers on the HUD, like the original                                 // a dimension clear shows the original result
  assert.equal(optionFps(o), 20);
});

test('extra settings round-trip and out-of-range values fall back', () => {
  saveOptions({ ...defaultOptions(), bgm: 3, textSpeed: 2, auto: 1, shake: 2 });
  const o = loadOptions();
  assert.deepEqual([o.bgm, o.textSpeed, o.auto, o.shake], [3, 2, 1, 2]);
  platform().storage.set('grantria.option', JSON.stringify({ volume: 0, bgm: 11, flash: -1, textSpeed: 1.5 }));
  const p = loadOptions();
  assert.equal(p.volume, 0);
  assert.equal(p.bgm, 10);
  assert.equal(p.flash, 0);
  assert.equal(p.textSpeed, 0);
});

test('fxScale: original, reduced, off', () => {
  assert.deepEqual([0, 1, 2].map(fxScale), [1, 0.5, 0]);
});

test('fullscreen follows the screen until the player sets it', () => {
  // the test platform is not touch-first: an unset fullscreen loads off, a chosen one is kept
  saveOptions({ ...defaultOptions(), fullscreen: 1, fullscreenSet: 0 });
  assert.equal(loadOptions().fullscreen, 0);
  saveOptions({ ...defaultOptions(), fullscreen: 1, fullscreenSet: 1 });
  assert.equal(loadOptions().fullscreen, 1);
});

test('개발자 모드: whole-number multipliers, off until unlocked, lock resets them', async () => {
  const { dev, dropMul, killMul, lockDev, resetDevCache, saveDev, unlockDev } = await import('../src/core/rules/dev.ts');
  platform().storage.set('grantria.dev', JSON.stringify({ unlocked: false, killMul: 3, dropMul: 2 }));
  resetDevCache();
  assert.deepEqual([killMul(), dropMul()], [1, 1]);                    // locked: the original rates
  unlockDev();
  assert.deepEqual([killMul(), dropMul()], [3, 2]);
  platform().storage.set('grantria.dev', JSON.stringify({ unlocked: true, killMul: 1.5, dropMul: 99 }));
  resetDevCache();
  assert.deepEqual([dev().killMul, dev().dropMul], [1, 1]);            // fractions and out-of-range fall back to ×1
  dev().killMul = 4; saveDev(); resetDevCache();
  assert.equal(killMul(), 4);
  lockDev(); resetDevCache();
  assert.deepEqual(dev(), { unlocked: false, killMul: 1, dropMul: 1, perfLog: false });
});
