// Browser-side game data: the core Assets plus pixel-art textures for the three.js renderer.
import * as THREE from 'three';
import { Assets } from '../core/data/assets';

export class WebAssets extends Assets {
  private textures = new Map<string, Promise<THREE.Texture | null>>();
  private loader = new THREE.TextureLoader();

  /** Pixel-art texture: no filtering, no mipmaps, no color-space conversion, rows top-down. */
  texture(name: string): Promise<THREE.Texture | null> {
    let p = this.textures.get(name);
    if (!p) {
      p = name in this.images
        ? this.loader.loadAsync(this.source.url(`images/${name}.png`)).then((t) => {
            t.magFilter = THREE.NearestFilter;
            t.minFilter = THREE.NearestFilter;
            t.generateMipmaps = false;
            t.flipY = false;
            t.colorSpace = THREE.NoColorSpace;
            return t;
          })
        : Promise.resolve(null);
      this.textures.set(name, p);
    }
    return p;
  }
}
