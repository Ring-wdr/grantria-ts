// 0.1.7 DOM UI layer (before aa5790d / 8aa3fa2): element keys counted per kind across the whole layer, an element
// not in its place inserted there (moving every later sibling), a texture copied into its canvas every frame.
// Kept since 0.1.7: a separator between the count and the id in the key (8aa3fa2, '1'+'2a' and '12'+'a' collided).
// The current one is ../render/domUi.ts.
import type * as THREE from 'three';
import { DomUi, px, type UiNode } from '../render/domUi';

export class LegacyDomUi extends DomUi {
  protected override node(kind: string, make: () => HTMLElement, id = ''): UiNode {
    const n = this.counts.get(kind) ?? 0;
    this.counts.set(kind, n + 1);
    const key = `${this.seg}:${kind}:${n}|${id}`;
    let node = this.nodes.get(key);
    if (!node) {
      node = { el: make(), key, sig: '', used: false };
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

  override texture(tex: THREE.Texture, w: number, h: number, x: number, y: number): void {
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
}
