// Input normalised to the original virtual keys (AVK, analysis/features/game-flow-ui.md §2.1):
// '2','8','4','6' = up/down/left/right, '5' = action, '1','3','7','9','*','#' = quick slots,
// -16 = CLR (back/menu), -10 = SAVE, -6 = map. Touch drives a virtual stick like FUN_00042ac8;
// a gamepad's left stick drives the same stick, its buttons map to keys (gamepad.ts).
import { gamepadSupported, padKind, padKeysOf, readPad, type PadButton, type PadKind } from './gamepad';

import { AVK } from '../../core/keys';
import type { InputDevice, InputState, Stick } from '../../core/input';
import { KEYMAP, RESERVED_KB } from './bindings';
import { platform } from '../../core/platform';
import { ctrlAt } from './touchLayout';
export { AVK };

/** Virtual stick state: angle in degrees (0 = right, 90 = down), speed level 0 or 5..8. */
export type { Stick };

export type { InputDevice };

/** gamepad left stick: radial dead zone, then 4 bands -> speed level 5..8 like the touch stick */
const PAD_DEAD = 0.3;
/** stick direction keys press at PAD_ON and release below PAD_OFF (no chatter at the edge) */
const PAD_ON = 0.5, PAD_OFF = 0.35;

export class Input implements InputState {
  /** held keys and the sources holding them (a key stays held while any source holds it) */
  private held = new Map<number, Set<string>>();
  private order: number[] = [];          // most recent held key last
  private presses: number[] = [];
  readonly stick: Stick = { active: false, angle: 0, level: 0, key: 0, dx: 0, dy: 0 };
  private stickId: number | null = null;
  /** touch zones -> virtual key for the current screen (touchdata.dat), checked before the stick;
   *  edge: the zone moves out by `edge` (see below) to the right (1) or the left (-1) */
  zones: { x: number; y: number; w: number; h: number; key: number; edge?: 1 | -1; mouseOnly?: true }[] = [];
  /** touch-first screens wider than 3:2: the controls move toward their side (the stick left, the right cluster right) by this many
   *  virtual pixels, into the side margins, so the thumbs stay at the screen edges (app.ts fit()) */
  edge = 0;
  /** fullscreen bleed: the canvas reaches `pad` virtual pixels past both sides of the 480-wide view (app.ts fit()) */
  pad = 0;
  /** touch confirm mode (PlayScene: dialogue, event or popup on the field): the OK zones stay live in UI mode
   *  and a tap beside the stick centre sends LEFT / RIGHT (yes / no), so the thumbs keep their places */
  confirm = false;
  confirmZones: { x: number; y: number; w: number; h: number; key: number; edge?: 1 | -1 }[] = [];
  /** UI mode (menus, popups, dialogue): pointer downs become taps instead of zones / stick */
  uiMode = false;
  /** field play with nothing open (PlayScene sets it every tick, a scene change clears it): the pad's d-pad
   *  presses the HUD buttons (PAD_FIELD). Not uiMode: the title / slot / class screens turn uiMode off for
   *  their touch zones but still need the d-pad as directions. */
  padField = false;
  private taps: { x: number; y: number }[] = [];
  private zoneKeys = new Map<number, number>();
  /** the device used last (on-screen hints follow it) */
  device: InputDevice = platform().touchFirst() ? 'touch' : 'keyboard';   // a phone starts as touch
  /** kind of the pad used last (PS / Xbox glyphs) */
  padKind: PadKind = 'generic';
  private padKeys = new Set<number>();
  /** keys of each held pad button, fixed when it was pressed (a d-pad press that opens a menu stays a HUD key) */
  private padHeld = new Map<PadButton, number[]>();
  private padStickKey = 0;
  private padStick = false;
  /** right stick vertical axis past its dead zone (-1 up .. 1 down), 0 when centred: scrolls the open text */
  padScrollY = 0;
  /** a gamepad was connected at the last poll (app.ts then polls every animation frame, not only on ticks) */
  padConnected = false;

  /** key settings (game/keyMap.ts): the next raw key or pad button goes here instead of the game */
  capture: ((c: { kb: string } | { pad: PadButton } | { cancel: true }) => void) | null = null;
  private canvas: HTMLCanvasElement;
  private surface: HTMLElement;
  private viewW: number;
  private viewH: number;
  constructor(canvas: HTMLCanvasElement, viewW: number, viewH: number) {
    this.canvas = canvas; this.viewW = viewW; this.viewH = viewH;
    addEventListener('keydown', (e) => {
      if (this.capture && !e.repeat) {
        e.preventDefault();
        const c = this.capture;
        this.capture = null;
        this.device = 'keyboard';
        c(RESERVED_KB.has(e.code) ? { cancel: true } : { kb: e.code });
        return;
      }
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
    // the whole frame listens, so touches in the side margins (edge layout) reach the zones and the stick;
    // taps on interactive DOM UI elements are theirs (DomUi), only the canvas and the empty frame count here
    const surface = canvas.closest<HTMLElement>('#frame') ?? canvas;
    const own = (e: PointerEvent) => e.target === canvas || e.target === surface || e.target === canvas.parentElement;
    surface.addEventListener('pointerdown', (e) => { if (own(e) || (this.confirm && this.confirmAt(this.toView(e)))) this.pointer(e, 'down'); });
    surface.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    surface.addEventListener('pointerup', (e) => this.pointer(e, 'up'));
    surface.addEventListener('pointercancel', (e) => this.pointer(e, 'up'));
    surface.style.touchAction = 'none';
    canvas.style.touchAction = 'none';
    this.surface = surface;
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
    this.padConnected = false;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.padConnected = true;
      const r = readPad(p);
      for (const b of r.buttons) now.add(b);
      if (r.buttons.size || Math.hypot(r.lx, r.ly) > PAD_DEAD) kind = padKind(p.id);
      if (Math.hypot(r.lx, r.ly) > Math.hypot(lx, ly)) { lx = r.lx; ly = r.ly; }
      if (Math.abs(r.ry) > PAD_DEAD) { kind ??= padKind(p.id); if (Math.abs(r.ry) > Math.abs(ry)) ry = r.ry; }
    }
    if (this.capture) {                                              // key settings: the first new button is taken
      const b = [...now].find((x) => !this.padHeld.has(x));
      if (b) {
        const c = this.capture;
        this.capture = null;
        this.padHeld.set(b, []);                                      // swallowed until released
        this.device = 'pad';
        c({ pad: b });
      }
    }
    for (const b of now) if (!this.padHeld.has(b)) this.padHeld.set(b, padKeysOf(b, this.padField));
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
    return { x: (e.clientX - r.left) * (this.viewW + 2 * this.pad) / r.width - this.pad, y: (e.clientY - r.top) * this.viewH / r.height };
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move' | 'up'): void {
    const p = this.toView(e);
    if (kind === 'down') this.device = e.pointerType === 'mouse' ? 'keyboard' : 'touch';
    if (kind === 'down' && this.confirm) {
      const c = this.confirmAt(p);
      if (c === 'ok') {
        this.zoneKeys.set(e.pointerId, AVK.OK);
        this.down(AVK.OK, `p${e.pointerId}`);
        this.surface.setPointerCapture(e.pointerId);
        return;
      }
      if (c) { this.presses.push(c === 'left' ? AVK.LEFT : AVK.RIGHT); return; }
    }
    if (kind === 'down' && this.uiMode) { this.taps.push(p); return; }
    if (kind === 'down') {
      const touch = e.pointerType !== 'mouse';
      const z = this.zones.find((r) => { if (r.mouseOnly && touch) return false; const x = r.x + (r.edge ?? 0) * this.edge; return p.x >= x && p.x < x + r.w && p.y >= r.y && p.y < r.y + r.h; });
      if (z) {
        this.zoneKeys.set(e.pointerId, z.key);
        this.down(z.key, `p${e.pointerId}`);
        this.surface.setPointerCapture(e.pointerId);
        return;
      }
      // stick area (FUN_00042ac8: x < 231; the margin counts too), the right half when 조작 배치 put the stick there
      const left = this.stickAt().x < 240;
      if ((left ? p.x < 231 : p.x >= 249) && this.stickId === null) {
        this.stickId = e.pointerId;
        this.padStick = false;
        this.surface.setPointerCapture(e.pointerId);
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
    const c = this.stickAt(), dx = p.x - c.x, dy = p.y - c.y;
    const dist = Math.hypot(dx, dy) / c.s;
    // dead zone 12px; distance bands 12/24/36/48 -> speed level 5..8 (FUN_00042ac8), in the stick's own size
    const level = dist <= 12 ? 0 : Math.min(8, 4 + Math.ceil((dist - 12) / 12));
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const key = level === 0 ? 0 : Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? AVK.LEFT : AVK.RIGHT) : (dy < 0 ? AVK.UP : AVK.DOWN);
    Object.assign(this.stick, { active: level > 0, angle, level, key, dx, dy });
  }

  /** confirm mode: 'ok' on an OK zone, 'left' / 'right' beside the stick centre (within 50 px), else null */
  private confirmAt(p: { x: number; y: number }): 'ok' | 'left' | 'right' | null {
    const z = this.confirmZones.find((r) => { const x = r.x + (r.edge ?? 0) * this.edge; return p.x >= x && p.x < x + r.w && p.y >= r.y && p.y < r.y + r.h; });
    if (z) return 'ok';
    const c = this.stickAt(), dx = p.x - c.x, dy = p.y - c.y;
    if (Math.hypot(dx, dy) > 50 * c.s || Math.abs(dx) < 8 * c.s) return null;
    return dx < 0 ? 'left' : 'right';
  }

  /** stick centre: (0x53, H-0x4a) in joystick mode 1 (FUN_0004b128, ui-screens.md §0.2), moved and sized by 조작 배치 */
  private stickAt(): { x: number; y: number; s: number } { return ctrlAt('stick', this.edge); }

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
    // TAB_L / TAB_R ride along with the pad's K7 / K9 and light no button: report the slot key
    for (let i = this.order.length - 1; i >= 0; i--) if (this.order[i] !== AVK.TAB_L && this.order[i] !== AVK.TAB_R) return this.order[i];
    return 0;
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
