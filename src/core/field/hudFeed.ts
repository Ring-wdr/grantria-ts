// What the field logic shows on the HUD besides the stats: world-space combat text (damage numbers, MISS / CRITICAL /
// EXTRA, labels) with their ages, the message log (FUN_0001e6e8) and the floor-name slide. The HUD draws them
// (web/game/fieldHud.ts); tick() ages them once a field frame.

/** World-space combat text. */
export interface FloatText {
  kind: 'damage' | 'pop' | 'miss' | 'crit' | 'extra' | 'label';
  /** 'pop': red (the player was hit) */
  red?: boolean;
  /** damage numbers: the object they belong to (a new one pushes the older ones away) */
  owner?: object;
  value: number;
  text: string;
  x: number;
  y: number;
  age: number;
}

export const popDigits = (v: number): number => String(Math.abs(Math.trunc(v))).length;

export class HudFeed {
  frame = 0;
  /** floor-name slide DAT_003b3be8: -33 on map entry, +2 per frame up to 32 */
  slide = 32;
  private lastMap = -1;
  floats: FloatText[] = [];
  /** HUD message log (FUN_0001e6e8, 6-line queue 0x40f380): text and age */
  messages: { text: string; age: number }[] = [];

  tick(): void {
    this.frame++;
    if (this.slide < 32) this.slide = Math.min(32, this.slide + 2);
    for (const f of this.floats) f.age++;
    this.floats = this.floats.filter((f) => f.age < (f.kind === 'label' ? 30 : f.kind === 'damage' ? 7 : f.kind === 'pop' ? 9 : 12));
    for (const m of this.messages) m.age++;
    this.messages = this.messages.filter((m) => m.age < 60);
  }

  /** FUN_00022090 kind 2: the whole number at once, 2x size (crit / EXTRA / second hits) */
  damage(value: number, x: number, y: number, owner?: object): void { this.push({ kind: 'damage', value, text: '', x, y, age: 0, owner }); }
  /** FUN_00022090: the owner's earlier numbers move by (c − 8, c − 16), c = what is left of their counter */
  private push(f: FloatText): void {
    if (f.owner) for (const o of this.floats) {
      if (o.owner !== f.owner || (o.kind !== 'damage' && o.kind !== 'pop')) continue;
      const c = o.kind === 'damage' ? 7 - o.age : popDigits(o.value) * 4 - o.age;
      o.x += c - 8; o.y += c - 16;
    }
    this.floats.push(f);
  }
  /** FUN_00022090 kind 1: digits pop out one by one (normal hits); red when the player is hit */
  pop(value: number, x: number, y: number, red = false, owner?: object): void { this.push({ kind: 'pop', value, text: '', x, y, age: 0, red, owner }); }
  hurt(value: number, x: number, y: number, owner?: object): void { this.pop(value, x, y, true, owner); }
  extra(x: number, y: number): void { this.floats.push({ kind: 'extra', value: 0, text: '', x, y, age: 0 }); }
  miss(x: number, y: number): void { this.floats.push({ kind: 'miss', value: 0, text: '', x, y, age: 0 }); }
  crit(x: number, y: number): void { this.floats.push({ kind: 'crit', value: 0, text: '', x, y, age: 0 }); }
  label(text: string, x: number, y: number): void { this.floats.push({ kind: 'label', value: 0, text, x, y, age: 0 }); }

  message(text: string): void {
    if (!text) return;
    this.messages.push({ text, age: 0 });
    if (this.messages.length > 6) this.messages.shift();
  }

  /** arrive on mapId without the slide: FUN_0002d640 (차원의 문 entry) loads the floor without setting
   *  DAT_003b3be8 = 0xdf, so the floor name just stands at its resting place */
  noSlideOn(mapId: number): void { this.lastMap = mapId; this.slide = 32; }

  /** the HUD shows mapId: a new map starts the floor-name slide */
  seeMap(mapId: number): void { if (mapId !== this.lastMap) { this.lastMap = mapId; this.slide = -33; } }
}
