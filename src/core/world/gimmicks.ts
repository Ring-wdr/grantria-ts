// Map gimmicks of the E list (analysis/features/gimmicks.md §1): kind 5 magic barriers (open by
// themselves with the right key bit), kind 6 treasure chests ('5' facing probe -> popup 0x5F).
// Slot range 0x65..0x73, depth key = y. Not hit by attacks, no sounds.
import type { Assets, Cmf } from '../data/assets';
import type { Drawable } from '../render';
import type { Rect } from '../combat/player';

export class Gimmick {
  readonly kind: number;
  readonly sprite: number;
  readonly animLen: number;
  readonly b3: number;
  /** fade-out timer (16 frames) after opening */
  timer = 0;
  t = 0;
  /** battle barriers (param > 15) are hidden until DANGER_ON */
  hidden = false;
  gone = false;

  constructor(a: Assets, readonly type: number, readonly x: number, readonly y: number, readonly param: number) {
    const o = 0x2692b + type * 4;
    this.kind = a.d8(o); this.sprite = a.d8(o + 1); this.animLen = a.d8(o + 2); this.b3 = a.d8(o + 3);
  }

  get solid(): boolean { return !this.gone && !this.hidden; }
  /** body box: kind 5 {-5, 0, 50, 62}, kind 6 {0, 0, 28, 28} */
  body(): Rect {
    return this.kind === 5 ? [this.x - 5, this.y, this.x + 45, this.y + 62] : [this.x, this.y, this.x + 28, this.y + 28];
  }
  /** kind 5 trigger [x-36, x+74) × [y-22, y+80) */
  trigger(): Rect { return [this.x - 36, this.y - 22, this.x + 74, this.y + 80]; }

  /** key group: 1..3 rusty / silver / gold key, 5..7 sage stones, 0 = no key opens it */
  get key(): number {
    if (this.b3 >= 1 && this.b3 <= 9) return ((this.b3 - 1) % 3) + 1;
    if (this.b3 >= 25 && this.b3 <= 33) return ((this.b3 - 25) % 3) + 5;
    return 0;
  }

  /** returns true when the slot should be removed */
  tick(): boolean {
    if (this.timer) { if (--this.timer === 0) { this.gone = true; return true; } }
    this.t++;
    return false;
  }

  drawables(oc: Cmf): Drawable[] {
    if (this.gone || this.hidden) return [];
    if (this.kind === 6) {
      return [{ cmfName: 'cmf_oc', cmf: oc, frame: this.sprite + (this.animLen ? this.t % this.animLen : 0), x: this.x, y: this.y, depth: this.y,
        fx: this.timer ? { alpha: this.timer * 2 } : undefined }];
    }
    if (this.param === 0x11) return [];                                  // invisible wall
    if (this.timer && (this.timer & 3) === 0) return [];                // blink while opening
    const fx = this.timer ? { tint: [255, 255, 255] as [number, number, number], amount: 32 } : undefined;
    const out: Drawable[] = [{ cmfName: 'cmf_oc', cmf: oc, frame: this.sprite + this.t % Math.max(1, this.animLen), x: this.x, y: this.y, depth: this.y, fx }];
    if (this.b3) out.push({ cmfName: 'cmf_oc', cmf: oc, frame: this.b3, x: this.x + 14, y: this.y + 22, depth: this.y + 1, fx });
    return out;
  }
}
