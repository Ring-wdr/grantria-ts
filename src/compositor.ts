// Renders a SpriteLayer in painter's order into an off-screen target. Quads whose blend mode
// needs the destination color get a fresh snapshot of everything drawn before them.
import * as THREE from 'three';
import { dstUniforms } from './sprites';

export function createTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false });
  rt.texture.generateMipmaps = false;
  return rt;
}

export class Compositor {
  private rt = createTarget(1, 1);
  private snapshot: THREE.FramebufferTexture | null = null;
  private present = new THREE.Scene();
  private presentCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private presentMat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  /** menu backdrop (FUN_0005dc50): the screen darkened and blurred once, reused while the menu is open */
  private backdrop = createTarget(1, 1);
  private blurMat = new THREE.ShaderMaterial({
    uniforms: { src: { value: null }, size: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // ScreenEffect(12,0) then FUN_000f8b00(0,2) on RGB565: rows 1..H-2, columns 2..W-1 average 8 samples
    // (the 3x3 block without its bottom-right pixel, the index wrapping into the next row at x = W-1)
    fragmentShader: `uniform sampler2D src; uniform vec2 size; varying vec2 vUv;
      vec3 px(float x, float y) {
        if (x > size.x - 1.0) { x -= size.x; y += 1.0; }
        vec3 c = floor(texture2D(src, vec2(x + 0.5, size.y - 1.0 - y + 0.5) / size).rgb * 255.0 + 0.5);
        vec3 q = floor(c / vec3(8.0, 4.0, 8.0));
        return floor(q * 12.0 / 32.0);
      }
      void main() {
        float x = floor(vUv.x * size.x), y = size.y - 1.0 - floor(vUv.y * size.y);
        vec3 q = px(x, y);
        if (y >= 1.0 && y <= size.y - 2.0 && x >= 2.0) {
          vec3 s = px(x - 1.0, y - 1.0) + px(x, y - 1.0) + px(x + 1.0, y - 1.0) + px(x - 1.0, y) + q + px(x + 1.0, y)
            + px(x - 1.0, y + 1.0) + px(x, y + 1.0);
          q = floor(s / 8.0);
        }
        vec3 c = q * vec3(8.0, 4.0, 8.0) + floor(q / vec3(4.0, 16.0, 4.0));
        gl_FragColor = vec4(c / 255.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  private blurScene = new THREE.Scene();

  constructor(private renderer: THREE.WebGLRenderer) {
    this.presentMat = new THREE.ShaderMaterial({
      uniforms: { src: { value: this.rt.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D src; varying vec2 vUv; void main(){ gl_FragColor = texture2D(src, vUv); }',
      depthTest: false,
      depthWrite: false,
    });
    this.present.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.presentMat));
    this.blurScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat));
  }

  /** Darken and blur what has been drawn so far into the backdrop target (once, when the menu opens). */
  freezeBackdrop(): void {
    const { width: w, height: h } = this.rt;
    if (this.backdrop.width !== w || this.backdrop.height !== h) this.backdrop.setSize(w, h);
    this.blurMat.uniforms.src.value = this.rt.texture;
    this.blurMat.uniforms.size.value.set(w, h);
    this.renderer.setRenderTarget(this.backdrop);
    this.renderer.render(this.blurScene, this.presentCam);
    this.drawBackdrop();
  }

  /** Copy the frozen backdrop into the internal target (instead of drawing the field). */
  drawBackdrop(): void {
    this.presentMat.uniforms.src.value = this.backdrop.texture;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.present, this.presentCam);
    this.renderer.setRenderTarget(null);
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
   * w x h target). clear = false draws over the existing content (UI passes). Returns the
   * number of render passes.
   */
  draw(group: THREE.Group, camera: THREE.Camera, w: number, h: number, target?: THREE.WebGLRenderTarget, clear = true): number {
    const r = this.renderer;
    if (!target) {
      if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
      target = this.rt;
    }
    this.useSnapshot(w, h);
    const meshes = (group.children as THREE.Mesh[]).slice().sort((a, b) => a.renderOrder - b.renderOrder);
    const parent = group.parent;
    this.scene.add(group);
    r.setRenderTarget(target);
    if (clear) {
      r.setClearColor(0x000000, 1);
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
    r.setRenderTarget(null);
    return passes;
  }

  /** Copy the internal target to the canvas. */
  show(): void {
    this.presentMat.uniforms.src.value = this.rt.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.present, this.presentCam);
  }

  render(group: THREE.Group, camera: THREE.Camera, w: number, h: number): { passes: number } {
    const passes = this.draw(group, camera, w, h);
    this.show();
    return { passes };
  }
}
