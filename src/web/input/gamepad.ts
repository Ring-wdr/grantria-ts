// Gamepads (PS / Xbox / generic) through the Web Gamepad API, normalised to the original virtual
// keys. Browsers that report the W3C "standard" mapping are read directly; for the raw HID layouts
// some engines report instead (Firefox, older WebKit / WebKitGTK for DualShock 4, DualSense and
// xpad), a vendor/product table gives the button indices and the d-pad hat axis.
import { AVK, HUD } from '../../core/keys';

/** logical buttons, named after the standard mapping positions */
export type PadButton =
  | 'south' | 'east' | 'west' | 'north' | 'l1' | 'r1' | 'l2' | 'r2'
  | 'select' | 'start' | 'l3' | 'r3' | 'up' | 'down' | 'left' | 'right' | 'home' | 'touchpad';

export type PadKind = 'ps' | 'xbox' | 'generic';

const STANDARD: PadButton[] = ['south', 'east', 'west', 'north', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3',
  'up', 'down', 'left', 'right', 'home', 'touchpad'];

interface RawLayout {
  buttons: (PadButton | null)[];
  /** left stick axes */
  lx: number;
  ly: number;
  /** right stick vertical axis */
  ry: number;
  /** d-pad as one hat axis (-1 = up, clockwise in steps of 2/7, > 1 = centred) */
  hat?: number;
  /** d-pad as two axes */
  dpad?: [number, number];
}

/** DualShock 4 / DualSense raw HID order (Firefox, WebKit without GameController mapping) */
const SONY_RAW: RawLayout = {
  buttons: ['west', 'south', 'east', 'north', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3', 'home', 'touchpad'],
  lx: 0, ly: 1, ry: 5, hat: 9,
};
/** Linux xpad (Xbox 360 / One) raw order */
const XPAD_RAW: RawLayout = {
  buttons: ['south', 'east', 'west', 'north', 'l1', 'r1', 'select', 'start', 'home', 'l3', 'r3'],
  lx: 0, ly: 1, ry: 4, dpad: [6, 7],
};

/** vendor:product -> raw layout for pads that arrive without the standard mapping */
const RAW_LAYOUTS: Record<string, RawLayout> = {
  '054c:05c4': SONY_RAW, '054c:09cc': SONY_RAW, '054c:0ba0': SONY_RAW,   // DualShock 4 v1 / v2 / USB dongle
  '054c:0ce6': SONY_RAW, '054c:0df2': SONY_RAW,                          // DualSense / DualSense Edge
  '045e:028e': XPAD_RAW, '045e:02d1': XPAD_RAW, '045e:02dd': XPAD_RAW,   // Xbox 360 / One / One (2015)
  '045e:02ea': XPAD_RAW, '045e:0b12': XPAD_RAW, '045e:0b13': XPAD_RAW,   // One S / Series X|S (USB / BT)
};

/** Pad button -> virtual key. South confirms, east cancels (user choice, PS5 / Xbox convention). */
export const PAD_KEYS: Partial<Record<PadButton, number>> = {
  south: AVK.OK, east: AVK.CLR, west: AVK.K1, north: AVK.K3, l1: AVK.K7, r1: AVK.K9, l2: AVK.STAR, r2: AVK.POUND,
  select: AVK.MAP, touchpad: AVK.MAP, start: AVK.CLR, r3: AVK.SAVE,
  up: AVK.UP, down: AVK.DOWN, left: AVK.LEFT, right: AVK.RIGHT,
};

/** keys a button sends besides PAD_KEYS: L1 / R1 also page the menu tabs (the menu drops their quick-slot keys) */
export const PAD_EXTRA: Partial<Record<PadButton, number>> = { l1: AVK.TAB_L, r1: AVK.TAB_R };

/** on the field (no menu, popup or dialogue) the d-pad presses the HUD buttons instead of walking (the left
 *  stick walks): up QUEST, left SHOP, right coupon shop, down the gate icon (community) */
export const PAD_FIELD: Partial<Record<PadButton, number>> = { up: HUD.QUEST, left: HUD.SHOP, right: HUD.COUPON, down: HUD.COMMUNITY };

/** keys a button sends when pressed, on the field or in the UI */
export function padKeysOf(b: PadButton, field: boolean): number[] {
  const f = field ? PAD_FIELD[b] : undefined;
  return f !== undefined ? [f] : [PAD_KEYS[b], PAD_EXTRA[b]].filter((k): k is number => k !== undefined);
}

/** the pad button bound to a virtual key (for on-screen glyphs) */
export function padButtonFor(key: number): PadButton | null {
  for (const b of ['south', 'east', 'west', 'north', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'r3'] as PadButton[]) {
    if (PAD_KEYS[b] === key || PAD_EXTRA[b] === key) return b;
  }
  for (const b of ['up', 'left', 'right', 'down'] as PadButton[]) if (PAD_FIELD[b] === key) return b;
  return null;
}

const GLYPHS: Record<PadKind, Partial<Record<PadButton, string>>> = {
  ps: { south: '✕', east: '○', west: '□', north: '△', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', select: 'CREATE', start: 'OPTIONS', r3: 'R3' },
  xbox: { south: 'A', east: 'B', west: 'X', north: 'Y', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', select: 'VIEW', start: 'MENU', r3: 'RS' },
  generic: { south: 'A', east: 'B', west: 'X', north: 'Y', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', select: 'SELECT', start: 'START', r3: 'R3' },
};
const DPAD: Partial<Record<PadButton, string>> = { up: '▲', down: '▼', left: '◀', right: '▶' };

export function padGlyph(kind: PadKind, b: PadButton): string {
  return GLYPHS[kind][b] ?? DPAD[b] ?? b;
}

/** "Vendor: 054c Product: 0ce6" (Chromium) or "54c-ce6-..." (Firefox / WebKit) -> "054c:0ce6" */
export function vendorProduct(id: string): string | null {
  const m = /Vendor:\s*([0-9a-f]{1,4})\s+Product:\s*([0-9a-f]{1,4})/i.exec(id) ?? /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  return m ? `${m[1].padStart(4, '0')}:${m[2].padStart(4, '0')}`.toLowerCase() : null;
}

export function padKind(id: string): PadKind {
  const vp = vendorProduct(id);
  if (vp?.startsWith('054c:')) return 'ps';
  if (vp?.startsWith('045e:') || /xbox|xinput|x-box/i.test(id)) return 'xbox';
  // "Wireless Controller" is how Sony pads name themselves (checked after "Xbox Wireless Controller")
  if (/playstation|dualshock|dualsense|wireless controller/i.test(id)) return 'ps';
  return 'generic';
}

/** Pressed logical buttons, the left stick and the right stick's vertical axis of one pad. */
export function readPad(p: Gamepad): { buttons: Set<PadButton>; lx: number; ly: number; ry: number } {
  const out = new Set<PadButton>();
  const pressed = (i: number) => { const b = p.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
  if (p.mapping === 'standard') {
    STANDARD.forEach((name, i) => { if (pressed(i)) out.add(name); });
    return { buttons: out, lx: p.axes[0] ?? 0, ly: p.axes[1] ?? 0, ry: p.axes[3] ?? 0 };
  }
  const vp = vendorProduct(p.id);
  const lay = (vp && RAW_LAYOUTS[vp]) || (padKind(p.id) === 'ps' ? SONY_RAW : null);
  if (!lay) {
    // unknown layout: assume the standard order for the face / shoulder buttons and axes 0 / 1
    STANDARD.forEach((name, i) => { if (pressed(i)) out.add(name); });
    return { buttons: out, lx: p.axes[0] ?? 0, ly: p.axes[1] ?? 0, ry: p.axes[3] ?? 0 };
  }
  lay.buttons.forEach((name, i) => { if (name && pressed(i)) out.add(name); });
  if (lay.hat !== undefined) {
    const v = p.axes[lay.hat];
    if (v !== undefined && v >= -1.05 && v <= 1.05) {
      const dir = Math.round(((v + 1) * 7) / 2) & 7;               // 0 up, 1 up-right, ... 7 up-left
      if (dir === 7 || dir <= 1) out.add('up');
      if (dir >= 1 && dir <= 3) out.add('right');
      if (dir >= 3 && dir <= 5) out.add('down');
      if (dir >= 5 && dir <= 7) out.add('left');
    }
  }
  if (lay.dpad) {
    const dx = p.axes[lay.dpad[0]] ?? 0, dy = p.axes[lay.dpad[1]] ?? 0;
    if (dx < -0.5) out.add('left'); else if (dx > 0.5) out.add('right');
    if (dy < -0.5) out.add('up'); else if (dy > 0.5) out.add('down');
  }
  return { buttons: out, lx: p.axes[lay.lx] ?? 0, ly: p.axes[lay.ly] ?? 0, ry: p.axes[lay.ry] ?? 0 };
}

/** whether this browser exposes gamepads at all (WebKitGTK without libmanette does not) */
export function gamepadSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
}
