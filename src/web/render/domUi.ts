// HTML/CSS backend of the UI drawing API. Draw calls made during a frame are reconciled with
// the elements of the previous frame (same segment / kind / occurrence -> same element), so a
// static screen touches the DOM only where something changed and CSS animations keep running.
// Composite widgets (window, popup frame, glow, button, text) become single elements styled in
// ui.css; their pulses and moves are CSS animations / transitions, so they run at the display
// rate while the game itself stays on its 20 Hz tick.
import type * as THREE from 'three';
import type { WebAssets } from '../assets';
import type { Compositor } from './compositor';
import type { SpriteFx } from './sprites';
import { COLOR_CODES, rgb565, stringWidth, NO_OUTLINE, WHITE, type TextStyle } from './text';
import { Ui, type Align } from './ui';
import type { KeyAct, ScrollRef, VChild, VNode } from './view';
import { VIEW_H, VIEW_W } from './field';
import { platform } from '../../core/platform';

/** URL of an image under assets/images (resolved per call: the platform is installed at boot) */
const imageUrl = (name: string) => platform().assets.url(`images/${name}.png`);

/** original blend modes (sprites.ts blendSetup) -> CSS mix-blend-mode; 10 / 15 (linear light) approximated by hard-light;
 *  5 / 7 / 9 / 12 (reflect, heat, vivid light, glow) have no CSS mode and no UI image uses them */
const BLEND: Record<number, string> = {
  1: 'lighten', 2: 'darken', 3: 'difference', 4: 'screen', 6: 'overlay', 11: 'color-dodge',
  8: 'hard-light', 10: 'hard-light', 13: 'plus-lighter', 14: 'multiply', 15: 'hard-light',
};

const px = (v: number) => `${Math.round(v * 100) / 100}px`;
const css = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
const css565 = (c: number) => { const [r, g, b] = rgb565(c); return `rgb(${r},${g},${b})`; };

interface UiNode {
  el: HTMLElement;
  /** last applied style / content signature */
  sig: string;
  used: boolean;
  /** last rectangle (glows slide only between equal-size rects) */
  w?: number;
  h?: number;
}

/** Shared per-document state: generated image classes, button skins and the frame counter. */
class DomShared {
  private sheet: CSSStyleSheet;
  private imageClasses = new Map<string, string>();
  readonly images = new Map<string, HTMLImageElement>();
  layers: DomUi[] = [];

  constructor() {
    const style = document.createElement('style');
    style.id = 'ui-generated';
    document.head.append(style);
    this.sheet = style.sheet!;
  }

  imageClass(name: string): string {
    let c = this.imageClasses.get(name);
    if (!c) {
      c = `im-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      this.sheet.insertRule(`.${c}{background-image:url("${imageUrl(name)}")}`, this.sheet.cssRules.length);
      this.imageClasses.set(name, c);
    }
    return c;
  }

  addRule(rule: string): void {
    this.sheet.insertRule(rule, this.sheet.cssRules.length);
  }

  async loadImage(name: string): Promise<HTMLImageElement | null> {
    const have = this.images.get(name);
    if (have) return have;
    const img = new Image();
    img.src = `${imageUrl(name)}`;
    try { await img.decode(); } catch { return null; }
    this.images.set(name, img);
    return img;
  }
}

let shared: DomShared | null = null;

/** Start a frame on every DOM layer: hits and element cursors reset. */
export function beginDomFrame(): void {
  for (const l of shared?.layers ?? []) l.beginFrame();
}

/** Finish a frame: elements not drawn this frame are removed (frozen layers keep theirs). */
export function endDomFrame(): void {
  for (const l of shared?.layers ?? []) l.endFrame();
}

/** right-stick scroll speed at full tilt, view px per second */
const PAD_SCROLL_SPEED = 200;
let padScrollEl: HTMLElement | null = null, padScrollAcc = 0;

/**
 * Pad right stick (dy -1..1): scroll the open scrolling text (skill detail, help, monster book, item
 * description …), the last visible .v-scroll that overflows, i.e. the topmost overlay's. Its ScrollRef
 * follows at once so the next frame's patch does not snap it back.
 */
export function padScroll(dy: number, ms: number): void {
  if (!dy) { padScrollAcc = 0; return; }
  const els = [...document.querySelectorAll<HTMLElement & { _scroll?: ScrollRef }>('.ui-layer .v-scroll')]
    .filter((e) => e.scrollHeight > e.clientHeight + 1 && e.getClientRects().length > 0);
  const el = els[els.length - 1];
  if (!el) return;
  if (el !== padScrollEl) { padScrollEl = el; padScrollAcc = 0; }
  padScrollAcc += (dy * PAD_SCROLL_SPEED * ms) / 1000;
  const step = Math.trunc(padScrollAcc);
  if (!step) return;
  padScrollAcc -= step;
  el.scrollTop += step;
  if (el._scroll) el._scroll.y = el.scrollTop;
}

export class DomUi extends Ui {
  readonly root: HTMLDivElement;
  private nodes = new Map<string, UiNode>();
  private counts = new Map<string, number>();
  private seg = 0;
  private cursors = new Map<HTMLElement, number>();
  private parents: HTMLElement[] = [];
  private shared: DomShared;
  /** receives the keys returned by a clicked view element (wired to Input in main.ts) */
  onKeys: (keys: number[], pointerType: string) => void = () => {};
  /** slot elements of the views drawn this frame, and the views mounted into them */
  private slots = new Map<string, HTMLElement>();
  private mounts = new Map<string, { el: HTMLElement; used: boolean }>();
  /** hold(): keep the last drawn elements this frame if nothing is drawn (the HUD under a menu) */
  private held = false;
  private drew = false;
  /** fullscreen bleed of an unclipped layer (the HUD): a fill over the whole view also covers the side margins */
  bleed = 0;

  constructor(assets: WebAssets, private compositor: Compositor, parent: HTMLElement, name: string, zoom = 1) {
    super(assets, zoom);
    shared ??= new DomShared();
    this.shared = shared;
    shared.layers.push(this);
    this.root = document.createElement('div');
    this.root.className = `ui-layer ui-${name}`;
    if (zoom !== 1) this.root.style.transform = `scale(${zoom})`;
    parent.append(this.root);
    this.parents = [this.root];
  }

  async init(images: string[]): Promise<void> {
    await this.preload(['t', 'c', ...images]);
  }

  /** decode images ahead so they do not pop in on first use */
  async preload(names: Iterable<string | null>): Promise<void> {
    await Promise.all([...new Set(names)].filter((n): n is string => !!n && n in this.assets.images).map((n) => this.shared.loadImage(n)));
  }

  /**
   * For this frame, keep what was drawn last (when nothing new is drawn) and show it darkened and
   * blurred, untappable: the HUD under an open menu, like the frozen field backdrop (FUN_0005dc50).
   */
  hold(): void {
    this.held = true;
  }

  /**
   * A declarative view (view.ts) laid out by CSS inside the (x, y, w, h) box: patched in place
   * every frame. Elements with an `on` handler take pointer input; the rest lets taps through.
   */
  override view(id: string, x: number, y: number, w: number, h: number, root: VNode): void {
    const node = this.node('view', () => {
      const d = DomUi.div('ui-view')();
      // a click counts only when its press started in this view: a HUD shortcut acts on the press and opens a
      // screen under the finger, and the click of the same tap must not land on that screen's buttons
      let pressed = false;
      d.addEventListener('pointerdown', () => { pressed = true; });
      d.addEventListener('click', (e) => {
        if (!pressed) return;
        pressed = false;
        let el = e.target as HTMLElement | null;
        while (el && el !== d) {
          const act = (el as HTMLElement & { _on?: KeyAct })._on;
          el = el.parentElement;
          if (!act) continue;
          e.stopPropagation();
          this.onKeys(act() ?? [], (e as PointerEvent).pointerType || 'mouse');
          return;
        }
      });
      return d;
    }, `#${id}`);
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${w}px;height:${h}px;${this.opacity()}`);
    this.patch(node.el, [root]);
  }

  override mount(slotName: string, id: string, root: VNode): void {
    const target = this.slots.get(slotName);
    if (!target) return;
    let m = this.mounts.get(id);
    if (!m) { m = { el: DomUi.div('v-mount')(), used: true }; this.mounts.set(id, m); }
    m.used = true;
    this.drew = true;
    if (m.el.parentElement !== target) target.append(m.el);
    this.patch(m.el, [root]);
  }

  private patch(parent: HTMLElement, kids: VChild[]): void {
    const flat: (VNode | string)[] = [];
    const add = (k: VChild) => {
      if (k === null || k === undefined || k === false) return;
      if (Array.isArray(k)) k.forEach(add); else flat.push(typeof k === 'number' ? String(k) : k);
    };
    kids.forEach(add);
    flat.forEach((k, i) => {
      const cur = parent.childNodes[i] as (ChildNode & { _tag?: string }) | undefined;
      if (typeof k === 'string') {
        if (cur?.nodeType === 3) { if ((cur as Text).data !== k) (cur as Text).data = k; }
        else if (cur) parent.replaceChild(document.createTextNode(k), cur); else parent.append(k);
        return;
      }
      let el = cur as (HTMLElement & { _tag?: string; _style?: string; _on?: KeyAct }) | undefined;
      if (!el || el.nodeType !== 1 || el._tag !== DomUi.identity(k)) {
        const made = document.createElement(k.tag) as HTMLElement & { _tag?: string };
        made._tag = DomUi.identity(k);
        if (el) parent.replaceChild(made, el); else parent.append(made);
        el = made;
      }
      this.update(el, k);
    });
    while (parent.childNodes.length > flat.length) parent.lastChild!.remove();
  }

  /** element identity: a sprite, a text run or a slot never reuses an element of another kind */
  private static identity(k: VNode): string {
    return k.tag + (k.sprite ? ':s' : k.text ? ':t' : k.slot ? `:slot=${k.slot}` : '');
  }

  private update(el: HTMLElement & { _style?: string; _on?: KeyAct }, k: VNode): void {
    let cls = k.cls, style = k.style;
    if (k.on) cls += ' v-hit';
    if (k.sprite) {
      const sp = k.sprite, sc = sp.scale ?? 1, size = this.assets.images[sp.img] ?? [0, 0];
      cls += ` ${this.shared.imageClass(sp.img)}`;
      style = `width:${sp.w * sc}px;height:${sp.h * sc}px;background-position:${-sp.sx * sc}px ${-sp.sy * sc}px;`
        + `${sc !== 1 ? `background-size:${size[0] * sc}px ${size[1] * sc}px;` : ''}${sp.flip ? 'transform:scaleX(-1);' : ''}${style}`;
    }
    if (k.text) {
      const pen = k.text.pen ?? WHITE;
      style = `color:${css565(pen)};${style}`;
      const c = `${k.text.s}\u0000${pen}`;
      if (el.dataset.c !== c) { el.dataset.c = c; el.replaceChildren(...textRuns(k.text.s, pen)); }
    }
    if (el.className !== cls) el.className = cls;
    if (el._style !== style) { el._style = style; el.style.cssText = style; }
    el._on = k.on;
    if (k.slot) { el.dataset.slot = k.slot; this.slots.set(k.slot, el); return; }   // children come from mount()
    if (!k.text && !k.sprite) this.patch(el, k.kids);
    if (k.scroll) DomUi.syncScroll(el as HTMLElement & { _scroll?: ScrollRef }, k.scroll);
  }

  /** drive scrollTop from the game's ScrollRef; the browser clamps it, user scrolling writes it back */
  private static syncScroll(el: HTMLElement & { _scroll?: ScrollRef }, ref: ScrollRef): void {
    if (el._scroll !== ref) {
      el._scroll = ref;
      el.onscroll = () => { if (el._scroll) el._scroll.y = el.scrollTop; };
    }
    if (Math.abs(el.scrollTop - ref.y) >= 1) el.scrollTop = ref.y;
    ref.y = el.scrollTop;
  }

  /** CSS filter for the whole layer (game-over grey) */
  set grey(v: number) {
    const f = v > 0 ? `grayscale(${v})` : '';
    if (this.root.style.filter !== f) this.root.style.filter = f;
  }

  beginFrame(): void {
    this.held = this.drew = false;
    this.hits = [];
    this.slots.clear();
    for (const m of this.mounts.values()) m.used = false;
    this.seg = 0;
    this.counts.clear();
    this.cursors.clear();
    this.parents = [this.root];
    for (const n of this.nodes.values()) n.used = false;
  }

  endFrame(): void {
    if (this.root.classList.contains('frozen') !== this.held) this.root.classList.toggle('frozen', this.held);
    if (this.held) this.hits = [];
    if (this.held && !this.drew) return;
    for (const [k, m] of this.mounts) if (!m.used) { m.el.remove(); this.mounts.delete(k); }
    for (const [k, n] of this.nodes) {
      if (n.used) continue;
      n.el.remove();
      this.nodes.delete(k);
    }
  }

  override begin(): void {
    super.begin();
    this.seg++;
    this.counts.clear();
    this.parents = [this.root];
  }

  endClear(): void { this.compositor.clear(); }
  end(): void { /* the DOM is the output */ }

  /** Get (or create) the next element of a kind and put it at the current paint position. */
  private node(kind: string, make: () => HTMLElement, id = ''): UiNode {
    const n = this.counts.get(kind) ?? 0;
    this.counts.set(kind, n + 1);
    const key = `${this.seg}:${kind}:${n}${id}`;
    let node = this.nodes.get(key);
    if (!node) {
      node = { el: make(), sig: '', used: false };
      this.nodes.set(key, node);
    }
    node.used = true;
    this.drew = true;
    const parent = this.parents[this.parents.length - 1];
    const i = this.cursors.get(parent) ?? 0;
    if (parent.children[i] !== node.el) parent.insertBefore(node.el, parent.children[i] ?? null);
    this.cursors.set(parent, i + 1);
    return node;
  }

  private static div(cls: string): () => HTMLElement {
    return () => { const d = document.createElement('div'); d.className = cls; return d; };
  }

  /** apply a style string when it changed */
  private static set(node: UiNode, style: string): void {
    if (node.sig === style) return;
    node.sig = style;
    node.el.style.cssText = style;
  }

  private opacity(extra = 1): string {
    const o = (this.alpha / 32) * extra;
    return o >= 1 ? '' : `opacity:${Math.max(0, Math.round(o * 1000) / 1000)};`;
  }

  override group(cls: string, cx: number, cy: number, id = ''): void {
    const node = this.node('group', DomUi.div(`u-group ${cls}`), id);
    if (node.el.className !== `u-group ${cls}`) node.el.className = `u-group ${cls}`;
    DomUi.set(node, `transform-origin:${px(cx + this.ox)} ${px(cy + this.oy)};`);
    this.parents.push(node.el);
  }

  override groupEnd(): void {
    if (this.parents.length > 1) this.parents.pop();
  }

  override padHint(glyph: string, hintCls: string, x: number, y: number): void {
    const node = this.node('pad', DomUi.div('u-pad'));
    if (node.el.textContent !== glyph) node.el.textContent = glyph;
    const cls = `u-pad ${hintCls}`;
    if (node.el.className !== cls) node.el.className = cls;
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};${this.opacity()}`);
  }

  image(name: string, sx: number, sy: number, w: number, h: number, x: number, y: number, flags = 0, fx?: SpriteFx): void {
    if (w <= 0 || h <= 0) return;
    const size = this.assets.images[name];
    if (!size) return;
    const rot = (flags >> 2) & 3, hflip = flags & 1, scale = ((flags >> 4) & 15) + 1, blend = (flags >> 8) & 31;
    const alpha8 = 8 - ((flags >> 13) & 7);
    x += this.ox; y += this.oy;
    const dw = ((rot & 1) ? h : w) * scale;
    const cls = `u-img ${this.shared.imageClass(name)}`;
    const node = this.node('img', DomUi.div(cls));
    if (node.el.className !== cls) node.el.className = cls;
    // the element is the unrotated w x h source rect; rotate about the top-left, then shift into dw x dh
    const t: string[] = [];
    if (hflip) t.push(`translateX(${dw}px) scaleX(-1)`);
    if (rot === 1) t.push(`translateX(${h * scale}px) rotate(90deg)`);
    else if (rot === 2) t.push(`translate(${w * scale}px,${h * scale}px) rotate(180deg)`);
    else if (rot === 3) t.push(`translateY(${w * scale}px) rotate(270deg)`);
    let s = `left:${px(x)};top:${px(y)};width:${w * scale}px;height:${h * scale}px;`
      + `background-position:${-sx * scale}px ${-sy * scale}px;`;
    if (scale !== 1) s += `background-size:${size[0] * scale}px ${size[1] * scale}px;`;
    if (t.length) s += `transform:${t.join(' ')};`;
    if (BLEND[blend]) s += `mix-blend-mode:${BLEND[blend]};`;
    s += this.opacity((alpha8 / 8) * ((fx?.alpha ?? 32) / 32));
    if (fx?.amount && fx.tint) {
      // tint: the sprite's shape filled with the colour, over the sprite at amount/32
      s += `--tint:rgb(${fx.tint.join(',')});--tint-a:${fx.amount / 32};--mask:url("${imageUrl(name)}");`
        + `--mpos:${-sx * scale}px ${-sy * scale}px;--msize:${size[0] * scale}px ${size[1] * scale}px;`;
      if (!node.el.classList.contains('tinted')) node.el.classList.add('tinted');
    } else if (node.el.classList.contains('tinted')) node.el.classList.remove('tinted');
    DomUi.set(node, s);
  }

  texture(tex: THREE.Texture, w: number, h: number, x: number, y: number): void {
    const node = this.node('tex', () => { const c = document.createElement('canvas'); c.className = 'u-tex'; return c; });
    const c = node.el as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${w}px;height:${h}px;${this.opacity()}`);
    const src = tex.image as CanvasImageSource | undefined;
    if (src) {
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, w, h);
      g.drawImage(src, 0, 0, w, h, 0, 0, w, h);
    }
  }

  fill(x: number, y: number, w: number, h: number, rgb = 0): void {
    if (w <= 0 || h <= 0) return;
    if (this.bleed && x + this.ox <= 0 && y + this.oy <= 0 && x + this.ox + w >= VIEW_W && y + this.oy + h >= VIEW_H) { x -= this.bleed; w += 2 * this.bleed; }
    const node = this.node('fill', DomUi.div('u-fill'));
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${w}px;height:${h}px;background:${css(rgb)};${this.opacity()}`);
  }

  override roundFill(x: number, y: number, w: number, h: number, rgb: number, r: number): void {
    if (w <= 0 || h <= 0) return;
    const node = this.node('rfill', DomUi.div('u-rfill'));
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${w}px;height:${h}px;background:${css(rgb)};--r:${r}px;${this.opacity()}`);
  }

  override bevel(x: number, y: number, w: number, h: number, c1: number, fill: number, c2 = c1): void {
    if (w <= 0 || h <= 0) return;
    const node = this.node('bevel', DomUi.div('u-bevel'));
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${w}px;height:${h}px;`
      + `--fill:${css(fill)};--c1:${css(c1)};--c2:${css(c2)};${this.opacity()}`);
  }

  override window(x: number, y: number, w: number, h: number): void {
    const node = this.node('win', () => {
      const d = DomUi.div('u-window')();
      for (let i = 0; i < 4; i++) d.append(DomUi.div(`u-corner c${i} ${this.shared.imageClass('c')}`)());
      return d;
    });
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${w}px;height:${h}px;${this.opacity()}`);
  }

  override popupFrame(x: number, y: number, w: number, h: number): void {
    const node = this.node('pframe', () => {
      const d = DomUi.div('u-popup')();
      for (let i = 0; i < 4; i++) d.append(DomUi.div(`u-corner c${i} ${this.shared.imageClass('c')}`)());
      return d;
    });
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${w}px;height:${h}px;`);
  }

  /** selection glow: the pulse is a CSS animation phased to t, and moves between equal-size rects slide */
  private glowNode(kind: string, x: number, y: number, w: number, h: number, period: number, t: number, peak: number): void {
    const node = this.node(kind, () => {
      const d = DomUi.div(`u-glow ${kind}`)();
      d.style.animationDelay = `calc(var(--tick) * ${-(t % period)})`;
      return d;
    });
    const slide = node.w === w && node.h === h;
    node.w = w; node.h = h;
    const s = `transform:translate(${px(x + this.ox)},${px(y + this.oy)});width:${w}px;height:${h}px;`
      + `--max:${Math.round(peak * this.alpha / 32 * 1000) / 1000};animation-delay:${node.el.style.animationDelay};${slide ? '' : 'transition:none;'}`;
    DomUi.set(node, s);
  }

  override glow(x: number, y: number, w: number, h: number, t: number): void {
    if (w < 10 || h < 10) return;
    this.glowNode('sel', x, y, w, h, 32, t, 1);
  }

  override slotGlow(x: number, y: number, w: number, h: number, t: number): void {
    this.glowNode('slot', x, y, w, h, 24, t, 12 / 32);
  }

  /**
   * FUN_0004ad90 button as one CSS element (ui.css .u-btn): the original geometry (d.dat slice
   * heights), drawn as a keycap instead of the t.pxl 9-slice; icons drawn on top stay sprites.
   */
  override button(x: number, y: number, w: number, h: number, style: number, variant: number, textId?: number): void {
    const { row, edge } = this.buttonSlices(style, variant);
    const W = this.buttonWidth(style, w, textId);
    const rows = h >= 0x12 ? h - 0x11 : 0;
    const H = row[1] + rows + (style !== 0 ? edge[1] : 0);
    const cls = `u-btn s${style} v${variant}`;
    const node = this.node('btn', DomUi.div(cls));
    if (node.el.className !== cls) node.el.className = cls;
    DomUi.set(node, `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${W}px;height:${H}px;${this.opacity()}`);
    if (style !== 0 && style !== 3 && textId !== undefined) this.textId(textId, x + (W >> 1), y + 5, 'center');
  }

  /**
   * A styled element (touch controls): cls from ui.css, optional inner HTML (inline SVG) or text,
   * and CSS custom properties. Drawn at the current alpha only through the classes' own opacity.
   */
  el(cls: string, x: number, y: number, w: number, h: number, opts: { html?: string; text?: string; vars?: Record<string, string | number> } = {}): void {
    const node = this.node('el', DomUi.div(cls));
    if (node.el.className !== cls) node.el.className = cls;
    const content = opts.html ?? opts.text ?? '';
    if (node.el.dataset.c !== content) {
      node.el.dataset.c = content;
      if (opts.html !== undefined) node.el.innerHTML = opts.html; else node.el.textContent = content;
    }
    let st = `left:${px(x + this.ox)};top:${px(y + this.oy)};width:${w}px;height:${h}px;`;
    for (const [k, v] of Object.entries(opts.vars ?? {})) st += `${k}:${v};`;
    DomUi.set(node, st);
  }

  string(s: string, x: number, y: number, align: Align = 'left', style?: TextStyle): void {
    if (!s) return;
    const node = this.node('text', DomUi.div('u-text'));
    const pen = style?.pen ?? WHITE, outline = style?.outline ?? NO_OUTLINE;
    const content = `${s}\u0000${pen}\u0000${outline}`;
    if (node.el.dataset.c !== content) {
      node.el.dataset.c = content;
      node.el.replaceChildren(...textRuns(s, pen));
    }
    const shift = align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : '';
    // the original box starts 1 px left of the first glyph (stringWidth counts 2 px of padding)
    const ax = align === 'center' ? x : align === 'right' ? x - 1 : x + 1;
    DomUi.set(node, `left:${px(ax + this.ox)};top:${px(y + this.oy)};${shift ? `transform:${shift};` : ''}`
      + `color:${css565(pen)};${outline !== NO_OUTLINE ? `--ol:${css565(outline)};` : ''}`
      + `--w:${stringWidth(s) - 2}px;${this.opacity()}`);
    node.el.classList.toggle('outlined', outline !== NO_OUTLINE);
  }
}

/** Split a string with '|x' colour codes into spans ('|0' = 40 px gap, '|q' = blinking pen, '|s' = previous pen). */
function textRuns(s: string, pen0: number): Node[] {
  const out: Node[] = [];
  let pen = pen0, prev = pen0, blink = false, cur = '';
  const flush = () => {
    if (!cur) return;
    const sp = document.createElement('span');
    sp.textContent = cur;
    if (blink) sp.className = 'u-blink';
    else if (pen !== pen0) sp.style.color = css565(pen);
    out.push(sp);
    cur = '';
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '@') continue;
    if (ch !== '|') { cur += ch; continue; }
    const code = s[++i] ?? '';
    if (code === '@') { cur += '\n'; continue; }
    flush();
    if (code === '0') { const gap = document.createElement('span'); gap.className = 'u-gap'; out.push(gap); continue; }
    if (code === 'q') { blink = true; continue; }
    if (code === 's') { blink = false; pen = prev; continue; }
    const c = COLOR_CODES[code];
    if (c !== undefined) { prev = pen; pen = c; blink = false; }
  }
  flush();
  return out;
}

/** '|q' blink colours (tables.blinkColors, k = |10 - frame % 20|) as a 20-tick CSS animation. */
export function installBlink(colors: [number, number][]): void {
  shared ??= new DomShared();
  const stops = Array.from({ length: 21 }, (_, f) => {
    const [b1, b2] = colors[Math.abs(10 - (f % 20))] ?? [255, 255];
    return `${f * 5}%{color:rgb(${b1 & 0xf8},${b2 & 0xfc},${b1 & 0xf8})}`;
  });
  shared.addRule(`@keyframes u-blink{${stops.join('')}}`);
}
