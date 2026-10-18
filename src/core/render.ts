// What the game asks a renderer to draw, independent of how (three.js + DOM in src/web, or anything else).
import type { Cmf } from './data/assets';

/** logical screen of the original (480×320 RGB565 framebuffer) */
export const VIEW_W = 480;
export const VIEW_H = 320;

/** equipment layers of a character frame (weapon, head, armour, pants) */
export type Equip = Record<'w' | 'h' | 'a' | 'p', number>;
export const DEFAULT_EQUIP: Equip = { w: 0, h: 0, a: 0, p: 0 };

/** FUN_000385e0: the look of equipment slots 0..3 (weapon, head, armour, pants) is the worn item's sub + 1, 0 when the
 *  slot is empty (eq/<kind><class>_<look>; weapon look 0 draws as look 1, the others as nothing) */
export function equipLook(equip: readonly ({ sub: number } | null | undefined)[] | undefined): Equip {
  const look = (slot: number) => { const it = equip?.[slot]; return it ? it.sub + 1 : 0; };
  return { w: look(0), h: look(1), a: look(2), p: look(3) };
}

/** scroll position of a scrolling list or text, owned by the game state: keys move y, the renderer clamps it to the
 *  content (and wheel / touch scrolling write it back) */
export interface ScrollRef {
  y: number;
  /** child index to bring into view when it changes (a key moved the cursor); touch scrolling stays free otherwise */
  follow?: number;
}

/** per-sprite tint / fade */
export interface SpriteFx {
  /** RGB tint mixed in by amount / 32 */
  tint?: [number, number, number];
  amount?: number;
  /** extra alpha 0..32 */
  alpha?: number;
}

/** Something drawn in the y-sorted mid layer. */
export interface Drawable {
  cmfName: string;
  /** absent for image drawables */
  cmf?: Cmf;
  frame: number;
  x: number;
  y: number;
  mirror?: boolean;
  equip?: Equip;
  /** depth key; defaults to y + body box dy of the frame */
  depth?: number;
  /** tint / fade */
  fx?: SpriteFx;
  /** parts skipped by clip number (PART_HIDE, FUN_00021fc8) */
  hideClips?: number[];
  /** whole-frame scale around the origin (+0x8c, FUN_00030cec) */
  scale?: number;
  /** actor shadow (FUN_00032800): shadow.pxl (120, 0) 36x20 multiplied at (x - 18, y - 10) just before the
   *  sprite, in its depth slot; unscaled, unmirrored, without the sprite's tint or fade */
  shadow?: boolean;
  /** draw a plain image rect at (x, y) instead of a cmf frame (ground items) */
  img?: { name: string; sx: number; sy: number; w: number; h: number; blend?: number };
}
