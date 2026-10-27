// 원정(가제) (not in the original): the standalone roguelike extra mode, drawn here.
// The state and keys are core/expedition; this draws them and steps them every animation frame (Scene.everyFrame):
// the 20 Hz tick only hands its presses over, each press carrying the time it happened (keyboard / pointer event
// time, a pad button the frame it was read) for the parry and dodge timing. Like the core side it stays apart from
// main play: no imports of the field game, combat, rules or saves (tests/boundary.test.ts).
import { AVK } from '../input/input';
import type { GameContext } from '../game/scene';
import { h, padBadge } from '../render/view';
import { KEYMAP } from '../input/bindings';
import { ctrlAt } from '../input/touchLayout';
import type { Cmf } from '../../core/data/assets';
import type { Drawable, Equip } from '../../core/render';
import { ExpeditionLogic, PAUSE_ITEMS } from '../../core/expedition/expedition';
import type { Press } from '../../core/expedition/field';
import type { Zone } from '../../core/expedition/zone';
import { WorldView } from './worldView';
import './expedition.css';

/** the hero's look: 검사 (c0) in a set of the starting gear */
const HERO_EQUIP: Equip = { w: 3, h: 3, a: 3, p: 3 };

export class ExpeditionScene extends ExpeditionLogic {
  declare protected readonly ctx: GameContext;
  /** drawn on every animation frame, not only after a tick (app.ts) */
  readonly everyFrame = true;
  private readonly view: WorldView;
  private heroCmf: Cmf | null = null;
  private pending: Press[] = [];
  private stamps: { key: number | null; t: number }[] = [];
  private last = performance.now();
  private readonly onKey = (e: KeyboardEvent) => { const k = KEYMAP[e.code]; if (k !== undefined && !e.repeat) this.stamps.push({ key: k, t: e.timeStamp }); };
  private readonly onPointer = (e: PointerEvent) => { this.stamps.push({ key: null, t: e.timeStamp }); };

  constructor(ctx: GameContext) {
    super(ctx);
    this.view = new WorldView(ctx);
    ctx.input.uiMode = false; ctx.input.zones = []; ctx.input.padField = false; ctx.input.confirm = false;
    addEventListener('keydown', this.onKey, true);
    addEventListener('pointerdown', this.onPointer, true);
  }

  protected override async onZone(zone: Zone): Promise<void> {
    this.heroCmf ??= await this.ctx.assets.cmf('cmf_c0');
    await this.view.prepare(zone, this.sets!, [{ name: 'cmf_c0', cmf: this.heroCmf, equip: HERO_EQUIP }]);
  }

  /** the tick's presses wait for the next frame */
  override update(presses: number[]): void {
    const now = performance.now();
    for (const k of presses) this.pending.push(this.stamp(k, now));
  }

  /** a press with the time of its key or pointer event (a pad button: now) */
  private stamp(key: number, now: number): Press {
    this.stamps = this.stamps.filter((s) => now - s.t < 300);
    const i = this.stamps.findIndex((s) => s.key === key || s.key === null);
    if (i < 0) return { key, t: now };
    const [s] = this.stamps.splice(i, 1);
    return { key, t: s.t };
  }

  draw(): void {
    const now = performance.now(), dt = (now - this.last) / 1000;
    this.last = now;
    for (const k of this.ctx.input.takePresses()) this.pending.push(this.stamp(k, now));
    for (const t of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(t.x, t.y); if (k) for (const key of k) this.pending.push({ key, t: now }); }
    const presses = this.pending;
    this.pending = [];
    this.frame(dt, presses);

    const u = this.ctx.ui, hud = this.ctx.hud;
    if (this.mode === 'loading' || !this.field) {
      this.ctx.compositor.clear();
      this.ctx.compositor.show();
      u.begin();
      u.view('ex-loading', 0, 0, 480, 320, h('div.v-fill.v-col.ex-screen', null, h('div.ex-sub', null, '원정지를 만드는 중...')));
      u.end();
      hud.begin(); hud.end();
      return;
    }
    this.drawField();
    u.begin();
    this.drawHud();
    if (this.mode === 'pause') this.drawPause();
    u.end();
    hud.begin();
    this.drawTouch();
    hud.end();
  }

  private heroDrawable(): Drawable {
    const hero = this.field!.hero, { frame, mirror } = hero.look();
    return { cmfName: 'cmf_c0', cmf: this.heroCmf!, frame, x: Math.round(hero.x), y: Math.round(hero.y), mirror, equip: HERO_EQUIP, shadow: true };
  }

  private drawField(): void {
    const f = this.field!;
    this.view.render(f.camX, f.camY, [this.heroDrawable()]);
    this.ctx.compositor.show();
  }

  private drawHud(): void {
    const inp = this.ctx.input;
    this.ctx.ui.view('ex-hud', 0, 0, 480, 320, h('div.v-fill.ex-hud', null,
      h('div.ex-zone', null, '원정 · 초원 1'),
      h('div.v-row.ex-keys', null, padBadge(inp, AVK.CLR), h('span', null, '메뉴'))));
  }

  private drawPause(): void {
    this.ctx.ui.view('ex-pause', 0, 0, 480, 320, h('div.v-fill.v-col.ex-modal', null,
      h('div.v-col.ex-menu', null,
        h('div.ex-menu-title', null, '일시 정지'),
        PAUSE_ITEMS.map((label, i) => h(`div.ex-item${i === this.pauseSel ? '.sel' : ''}`, { on: () => { this.pickPause(i); } }, label)))));
  }

  /** the touch stick (where 조작 배치 puts it; Input reads it there) */
  private drawTouch(): void {
    const inp = this.ctx.input;
    if (inp.device !== 'touch' || this.mode !== 'field') return;
    const hud = this.ctx.hud, { x, y, s } = ctrlAt('stick', inp.edge);
    hud.el('ex-stick', x - 30 * s, y - 30 * s, 60 * s, 60 * s);
    const d = Math.hypot(inp.stick.dx, inp.stick.dy), k = d > 22 * s ? (22 * s) / d : 1;
    hud.el('ex-knob', x - 11 * s + inp.stick.dx * k, y - 11 * s + inp.stick.dy * k, 22 * s, 22 * s);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('pointerdown', this.onPointer, true);
    this.view.dispose();
  }
}
