// 성능 기록 (개발자 모드 → 성능 기록, off by default): per-minute aggregates of the tick and draw cost, the rAF
// interval, long tasks, the JS heap and the renderer's resources, kept in memory (PERF_CAP windows) and exported as
// JSON through the platform FilePort, to line up with tools/perf_soak.py's CSV by wall clock (docs/perf-soak.md).
// Off, app.ts pays one null check per frame and per tick; nothing here runs and no observer is registered.
import { platform } from '../core/platform';

export const PERF_WINDOW_MS = 60_000;
/** windows kept (4 hours); the oldest go first */
export const PERF_CAP = 240;

export interface PerfStat { n: number; p50: number; p95: number; max: number; mean: number }

/** what app.ts reports at the end of each window */
export interface PerfContext {
  scene: string;
  map: number | null;
  monsters: number | null;
  /** the options in effect (fps from the speed option, effects, fullscreen, ...) */
  options: Record<string, number>;
  /** renderer.info: resources alive, and the last render pass's draw calls / triangles */
  renderer: { geometries: number; textures: number; programs: number; calls: number; triangles: number };
  view: { canvasW: number; canvasH: number; cssW: number; cssH: number; dpr: number };
}

export interface PerfRecord extends PerfContext {
  /** wall clock at the window's start and end (ISO, local offset lost: compare with epoch ms) */
  start: string;
  end: string;
  endEpochMs: number;
  durMs: number;
  /** of durMs, time the page was hidden (backgrounded: no rAF, no ticks) */
  hiddenMs: number;
  ticks: number;
  frames: number;
  /** scene.update per tick and drawScene per drawn tick, CPU ms (WebGL work is queued, not waited for) */
  update: PerfStat;
  draw: PerfStat;
  /** requestAnimationFrame interval, ms; gaps over 1 s (backgrounded, stalled) are counted apart */
  raf: PerfStat;
  rafGaps: number;
  longTasks: number;
  longTaskMs: number;
  /** performance.memory (Chromium only), MB */
  heapUsedMb: number | null;
  heapTotalMb: number | null;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const mb = (v: number) => Math.round((v / 1048576) * 10) / 10;

/** growable sample buffer, read and emptied once per window */
export class Samples {
  private a = new Float64Array(1024);
  n = 0;
  push(v: number): void {
    if (this.n === this.a.length) { const b = new Float64Array(this.n * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  /** nearest-rank percentiles of what was pushed since the last call; empties the buffer */
  take(): PerfStat {
    const n = this.n;
    this.n = 0;
    if (!n) return { n: 0, p50: 0, p95: 0, max: 0, mean: 0 };
    const s = this.a.slice(0, n).sort();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s[i];
    const at = (q: number) => s[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
    return { n, p50: r3(at(0.5)), p95: r3(at(0.95)), max: r3(s[n - 1]), mean: r3(sum / n) };
  }
}

export class PerfRecorder {
  readonly records: PerfRecord[] = [];
  readonly startedAt = new Date().toISOString();
  private readonly upd = new Samples();
  private readonly drw = new Samples();
  private readonly raf = new Samples();
  private lastFrame = -1;
  private ticks = 0;
  private frames = 0;
  private gaps = 0;
  private longTasks = 0;
  private longMs = 0;
  private hiddenMs = 0;
  private hiddenSince = -1;
  private winStart: number;
  private winEpoch = Date.now();
  private readonly describe: () => PerfContext;
  private readonly clock: () => number;
  private readonly cap: number;

  constructor(describe: () => PerfContext, clock: () => number = () => performance.now(), cap = PERF_CAP) {
    this.describe = describe;
    this.clock = clock;
    this.cap = cap;
    this.winStart = clock();
  }

  /** every animation frame, with its timestamp; closes the window once PERF_WINDOW_MS have passed */
  frame(now: number): void {
    if (this.lastFrame >= 0) {
      const d = now - this.lastFrame;
      if (d > 1000) this.gaps++; else this.raf.push(d);
    }
    this.lastFrame = now;
    this.frames++;
    if (now - this.winStart >= PERF_WINDOW_MS) this.flush(now);
  }
  update(ms: number): void { this.upd.push(ms); this.ticks++; }
  drawn(ms: number): void { this.drw.push(ms); }
  longTask(ms: number): void { this.longTasks++; this.longMs += ms; }
  hidden(h: boolean, now = this.clock()): void {
    if (h && this.hiddenSince < 0) this.hiddenSince = now;
    else if (!h && this.hiddenSince >= 0) { this.hiddenMs += now - this.hiddenSince; this.hiddenSince = -1; }
  }

  /** close the current window into a record (also the partial one, on export) */
  flush(now = this.clock()): PerfRecord {
    if (this.hiddenSince >= 0) { this.hiddenMs += now - this.hiddenSince; this.hiddenSince = now; }
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    const endEpoch = this.winEpoch + (now - this.winStart);
    const rec: PerfRecord = {
      start: new Date(this.winEpoch).toISOString(), end: new Date(endEpoch).toISOString(), endEpochMs: Math.round(endEpoch),
      durMs: Math.round(now - this.winStart), hiddenMs: Math.round(this.hiddenMs),
      ticks: this.ticks, frames: this.frames,
      update: this.upd.take(), draw: this.drw.take(), raf: this.raf.take(), rafGaps: this.gaps,
      longTasks: this.longTasks, longTaskMs: Math.round(this.longMs),
      heapUsedMb: mem ? mb(mem.usedJSHeapSize) : null, heapTotalMb: mem ? mb(mem.totalJSHeapSize) : null,
      ...this.describe(),
    };
    this.records.push(rec);
    if (this.records.length > this.cap) this.records.splice(0, this.records.length - this.cap);
    this.ticks = this.frames = this.gaps = this.longTasks = this.longMs = this.hiddenMs = 0;
    this.winStart = now;
    this.winEpoch = endEpoch;
    return rec;
  }
}

/** the recorder while 성능 기록 is on, else null (app.ts checks it every frame) */
export let perf: PerfRecorder | null = null;
/** the last recorder, kept after switching off so its records can still be exported */
let kept: PerfRecorder | null = null;
let source: (() => PerfContext) | null = null;
let observer: PerformanceObserver | null = null;
const onVisibility = () => perf?.hidden(document.hidden);

/** app.ts: how to describe the game at a window's end */
export function setPerfSource(describe: () => PerfContext): void { source = describe; }

/** start a new log (the previous records are dropped) */
export function startPerf(): void {
  if (perf || !source) return;
  perf = kept = new PerfRecorder(source);
  if (document.hidden) perf.hidden(true);
  addEventListener('visibilitychange', onVisibility);
  try {
    observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) perf?.longTask(e.duration); });
    observer.observe({ type: 'longtask', buffered: false });
  } catch { observer = null; /* no Long Tasks API: longTasks stays 0 */ }
}

/** stop recording; the records stay until the next start */
export function stopPerf(): void {
  if (!perf) return;
  perf = null;
  observer?.disconnect();
  observer = null;
  removeEventListener('visibilitychange', onVisibility);
}

export function perfRecordCount(): number { return kept?.records.length ?? 0; }

/** save the log as JSON through the platform's save dialog (closes the running window first); the file name, or
 *  null when there is nothing to export */
export async function exportPerf(): Promise<string | null> {
  if (!kept) return null;
  if (perf) perf.flush();
  const d = new Date(), p2 = (v: number) => String(v).padStart(2, '0');
  const name = `grantria-perf-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.json`;
  const doc = {
    format: 'grantria-perf/1', exportedAt: d.toISOString(), startedAt: kept.startedAt, recording: !!perf,
    platform: platform().name, mode: import.meta.env.MODE, userAgent: navigator.userAgent, windowMs: PERF_WINDOW_MS,
    records: kept.records,
  };
  await platform().files.save(name, JSON.stringify(doc, null, 1), 'application/json');
  return name;
}
