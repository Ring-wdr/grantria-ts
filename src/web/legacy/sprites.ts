// 0.1.7 sprite recording (before 584c79c): every quad its own BufferGeometry + Mesh in a group, ordered by
// renderOrder; a zoom pass makes a new material each time. Drawn by LegacyCompositor (legacy/compositor.ts).
// The current one records into one vertex buffer (../render/sprites.ts).
import * as THREE from 'three';
import { SpriteLayer, VERT, ZOOM_FRAG, dstUniforms } from '../render/sprites';

export class LegacySpriteLayer extends SpriteLayer {
  readonly group = new THREE.Group();
  private order = 0;

  override clear(): void {
    for (const m of this.group.children as THREE.Mesh[]) m.geometry.dispose();
    this.group.clear();
    this.order = 0;
  }

  /** 0.1.7 had clear() only (it freed the geometries) */
  override dispose(): void {
    this.clear();
  }

  override sync(): void {}

  /** A zoom pass (FUN_0007ac0c) over the rect covering the whole target, at this point of the draw order. */
  override zoom(x: number, y: number, w: number, h: number, k: number): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([x, y, 0, x + w, y, 0, x + w, y + h, 0, x, y + h, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: ZOOM_FRAG, uniforms: { ...dstUniforms, k: { value: k } },
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    m.userData.readsDst = true;
    const mesh = new THREE.Mesh(geo, m);
    mesh.renderOrder = this.order++;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  protected override emit(mat: THREE.ShaderMaterial, x: number, y: number, dw: number, dh: number,
    u0: number, v0: number, u1: number, v1: number, rot: number, hflip: number): void {
    // source corners TL, TR, BR, BL; destination corner i samples src[(i - rot) mod 4]
    const src = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const rotated = [0, 1, 2, 3].map((i) => src[(i - rot + 4) & 3]);
    const corners = hflip ? [rotated[1], rotated[0], rotated[3], rotated[2]] : rotated;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [x, y, 0, x + dw, y, 0, x + dw, y + dh, 0, x, y + dh, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(corners.flat(), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = this.order++;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }
}
