// Field play on the web: FieldGame (core/field/fieldGame.ts) drawn with the WebGL field renderer, the world-space
// effects layer and the HTML HUD, minimap, dialogue and popup layers.
import type { Cmf } from '../../core/data/assets';
import { FieldGame, WarpList, type FortuneShown } from '../../core/field/fieldGame';
import { clockFrame, buffItem, tintRow } from '../../core/rules/buffs';
import { FORTUNE_CMF, type FortuneArt } from '../../core/rules/fortune';
import { untrackKey } from '../../core/rules/quests';
import { fxScale, optionFps } from '../../core/save/options';
import type { ItemDb } from '../../core/rules/items';
import { groundDrawables } from '../../core/rules/drops';
import { Boss } from '../../core/combat/boss';
import type { EvActor } from '../../core/world/actors';
import type { Overlay } from '../../core/ui/overlays';
import type { Popup } from '../../core/ui/popup';
import { MAX_LEVEL, expNeed } from '../../core/rules/rules';
import type { SaveData } from '../../core/save/save';
import { DEFAULT_EQUIP, setDayShift, setGrey, type SpriteLayer } from '../render/sprites';
import { Field, VIEW_H, VIEW_W, type Drawable } from '../render/field';
import { Minimap } from '../render/minimap';
import { GlUi } from '../render/ui';
import { button, gt, win } from '../render/view';
import type { DomUi } from '../render/domUi';
import { AVK } from '../input/input';
import { fortuneAskView, fortuneResultView } from './fortune';
import { drawGatherGauge } from './gather';
import { drawDialogue, drawDialogueButtons } from './dialogue';
import { drawEventOverlay } from './eventOverlay';
import { popupPaint } from './popup';
import { FIELD_ZONES, FieldHud, type HudState } from './fieldHud';
import type { GameContext, Scene } from './scene';

/** FUN_00032800 32218: every actor in slots 0..40 gets a shadow except type 0x13 */
const NO_SHADOW = 0x13;

export class FieldScene extends FieldGame implements Scene {
  declare readonly ctx: GameContext;
  declare readonly field: Field;
  /** world-space effects (aura, quest marks, status icons, balloons) drawn with WebGL on the tick */
  readonly ui: GlUi;
  /** HUD, minimap, dialogue and event overlays (HTML layer) */
  readonly hudUi: DomUi;
  /** the HUD view (status bar, touch buttons, combat text) */
  hudView!: FieldHud;
  /** field minimap (option 미니맵) */
  private minimap: Minimap | null = null;
  /** the fortune teller's portrait cmf once loaded; its frame counter advances once per popup draw (one tick), frame % 6 */
  private fortuneCmf: Cmf | null = null;
  private fortuneFrame = 0;

  private constructor(ctx: GameContext, save: SaveData, playerCmf: Cmf, db: ItemDb) {
    super(ctx, save, playerCmf, db, new Field(ctx.assets, ctx.compositor));
    this.ui = new GlUi(ctx.assets, ctx.compositor);
    this.hudUi = ctx.hud;
  }

  static async create(ctx: GameContext, save: SaveData, lap = 0, sandbox: FieldScene['sandbox'] = null): Promise<FieldScene> {
    const db = await FieldGame.itemDb(ctx.assets, lap);
    const s = new FieldScene(ctx, save, await ctx.assets.cmf(`cmf_c${save.cls}`), db);
    await s.ui.init(FieldHud.images);
    ctx.input.zones = FIELD_ZONES;
    ctx.input.confirmZones = FIELD_ZONES.filter((z) => z.key === AVK.OK);
    await s.start(save, lap, sandbox);
    s.hudView = new FieldHud(s.hudUi, s.statusCmf, ctx.input, s.hud);
    return s;
  }

  protected override viewPad(): number { return this.ctx.compositor.pad; }

  protected override mapLoaded(): void {
    this.minimap ??= new Minimap(this.ctx.assets);
    this.minimap.build(this.field.map, this.field.kind0Markers());
  }

  protected override fortuneAsk(p: Popup): void {
    // FUN_00051edc(0x54) loads the portrait actor (어둠의 상인, cmf c72) when the popup opens
    void this.ctx.assets.cmf(FORTUNE_CMF).then((c) => { this.fortuneCmf = c; });
    void this.ctx.ui13.preload(['c72', 'shadow']);
    p.content = () => fortuneAskView(this.db.a.text, this.fortuneArt());
  }

  protected override fortuneResult(p: Popup, f: FortuneShown): void {
    p.content = () => fortuneResultView(this.db.a.text, f.res, f.item, this.fortuneArt(), f.held);
  }

  /** the portrait for the fortune popups, null until its cmf is in */
  private fortuneArt(): FortuneArt | null {
    return this.fortuneCmf ? { cmf: this.fortuneCmf, frame: this.fortuneFrame++ } : null;
  }

  /** free the GPU side of this play: map target and buffers, the WebGL UI layer, the minimap texture.
   *  Without it every dimension exit (a reload into a new scene) left thousands of buffers behind until
   *  the WebGL context ran out and the field went white. */
  dispose(): void {
    this.field.dispose();
    this.ui.dispose();
    this.minimap?.dispose();
  }

  /** FUN_0002f184 id 0x102, the event light (events 9 / 19 / 29): c.pxl frame 0x13 at (x, y + 8) (the sin / cos bob
   *  is 22 * table(1024) >> 16, under a pixel), alpha pulsing over a 12..49 counter */
  private lightDrawable(a: EvActor): Drawable | null {
    if (!a.visible || a.alpha <= 0) return null;
    const dd = (i: number) => this.ctx.assets.dd(0x400de3, 0x13 * 4 + i);
    const k = 12 + this.tick % 38, alpha = Math.min(a.alpha, k > 31 ? 32 - (k & 31) : k);
    return { cmfName: '', frame: 0, x: a.x, y: a.y + 8, depth: a.y, img: { name: 'c', sx: dd(0), sy: dd(1), w: dd(2), h: dd(3) }, fx: { alpha } };
  }

  /** FUN_0002a908: 11 rows, registered ones white (the cursor row yellow), the rest grey */
  private drawWarpList(w: WarpList): void {
    const u = this.ctx.ui13;
    u.begin();
    u.pushCenter220();
    u.view('warps', 20, 8, 180, 204, win('.v-col.v-fill.v-center', { style: 'gap:2px;padding:6px 10px' },
      w.rows.map((row, i) => {
        const on = this.story.stones.has(row);
        return button(gt(this.stoneName(row), { pen: !on ? 0xc618 : i === w.cur ? 0xffe0 : 0xffff }), {
          sel: i === w.cur, style: 'width:100%;min-height:16px',
          on: () => { if (w.cur === i) return [AVK.OK]; w.cur = i; },
        });
      })));
    u.pop();
    u.closeButton();
    u.end();
  }

  /** lit warp stone (oc 36) over the static grey one once registered */
  /** warp stone objects (gimmicks.md §4.1 그리기): oc 36 lit or oc 35, one sprite each; rows 0..2 not before their flag */
  private stoneDrawables(): Drawable[] {
    const map = this.field.mapId, st = this.story, ev = this.events;
    const need = map === 2 ? 63 : map === 0x3b || map === 0x3c ? 72 : map === 0x6b ? 143 : -1;
    if (need >= 0 && !st.isDone(need)) return [];
    let lit: boolean;
    if (!ev.active) {
      const row = this.stoneRow();
      lit = need < 0 && this.stone(row).map === map && st.stones.has(row) && ![0x70, 0x71, 0x73].includes(map);
    } else {
      const id = ev.id, clock = ev.progress;
      lit = map === 0x45 ? id === 0x48 || id === 0x13 : map === 0x26 ? id === 0x3f || id === 9
        : map === 0x50 ? (id === 0x1d && clock >= 240) || id === 0x8f : map === 0x9b ? (id === 0x7b ? clock >= 0x72 : st.isDone(0x7b)) : false;
    }
    return this.field.stoneObjs().map((o) => ({ cmfName: 'cmf_oc', cmf: this.field.oc, frame: lit ? 36 : 35, x: o.x, y: o.y, depth: -1 }));   // objLow floor: under every actor
  }

  /** FUN_00025a88 data: the target while alive (type < 43); the ghost bar shrinks 1 px per 2 ticks to the HP width */
  private targetView(): HudState['target'] {
    const m = this.panelTarget;
    if (this.events.active || !m || !m.alive || m.hp <= 0 || m.maxHp <= 0 || m.type >= 43) return null;
    let ghost = -1;
    const g = this.ghost;
    if (g && g.m === m) {
      const w = Math.trunc((g.old * 60) / m.maxHp) - (g.n >> 1), cur = Math.trunc((m.hp * 60) / m.maxHp);
      if (w > cur) ghost = w; else this.ghost = null;
    }
    return { name: this.db.a.text[0x3e1 + m.type] ?? '', level: m.level, hp: m.hp, maxHp: m.maxHp, ghost };
  }

  /** 편의 설정 HUD 정보 (not in the original): what fieldHud.extraInfo shows; display only */
  private hudExtra(): HudState['extra'] {
    const o = this.ctx.options, a = this.db.a, plain = (s: string) => s.replace(/\|./g, '');
    const lo = expNeed(this.model.level - 1), hi = expNeed(this.model.level);
    const fps = optionFps(o);
    let boss: { name: string; hp: number; maxHp: number } | null = null;
    if (o.hudBoss) {
      const p = this.player;
      // 35 / 39: the role-0 object is the one that takes hits (퀸 프로스트웜 part A, 마더 main body), not the drawn main body
      const b = this.monsters.find((m) => m.isBoss && m.alive && m.hp > 0 && m.maxHp > 0 && !(m instanceof Boss && m.noReward) && Math.hypot(m.x - p.x, m.y - p.y) < 360);
      if (b) boss = { name: plain(a.text[0x3e1 + b.type] ?? ''), hp: b.hp, maxHp: b.maxHp };
    }
    return {
      numbers: o.hudNumbers ? { expPct: this.model.level >= MAX_LEVEL ? 100 : Math.max(0, Math.min(100, ((this.vitals.exp - lo) * 100) / Math.max(1, hi - lo))) } : undefined,
      buffs: o.hudBuffs ? this.buffs.active(a).map(({ slot, left }) => {
        const [t, sub] = buffItem(slot);
        return { icon: this.db.iconRect(this.db.icon(t, sub)), secs: left < 0 ? -1 : Math.ceil(left / fps) };
      }) : undefined,
      boss,
      quests: o.hudQuests ? this.story.active.filter((q) => !this.story.counters[untrackKey(q.q)]).slice(0, 3).map((q) => {   // 추적 끔 (quest detail) left out
        const Q = this.sdb.quests[q.q], st = this.story.qs[q.q];
        let progress = '';
        if (Q.kind === 1) progress = `${q.cnt}/${this.sdb.killCond(Q)[1]}`;
        else if (Q.kind === 0) { const c = this.sdb.collectCond(Q); if (c.type !== 0x1c) progress = `${Math.min(q.cnt, c.count)}/${c.count}`; }
        return { name: plain(this.quests.name(q.q)), progress, done: st === 3 && Q.kind <= 1, main: this.sdb.mainQuest(q.q) };
      }) : undefined,
      minimap: !!o.minimap,
    };
  }

  /** effect bank frame (d+0x20cd6 / 0x1c1b8, Ui.effect) drawn into the field layer at world (x, y) */
  private layerEffect(V: SpriteLayer, id: number, x: number, y: number): void {
    const a = this.db.a, first = a.d16(0x20cd6 + id * 4), n = a.d16(0x20cd6 + id * 4 + 2);
    for (let i = first; i < first + n; i++) {
      const o = 0x1c1b8 + i * 10, clip = a.d8(o), sdx = (a.d16(o + 2) << 16) >> 16, sdy = (a.d16(o + 4) << 16) >> 16;
      const flags = a.d16(o + 6) | (a.d16(o + 8) << 8), c = 0x24b96 + clip * 4;    // +8: blend mode and alpha (Ui.effect)
      const img = clip <= 0x46 ? 'ec' : clip <= 0x68 ? 'c' : clip <= 0x6c ? 'oc' : 't';
      const w = a.d8(c + 2), h = a.d8(c + 3);
      if (w > 0 && h > 0) V.quad(img, a.d8(c), a.d8(c + 1), w, h, x + sdx, y + sdy, (flags >> 2) & 3, flags & 1, ((flags >> 4) & 15) + 1, (flags >> 8) & 31, 8 - ((flags >> 13) & 7));
    }
  }

  /** status icons over poisoned / slowed objects (FUN_000324e4: cmf_status frame 6·i + t % 6) */
  private drawStatus(ox: number, oy: number): void {
    // FUN_000324e4: icon 6i + (that timer % 6) at the foot origin; the stun icon at y − k·h (k by type)
    const icon = (i: number, timer: number, x: number, y: number) => this.ui.frame('cmf_status', this.statusCmf, 6 * i + (timer % 6), x - ox, y - oy, 'es');
    if (!this.events.active) for (const m of this.monsters) {
      if (!m.alive) continue;
      const timers = [m.slow, m.dark, m.poison, m.stun, m.burn, m.chill];
      timers.forEach((v, i) => {
        if (v <= 0) return;
        if (i !== 3) { icon(i, v, m.x, m.y); return; }
        const b = m.body(), h = b ? b[3] - b[1] : 30;
        const k = [16, 33, 37].includes(m.type) ? 4 : [6, 9, 10].includes(m.type) ? 1 : m.type === 8 ? 0.5 : 2;
        icon(3, v, m.x, m.y - Math.trunc(k * h));
      });
    }
    if (this.player.slowT > 0) icon(0, this.player.slowT, this.player.x, this.player.y);
    if (this.poison > 0) icon(2, this.poison, this.player.x, this.player.y);
  }

  /** Render the field into the compositor target (UI passes and show() are done by the caller). */
  draw(): void {
    if (this.busy) return;
    const { field, player, vitals, model, stats } = this;
    // insertion order = descending actor index, the player (index 0) last
    const ents: Drawable[] = [];
    const ev = this.events.active;
    for (const a of this.actors.slice().reverse()) {
      const d = a.id === 0x102 ? this.lightDrawable(a) : a.drawable();
      if (!d) continue;
      if (this.partHide === 0x22c && a.id === 0x2c) d.hideClips = [0x11, 0x02];
      d.shadow = a.id !== NO_SHADOW && a.id !== 0x102;
      ents.push(d);
    }
    for (const g of this.gimmicks) ents.push(...g.drawables(field.oc));
    for (const n of this.nodes) ents.push(...n.drawables(field, this.statusCmf, this.tick, this.run));
    ents.push(...this.stoneDrawables());
    // events hide normal monsters (except 0x66 / 0x56 / 0x4f / 0x50); bosses are hidden by beginEvent until the script shows them
    for (const m of this.monsters.slice().reverse()) { if (ev && !m.isBoss && !this.events.keepsMonsters) continue; const d = m.drawable(); if (d) { d.shadow = m.type !== NO_SHADOW; ents.push(d); } }
    for (const it of this.eventItems) {                            // FUN_0002f184 id 200: the icon at (x-6, y-6), no sparkle
      const r = this.db.iconRect(this.db.icon(it.cat, it.sub));
      ents.push({ cmfName: '', frame: 0, x: it.x - 6, y: it.y - 6, depth: it.y, img: { name: r.image, sx: r.sx, sy: r.sy, w: 16, h: 16 } });
    }
    for (const g of this.ground) ents.push(...groundDrawables(g, this.db, this.statusCmf, !!this.ctx.options.effects, this.dead));
    for (const p of this.projectiles) ents.push(p.drawable());
    if (!ev) for (const s of this.shots) ents.push(s.drawable());
    const pd = player.drawable();
    // hit tint 12, 8, 4, 0 and off on ticks where (invuln & 2) (combat.md §5.2)
    if (vitals.tint && !(vitals.invuln & 2)) pd.fx = { tint: [255, 0, 0], amount: Math.max(0, vitals.tint * 4 - 8) };
    else if (this.poison > 0 && (this.poison >> 2) & 1) pd.fx = { tint: [0, 0x66, 0], amount: 24 };
    if (this.warpT > 9) pd.fx = { ...pd.fx, alpha: Math.max(0, (13 - this.warpT) * 6) };
    if (this.lead) { const d = this.lead.drawable(); if (d) { d.shadow = this.lead.id !== NO_SHADOW; ents.push(d); } } else { pd.shadow = true; ents.push(pd); }
    const originX = field.width < VIEW_W ? (VIEW_W - field.width) >> 1 : 0;
    const shakeK = fxScale(this.ctx.options.shake);                     // 편의 설정: shake reduced / off
    const [sx0, sy0] = this.shake[0] ?? [0, 0];
    const sx = Math.round(sx0 * shakeK), sy = Math.round(sy0 * shakeK) + this.events.shakeY;
    if (this.events.grey) setGrey(1);
    const [tr, tg, tb] = tintRow(this.db.a, this.tintIndex());
    setDayShift(tr, tg, tb);
    const camX = this.cam.x - originX - sx, camY = this.cam.y - sy;
    // under objTop, in this order (FUN_0003357c): FUN_00024b80 warp / arrival frames and the gate banner with its zoom,
    // then FUN_000250e8 the buff aura above every actor and effect
    if (!(ev && this.events.holdFrame)) field.render(camX, camY, ents, ev ? undefined : (V) => {
      const st = (f: number) => V.frame('cmf_status', this.statusCmf, f, player.x, player.y - 90, 0, DEFAULT_EQUIP);
      if (this.warpT >= 0) st(0x34 + (this.warpT >> 1));
      if (this.arriveT >= 0) st(0x34 + (this.arriveT >> 1));
      if (this.bannerT >= 0) {                                        // case 8: image t (0x80, 0x60) 83×25 at the view centre
        const t = this.bannerT >> 1;
        if (t < 6) V.quad('t', 0x80, 0x60 + t, 83, 4, camX + 240 - 41, camY + 160 - 12 + t);
        else {
          V.quad('t', 0x80, 0x60, 83, 25, camX + 240 - 41, camY + 160 - 12);
          if (t & 1) { const p = this.ctx.compositor.pad; V.zoom(camX - p, camY, VIEW_W + 2 * p, VIEW_H, 0x116); }         // FUN_0007ac0c: ×278/256 pulse on odd steps
        }
      }
      const af = this.buffs.auraFrame();
      if (af >= 0) this.layerEffect(V, af, player.x + (player.dir & 1 ? 2 : -2), player.y + 15 - 8);
    });
    if (ev && (this.events.screenFxOn || this.events.holdFrame)) this.ctx.compositor.filter565((b, w, h) => this.events.screenFx(b, w, h));
    setDayShift(0, 0, 0);
    if (this.events.grey) setGrey(0);           // the filter is applied before the dialogue
    this.ui.bleed = this.ctx.compositor.pad;                       // balloons, marks and effects reach the fullscreen margins too
    this.ui.begin();
    const hud = this.hudUi;
    hud.begin();
    if (ev) {
      this.drawBalloons(originX);
      this.ui.end();
      drawEventOverlay(hud, this.events, this);
      if (this.ctx.input.confirm) this.hudView.confirmControls();
      this.drawPopup();
      return;
    }
    const ox = this.cam.x - originX - sx, oy = this.cam.y - sy;
    this.drawQuestMarks(ox, oy);
    this.drawStatus(ox, oy);
    if (this.run) drawGatherGauge(this.ui, this.run, this.run.node.x - ox, this.run.node.y - oy);
    for (const f of this.gatherFx) {                                  // FUN_00030734 spark (alpha 32), FUN_00029604 star (alpha 16, counters 1..7)
      if (f.kind === 'spark') { this.ui.effect(f.t - 1, f.x - ox, f.y - oy); continue; }
      if (f.t >= 8) continue;
      this.ui.alpha = 16; this.ui.effect(0xa7 + (f.t % 4), f.x - ox, f.y - oy); this.ui.alpha = 32;
    }
    if (!this.events.active) for (const f of this.sparks) {           // FUN_00030734 (owner 0): bank frame t - 1 + d8(0x23632 + set)
      const base = this.db.a.d8(0x23632 + f.set), cx = (VIEW_W >> 1) + this.cam.x - ox, cy = (VIEW_H >> 1) + this.cam.y - oy;
      if (!f.hidden) this.ui.effect(f.t - 1 + base, f.x - ox, f.y - oy);
      // set 1: the rim over the whole screen. Touch mode (DAT_003b3b48, always on Android) on a screen not 320 wide draws
      // frames 12 / 13 / 14, whose lines sit on the 480 px edges; 6 / 7 / 8 (no touch) and 9..11 (320 wide) gather
      // around the centre. Fullscreen (편의 설정): the side bands move out by the margin to the screen edges
      const k = base - 1 + f.t, pad = this.ctx.compositor.pad;
      if (k === 15) { this.ui.alpha = 16; this.ui.effect(12, cx, cy, pad); }
      else if (k === 16) { this.ui.alpha = 8; this.ui.effect(13, cx, cy, pad); }
      else if (k === 17) this.ui.effect(14, cx, cy, pad);
      this.ui.alpha = 32;
    }
    const gd = this.guide;
    if (gd && (gd.x >= 0 || gd.y >= 0) && !this.events.active) {    // FUN_000331e8: t.pxl 35×49 (211, 70), alpha and bob by frame & 31
      let u = this.tick & 0x1f;
      if (u > 16) u = 32 - u;
      this.ui.alpha = u << 1;
      if (gd.variant === 0) this.ui.image('t', 211, 70, 35, 49, gd.x - ox, gd.y - oy + (u >> 1));
      else if (gd.variant === 1) this.ui.image('t', 211, 70, 35, 49, gd.x - ox + (u >> 1), gd.y - oy, 0xc);   // turned 270°
      this.ui.alpha = 32;
    }
    for (const f of this.useFxs) {                                    // FUN_00029604: frame id + t, alpha 24 then 36 - 3t, hidden from t 8
      if (f.t >= 8) continue;
      this.ui.alpha = f.t < 5 ? 24 : 36 - 3 * f.t;
      this.ui.effect(f.id + f.t, f.x + this.cam.x - ox, f.y + this.cam.y - oy);
    }
    this.ui.alpha = 32;
    this.ui.end();
    if (this.ctx.options.minimap && !this.talk && !this.dead && this.showButtons)   // FUN_00022228 in state 0x10
      this.minimap?.draw(hud, player.x, player.y, [
        ...this.monsters.filter((m) => m.alive).map((m) => ({ x: m.x, y: m.y, monster: true })),
        // objects in slots 3..40 that are not monsters (type >= 43): actors created by the event (SPAWN_TYPE)
        ...this.actors.filter((a) => a.spawned && a.visible && a.id >= 43).map((a) => ({ x: a.x, y: a.y, monster: false })),
        ...(this.ctx.options.minimapIcons ? this.minimapMarks() : []),
      ]);
    this.hudView.draw({
      clock: clockFrame(this.dayCounter, this.dayPh),
      cls: model.cls, level: model.level, hp: vitals.hp, maxHp: stats.maxHp, mp: vitals.mp, maxMp: stats.maxMp,
      exp: vitals.exp, statPoints: this.statPoints, skillPoints: this.skillPoints, mapId: field.mapId,
      dimGate: this.gardenMode !== 0 || !this.canSave,
      slots: this.inv.quick.map((q) => {
        // 쿨다운 숫자: cooldowns count field ticks, so the seconds follow the speed option
        const fps = optionFps(this.ctx.options), secs = this.ctx.options.hudCooldown && q.cd >= fps ? Math.ceil(q.cd / fps) : 0;
        if (q.kind === 1) return { skill: q.id, cd: q.cd, maxCd: q.maxCd, noMp: this.vitals.mp < this.skillCost(q.id), secs };
        const it = q.kind === 2 ? this.inv.items[q.id] : undefined;
        if (!it) return null;
        return { icon: this.db.iconRect(it.icon), count: this.db.showsCount(it) ? it.count : -1, cd: q.cd, maxCd: it.type === 0x11 && it.sub >= 14 ? 900 : 100, secs };
      }),
      target: this.targetView(),
      hits: this.events.active ? undefined : this.hits,
      extra: this.hudExtra(),
      nextEvent: this.pendingEvent ? 200 - this.pendingEvent.t : 0,
    }, this.cam.x - originX - sx, this.cam.y - sy, this.showButtons && !this.dead && !this.talk && !this.ctx.input.confirm);
    if (this.ctx.input.confirm) this.hudView.confirmControls();
    const flashA = Math.round(Math.min(32, this.flash * 4) * fxScale(this.ctx.options.flash));
    if (flashA > 0) { hud.alpha = flashA; hud.fill(0, 0, VIEW_W, VIEW_H, 0xffffff); hud.alpha = 32; }
    if (this.talk) {
      hud.hit(0, 0, VIEW_W, VIEW_H, () => [AVK.OK]);
      drawDialogue(hud, this.talk.d, this.tick);
      drawDialogueButtons(hud, !!this.ctx.options.auto, this.ctx.input);
    }
    this.drawPopup();
  }

  /** 편의 설정 미니맵 아이콘 (not in the original): NPCs with a quest mark and this map's warp stone */
  private minimapMarks(): { x: number; y: number; monster: false; mark: 'take' | 'report' | 'busy' | 'stone' }[] {
    const out: { x: number; y: number; monster: false; mark: 'take' | 'report' | 'busy' | 'stone' }[] = [];
    for (const a of this.actors) {
      if (!a.visible || a.id < 43) continue;
      const { mark } = this.quests.marker(a.id);
      if (mark === 1 || mark === 2 || mark === 3) out.push({ x: a.x, y: a.y, monster: false, mark: mark === 1 ? 'take' : mark === 3 ? 'report' : 'busy' });
    }
    const r = this.stone(this.stoneRow());
    if (r.map === this.field.mapId && (r.flag === -1 || this.story.isDone(r.flag))) out.push({ x: r.x0 + 25, y: r.y0 + 25, monster: false, mark: 'stone' });
    return out;
  }

  /** quest marks over NPCs (end of FUN_00030cec): 1 yellow ?, 2 grey !, 3 orange !, bobbing, alpha 24 */
  private drawQuestMarks(ox: number, oy: number): void {
    const u = this.ui, bob = (this.tick % 6) >> 1;
    for (const a of this.actors) {
      if (!a.visible || a.id < 43) continue;
      const { mark } = this.quests.marker(a.id);
      if (!mark || mark === 5) continue;
      const bb = a.rect();
      const x = a.x - 4 - ox + (a.dir & 1 ? 2 : -2) - 2, y = bb[1] + 4 - oy + bob - 0x36;   // y + body dy
      u.alpha = 24;
      if (mark === 2) u.image('c', 0xf1, 1, 9, 19, x, y);
      else if (mark === 3) u.image('c', 0x79, 0, 9, 19, x, y);
      else if (mark === 1) u.image('c', 0xe7, 3, 10, 15, x, y);
      u.alpha = 32;
    }
  }

  private drawPopup(): void {
    if (!this.overlays.size) return;
    this.ctx.ui13.begin();
    this.overlays.draw(this.paintOverlay);
    this.ctx.ui13.end();
  }

  /** the field's model overlays: popups and the warp stone list */
  private readonly paintOverlay = (o: Overlay): void => {
    if (o.model instanceof WarpList) this.drawWarpList(o.model);
    else popupPaint(this.ctx)(o);
  };

  /** BALLOON n above actors: effect bank frames (events.md §0.3) */
  private drawBalloons(originX: number): void {
    const FIRST = [0x15, 0x1b, 0x22, 0x35, 0x3c, 0x28, 0x2e, 0x43, 0x4a, 0x53, 0x5c, 99];
    const COUNT = [4, 5, 4, 5, 5, 4, 5, 5, 7, 7, 5, 5];
    for (const a of [this.lead, ...this.actors]) {
      if (!a || !a.visible || a.balloon < 1 || a.balloon > 12) continue;
      const n = a.balloon - 1, loop = n > 4 ? 3 : 2;
      let k = a.balloonT;
      if (k >= COUNT[n]) k = loop + ((k - COUNT[n]) % Math.max(1, COUNT[n] - loop));
      this.ui.effect(FIRST[n] + k, a.x - this.cam.x + originX, a.rect()[1] - 16 - this.cam.y);
    }
  }

  debugLine(): string {
    const { field, model, vitals, stats, player } = this;
    return `m${String(field.mapId).padStart(3, '0')} ${field.name}  ·  Lv ${model.level} HP ${vitals.hp}/${stats.maxHp} ATK ${stats.atk} DEF ${stats.def} EXP ${vitals.exp} G ${this.inv.gold}  ·  `
      + `${this.events.debug()} (${player.x}, ${player.y}) act ${player.action}  ·  몬스터 ${this.monsters.filter((m) => m.alive).length}/${this.monsters.length}  ·  ${field.passes} passes`;
  }
}
