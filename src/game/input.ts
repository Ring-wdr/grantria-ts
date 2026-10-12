// Input normalised to the original virtual keys (AVK, analysis/features/game-flow-ui.md §2.1):
// '2','8','4','6' = up/down/left/right, '5' = action, '1','3','7','9','*','#' = quick slots,
// -16 = CLR (back/menu), -10 = SAVE, -6 = map. Touch drives a virtual stick like FUN_00042ac8.

export const AVK = {
  UP: 0x32, DOWN: 0x38, LEFT: 0x34, RIGHT: 0x36, OK: 0x35,
  K1: 0x31, K3: 0x33, K7: 0x37, K9: 0x39, K0: 0x30, STAR: 0x2a, POUND: 0x23,
  CLR: -16, SAVE: -10, MAP: -6,
} as const;

const KEYMAP: Record<string, number> = {
  ArrowUp: AVK.UP, ArrowDown: AVK.DOWN, ArrowLeft: AVK.LEFT, ArrowRight: AVK.RIGHT,
  KeyW: AVK.UP, KeyS: AVK.DOWN, KeyA: AVK.LEFT, KeyD: AVK.RIGHT,
  KeyZ: AVK.OK, Enter: AVK.OK, Space: AVK.OK,
  KeyX: AVK.POUND, KeyC: AVK.STAR,
  Digit1: AVK.K1, Digit2: AVK.K3, Digit3: AVK.K7, Digit4: AVK.K9, Digit0: AVK.K0,
  Escape: AVK.CLR, KeyM: AVK.MAP, KeyP: AVK.SAVE,
};

/** Virtual stick state: angle in degrees (0 = right, 90 = down), speed level 0 or 5..8. */
export interface Stick {
  active: boolean;
  angle: number;
  level: number;
  /** dominant-axis direction key the original also generates, or 0 */
  key: number;
  /** raw offset from the stick centre in virtual pixels (drives the knob drawing) */
  dx: number;
  dy: number;
}

export class Input {
  private held = new Set<number>();
  private order: number[] = [];          // most recent held key last
  private presses: number[] = [];
  readonly stick: Stick = { active: false, angle: 0, level: 0, key: 0, dx: 0, dy: 0 };
  private stickId: number | null = null;
  /** stick centre: fixed (0x53, H-0x4a) in joystick mode 1 (FUN_0004b128, ui-screens.md §0.2) */
  private center = { x: 83, y: 246 };
  /** touch zones -> virtual key for the current screen (touchdata.dat), checked before the stick */
  zones: { x: number; y: number; w: number; h: number; key: number }[] = [];
  /** UI mode (menus, popups, dialogue): pointer downs become taps instead of zones / stick */
  uiMode = false;
  private taps: { x: number; y: number }[] = [];
  private zoneKeys = new Map<number, number>();

  constructor(private canvas: HTMLCanvasElement, private viewW: number, private viewH: number) {
    addEventListener('keydown', (e) => {
      const k = KEYMAP[e.code];
      if (k === undefined) return;
      e.preventDefault();
      if (!e.repeat) this.down(k);
    });
    addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k !== undefined) this.up(k);
    });
    addEventListener('blur', () => { for (const k of [...this.held]) this.up(k); });
    canvas.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    canvas.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    canvas.addEventListener('pointerup', (e) => this.pointer(e, 'up'));
    canvas.addEventListener('pointercancel', (e) => this.pointer(e, 'up'));
    canvas.style.touchAction = 'none';
  }

  private down(k: number): void {
    if (!this.held.has(k)) this.order.push(k);
    this.held.add(k);
    this.presses.push(k);
  }

  private up(k: number): void {
    this.held.delete(k);
    this.order = this.order.filter((x) => x !== k);
  }

  /** Convert a pointer event to virtual-screen pixels. */
  private toView(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.viewW / r.width, y: (e.clientY - r.top) * this.viewH / r.height };
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move' | 'up'): void {
    const p = this.toView(e);
    if (kind === 'down' && this.uiMode) { this.taps.push(p); return; }
    if (kind === 'down') {
      const z = this.zones.find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
      if (z) {
        this.zoneKeys.set(e.pointerId, z.key);
        this.down(z.key);
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (p.x < 231 && this.stickId === null) {                 // stick area (FUN_00042ac8: x < 231)
        this.stickId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
      } else return;
    }
    const zk = this.zoneKeys.get(e.pointerId);
    if (zk !== undefined) {
      if (kind === 'up') { this.zoneKeys.delete(e.pointerId); this.up(zk); }
      return;
    }
    if (e.pointerId !== this.stickId) return;
    if (kind === 'up') {
      this.stickId = null;
      Object.assign(this.stick, { active: false, level: 0, key: 0, dx: 0, dy: 0 });
      return;
    }
    const dx = p.x - this.center.x, dy = p.y - this.center.y;
    const dist = Math.hypot(dx, dy);
    // dead zone 12px; distance bands 12/24/36/48 -> speed level 5..8 (FUN_00042ac8)
    const level = dist <= 12 ? 0 : Math.min(8, 4 + Math.ceil((dist - 12) / 12));
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const key = level === 0 ? 0 : Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? AVK.LEFT : AVK.RIGHT) : (dy < 0 ? AVK.UP : AVK.DOWN);
    Object.assign(this.stick, { active: level > 0, angle, level, key, dx, dy });
  }

  /** Taps since the last tick in UI mode (consumed). */
  takeTaps(): { x: number; y: number }[] { const t = this.taps; this.taps = []; return t; }

  /** Keys pressed since the last tick (consumed). */
  takePresses(): number[] {
    const p = this.presses;
    this.presses = [];
    return p;
  }

  /** Most recently pressed key still held (for button highlighting, like DAT_003b3af8). */
  lastHeld(): number {
    if (this.stick.key) return this.stick.key;
    return this.order[this.order.length - 1] ?? 0;
  }

  isHeld(k: number): boolean {
    return this.held.has(k) || this.stick.key === k;
  }

  /** The direction key to act on this tick: stick first, then the most recently pressed held arrow. */
  direction(): number {
    if (this.stick.key) return this.stick.key;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const k = this.order[i];
      if (k === AVK.UP || k === AVK.DOWN || k === AVK.LEFT || k === AVK.RIGHT) return k;
    }
    return 0;
  }
}
