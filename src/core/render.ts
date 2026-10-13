// What the game asks a renderer to draw, independent of how (three.js + DOM in src/web, or anything else).
import type { Cmf } from './data/assets';

/** logical screen of the original (480×320 RGB565 framebuffer) */
export const VIEW_W = 480;
export const VIEW_H = 320;

/** equipment layers of a character frame (weapon, head, armour, pants) */
export type Equip = Record<'w' | 'h' | 'a' | 'p', number>;
export const DEFAULT_EQUIP: Equip = { w: 0, h: 0, a: 0, p: 0 };

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
