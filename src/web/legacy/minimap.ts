// 0.1.7 minimap upload (before aa5790d): the pixels go into the canvas texture every tick, changed or not.
// The current one skips an unchanged frame (../render/minimap.ts).
import { Minimap } from '../render/minimap';

export class LegacyMinimap extends Minimap {
  protected override put(img: ImageData): void {
    this.ctx2d.putImageData(img, 0, 0);
    this.tex.needsUpdate = true;
  }
}
