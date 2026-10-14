// OverlayStack: top-only keys, roles to handlers, CLR close requests, nested opens and the priority queue.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVK } from '../src/core/keys.ts';
import { OverlayStack, popupRole, type Overlay, type Role } from '../src/web/game/overlays.ts';

/** an overlay that answers `role` on OK and records the keys it saw */
function fake(role: Role = 'yes'): Overlay & { seen: number[][]; draws: number } {
  const o = {
    seen: [] as number[][], draws: 0,
    handle(p: number[]) { o.seen.push(p); return p.includes(AVK.OK) ? role : null; },
    draw() { o.draws++; },
  };
  return o;
}

test('only the top overlay takes keys; update reports an open stack', () => {
  const s = new OverlayStack(), a = fake(), b = fake();
  assert.equal(s.update([AVK.UP]), false);
  s.open(a); s.open(b);
  assert.equal(s.update([AVK.UP]), true);
  assert.deepEqual(a.seen, []);
  assert.deepEqual(b.seen, [[AVK.UP]]);
  assert.equal(s.top, b);
});

test('the closing role runs its handler, then close(role); ok counts as yes', () => {
  const s = new OverlayStack(), log: string[] = [];
  s.open(fake('no'), { on: { yes: () => log.push('yes'), no: () => log.push('no'), close: (r) => log.push(`close:${r}`) } });
  s.update([AVK.OK]);
  assert.deepEqual(log, ['no', 'close:no']);
  assert.equal(s.size, 0);
  assert.equal(popupRole('ok'), 'yes');
  assert.equal(popupRole(null), null);
});

test("closedby 'cancel': CLR closes with role cancel before the overlay sees it", () => {
  const s = new OverlayStack(), o = fake(), log: string[] = [];
  s.open(o, { closedby: 'cancel', on: { cancel: () => log.push('cancel'), no: () => log.push('no') } });
  s.update([AVK.CLR]);
  assert.deepEqual(log, ['cancel']);
  assert.deepEqual(o.seen, []);
});

test('a handler that opens the next overlay leaves it on top, without this tick\'s keys', () => {
  const s = new OverlayStack(), next = fake();
  s.open(fake(), { on: { yes: () => s.open(next) } });
  s.update([AVK.OK]);
  assert.equal(s.top, next);
  assert.deepEqual(next.seen, []);
});

test('closing an overlay drops the ones above it; draw goes bottom to top', () => {
  const s = new OverlayStack(), a = fake(), b = fake(), order: string[] = [];
  a.draw = () => order.push('a'); b.draw = () => order.push('b');
  s.open(a, { kind: 'list' }); s.open(b, { kind: 'popup' });
  s.draw();
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(s.kindOpen('popup'), true);
  s.close(a, 'cancel');
  assert.equal(s.size, 0);
  assert.equal(s.kindOpen('popup'), false);
});

test('drain opens the highest priority first, first queued among equal ones, only on an empty stack', () => {
  const s = new OverlayStack(), log: string[] = [];
  const opener = (n: string) => () => { log.push(n); s.open(fake()); };
  s.enqueue(opener('attend'), 1);
  s.enqueue(opener('ach1'), 3);
  s.enqueue(opener('fortune'), 2);
  s.enqueue(opener('ach2'), 3);
  for (let i = 0; i < 4; i++) { assert.equal(s.drain(), true); assert.equal(s.drain(), false); s.update([AVK.OK]); }
  assert.deepEqual(log, ['ach1', 'ach2', 'fortune', 'attend']);
  assert.equal(s.drain(), false);
});
