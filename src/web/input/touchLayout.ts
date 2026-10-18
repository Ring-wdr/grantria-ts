// 조작 배치 (편의 설정, not in the original): where the field's touch controls sit and how big they are, like the
// layout editors of phone console emulators. Each control keeps an offset from its original centre and a size;
// the HUD (fieldHud.ts), the touch zones (FIELD_ZONES) and the stick (input.ts) all read it from here.
// On a wide touch screen (Input.edge) every control still moves out toward the side its centre is on.
// The editor is game/touchLayoutEditor.ts.
import { loadJson, saveJson } from '../../core/platform';

const KEY = 'grantria.touchLayout';
export const VIEW_W = 480, VIEW_H = 320;

export type CtrlId = 'stick' | 'attack' | 'slot0' | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5' | 'menu' | 'log';
export const CTRL_IDS: CtrlId[] = ['stick', 'attack', 'slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'menu', 'log'];

/** original centres (FUN_0004b128 layout, stick mode 1) and the size of each control's drawing at scale 1 */
const H = VIEW_H, W = VIEW_W;
const SLOT_X = [0xc0, 0x83, 0xb8, 0x7b, 0x72, 0x31], SLOT_Y = [0x31, 0x31, 0x67, 0x66, 0x9c, 0x9b];
export const BASE: Record<CtrlId, { x: number; y: number; w: number; h: number }> = {
  stick: { x: 0x53, y: H - 0x4a + 1, w: 106, h: 106 },
  attack: { x: W - 0x4c + 31, y: H - 0x5a + 30, w: 58, h: 58 },
  ...Object.fromEntries(SLOT_X.map((sx, i) => [`slot${i}`, { x: W - sx + 20, y: H - SLOT_Y[i] + 20, w: 38, h: 38 }])) as Record<`slot${0 | 1 | 2 | 3 | 4 | 5}`, { x: number; y: number; w: number; h: number }>,
  menu: { x: W - 0x2e + 20, y: H - 0xe5 + 20, w: 38, h: 38 },
  log: { x: W - 0x50 + 0x26, y: H - 0x102 + 11, w: 0x4c, h: 22 },
};

export const SCALE_MIN = 0.6, SCALE_MAX = 1.8;
export const ALPHA_MIN = 0.2, ALPHA_MAX = 1;

/** dx, dy: offset of the centre from the original one at edge 0; s: size; side: the edge it moves out to on a wide
 *  screen (-1 left, 1 right; unset = the original control's side), so it keeps its distance from that edge */
export interface CtrlPos { dx: number; dy: number; s: number; side?: -1 | 1 }
export interface TouchLayout { ctrls: Record<CtrlId, CtrlPos>; alpha: number }

export function defaultLayout(): TouchLayout {
  return { ctrls: Object.fromEntries(CTRL_IDS.map((id) => [id, { dx: 0, dy: 0, s: 1 }])) as Record<CtrlId, CtrlPos>, alpha: 1 };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

let current: TouchLayout = load();
const listeners: (() => void)[] = [];

function load(): TouchLayout {
  const o = defaultLayout();
  const d = loadJson<Partial<TouchLayout>>(KEY);
  if (!d) return o;
  for (const id of CTRL_IDS) {
    const c = d.ctrls?.[id];
    if (!c) continue;
    o.ctrls[id] = { dx: num(c.dx, 0), dy: num(c.dy, 0), s: clamp(num(c.s, 1), SCALE_MIN, SCALE_MAX) };
    if (c.side === 1 || c.side === -1) o.ctrls[id].side = c.side;
  }
  o.alpha = clamp(num(d.alpha, 1), ALPHA_MIN, ALPHA_MAX);
  return o;
}

export function touchLayout(): TouchLayout { return current; }

/** a deep copy (the editor works on one and commits it with setTouchLayout) */
export function copyLayout(l: TouchLayout): TouchLayout {
  return { ctrls: Object.fromEntries(CTRL_IDS.map((id) => [id, { ...l.ctrls[id] }])) as Record<CtrlId, CtrlPos>, alpha: l.alpha };
}

export function setTouchLayout(l: TouchLayout): void {
  current = copyLayout(l);
  saveJson(KEY, current);
  for (const f of listeners) f();
}

export function onTouchLayoutChange(f: () => void): void { listeners.push(f); }

/** -1 = the control hugs the left edge on a wide screen, 1 = the right edge */
export function ctrlSide(id: CtrlId, l: TouchLayout = current): -1 | 1 {
  return l.ctrls[id].side ?? (BASE[id].x < W / 2 ? -1 : 1);
}

/** place a control's centre at (x, y) on a screen with this edge: kept on the screen, anchored to the nearer edge */
export function placeCtrl(l: TouchLayout, id: CtrlId, x: number, y: number, edge: number): void {
  const b = BASE[id], c = l.ctrls[id];
  x = clamp(Math.round(x), -edge + 10, W + edge - 10);
  y = clamp(Math.round(y), 10, H - 10);
  const side = x < W / 2 ? -1 : 1;
  c.dx = x - side * edge - b.x;
  c.dy = y - b.y;
  if (side === (b.x < W / 2 ? -1 : 1)) delete c.side; else c.side = side;
}

/** centre (with the wide-screen edge shift) and scale of a control */
export function ctrlAt(id: CtrlId, edge: number, l: TouchLayout = current): { x: number; y: number; s: number } {
  const b = BASE[id], c = l.ctrls[id];
  return { x: b.x + c.dx + ctrlSide(id, l) * edge, y: b.y + c.dy, s: c.s };
}

/** the touch zone keys each movable control owns in FIELD_ZONES (fieldHud.ts) */
export function zoneCtrl(key: number, keys: { OK: number; CLR: number; LOG: number; slots: number[] }, x: number): CtrlId | null {
  if (key === keys.OK) return 'attack';
  if (key === keys.LOG) return 'log';
  if (key === keys.CLR) return x > W / 2 ? 'menu' : null;        // the top-left CLR corner stays put
  const i = keys.slots.indexOf(key);
  return i >= 0 ? `slot${i}` as CtrlId : null;
}
