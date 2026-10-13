// Declarative HTML views for menu and popup contents: describe a tree with h() each frame and
// DomUi.view() patches it into the layer (same element per position, so CSS transitions and
// animations survive). Layout is real CSS (flex, wrapping); clicks run the node's `on` handler,
// whose returned keys are fed to the game exactly like a key press or a tap on a hit area.
import type { Cmf } from '../../core/data/assets';
import type { WebAssets } from '../assets';
import { padButtonFor, padGlyph, type PadKind } from '../input/gamepad';

export type KeyAct = () => number[] | void;

/** scroll position of a scrolling element, owned by the game state: keys move y, the browser clamps it
 *  (and wheel / touch scrolling write it back) */
export interface ScrollRef { y: number }

export interface VNode {
  /** named mount point: views mounted with Ui.mount(slot, ...) become its children */
  slot?: string;
  scroll?: ScrollRef;
  tag: string;
  cls: string;
  style: string;
  on?: KeyAct;
  kids: VChild[];
  /** game text with '|x' colour codes and '|@' line breaks */
  text?: { s: string; pen?: number };
  /** sprite from an original sheet */
  sprite?: { img: string; sx: number; sy: number; w: number; h: number; flip?: boolean; scale?: number };
}

export type VChild = VNode | string | number | null | undefined | false | VChild[];

export interface VProps {
  slot?: string;
  scroll?: ScrollRef;
  cls?: string | false | null;
  style?: string;
  on?: KeyAct;
}

/** h('div.a.b', { on, style }, ...children): element with classes from the selector */
export function h(sel: string, props?: VProps | null, ...kids: VChild[]): VNode {
  const [tag, ...classes] = sel.split('.');
  if (props?.cls) classes.push(props.cls);
  return { tag: tag || 'div', cls: classes.join(' '), style: props?.style ?? '', on: props?.on, kids, slot: props?.slot, scroll: props?.scroll };
}

/** the pad button glyph of a key (u-pad badge) while a pad is the last used device, else nothing */
export function padBadge(input: { device: string; padKind: PadKind }, key: number, cls = ''): VNode | null {
  const b = input.device === 'pad' ? padButtonFor(key) : null;
  if (!b) return null;
  const g = padGlyph(input.padKind, b);
  return h(`span.u-pad.${input.padKind}.b-${b}${g.length > 2 ? '.wide' : ''}`, { cls }, g);
}

/** game text (colour codes, '|@' breaks) in a span; pen is the default RGB565 colour */
export function gt(s: string, opts: { pen?: number; cls?: string } = {}): VNode {
  return { tag: 'span', cls: `v-text${opts.cls ? ` ${opts.cls}` : ''}`, style: '', kids: [], text: { s, pen: opts.pen } };
}

/** an original sprite (icons stay the game's art) */
export function sprite(img: string, sx: number, sy: number, w: number, hgt: number, opts: { cls?: string; flip?: boolean; scale?: number; style?: string } = {}): VNode {
  return { tag: 'i', cls: `v-sprite${opts.cls ? ` ${opts.cls}` : ''}`, style: opts.style ?? '', kids: [], sprite: { img, sx, sy, w, h: hgt, flip: opts.flip, scale: opts.scale } };
}

/** c.pxl sprite frame f (d.dat 0x400de3 + f*4), negative = mirrored (Ui.cSprite) */
export function cSprite(a: WebAssets, f: number, cls?: string): VNode {
  const o = Math.abs(f) * 4;
  return sprite('c', a.dd(0x400de3, o), a.dd(0x400de3, o + 1), a.dd(0x400de3, o + 2), a.dd(0x400de3, o + 3), { cls, flip: f < 0 });
}

/** a keycap button (ui.css .u-btn) with content; sel = highlighted (v1) with the pulsing glow */
export function button(content: VChild, opts: { sel?: boolean; on?: KeyAct; cls?: string; glow?: boolean; style?: string } = {}): VNode {
  const sel = !!opts.sel;
  return h(`div.u-btn.s3.v-btn.${sel ? 'v1' : 'v0'}`, { cls: [opts.cls, sel && opts.glow !== false ? 'v-sel' : ''].filter(Boolean).join(' '), on: opts.on, style: opts.style }, content);
}

/**
 * Origin of the menu window's 'tab' slot in pushCenter220 coordinates (window at (0, 24), 6 px
 * padding, ui.css .mf-window). Only content with absolute game geometry (the map) needs it.
 */
export const TAB_BODY = { x: 6, y: 30, w: 208, h: 182 } as const;

/** mount points inside a window: 'tab' for the body (a flex child), 'tab-over' for overlays covering the window */
export function slot(name: 'tab' | 'tab-over', cls = ''): VNode {
  return h(`div.v-slot.${name}${cls ? `.${cls}` : ''}`, { slot: name });
}

/** FUN_000fb054 window as a view element: the .u-window frame with its four c.pxl corners */
export function win(sel: string, props: VProps | null, ...kids: VChild[]): VNode {
  const corners = [0, 1, 2, 3].map((i) => sprite('c', 104, 37, 8, 8, { cls: `u-corner c${i}` }));
  return h(`div.u-window.v-win${sel}`, props, ...kids, corners);
}

/** CSS mix-blend-mode of the original blend modes used by sprite parts (domUi BLEND) */
const PART_BLEND: Record<number, string> = { 4: 'screen', 13: 'plus-lighter', 14: 'multiply' };

/**
 * One frame of a cmf (multi-part sprite) as positioned sprites around its origin (ox, oy) inside a
 * relatively positioned box: the same placement as SpriteLayer.part (rotation, flip, scale, alpha).
 */
export function cmfFrame(cmf: Cmf, fi: number, ox: number, oy: number, image: (clip: number) => string | null): VNode[] {
  return (cmf.frames[fi]?.parts ?? []).flatMap((p) => {
    const c = cmf.clips[p.clip], img = image(p.clip);
    if (!c || !img) return [];
    const [sx, sy, w, hh] = c, s = p.scale || 1, dw = ((p.rot & 1) ? hh : w) * s;
    const t: string[] = [];
    if (p.hflip) t.push(`translateX(${dw}px) scaleX(-1)`);
    if (p.rot === 1) t.push(`translateX(${hh * s}px) rotate(90deg)`);
    else if (p.rot === 2) t.push(`translate(${w * s}px,${hh * s}px) rotate(180deg)`);
    else if (p.rot === 3) t.push(`translateY(${w * s}px) rotate(270deg)`);
    const style = `position:absolute;left:${ox + p.dx}px;top:${oy + p.dy}px;transform-origin:0 0;`
      + `${t.length ? `transform:${t.join(' ')};` : ''}${PART_BLEND[p.blend] ? `mix-blend-mode:${PART_BLEND[p.blend]};` : ''}`
      + `${p.alpha8 < 8 ? `opacity:${p.alpha8 / 8};` : ''}`;
    return [sprite(img, sx, sy, w, hh, { scale: s, style })];
  });
}

/**
 * A menu tab's list of keycap rows over a help note (options 0x23, community 0x24, titles 0x31):
 * one shared layout so every list spaces its rows the same way (ui.css .v-menu-list).
 */
export function menuList(rows: VChild[], note?: VChild, head?: VChild): VNode {
  return h('div.v-col.v-fill.v-tab', null, head, h('div.v-col.v-grow.v-menu-list', null, rows), note !== undefined && h('div.v-box.v-note', null, note));
}
