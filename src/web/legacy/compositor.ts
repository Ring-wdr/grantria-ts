// 0.1.7 layer drawing (before 584c79c): the group's meshes in renderOrder, every quad whose blend reads the
// destination with a fresh snapshot of everything drawn before it. The current one batches quads and reuses
// snapshots (../render/compositor.ts).
import * as THREE from 'three';
import { Compositor } from '../render/compositor';
import { dstUniforms, type SpriteLayer } from '../render/sprites';
import { VIEW_H } from '../../core/render';
import type { WebAssets } from '../assets';
import { LegacySpriteLayer } from './sprites';

export class LegacyCompositor extends Compositor {
  override newLayer(assets: WebAssets): SpriteLayer {
    return new LegacySpriteLayer(assets);
  }

  private useSnapshot(w: number, h: number): void {
    if (!this.snapshot || this.snapshot.image.width !== w || this.snapshot.image.height !== h) {
      this.snapshot?.dispose();
      this.snapshot = new THREE.FramebufferTexture(w, h);
      this.snapshot.magFilter = this.snapshot.minFilter = THREE.NearestFilter;
    }
    dstUniforms.dstTex.value = this.snapshot;
    dstUniforms.size.value.set(w, h);
  }

  /**
   * Draw group's meshes (in renderOrder) through camera into target (default: the internal
   * target, the w x h view centred in it when it is wider: see pad). clear = false draws over the
   * existing content (UI passes). Returns the number of render passes.
   */
  override draw(layer: SpriteLayer, camera: THREE.Camera, w: number, h: number, target?: THREE.WebGLRenderTarget, clear: boolean | number = true): number {
    const group = (layer as LegacySpriteLayer).group;
    const r = this.renderer;
    if (!target) {
      if (this.rt.width !== this.width || this.rt.height !== VIEW_H) this.rt.setSize(this.width, VIEW_H);
      target = this.rt;
      target.viewport.set((target.width - w) >> 1, 0, w, h);
    }
    // the snapshot covers the whole target: dst-reading blends sample it at gl_FragCoord
    this.useSnapshot(target.width, target.height);
    const meshes = (group.children as THREE.Mesh[]).slice().sort((a, b) => a.renderOrder - b.renderOrder);
    const parent = group.parent;
    this.scene.add(group);
    r.setRenderTarget(target);
    if (clear !== false) {
      r.setClearColor(clear === true ? 0x000000 : clear, 1);
      r.clear();
    }
    const auto = r.autoClear;
    r.autoClear = false;
    let passes = 0;
    let start = 0;
    const drawRange = (a: number, b: number) => {
      if (a >= b) return;
      for (const m of group.children) m.visible = false;
      for (let i = a; i < b; i++) meshes[i].visible = true;
      r.render(this.scene, camera);
      passes++;
    };
    meshes.forEach((m, i) => {
      if (!(m.material as THREE.Material).userData.readsDst) return;
      drawRange(start, i);
      r.copyFramebufferToTexture(this.snapshot!);
      drawRange(i, i + 1);
      start = i + 1;
    });
    drawRange(start, meshes.length);
    for (const m of group.children) m.visible = true;
    r.autoClear = auto;
    if (parent) parent.add(group);
    else this.scene.remove(group);
    target.viewport.set(0, 0, target.width, target.height);
    r.setRenderTarget(null);
    return passes;
  }
}
