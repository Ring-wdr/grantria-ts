// Overlay stack: popups, lists and other modal layers of one scene, top-most last. Only the top overlay takes the
// tick's keys, a closed overlay hands its result role to the handlers it was opened with, and overlays waiting for
// a free moment (challenge rewards, the daily fortune, attendance) queue by priority instead of each polling its
// own "nothing else is open" flag. Patterns from RPG Maker's SceneManager / Window_Selectable handlers / Game_Message
// queue, Ionic's overlay roles and the HTML dialog closedby attribute.
import { AVK } from '../keys';

/** how an overlay was closed: affirmative (yes / ok), negative (no), or a close request (CLR) */
export type Role = 'yes' | 'no' | 'cancel';

export interface Overlay {
  /** this tick's keys (only the top overlay gets them); returning a role closes it */
  handle(presses: number[]): Role | null | void;
  /** an overlay made by the host draws itself */
  draw?(): void;
  /** an overlay made by the game logic carries what the host draws instead (a Popup, a list's state) */
  model?: unknown;
}

export interface Handlers {
  yes?(): void;
  no?(): void;
  cancel?(): void;
  /** after the role's handler, whatever the role */
  close?(role: Role): void;
}

export interface OpenOpts {
  on?: Handlers;
  /** 'self' (default): the overlay reads CLR itself; 'cancel': CLR closes it with role 'cancel' before it sees the keys */
  closedby?: 'self' | 'cancel';
  /** tag read back by kindOpen() (e.g. 'popup' for events that wait on a dismissed popup) */
  kind?: string;
}

interface Entry extends OpenOpts { o: Overlay }

interface Waiting { prio: number; seq: number; open: () => void }

export class OverlayStack {
  private stack: Entry[] = [];
  private queue: Waiting[] = [];
  private seq = 0;

  get size(): number { return this.stack.length; }
  get top(): Overlay | null { return this.stack[this.stack.length - 1]?.o ?? null; }
  /** is an overlay of this kind open anywhere in the stack */
  kindOpen(kind: string): boolean { return this.stack.some((e) => e.kind === kind); }
  has(o: Overlay): boolean { return this.stack.some((e) => e.o === o); }

  /** push an overlay on top; it takes keys from the next update */
  open<T extends Overlay>(o: T, opts: OpenOpts = {}): T {
    this.stack.push({ ...opts, o });
    return o;
  }

  /** close an overlay (and everything opened above it), then run its handlers for role */
  close(o: Overlay, role: Role): void {
    const i = this.stack.findIndex((e) => e.o === o);
    if (i < 0) return;
    const e = this.stack[i];
    this.stack.length = i;
    e.on?.[role]?.();
    e.on?.close?.(role);
  }

  /** drop every overlay and queued opener without running handlers (scene change, reload) */
  clear(): void { this.stack.length = 0; this.queue.length = 0; }

  /**
   * Queue an overlay for the next free moment: drain() runs the highest priority opener (first queued among equal
   * ones) once the stack is empty. The opener may decide to open nothing (its reward went elsewhere).
   */
  enqueue(open: () => void, prio = 0): void {
    this.queue.push({ prio, seq: this.seq++, open });
  }

  get queued(): number { return this.queue.length; }

  /** open the best queued overlay when nothing is open; true when one was taken off the queue */
  drain(): boolean {
    if (this.stack.length || !this.queue.length) return false;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const q = this.queue[i], b = this.queue[best];
      if (q.prio > b.prio || (q.prio === b.prio && q.seq < b.seq)) best = i;
    }
    const [w] = this.queue.splice(best, 1);
    w.open();
    return true;
  }

  /** feed the tick's keys to the top overlay; true while an overlay is open (the scene skips its own keys) */
  update(presses: number[]): boolean {
    const e = this.stack[this.stack.length - 1];
    if (!e) return false;
    if (e.closedby === 'cancel' && presses.includes(AVK.CLR)) { this.close(e.o, 'cancel'); return true; }
    const r = e.o.handle(presses);
    if (r) this.close(e.o, r);
    return true;
  }

  /** draw bottom to top: an overlay's own draw, else paint (the host's drawing of the overlay's model) */
  draw(paint: (o: Overlay) => void): void {
    for (const e of [...this.stack]) {
      if (e.o.draw) e.o.draw();
      else paint(e.o);
    }
  }
}

/** the yes / no / ok answers of Popup.handle as roles: ok is affirmative */
export function popupRole(r: 'yes' | 'no' | 'ok' | null): Role | null {
  return r === 'ok' ? 'yes' : r;
}
