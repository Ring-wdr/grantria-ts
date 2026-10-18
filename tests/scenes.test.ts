// The screen flow runs without a renderer: core/scenes logic driven by keys over a fake host, its screen changes
// recorded through the Screens port (core/scenes/host.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import type { SceneHost, Screens } from '../src/core/scenes/host.ts';
import { LogoLogic, RatingLogic, TITLE_HELP, TITLE_ITEMS, TITLE_REPLAY, TitleLogic } from '../src/core/scenes/title.ts';

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

test('title: the intro takes a key, then the menu rows, the 엑스트라 submenu and the pad keys pick screens', () => {
  const h = host(), title = new TitleLogic(h.ctx, true);
  title.update([AVK.OK]);                                          // ends the intro only
  assert.deepEqual(h.went, []);
  title.update([AVK.UP, AVK.OK]);                                  // from 게임시작 up wraps to the last row
  assert.deepEqual(h.went, ['ranking']);
  const extra = new TitleLogic(h.ctx);
  extra.update([AVK.DOWN, AVK.DOWN, AVK.OK, AVK.CLR]);             // 게임순위 (kept) wraps to 엑스트라, opens, closes
  extra.update([AVK.OK, AVK.DOWN, AVK.OK]);                        // opens again, 음악감상
  new TitleLogic(h.ctx).update([TITLE_REPLAY]);                    // a tapped submenu row is picked at once
  new TitleLogic(h.ctx).update([TITLE_HELP]);                      // so is a tapped row
  new TitleLogic(h.ctx).update([AVK.K1]);                          // pad □ = 환경설정
  assert.deepEqual(h.went, ['ranking', 'musicRoom', 'replays', 'titleOption help', 'titleOption settings']);
  assert.deepEqual(TITLE_ITEMS.map(([, l]) => l), ['게임시작', '엑스트라', '환경설정', '도움말', '게임순위']);
});
