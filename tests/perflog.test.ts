import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PERF_WINDOW_MS, PerfRecorder, Samples, type PerfContext } from '../src/web/perfLog.ts';

const ctx = (): PerfContext => ({
  scene: 'play', map: 10, monsters: 3, options: { fps: 20 },
  renderer: { geometries: 1, textures: 2, programs: 3, calls: 4, triangles: 5 },
  view: { canvasW: 480, canvasH: 320, cssW: 960, cssH: 640, dpr: 2 },
});

test('성능 기록: nearest-rank percentiles, buffer emptied per window', () => {
  const s = new Samples();
  for (let i = 1; i <= 2000; i++) s.push(i);          // grows past the first buffer
  assert.deepEqual(s.take(), { n: 2000, p50: 1000, p95: 1900, max: 2000, mean: 1000.5 });
  assert.equal(s.take().n, 0);
});

test('성능 기록: one record per minute, rAF gaps and hidden time apart, capped', () => {
  let now = 0;
  const r = new PerfRecorder(ctx, () => now, 2);
  for (let w = 0; w < 3; w++) {
    for (let t = 0; t < PERF_WINDOW_MS; t += 1000 / 60) {
      now = w * PERF_WINDOW_MS + t;
      r.frame(now);
      if (Math.round(t) % 50 < 17) { r.update(1); r.drawn(2); }
    }
  }
  r.flush(now);                                         // a fresh window, then backgrounded for 5 s
  const full = r.records[0];
  r.hidden(true, now);
  now += 5000;
  r.hidden(false, now);
  r.frame(now);
  r.longTask(80);
  const last = r.flush(now + 100);
  assert.equal(r.records.length, 2);                   // cap: the oldest went first
  assert.equal(r.records[1], last);
  assert.equal(last.rafGaps, 1);
  assert.equal(last.hiddenMs, 5000);
  assert.deepEqual([last.longTasks, last.longTaskMs], [1, 80]);
  assert.equal(last.map, 10);
  assert.ok(Math.abs(full.raf.p50 - 1000 / 60) < 0.01);
  assert.equal(full.update.max, 1);
  assert.ok(full.ticks > 0 && full.ticks === full.draw.n);
});
