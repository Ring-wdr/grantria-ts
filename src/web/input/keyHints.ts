// On-screen key hints for the device in use: the pad's button glyph (PS / Xbox / generic), the keyboard key
// bound to the same virtual key, or nothing on touch. The game asks for AVK keys (core/keys.ts); which physical
// key or button produces one is the host's binding (input.ts KEYMAP, gamepad.ts PAD_KEYS), so the labels come
// from those tables and cannot drift from the real bindings.
import { AVK } from '../../core/keys';
import { padButtonFor, padGlyph, type PadKind } from './gamepad';
import { KEY_LABELS, type InputDevice } from './input';

export interface KeyHint {
  glyph: string;
  /** classes after u-pad: pad kind and button (colours), or 'kb' for a keycap */
  cls: string;
}

export function keyHint(input: { device: InputDevice | string; padKind: PadKind }, key: number): KeyHint | null {
  if (input.device === 'pad') {
    const b = padButtonFor(key);
    if (!b) return null;
    const g = padGlyph(input.padKind, b);
    return { glyph: g, cls: `${input.padKind} b-${b}${g.length > 2 ? ' wide' : ''}` };
  }
  if (input.device === 'keyboard') {
    const g = KEY_LABELS[key];
    return g ? { glyph: g, cls: `kb${g.length > 2 ? ' wide' : ''}` } : null;
  }
  return null;
}

/** previous / next tab (pad L1 / R1, keyboard Q / E) */
export function tabHint(input: { device: InputDevice | string; padKind: PadKind }, side: 'l1' | 'r1'): KeyHint | null {
  if (input.device === 'pad') return { glyph: padGlyph(input.padKind, side), cls: `${input.padKind} b-${side} wide` };
  return keyHint(input, side === 'l1' ? AVK.TAB_L : AVK.TAB_R);
}
