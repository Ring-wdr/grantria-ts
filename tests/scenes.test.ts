// The screen flow runs without a renderer: core/scenes logic driven by keys over a fake host, its screen changes
// recorded through the Screens port (core/scenes/host.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import type { SceneHost, Screens } from '../src/core/scenes/host.ts';
import { LogoLogic, RatingLogic, TITLE_ITEMS, TITLE_REPLAY, TitleLogic } from '../src/core/scenes/title.ts';

/** a host that records the screens asked for and the BGM played */
function host() {
  const went: string[] = [], bgm: number[] = [];
  const screens = new Proxy({}, { get: (_, name) => (...args: unknown[]) => { went.push([String(name), ...args].join(' ')); } }) as Screens;
  const audio = { playBgm: (n: number) => { bgm.push(n); }, stopBgm() {}, playSfx() {}, bgmTime: () => null, pauseBgm() {}, setBgmLoop() {} };
  return { ctx: { screens, audio } as unknown as SceneHost, went, bgm };
}

test('logo -> rating -> title: after their frames, or at once on a key', () => {
  const h = host(), logo = new LogoLogic(h.ctx);
  for (let i = 0; i < 20; i++) logo.update([]);
  assert.deepEqual(h.went, []);
  logo.update([]);
  assert.deepEqual(h.went, ['rating']);
  new RatingLogic(h.ctx).update([AVK.OK]);
  assert.deepEqual([h.went, h.bgm], [['rating', 'title true'], [0]]);
});

test('title: the intro takes a key, then the menu rows and the pad icon keys pick screens', () => {
  const h = host(), title = new TitleLogic(h.ctx, true);
  title.update([AVK.OK]);                                          // ends the intro only
  assert.deepEqual(h.went, []);
  title.update([AVK.UP, AVK.OK]);                                  // from 게임시작 up wraps to the last row
  assert.deepEqual(h.went, ['musicRoom']);
  new TitleLogic(h.ctx).update([TITLE_REPLAY]);                    // a tapped row is picked at once
  new TitleLogic(h.ctx).update([AVK.K1]);                          // pad □ = the settings icon
  assert.deepEqual(h.went, ['musicRoom', 'replays', 'titleOption settings']);
  assert.equal(TITLE_ITEMS.length, 4);
});
