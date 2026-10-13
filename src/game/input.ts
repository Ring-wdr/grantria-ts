// Input normalised to the original virtual keys (AVK, analysis/features/game-flow-ui.md §2.1):
// '2','8','4','6' = up/down/left/right, '5' = action, '1','3','7','9','*','#' = quick slots,
// -16 = CLR (back/menu), -10 = SAVE, -6 = map. Touch drives a virtual stick like FUN_00042ac8;
// a gamepad's left stick drives the same stick, its buttons map to keys (gamepad.ts).
import { gamepadSupported, padKind, padKeysOf, readPad, type PadButton, type PadKind } from './gamepad';

import { AVK } from './keys';
export { AVK };

const KEYMAP: Record<string, number> = {
  ArrowUp: AVK.UP, ArrowDown: AVK.DOWN, ArrowLeft: AVK.LEFT, ArrowRight: AVK.RIGHT,
  KeyW: AVK.UP, KeyS: AVK.DOWN, KeyA: AVK.LEFT, KeyD: AVK.RIGHT,
  KeyZ: AVK.OK, Enter: AVK.OK, Space: AVK.OK,
  KeyX: AVK.POUND, KeyC: AVK.STAR,
  Digit1: AVK.K1, Digit2: AVK.K3, Digit3: AVK.K7, Digit4: AVK.K9, Digit0: AVK.K0,
  Escape: AVK.CLR, KeyM: AVK.MAP, KeyP: AVK.SAVE, KeyQ: AVK.TAB_L, KeyE: AVK.TAB_R,
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

export type InputDevice = 'keyboard' | 'touch' | 'pad';

/** gamepad left stick: radial dead zone, then 4 bands -> speed level 5..8 like the touch stick */
const PAD_DEAD = 0.3;
/** stick direction keys press at PAD_ON and release below PAD_OFF (no chatter at the edge) */
const PAD_ON = 0.5, PAD_OFF = 0.35;

export class Input {
  /** held keys and the sources holding them (a key stays held while any source holds it) */
  private held = new Map<number, Set<string>>();
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
  /** the device used last (on-screen hints follow it) */
  device: InputDevice = 'keyboard';
  /** kind of the pad used last (PS / Xbox glyphs) */
  padKind: PadKind = 'generic';
  private padKeys = new Set<number>();
  /** keys of each held pad button, fixed when it was pressed (a d-pad press that opens a menu stays a HUD key) */
  private padHeld = new Map<PadButton, number[]>();
  private padStickKey = 0;
  private padStick = false;
  /** right stick vertical axis past its dead zone (-1 up .. 1 down), 0 when centred: scrolls the open text */
  padScrollY = 0;

  constructor(private canvas: HTMLCanvasElement, private viewW: number, private viewH: number) {
    addEventListener('keydown', (e) => {
      const k = KEYMAP[e.code];
      if (k === undefined) return;
      e.preventDefault();
      this.device = 'keyboard';
      if (!e.repeat) this.down(k, 'key');
    });
    addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k !== undefined) this.up(k, 'key');
    });
    addEventListener('blur', () => { for (const k of [...this.held.keys()]) this.up(k, 'key'); });
    canvas.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    canvas.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    canvas.addEventListener('pointerup', (e) => this.pointer(e, 'up'));
    canvas.addEventListener('pointercancel', (e) => this.pointer(e, 'up'));
    canvas.style.touchAction = 'none';
  }

  private down(k: number, src: string): void {
    let by = this.held.get(k);
    if (!by) { by = new Set(); this.held.set(k, by); this.order.push(k); }
    by.add(src);
    this.presses.push(k);
  }

  private up(k: number, src: string): void {
    const by = this.held.get(k);
    if (!by) return;
    by.delete(src);
    if (by.size) return;
    this.held.delete(k);
    this.order = this.order.filter((x) => x !== k);
  }

  /**
   * Read the gamepads (call once per animation frame so short presses are not missed): mapped
   * buttons press / release keys, the left stick drives the virtual stick unless a finger does.
   */
  pollPads(): void {
    if (!gamepadSupported()) return;
    let pads: (Gamepad | null)[];
    try { pads = navigator.getGamepads(); } catch { return; }      // blocked by a permissions policy
    const keys = new Set<number>(), now = new Set<PadButton>();
    let lx = 0, ly = 0, ry = 0, kind: PadKind | null = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const r = readPad(p);
      for (const b of r.buttons) now.add(b);
      if (r.buttons.size || Math.hypot(r.lx, r.ly) > PAD_DEAD) kind = padKind(p.id);
      if (Math.hypot(r.lx, r.ly) > Math.hypot(lx, ly)) { lx = r.lx; ly = r.ly; }
      if (Math.abs(r.ry) > PAD_DEAD) { kind ??= padKind(p.id); if (Math.abs(r.ry) > Math.abs(ry)) ry = r.ry; }
    }
    for (const b of now) if (!this.padHeld.has(b)) this.padHeld.set(b, padKeysOf(b, !this.uiMode));
    for (const b of [...this.padHeld.keys()]) if (!now.has(b)) this.padHeld.delete(b);
    for (const ks of this.padHeld.values()) for (const k of ks) keys.add(k);
    this.padScrollY = ry ? Math.sign(ry) * (Math.abs(ry) - PAD_DEAD) / (1 - PAD_DEAD) : 0;
    const mag = Math.hypot(lx, ly);
    // stick direction key with hysteresis on the dominant axis
    const dom = Math.abs(lx) >= Math.abs(ly) ? (lx < 0 ? AVK.LEFT : AVK.RIGHT) : (ly < 0 ? AVK.UP : AVK.DOWN);
    if (mag >= PAD_ON || (this.padStickKey && mag >= PAD_OFF)) this.padStickKey = mag >= PAD_ON ? dom : this.padStickKey;
    else this.padStickKey = 0;
    if (this.padStickKey) keys.add(this.padStickKey);
    for (const k of keys) if (!this.padKeys.has(k)) this.down(k, 'pad');
    for (const k of this.padKeys) if (!keys.has(k)) this.up(k, 'pad');
    this.padKeys = keys;
    if (kind) { this.device = 'pad'; this.padKind = kind; }
    if (this.stickId !== null) return;                                // a finger owns the stick
    if (mag > PAD_DEAD) {
      const level = Math.min(8, 5 + Math.floor(((Math.min(1, mag) - PAD_DEAD) / (1 - PAD_DEAD)) * 4));
      const angle = (Math.atan2(ly, lx) * 180 / Math.PI + 360) % 360;
      Object.assign(this.stick, { active: true, angle, level, key: dom, dx: lx * 36, dy: ly * 36 });
      this.padStick = true;
    } else if (this.padStick) {
      Object.assign(this.stick, { active: false, level: 0, key: 0, dx: 0, dy: 0 });
      this.padStick = false;
    }
  }

  /** Convert a pointer event to virtual-screen pixels. */
  private toView(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.viewW / r.width, y: (e.clientY - r.top) * this.viewH / r.height };
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move' | 'up'): void {
    const p = this.toView(e);
    if (kind === 'down') this.device = e.pointerType === 'mouse' ? 'keyboard' : 'touch';
    if (kind === 'down' && this.uiMode) { this.taps.push(p); return; }
    if (kind === 'down') {
      const z = this.zones.find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
      if (z) {
        this.zoneKeys.set(e.pointerId, z.key);
        this.down(z.key, `p${e.pointerId}`);
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (p.x < 231 && this.stickId === null) {                 // stick area (FUN_00042ac8: x < 231)
        this.stickId = e.pointerId;
        this.padStick = false;
        this.canvas.setPointerCapture(e.pointerId);
      } else return;
    }
    const zk = this.zoneKeys.get(e.pointerId);
    if (zk !== undefined) {
      if (kind === 'up') { this.zoneKeys.delete(e.pointerId); this.up(zk, `p${e.pointerId}`); }
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

  /** Keys produced by clicking an HTML view element: pressed this tick, not held. */
  inject(keys: number[], pointerType: string): void {
    this.device = pointerType === 'mouse' ? 'keyboard' : 'touch';
    this.presses.push(...keys);
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
