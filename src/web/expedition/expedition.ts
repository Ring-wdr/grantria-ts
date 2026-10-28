// 원정(가제) (not in the original): the standalone roguelike extra mode, drawn here.
// The state and keys are core/expedition; this draws them and steps them every animation frame (Scene.everyFrame):
// the 20 Hz tick only hands its presses over, each press carrying the time it happened (keyboard / pointer event
// time, a pad button the frame it was read) for the parry and dodge timing. Like the core side it stays apart from
// main play: no imports of the field game, combat, rules or saves (tests/boundary.test.ts).
// Touch: a fixed layout of this mode's own (the stick where 조작 배치 puts it, since Input reads it there; the action
// buttons on the right), not the main game's editable one.
// Growth and rewards (web/docs/expedition-balance.md): chests (cmf_oc 14..17), the rare creature's sparkle (cmf_status
// 0x5d..0x63, the original's ground-item sparkle), the dark merchant (the original's dark merchant actor 0x9E) and the
// day / night colour, the original's own palette shift rows and fade. Equipment shows the main game's item icons (sheets
// i0..i3) and grade colours, and a piece for a filled slot opens the comparison (before / after, 교체 or 버리기).
import { AVK } from '../input/input';
import type { GameContext } from '../game/scene';
import { h, padBadge, sprite, type VNode } from '../render/view';
import { KEYMAP } from '../input/bindings';
import { keyHint } from '../input/keyHints';
import { ctrlAt } from '../input/touchLayout';
import type { Cmf } from '../../core/data/assets';
import type { Drawable } from '../../core/render';
import { bodyBox } from '../../core/world/world';
import { ADVANTAGE_LABEL, CLOCK_SPEED, ExpeditionLogic, GEAR_CHOICES, NIGHT_AT, PAUSE_ITEMS } from '../../core/expedition/expedition';
import { CHEST_FRAME, GRADE_NAME, SLOT_NAME, gearDesc, gearIcon, type Gear } from '../../core/expedition/loot';
import { statsWith } from '../../core/expedition/run';
import { DEFAULT_EQUIP, setDayShift, type SpriteLayer } from '../render/sprites';
import { FK, type FieldEnemy, type Press } from '../../core/expedition/field';
import { SPECIES } from '../../core/expedition/species';
import { EXIT_MARKER, type Zone } from '../../core/expedition/zone';
import { WorldView } from './worldView';
import { BattleView } from './battleView';
import { HERO_EQUIP } from './heroLook';
import type { Battle } from '../../core/expedition/battle';
import './expedition.css';

/** the rare creature's sparkle: cmf_status frames SPARKLE..SPARKLE + 6 */
const SPARKLE = 0x5d;
/** the original's dark merchant actor (its sprite: actorTypes[id][0]) */
const MERCHANT_ACTOR = 0x9e;
/** the original's palette shift table (d.dat 0x26e0c, 3 signed bytes a row): (dr, dg, db) taken off every colour */
const TINT_TABLE = 0x26e0c;
/** sprites farther than this (px) outside the view are not drawn (the boss and the trees reach about this far) */
const CULL = 96;

/** a piece's 16×16 icon from the main game's item sheets (FUN_0003bc80: sheet i<icon/117>, nine to a row) */
function gearSprite(g: Gear): VNode {
  const i = gearIcon(g);
  return sprite(`i${Math.floor(i / 117)}`, (i % 9) * 16, Math.floor((i % 117) / 9) * 16, 16, 16, { cls: 'ex-icon' });
}

/** a piece's name in its grade colour */
function gearName(g: Gear): VNode { return h(`span.ex-ware-name.g${g.grade}`, null, `[${GRADE_NAME[g.grade]}] ${g.name}`); }

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

  /** this frame's day / night shift: the original's row (core ExpeditionLogic.tint) */
  protected tintShift(): [number, number, number] {
    const a = this.ctx.assets, o = TINT_TABLE + 3 * this.tint;
    return [a.s8(o), a.s8(o + 1), a.s8(o + 2)];
  }

  /** the dark merchant's sprite */
  private get merchantCmf(): string { return `cmf_c${this.ctx.assets.tables.actorTypes[MERCHANT_ACTOR][0]}`; }

  protected override async onZone(zone: Zone): Promise<void> {
    const names = ['cmf_c0', ...new Set(zone.spawns.map((s) => `cmf_c${SPECIES[s.species].cmf}`))];
    if (zone.kind === 'battle') names.push(this.merchantCmf);
    const [cmfs, status] = await Promise.all([Promise.all(names.map((n) => this.cmf(n))), this.cmf('cmf_status')]);
    await this.view.prepare(zone, this.sets!, names.map((name, i) => ({ name, cmf: cmfs[i], equip: name === 'cmf_c0' ? HERO_EQUIP : undefined })),
      [{ name: 'cmf_status', cmf: status, ids: Array.from({ length: 7 }, (_, i) => SPARKLE + i) }]);
  }

  /** the run log (web/docs/expedition-balance.md §12.1) to the console, for tuning */
  protected override onRunEnd(log: ExpeditionLogic['log']): void {
    console.info('[원정 기록]', JSON.stringify(log));
  }

  protected override onBattle(b: Battle): void {
    const names = [...new Set(b.units.filter((u) => u.sp).map((u) => `cmf_c${u.sp!.cmf}`)), 'cmf_status'];
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
      this.battleView.draw(this.battle, this.field, this.talk, this.tintShift());
      u.end();
      hud.begin();
      this.drawTouch();
      hud.end();
      return;
    }
    if (this.mode === 'over' || this.mode === 'clear') {
      this.ctx.compositor.clear();
      this.ctx.compositor.show();
      u.begin();
      u.view('ex-over', 0, 0, 480, 320, this.resultTree());
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
    if (this.mode === 'summary') this.drawSummary();
    if (this.mode === 'shop') this.drawShop();
    if (this.mode === 'gear') this.drawGear();
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
      : e.state === 'windup' ? { tint: [255, 60, 40] as [number, number, number], amount: Math.round(3 + 6 * Math.min(1, e.t / e.windupT)) }
      : e.stunned ? { tint: [255, 230, 90] as [number, number, number], amount: 8 } : undefined;
    return { cmfName: name, cmf, frame, x: Math.round(e.x), y: Math.round(e.y), mirror, shadow: true, fx };
  }

  /** the sparkles over a rare creature, over everything (it is seen behind trees too): three, a beat apart */
  private sparkles(V: SpriteLayer, x: number, y: number, t: number): void {
    const cmf = this.cmfs.get('cmf_status')!, z = this.zone?.map.header.zone ?? 3;
    for (const [dx, dy, k] of [[-8, -10, 0], [7, -22, 2], [2, -4, 4]]) V.frame('cmf_status', cmf, SPARKLE + (Math.floor(t * 10 + k) % 7), Math.round(x + dx), Math.round(y + dy), z, DEFAULT_EQUIP);
  }

  /** a point (map px) is near enough the view (and its fullscreen margins) to be drawn: a battle zone has dozens of
   *  creatures, chests and shots, and drawing the unseen ones made it far slower than a rest zone */
  private inView(x: number, y: number): boolean {
    const f = this.field!, pad = this.ctx.compositor.pad + CULL;
    return x > f.camX - pad && x < f.camX + 480 + pad && y > f.camY - CULL && y < f.camY + 320 + CULL;
  }

  private drawField(): void {
    const f = this.field!, ents: Drawable[] = [];
    for (const e of f.enemies) {
      if (!this.inView(e.x, e.y)) continue;
      const d = this.enemyDrawable(e);
      if (d) ents.push(d);
    }
    ents.push(this.heroDrawable());
    for (const c of f.chests) {                                       // a chest's top-left is 14 px up-left of its cell's centre
      if ((c.opened && c.t > 0.8) || !this.inView(c.x, c.y)) continue;
      ents.push({ cmfName: 'cmf_oc', cmf: this.sets!.oc, frame: CHEST_FRAME[c.kind], x: c.x - 14, y: c.y - 14, depth: c.y + 6,
        fx: c.opened ? { alpha: Math.max(0, Math.round(32 - c.t * 40)) } : undefined });
    }
    if (f.merchant && this.inView(f.merchant.x, f.merchant.y)) {
      const name = this.merchantCmf, cmf = this.cmfs.get(name)!, rec = cmf.anims[0];
      ents.push({ cmfName: name, cmf, frame: rec.frames[Math.floor(f.time * 6) % rec.n] ?? 0, x: f.merchant.x, y: f.merchant.y, shadow: true });
    }
    for (const s of f.shots) {
      if (!this.inView(s.x, s.y)) continue;
      const name = `cmf_c${s.owner.sp.cmf}`, { frame, mirror } = s.look();
      ents.push({ cmfName: name, cmf: this.cmfs.get(name)!, frame, x: Math.round(s.x), y: Math.round(s.y - s.shot.lift), mirror, depth: s.y,
        fx: s.reflected ? { tint: [120, 200, 255], amount: 14 } : undefined });
    }
    if (f.zone.kind !== 'boss' && this.sets && this.inView(f.zone.exit.x, f.zone.exit.y)) {   // the exit stone's blue light (20 fps loop)
      const x = f.zone.exit;
      ents.push({ cmfName: 'cmf_oc', cmf: this.sets.oc, frame: EXIT_MARKER + (Math.floor(f.time * 20) % 8), x: x.x + 26, y: x.y + 6, depth: x.y + 30 });
    }
    setDayShift(...this.tintShift());
    this.view.render(f.camX, f.camY, ents, undefined, (V) => { for (const e of f.enemies) if (e.rare && e.alive && this.inView(e.x, e.y)) this.sparkles(V, e.x, e.y, f.time); });
    setDayShift(0, 0, 0);
    this.ctx.compositor.show();
  }

  /** windup rings on the ground (under the screen UI, over the field) */
  private drawTelegraphs(): void {
    const f = this.field!, hud = this.ctx.hud, ox = Math.round(f.camX), oy = Math.round(f.camY);
    for (const e of f.enemies) {
      if (e.state !== 'windup' || e.removed) continue;
      const k = Math.min(1, e.t / e.windupT), r = e.radius + (e.pounce ? 60 : e.sp.tier === 'boss' ? 40 : 28);
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
    if (f.merchant) {                                                 // the merchant: a name over it, or an arrow on the edge
      const mx = f.merchant.x - ox, my = f.merchant.y - oy;
      if (mx > -10 && mx < 490 && my > -10 && my < 330) u.el('ex-npc', mx - 30, my - 52, 60, 12, { key: 'npc', text: '암흑상인' });
      else {
        const a = Math.atan2(my - 160, mx - 240), ex = Math.max(14, Math.min(466, 240 + Math.cos(a) * 400)), ey = Math.max(40, Math.min(306, 160 + Math.sin(a) * 400));
        u.el('ex-npc-arrow', ex - 8, ey - 8, 16, 16, { key: 'npca', text: '➤', vars: { '--a': `${a}rad` } });
      }
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
      h('div.v-col.ex-status', null,
        h('div.v-row.ex-zone', null, h('span', null, this.zoneName), this.zone?.kind === 'battle' ? h('span.ex-dim', null, `적 ${left}`) : null, h('span.ex-dim', null, `회복약 ${this.run.potions}`),
          h('span.ex-gold', null, `${this.run.gold}G`), this.inBattleZone ? this.clockTree() : null),
        this.run.party.map((m) => h('div.v-row.ex-mem', null, h('span.ex-mname', null, `${m.name} Lv.${m.lv}`),
          h('div.exb-bar.hp', null, h('div.exb-fill', { style: `width:${(100 * m.hp) / m.hpMax}%` })), h('span.ex-dim', null, `${m.hp}`)))),
      inp.device !== 'touch' ? h('div.v-row.ex-keys', null,
        this.hint(FK.LIGHT, '공격'), this.hint(FK.HEAVY, '강공격'), this.hint(FK.DODGE, '회피'), this.hint(FK.PARRY, '패링'), this.hint(AVK.CLR, '메뉴')) : null,
      h('div.v-col.ex-toasts', null, this.toasts.map((t) => h('div.ex-toast', { style: `opacity:${Math.min(1, (2.4 - t.t) * 2)}` }, t.text)))));
  }

  protected hint(key: number, label: string): VNode {
    return h('span.v-row.ex-hint', null, padBadge(this.ctx.input, key), h('span', null, label));
  }

  /** the battle zone's clock: day, dusk or night, and the real time to nightfall */
  private clockTree(): VNode {
    const ph = this.dayPhase, left = Math.max(0, Math.ceil((NIGHT_AT - this.clock) / CLOCK_SPEED)), mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
    return h(`span.ex-clock.${ph}`, null, ph === 'night' ? '☾ 밤' : `${ph === 'dusk' ? '◐ 해질녘' : '☀ 낮'} ${mm}:${ss}`);
  }

  /** a battle zone left: what it gave and the heal (then on to the next zone) */
  private drawSummary(): void {
    this.ctx.ui.view('ex-summary', 0, 0, 480, 320, h('div.v-fill.v-col.ex-modal', null,
      h('div.v-col.ex-menu.ex-result', null,
        h('div.ex-menu-title', null, this.summary[0]),
        this.summary.slice(1).map((l) => h('div.ex-line', null, l)),
        h('div.v-row.ex-item.sel.ex-go', { on: () => { this.nextZone(); } }, padBadge(this.ctx.input, AVK.OK), `다음: ${this.nextName()}`))));
  }

  /** the dark merchant: its four slots and 떠나기 */
  private drawShop(): void {
    const rows = this.stock.map((w, i) => {
      const g = w.gear, cls = `div.v-col.ex-item.ex-ware${i === this.shopSel ? '.sel' : ''}${w.sold || this.run.gold < w.price ? '.off' : ''}`;
      const worn = g ? this.run.equip[g.slot] : null;
      return h(cls, { on: () => { this.buy(i); } },
        h('div.v-row.ex-ware-top', null, g ? gearSprite(g) : null, g ? gearName(g) : h('span.ex-ware-name', null, `회복약 (남은 ${w.n})`),
          h('span.ex-ware-price', null, w.sold ? '매진' : `${w.price}G`)),
        h('span.ex-ware-desc', null, g ? `${SLOT_NAME[g.slot]} · ${gearDesc(g)}` : '한 명의 HP 40% 회복'),
        g ? h('span.ex-ware-desc.ex-dim', null, worn ? `착용 중: ${worn.name} (${gearDesc(worn)})` : '이 부위는 비어 있다') : null);
    });
    this.ctx.ui.view('ex-shop', 0, 0, 480, 320, h('div.v-fill.v-col.ex-modal', null,
      h('div.v-col.ex-menu.ex-shop', null,
        h('div.v-row.ex-menu-title', null, h('span.v-grow', null, '암흑상인'), h('span.ex-gold', null, `${this.run.gold}G`)),
        ...rows,
        h(`div.ex-item${this.shopSel >= this.stock.length ? '.sel' : ''}`, { on: () => { this.closeShop(); } }, '떠나기'),
        h('div.ex-line.ex-dim', null, this.shopLine))));
  }

  /** a piece for a filled slot: the worn one and the new one side by side, the hero's stats before and after, 교체 / 버리기 */
  private drawGear(): void {
    const o = this.offers[0];
    if (!o) return;
    const g = o.gear, worn = this.run.equip[g.slot], hero = this.run.party[0];
    const now = statsWith(hero, this.run.gearStats()), then = statsWith(hero, this.run.gearStats(g));
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const rows: [string, number, number, (v: number) => string][] = [
      ['공격', now.atk, then.atk, String], ['속도', now.spd, then.spd, String], ['최대 HP', now.hpMax, then.hpMax, String],
      ['받는 피해 감소', this.run.guard, this.run.guardWith(g), pct],
    ];
    const piece = (label: string, x: Gear | null) => h('div.v-col.ex-gear-piece', null, h('div.ex-dim', null, label),
      x ? h('div.v-row.ex-ware-top', null, gearSprite(x), gearName(x)) : h('div.ex-ware-name', null, '없음'),
      h('span.ex-ware-desc', null, x ? gearDesc(x) : ''));
    this.ctx.ui.view('ex-gear', 0, 0, 480, 320, h('div.v-fill.v-col.ex-modal', null,
      h('div.v-col.ex-menu.ex-gear', null,
        h('div.v-row.ex-menu-title', null, h('span.v-grow', null, `${SLOT_NAME[g.slot]} 비교`), h('span.ex-dim', null, `얻은 곳: ${o.from} · 남은 ${this.offers.length}`)),
        h('div.v-row.ex-gear-pair', null, piece('착용 중', worn), h('div.ex-gear-arrow', null, '→'), piece('새 장비', g)),
        h('div.v-col.ex-gear-stats', null, h('div.ex-dim', null, `${hero.name} 기준 (파티 전원에게 같은 효과)`),
          rows.map(([label, a, b, f]) => h('div.v-row.ex-gear-row', null, h('span.v-grow', null, label), h('span', null, f(a)), h('span.ex-dim', null, '→'),
            h(`span.ex-gear-new${b > a ? '.up' : b < a ? '.down' : ''}`, null, f(b))))),
        GEAR_CHOICES.map((label, i) => h(`div.ex-item${i === this.gearSel ? '.sel' : ''}`, { on: () => { this.chooseGear(i === 0); } },
          i === 0 ? `${label} (${worn?.name ?? '착용 중인 장비'}은(는) 버린다)` : `${label} (${g.name}을(를) 두고 간다)`)))));
  }

  private nextName(): string {
    const k = this.plan[this.step + 1];
    return k === 'rest' ? '쉼터' : k === 'boss' ? '깊숙한 곳' : '초원';
  }

  /** the run's end: cleared or wiped out */
  private resultTree(): VNode {
    const r = this.run, clear = this.mode === 'clear';
    return h('div.v-fill.v-col.ex-screen', null,
      h('div.ex-title', null, clear ? '1스테이지 돌파!' : '원정 실패'),
      h('div.ex-sub', null, clear ? '초원의 왕을 쓰러뜨렸다. (이후 스테이지는 준비 중)' : '파티가 쓰러졌다. 원정은 여기서 끝난다.'),
      h('div.v-col.ex-stats', null,
        h('div', null, `돌파한 지역 ${r.cleared} / 3`), h('div', null, `쓰러뜨린 적 ${r.kills}`), h('div', null, `패링 ${r.parries}회`), h('div', null, `영입 ${r.recruits}`),
        h('div', null, `골드 ${r.gold}G · 장비 ${r.equip.filter(Boolean).length} / ${r.equip.length}`),
        r.party.map((m) => h('div.ex-dim', null, `${m.shiny ? '빛나는 ' : ''}${m.name} Lv.${m.lv}`))),
      h('div.v-row.ex-item.sel.ex-go', { on: () => [AVK.OK] }, padBadge(this.ctx.input, AVK.OK), '타이틀로'));
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
        PAUSE_ITEMS.map((label, i) => h(`div.ex-item${i === this.pauseSel ? '.sel' : ''}`, { on: () => { this.pickPause(i); } }, label)),
        h('div.ex-line.ex-dim', null, `골드 ${this.run.gold}G · 회복약 ${this.run.potions}`),
        this.run.equip.map((g, i) => h('div.v-col.ex-relic', null,
          h('div.v-row.ex-ware-top', null, h('span.ex-slot', null, SLOT_NAME[i]), g ? gearSprite(g) : null, g ? gearName(g) : h('span.ex-ware-name.ex-dim', null, '없음')),
          g ? h('span.ex-ware-desc', null, gearDesc(g)) : null)))));
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
