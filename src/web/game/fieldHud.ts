// Field HUD drawn with the original art (analysis/features/ui-screens.md §0.2, port of
// tools/grantria_ui.py draw_status_bar / draw_floor_name / draw_touch_buttons) plus combat text
// (text-rendering.md §3: number fonts, CRITICAL/MISS frames of the effect bank on t.pxl).
import type { Cmf } from '../../core/data/assets';
import { VIEW_H as H, VIEW_W as W } from '../render/field';
import { AVK, type Input } from '../input/input';
import { HUD } from '../../core/keys';
import { expNeed } from '../../core/rules/rules';
import type { DomUi } from '../render/domUi';
import { ICONS } from '../render/touchIcons';
import { keyHint } from '../input/keyHints';

export interface HudState {
  /** day/night clock frame of cmf_status (0x51 day) */
  clock?: number;
  cls: number;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  exp: number;
  statPoints: number;
  skillPoints: number;
  mapId: number;
  /** the gate icon is drawn at alpha 10 (garden or no-save area, FUN_0002f7b8) */
  dimGate?: boolean;
  /** quick slots '1','3','7','9','*','#': skill, item (icon + count, -1 = no count) or empty */
  slots: (SlotView | null)[];
  /** target panel (FUN_00025a88): DAT_003b3c49 or the monster just hit; ghost = trailing bar width or -1 */
  target?: { name: string; level: number; hp: number; maxHp: number; ghost: number } | null;
  /** HIT counter DAT_003b61c8: hits and the display timer */
  hits?: { count: number; timer: number };
}

export type SlotView =
  | { skill: number; cd: number; maxCd: number; noMp?: boolean }
  | { icon: { image: string; sx: number; sy: number }; count: number; cd: number; maxCd: number };

/** Touch zones of the field screen (touchdata.dat state 0x10, game-flow-ui.md §5.2). */
export const FIELD_ZONES: { x: number; y: number; w: number; h: number; key: number; edge?: 1 }[] = [
  { x: 0, y: 0, w: 40, h: 40, key: AVK.CLR },
  { x: 194, y: 0, w: 56, h: 32, key: 10000 },                        // QUEST -> quest tab (key 10000 lights it, FUN_0004b128 idx 12)
  { x: 255, y: 0, w: 60, h: 32, key: AVK.SAVE },
  { x: 156, y: 2, w: 32, h: 32, key: -30 },
  { x: 0, y: 75, w: 80, h: 70, key: AVK.MAP },                     // minimap -> map tab                         // gate icon -> community menu
  { x: 322, y: 0, w: 52, h: 32, key: -7 },                          // SHOP -> premium shop
  { x: 410, y: 55, w: 76, h: 30, key: -31 },                        // coupon shop button
  { x: 427, y: 104, w: 50, h: 50, key: AVK.CLR, edge: 1 },
  { x: 361, y: 157, w: 50, h: 50, key: AVK.STAR, edge: 1 },
  { x: 427, y: 157, w: 50, h: 50, key: AVK.POUND, edge: 1 },
  { x: 288, y: 211, w: 50, h: 50, key: AVK.K7, edge: 1 },
  { x: 352, y: 211, w: 50, h: 50, key: AVK.K9, edge: 1 },
  { x: 279, y: 264, w: 50, h: 50, key: AVK.K1, edge: 1 },
  { x: 346, y: 265, w: 50, h: 50, key: AVK.K3, edge: 1 },
  { x: 402, y: 208, w: 78, h: 110, key: AVK.OK, edge: 1 },
];

/** touch control centres (original sprite rects: stick ring, attack 62x60, MENU 40x39, slots 40x39) */
const STICK = { x: 0x53, y: H - 0x4a + 1 };
const ATTACK = { x: W - 0x4c + 31, y: H - 0x5a + 30 };
const MENU = { x: W - 0x2e + 20, y: H - 0xe5 + 20 };
const SLOT_X = [0xc0, 0x83, 0xb8, 0x7b, 0x72, 0x31], SLOT_Y = [0x31, 0x31, 0x67, 0x66, 0x9c, 0x9b];
const slotCentre = (i: number): [number, number] => [W - SLOT_X[i] + 20, H - SLOT_Y[i] + 20];

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** World-space combat text. */
interface FloatText {
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

/** d+0x24d7a (byte pairs): kind 2 reads them as (alpha, style) at 11 - c, kind 1 as (dy, style) per digit */
const NUM_T: [number, number][] = [[0, 8], [-16, 8], [4, 7], [1, 7], [16, 9], [32, 10], [32, 10], [32, 10], [32, 9], [16, 9], [16, 9]];
const popDigits = (v: number) => String(Math.abs(Math.trunc(v))).length;

export class FieldHud {
  private frame = 0;
  /** floor-name slide DAT_003b3be8: -33 on map entry, +2 per frame up to 32 */
  private slide = 32;
  private lastMap = -1;
  private floats: FloatText[] = [];
  /** HUD message log (FUN_0001e6e8, 6-line queue 0x40f380): text and age */
  private messages: { text: string; age: number }[] = [];

  constructor(private ui: DomUi, private status: Cmf, private input: Input) {}

  static images = ['c', 't', 'touch', 'sIcon', 'i0', 'f', 'ec', 'oc', ...Array.from({ length: 11 }, (_, i) => `face${i}`)];

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

  /** Message log, provisional placement (the original drawing position is not documented). */
  private drawMessages(): void {
    const u = this.ui;
    this.messages.forEach((m, i) => {
      u.alpha = m.age > 50 ? (60 - m.age) * 3 : 32;
      u.string(m.text, 8, H - 30 - (this.messages.length - 1 - i) * 13);
    });
    u.alpha = 32;
  }

  /** buttons = false while the game-over screen redraws the field (FUN_0003357c) */
  draw(s: HudState, camX: number, camY: number, buttons = true): void {
    const u = this.ui;
    if (s.mapId !== this.lastMap) { this.lastMap = s.mapId; this.slide = -33; }
    this.drawFloats(camX, camY);
    if (s.target) this.targetPanel(s.target);
    if (s.hits?.count) this.hitCounter(s.hits.count, s.hits.timer);
    this.statusBar(s);
    this.floorName(s.mapId);
    if (buttons) this.touchButtons(s);
    this.drawMessages();
    u.alpha = 32;
  }

  /** FUN_00025a88: translucent c.pxl plate top right, name, "Lv" and level, HP bar 60 wide with its trailing ghost */
  private targetPanel(t: NonNullable<HudState['target']>): void {
    const u = this.ui;
    u.alpha = 16;
    u.image('c', 0x31, 0x8a, 0x29, 0x15, W - 0x5b, 2, 1);
    u.image('c', 0x31, 0x8a, 8, 0x15, W - 0x32, 2);
    u.image('c', 0x31, 0x8a, 0x29, 0x15, W - 0x2a, 2);
    u.image('c', 0x31, 0xa3, 0x29, 5, W - 0x5b, 0x17, 1);
    u.image('c', 0x31, 0xa3, 8, 5, W - 0x32, 0x17);
    u.image('c', 0x31, 0xa3, 0x29, 5, W - 0x2a, 0x17);
    u.alpha = 32;
    u.string(t.name, W - 0x59, 4, 'left');
    u.image('c', 0x3c, 0x1c, 0xe, 8, W - 0x5a, 0x11);
    u.number(t.level, W - 0x4c, 0x12, 0, 0, 3);
    u.image('c', 0x90, 0xb6, 0x3c, 6, W - 0x3e, 0x13);
    if (t.ghost > 0) { u.alpha = 16; u.image('c', 0x90, 0xb0, t.ghost, 6, W - 0x3e, 0x13); u.alpha = 32; }
    const w = Math.trunc((t.hp * 0x3c) / Math.max(1, t.maxHp));
    if (w > 0) u.image('c', 0x90, 0xb0, w, 6, W - 0x3e, 0x13);
  }

  /** FUN_00029604 HIT counter: digits pop in like kind 1 numbers at the right edge, "HIT" (t.pxl 0,55) */
  private hitCounter(count: number, timer: number): void {
    const u = this.ui, s = String(count), n = s.length;
    u.alpha = timer === 0 ? 8 : timer === 1 ? 12 : timer === 2 ? 16 : 32;
    for (let i = 0; i < n; i++) {
      const idx = Math.min(timer - i, 3);
      if (idx < 0) break;
      const d = +s[i], [dy, st] = NUM_T[idx];
      u.numberGlyph(d, W - 0x22 - 12 * n + 12 * i + (d === 1 ? 2 : 0), dy + (H >> 1), st);
    }
    u.image('t', 0, 0x37, 0x1e, 0x12, W - 0x24, (H >> 1) - 1);
    u.alpha = 32;
  }

  /** FUN_0002f7b8 status bar. */
  private statusBar(s: HudState): void {
    const u = this.ui;
    u.frame('cmf_status', this.status, s.clock ?? 0x51, W / 2 - 0x77, 5, 'c');     // icon 1: day/night clock (FUN_0002f7b8)
    u.image('c', 200, 0x74, 0x22, 0x22, W / 2 - 0x7c, 0);                // its gold frame
    if (s.dimGate) u.alpha = 10;
    u.image('t', 0xcf, 0x77, 0x22, 0x22, W / 2 - 0x54, 0);               // dimension door icon
    u.alpha = 32;
    u.image('c', 0, 0x89, 0x5b, 0x1e, 0x11, 2);                          // frame 91x30
    u.alpha = 16;
    u.image('c', 0x5a, 0x88, 0x1a, 0x1a, 2, 4);                          // disc behind the face
    u.alpha = 32;
    u.image('c', 0xbd, 0x1a, 0x1e, 0x1e, 1, 3);                          // ring
    const face = [[0x17, 0x15, 0xa8, 0x93, 5, 4], [0x19, 0x14, 0x77, 0x94, 3, 5], [0x18, 0x13, 0x90, 0x95, 4, 5]][s.cls];
    u.image('c', face[2], face[3], face[0], face[1], face[4], face[5]);
    u.image('c', 0, 0xb7, 0x48, 7, 0x20, 0xf);                           // HP bg / fill
    u.image('c', 0, 0xb0, Math.trunc(Math.max(0, s.hp) * 0x48 / Math.max(1, s.maxHp)), 7, 0x20, 0xf);
    u.image('c', 0x48, 0xb7, 0x48, 7, 0x20, 0x17);                       // MP bg / fill
    u.image('c', 0x48, 0xb0, Math.trunc(Math.max(0, s.mp) * 0x48 / Math.max(1, s.maxMp)), 7, 0x20, 0x17);
    u.image('c', 0x3c, 0x1c, 0xe, 8, 0x1e, 4);                           // "Lv."
    u.number(s.level, 0x2d, 5, 0, 0, 2);
    if (this.frame & 4) {                                                // blinking point icons
      if (s.statPoints > 0) u.image('c', 0x80, 0x50, 8, 8, 0x46, 5);
      if (s.skillPoints > 0) u.image('c', 0x88, 0x50, 8, 8, 0x4f, 5);
    }
    const lo = expNeed(s.level - 1), hi = expNeed(s.level);
    u.image('c', 0, 0xac, 0xe0, 4, W / 2 - 0x70, H - 5);                 // exp bg / fill
    u.image('c', 0, 0xa8, Math.trunc(Math.max(0, s.exp - lo) * 0xe0 / Math.max(1, hi - lo)), 4, W / 2 - 0x70, H - 5);
  }

  /** FUN_000354bc floor name: round box 0x333333 alpha 16, text alpha follows the slide. */
  private floorName(mapId: number): void {
    const u = this.ui, be8 = this.slide;
    const id = 0x1e4 + mapId;
    const tw = u.width(id);
    u.alpha = 16;
    u.roundFill(be8 - 0x16, H - 0x11b, tw + 0x12, 0x13, 0x333333, 1);
    u.alpha = be8 < 0 ? be8 + 32 : Math.min(32, 64 - be8);
    u.textId(id, be8 - 0x12, H - 0x118);
    u.alpha = 32;
  }

  /**
   * Touch controls (FUN_0004b128 layout, stick mode 1 centre (0x53, H-0x4a)) redrawn as CSS + SVG
   * (ui.css .t-*): same places and touch zones, idle / pressed states as CSS transitions.
   */
  private touchButtons(s: HudState): void {
    const u = this.ui, inp = this.input;
    const held = inp.lastHeld();
    const idx = ({ [AVK.UP]: 0, [AVK.LEFT]: 1, [AVK.DOWN]: 2, [AVK.RIGHT]: 3, [AVK.K1]: 4, [AVK.K3]: 5, [AVK.K7]: 6,
      [AVK.K9]: 7, [AVK.STAR]: 8, [AVK.POUND]: 9, [-7]: 10, [AVK.SAVE]: 11, [10000]: 12 } as Record<number, number>)[held] ?? 0xff;
    const on = (b: boolean) => (b ? ' on' : '');
    u.alpha = 32;
    // virtual stick: ring, four chevrons, a knob that follows the finger / pad stick (radius 22)
    const e = inp.edge;                                                // edge layout: stick left, right cluster right
    const cx = STICK.x - e, cy = STICK.y;
    u.el(`t-stick${on(inp.stick.active)}`, cx - 30, cy - 30, 60, 60);
    ([[0, -42, 0], [-43, 0, 270], [0, 42, 180], [43, 0, 90]] as const).forEach(([dx, dy, rot], i) =>
      u.el(`t-arrow${on(idx === i)}`, cx + dx - 10, cy + dy - 10, 20, 20, { html: ICONS.chevron, vars: { '--rot': `${rot}deg` } }));
    const d = Math.hypot(inp.stick.dx, inp.stick.dy), k = d > 22 ? 22 / d : 1;
    u.el(`t-knob${on(idx < 4)}`, cx - 15, cy - 15, 30, 30,
      { vars: { '--kx': `${Math.round(inp.stick.dx * k)}px`, '--ky': `${Math.round(inp.stick.dy * k)}px` } });
    // attack
    u.el(`t-circle t-attack${on(inp.isHeld(AVK.OK))}`, ATTACK.x + e - 29, ATTACK.y - 29, 58, 58, { html: ICONS.sword });
    // quick slots 1, 3, 7, 9, *, #: the skill / item icon stays the game's art inside a CSS ring
    for (let i = 0; i < 6; i++) {
      const [x0, y] = slotCentre(i), x = x0 + e, v = s.slots[i];
      u.group(`t-btn${on(idx === i + 4)}`, x, y, `slot${i}`);
      u.el(`t-circle t-slot${v ? '' : ' empty'}`, x - 19, y - 19, 38, 38);
      if (v) {
        if ('skill' in v) {
          // skill icon: i3 (skill%10*24, 72) where the loader FUN_000f9aac pastes sIcon rows cls*24..+23 at y=72
          u.image('sIcon', (v.skill % 10) * 0x18, s.cls * 0x18, 0x18, 0x18, x - 12, y - 12);
        } else {
          u.image(v.icon.image, v.icon.sx, v.icon.sy, 0x10, 0x10, x - 8, y - 9);   // FUN_0003bc80
          if (v.count >= 0) u.el('t-count', x - 14, y + 5, 28, 10, { text: String(v.count) });
        }
        if ('skill' in v && v.noMp) u.el('t-nomp', x - 19, y - 19, 38, 38);   // FUN_00029108: MP below the cost -> greyed
        // cooldown (FUN_00029108 shrinking grey): a clockwise sweep over the ring
        if (v.cd > 0) u.el('t-cd', x - 19, y - 19, 38, 38, { vars: { '--cd': (Math.min(1, v.cd / Math.max(1, v.maxCd))).toFixed(3) } });
      }
      u.groupEnd();
    }
    u.el(`t-circle t-menu${on(held === AVK.CLR)}`, MENU.x + e - 19, MENU.y - 19, 38, 38, { html: ICONS.menu });
    // QUEST / SAVE / SHOP (the original swaps the QUEST/SHOP highlight) and the coupon shop
    for (const [lit, icon, label, x] of [[12, 'quest', 'QUEST', 194], [11, 'save', 'SAVE', 258], [10, 'shop', 'SHOP', 322]] as const)
      u.el(`t-pill${on(idx === lit)}`, x, 6, 52, 20, { html: `${ICONS[icon]}<span>${label}</span>` });
    u.el('t-pill t-coupon', W - 0x50, H - 0x102, 0x4c, 22, { html: `${ICONS.coupon}<span>${escapeHtml(u.textOf(0x1a08))}</span>` });
    if (inp.device !== 'touch') this.padHints();
  }

  /** the pad glyph or keyboard key on each touch button it presses (follows the device used last) */
  private padHints(): void {
    const u = this.ui;
    const hint = (key: number, x: number, y: number) => {
      const k = keyHint(this.input, key);
      if (k) u.padHint(k.glyph, k.cls, x, y);
    };
    const e = this.input.edge;
    hint(AVK.OK, ATTACK.x + e + 16, ATTACK.y + 17);
    [AVK.K1, AVK.K3, AVK.K7, AVK.K9, AVK.STAR, AVK.POUND].forEach((k, i) => { const [x, y] = slotCentre(i); hint(k, x + e + 9, y + 9); });
    hint(AVK.CLR, MENU.x + e + 9, MENU.y + 9);
    hint(AVK.SAVE, 258 + 44, 6 + 12);
    hint(AVK.MAP, 4, 47);
    hint(HUD.QUEST, 194 + 44, 6 + 12);                                       // d-pad on the field (PAD_FIELD)
    hint(HUD.SHOP, 322 + 44, 6 + 12);
    hint(HUD.COUPON, W - 0x50 + 0x4c - 8, H - 0x102 + 14);
    hint(HUD.COMMUNITY, 156 + 24, 2 + 24);                                  // gate icon -> community                                                    // minimap -> map tab
  }

  /** Damage numbers (kind 2 style 9, kind 1 red style 6), MISS / CRITICAL from t.pxl, labels. */
  private drawFloats(camX: number, camY: number): void {
    const u = this.ui;
    for (const f of this.floats) {
      const x = f.x - camX, y = f.y - camY;
      if (f.kind === 'damage') {                            // style / alpha from NUM_T[11 - c], c = 7..1
        const [a, st] = NUM_T[Math.min(4 + f.age, 10)];
        u.alpha = a;
        u.number(f.value, x, y, st, 1);
      } else if (f.kind === 'pop') {                         // FUN_00029604 kind 1: digit i at idx min(age - i, 3)
        const n = popDigits(f.value), s = String(Math.abs(Math.trunc(f.value)));
        const fx = f.red ? { tint: [255, 0, 0] as [number, number, number], amount: 10 } : undefined;
        for (let i = 0; i < n; i++) {
          let idx = f.age - i;
          if (idx < 0) break;
          if (idx > 3) idx = 3;
          const d = +s[i], [dy, st] = NUM_T[idx];
          u.alpha = f.age === 7 ? 16 : 32;
          u.numberGlyph(d, x - 12 * n + 12 * i + (d === 1 ? 2 : 0), y + dy, st, fx);
        }
      } else if (f.kind === 'miss') {                       // frames 157..161: dy -9, -23, -26, -29, -31
        const dy = [-9, -23, -26, -29, -31][Math.min(4, f.age >> 1)];
        u.alpha = f.age > 9 ? 16 : 32;
        u.image('t', 139, 53, 43, 18, x - 20, y + dy);
      } else if (f.kind === 'extra') {                      // frames 162..166, as MISS
        const dy = [-9, -23, -26, -29, -31][Math.min(4, f.age >> 1)];
        u.alpha = f.age > 9 ? 16 : 32;
        u.image('t', 139, 71, 56, 18, x - 26, y + dy);
      } else if (f.kind === 'crit') {                       // frames 151..156, ghosts at +-10 on 151/156
        u.alpha = f.age > 9 ? 16 : 32;
        if (f.age < 2 || f.age >= 10) {
          u.image('t', 30, 55, 109, 24, x - 68, y - 14);
          u.image('t', 30, 55, 109, 24, x - 48, y - 14);
        }
        u.image('t', 30, 55, 109, 24, x - 58, y - 14);
      } else {
        u.alpha = f.age > 20 ? 32 - (f.age - 20) * 3 : 32;
        u.string(f.text, x, y - Math.min(f.age, 10), 'center', { pen: 0xffe0 });
      }
    }
    u.alpha = 32;
  }
}
