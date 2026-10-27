// 원정(가제) (not in the original): the standalone roguelike extra mode, drawn here.
// The state and keys are core/expedition; this draws them and steps them every animation frame (Scene.everyFrame):
// the 20 Hz tick only hands its presses over, each press carrying the time it happened (keyboard / pointer event
// time, a pad button the frame it was read) for the parry and dodge timing. Like the core side it stays apart from
// main play: no imports of the field game, combat, rules or saves (tests/boundary.test.ts).
// Touch: a fixed layout of this mode's own (the stick where 조작 배치 puts it, since Input reads it there; the action
// buttons on the right), not the main game's editable one.
import { AVK } from '../input/input';
import type { GameContext } from '../game/scene';
import { h, padBadge, type VNode } from '../render/view';
import { KEYMAP } from '../input/bindings';
import { keyHint } from '../input/keyHints';
import { ctrlAt } from '../input/touchLayout';
import type { Cmf } from '../../core/data/assets';
import type { Drawable } from '../../core/render';
import { bodyBox } from '../../core/world/world';
import { ADVANTAGE_LABEL, ExpeditionLogic, PAUSE_ITEMS } from '../../core/expedition/expedition';
import { FK, type FieldEnemy, type Press } from '../../core/expedition/field';
import { SPECIES } from '../../core/expedition/species';
import type { Zone } from '../../core/expedition/zone';
import { WorldView } from './worldView';
import { BattleView } from './battleView';
import { HERO_EQUIP } from './heroLook';
import type { Battle } from '../../core/expedition/battle';
import './expedition.css';


/** the mode's touch buttons (virtual px, right side; edge 1 moves them out with Input.edge) */
const TOUCH: { key: number; label: string; x: number; y: number; r: number }[] = [
  { key: FK.LIGHT, label: '공격', x: 432, y: 268, r: 24 },
  { key: FK.HEAVY, label: '강공격', x: 380, y: 284, r: 17 },
  { key: FK.DODGE, label: '회피', x: 448, y: 214, r: 17 },
  { key: FK.PARRY, label: '패링', x: 392, y: 232, r: 17 },
  { key: FK.ACT, label: '상호작용', x: 448, y: 166, r: 15 },
];

export class ExpeditionScene extends ExpeditionLogic {
  declare protected readonly ctx: GameContext;
  /** drawn on every animation frame, not only after a tick (app.ts) */
  readonly everyFrame = true;
  protected readonly view: WorldView;
  private readonly battleView: BattleView;
  protected cmfs = new Map<string, Cmf>();
  private pending: Press[] = [];
  private stamps: { key: number | null; t: number }[] = [];
  private last = performance.now();
  private readonly onKey = (e: KeyboardEvent) => { const k = KEYMAP[e.code]; if (k !== undefined && !e.repeat) this.stamps.push({ key: k, t: e.timeStamp }); };
  private readonly onPointer = (e: PointerEvent) => { this.stamps.push({ key: null, t: e.timeStamp }); };

  constructor(ctx: GameContext) {
    super(ctx);
    this.view = new WorldView(ctx);
    this.battleView = new BattleView(ctx, this.view, this.cmfs);
    ctx.input.uiMode = false; ctx.input.padField = false; ctx.input.confirm = false;
    ctx.input.zones = [
      ...TOUCH.map((b) => ({ x: b.x - b.r - 4, y: b.y - b.r - 4, w: 2 * b.r + 8, h: 2 * b.r + 8, key: b.key, edge: 1 as const })),
      { x: 444, y: 4, w: 32, h: 22, key: AVK.CLR, edge: 1 as const },
    ];
    addEventListener('keydown', this.onKey, true);
    addEventListener('pointerdown', this.onPointer, true);
  }

  protected async cmf(name: string): Promise<Cmf> {
    let c = this.cmfs.get(name);
    if (!c) { c = await this.ctx.assets.cmf(name); this.cmfs.set(name, c); }
    return c;
  }

  protected override async onZone(zone: Zone): Promise<void> {
    const names = ['cmf_c0', ...new Set(zone.spawns.map((s) => `cmf_c${SPECIES[s.species].cmf}`))];
    const cmfs = await Promise.all(names.map((n) => this.cmf(n)));
    await this.view.prepare(zone, this.sets!, names.map((name, i) => ({ name, cmf: cmfs[i], equip: name === 'cmf_c0' ? HERO_EQUIP : undefined })));
  }

  protected override onBattle(b: Battle): void {
    const names = [...new Set(b.units.filter((u) => u.sp).map((u) => `cmf_c${u.sp!.cmf}`))];
    void Promise.all(names.map((n) => this.cmf(n))).then((cmfs) =>
      this.view.preloadSprites([{ name: 'cmf_c0', cmf: this.cmfs.get('cmf_c0')!, equip: HERO_EQUIP }, ...names.map((name, i) => ({ name, cmf: cmfs[i] }))], ['ec', 'c', 'oc', 't']));
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

  /** this frame's presses (the tick's, those since, the UI taps), stamped */
  protected takePresses(now: number): Press[] {
    for (const k of this.ctx.input.takePresses()) this.pending.push(this.stamp(k, now));
    const p = this.pending;
    this.pending = [];
    return p;
  }

  draw(): void {
    const now = performance.now(), dt = (now - this.last) / 1000;
    this.last = now;
    this.frame(dt, this.takePresses(now), now);
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
    if (this.mode === 'battle' && this.battle) {
      u.begin();
      this.battleView.draw(this.battle, this.field);
      u.end();
      hud.begin();
      this.drawTouch();
      hud.end();
      return;
    }
    if (this.mode === 'over') {
      this.ctx.compositor.clear();
      this.ctx.compositor.show();
      u.begin();
      u.view('ex-over', 0, 0, 480, 320, h('div.v-fill.v-col.ex-screen', null, h('div.ex-title', null, '원정 실패'),
        h('div.ex-sub', null, '파티가 쓰러졌다. 원정은 여기서 끝난다.'), h('div.ex-item.sel', { on: () => [AVK.OK] }, '타이틀로')));
      u.end();
      hud.begin(); hud.end();
      return;
    }
    hud.begin();
    this.drawTelegraphs();
    this.drawField();
    u.begin();
    this.drawFieldUi();
    this.drawHud();
    if (this.mode === 'encounter') this.drawBanner();
    if (this.mode === 'pause') this.drawPause();
    u.end();
    this.drawTouch();
    hud.end();
  }

  protected heroDrawable(): Drawable {
    const hero = this.field!.hero, t = this.ctx.assets.tables;
    const { frame, mirror, alpha } = hero.look(t.playerActions[0], t.actionMult[0]);
    return { cmfName: 'cmf_c0', cmf: this.cmfs.get('cmf_c0')!, frame, x: Math.round(hero.x), y: Math.round(hero.y), mirror, equip: HERO_EQUIP, shadow: true, fx: alpha ? { alpha } : undefined };
  }

  private enemyDrawable(e: FieldEnemy): Drawable | null {
    if (e.removed) return null;
    const name = `cmf_c${e.sp.cmf}`, cmf = this.cmfs.get(name)!;
    const { frame, mirror } = e.look(cmf);
    const fx = e.state === 'dead' ? { alpha: Math.max(0, Math.round(32 - e.t * 46)) }
      : e.flashT > 0 ? { tint: [255, 255, 255] as [number, number, number], amount: 22 }
      : e.state === 'windup' ? { tint: [255, 60, 40] as [number, number, number], amount: Math.round(3 + 6 * Math.min(1, e.t / e.sp.field.windup)) }
      : e.stunned ? { tint: [255, 230, 90] as [number, number, number], amount: 8 } : undefined;
    return { cmfName: name, cmf, frame, x: Math.round(e.x), y: Math.round(e.y), mirror, shadow: true, fx };
  }

  private drawField(): void {
    const f = this.field!, ents: Drawable[] = [];
    for (const e of f.enemies) { const d = this.enemyDrawable(e); if (d) ents.push(d); }
    ents.push(this.heroDrawable());
    this.view.render(f.camX, f.camY, ents);
    this.ctx.compositor.show();
  }

  /** windup rings on the ground (under the screen UI, over the field) */
  private drawTelegraphs(): void {
    const f = this.field!, hud = this.ctx.hud, ox = Math.round(f.camX), oy = Math.round(f.camY);
    for (const e of f.enemies) {
      if (e.state !== 'windup' || e.removed) continue;
      const k = Math.min(1, e.t / e.sp.field.windup), r = e.radius + 28;
      hud.el('ex-tele', e.x - ox - r, e.y - oy - r * 0.55, 2 * r, 1.1 * r, { key: `tele${e.id}`, vars: { '--k': k.toFixed(3) } });
    }
  }

  /** over the field: enemy bars, effects, the hero's prompt, toasts */
  private drawFieldUi(): void {
    const f = this.field!, u = this.ctx.ui, ox = Math.round(f.camX), oy = Math.round(f.camY);
    for (const e of f.enemies) {
      if (!e.alive) continue;
      const sx = e.x - ox, sy = e.y - oy;
      if (sx < -30 || sx > 510 || sy < -20 || sy > 360) continue;
      const cmf = this.cmfs.get(`cmf_c${e.sp.cmf}`)!, box = bodyBox(cmf, e.look(cmf).frame);
      const top = sy + Math.min(-20, ((box[1] << 24) >> 24)) - 22;
      if (e.state === 'notice') u.el('ex-alert', sx - 4, top - 14, 8, 12, { key: `al${e.id}`, text: '!' });
      if (e.brk > 0 || e.hp < e.hpMax || e.state !== 'idle' && e.state !== 'wander') {
        u.el('ex-bar hp', sx - 14, top, 28, 3, { key: `hp${e.id}`, vars: { '--v': (e.hp / e.hpMax).toFixed(3) } });
        u.el(`ex-bar brk${e.stunned ? ' full' : ''}`, sx - 14, top + 4, 28, 3, { key: `bk${e.id}`, vars: { '--v': (e.brk / e.brkMax).toFixed(3) } });
      }
      if (e.stunned) u.effect(0xa7 + (Math.floor(e.t * 10) % 4), sx, top - 6);
    }
    for (const fl of this.flashes) {
      const sx = fl.x - ox, sy = fl.y - oy;
      if (fl.kind === 'parry') u.el('ex-parry', sx - 20, sy - 20, 40, 40, { key: `pr${fl.x | 0}`, vars: { '--k': (fl.t / 0.5).toFixed(3) } });
      else if (fl.kind === 'break') u.el('ex-breaktxt', sx - 30, sy - 10 - fl.t * 20, 60, 12, { key: `br${fl.x | 0}`, text: 'BREAK' });
      else u.effect(Math.min(5, Math.floor(fl.t * 14)) + (fl.kind === 'heavy' ? 0 : 0), sx, sy);
    }
    const hint = this.mode === 'field' ? f.actHint() : null;
    if (hint) u.el('ex-act', f.hero.x - ox - 50, f.hero.y - oy - 58, 100, 14, { html: `${this.keyGlyph(FK.ACT)}${hint}` });
  }

  /** a key's glyph as inline HTML (empty on touch) */
  protected keyGlyph(key: number): string {
    const k = keyHint(this.ctx.input, key);
    return k ? `<span class="u-pad ${k.cls}">${k.glyph}</span> ` : '';
  }

  private drawHud(): void {
    const inp = this.ctx.input, f = this.field!;
    const left = f.enemies.filter((e) => e.alive).length;
    this.ctx.ui.view('ex-hud', 0, 0, 480, 320, h('div.v-fill.ex-hud', null,
      h('div.v-row.ex-zone', null, h('span', null, '원정 · 초원 1'), h('span.ex-dim', null, `적 ${left}`), h('span.ex-dim', null, `Lv.${this.run.party[0].lv}`)),
      inp.device !== 'touch' ? h('div.v-row.ex-keys', null,
        this.hint(FK.LIGHT, '공격'), this.hint(FK.HEAVY, '강공격'), this.hint(FK.DODGE, '회피'), this.hint(FK.PARRY, '패링'), this.hint(AVK.CLR, '메뉴')) : null,
      h('div.v-col.ex-toasts', null, this.toasts.map((t) => h('div.ex-toast', { style: `opacity:${Math.min(1, (2.4 - t.t) * 2)}` }, t.text)))));
  }

  protected hint(key: number, label: string): VNode {
    return h('span.v-row.ex-hint', null, padBadge(this.ctx.input, key), h('span', null, label));
  }

  private drawBanner(): void {
    const enc = this.encounter!;
    this.ctx.ui.view('ex-banner', 0, 120, 480, 60, h(`div.v-fill.v-col.ex-banner.${enc.advantage}`, null,
      h('div.ex-banner-t', null, ADVANTAGE_LABEL[enc.advantage]),
      h('div.ex-banner-s', null, enc.enemies.map((e) => e.sp.name).join(' · '))));
  }

  private drawPause(): void {
    this.ctx.ui.view('ex-pause', 0, 0, 480, 320, h('div.v-fill.v-col.ex-modal', null,
      h('div.v-col.ex-menu', null,
        h('div.ex-menu-title', null, '일시 정지'),
        PAUSE_ITEMS.map((label, i) => h(`div.ex-item${i === this.pauseSel ? '.sel' : ''}`, { on: () => { this.pickPause(i); } }, label)))));
  }

  /** the touch stick and buttons (touch only) */
  private drawTouch(): void {
    const inp = this.ctx.input;
    if (inp.device !== 'touch') return;
    const hud = this.ctx.hud, e = inp.edge;
    if (this.mode === 'battle') {                                     // the defense buttons while an enemy attacks
      if (this.battle?.phase !== 'enemy') return;
      for (const b of TOUCH) if (b.key === FK.PARRY || b.key === FK.DODGE)
        hud.el(`ex-tbtn big${inp.isHeld(b.key) ? ' on' : ''}`, b.x + e - b.r - 6, b.y - b.r - 6, 2 * b.r + 12, 2 * b.r + 12, { key: `tb${b.key}`, text: b.label });
      return;
    }
    if (this.mode !== 'field') return;
    const { x, y, s } = ctrlAt('stick', inp.edge);
    hud.el('ex-stick', x - 30 * s, y - 30 * s, 60 * s, 60 * s);
    const d = Math.hypot(inp.stick.dx, inp.stick.dy), k = d > 22 * s ? (22 * s) / d : 1;
    hud.el('ex-knob', x - 11 * s + inp.stick.dx * k, y - 11 * s + inp.stick.dy * k, 22 * s, 22 * s);
    for (const b of TOUCH) {
      hud.el(`ex-tbtn${inp.isHeld(b.key) ? ' on' : ''}${b.key === FK.ACT && !this.field!.actHint() ? ' dim' : ''}`, b.x + e - b.r, b.y - b.r, 2 * b.r, 2 * b.r,
        { key: `tb${b.key}`, text: b.label });
    }
    hud.el('ex-tbtn menu', 444 + e, 4, 32, 22, { key: 'tbm', text: '메뉴' });
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('pointerdown', this.onPointer, true);
    this.view.dispose();
  }
}
