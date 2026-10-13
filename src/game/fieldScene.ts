// Field play (drawHandle 0x10): locomotion (locomotion.md), basic melee combat (combat.md,
// game-rules.md §3) and items (items.md: drops, pickup, potions, quick slots), started from a save slot.
import type { Cmf } from '../assets';
import { greyUniform, setDayShift } from '../sprites';
import { Buffs, DAY_EVENTS, TINT_BASE, clockFrame, dayPhase, isSafeMap, returnPoint, tintRow } from './buffs';
import { boxEquipment } from './boxes';
import { Gimmick } from './gimmicks';
import { Minimap } from './minimap';
import { drawFortune, fortuneAskView, fortuneResultView, FORTUNE_CMF, today, type FortuneArt } from './fortune';
import { achCheck, achEvent, challengeGold, titleBonus, type AchEvent, type Awards } from './achievements';
import { accountBook, accountDay, clearUnsavedUses, countUnsavedUse, saveAccount, setAccountDay, takeUnsavedUses, account, secondDrop, traitBox, traitOnLevelUp, traitReset, traitStatBonus, traitVal } from './account';
import { dimStats, dungeonStart, generateFloor, newRun, resultValues, rollDimDrops, type DimRun } from './dimension';
import { GATHER_CAP, GatherRun, gatherExp, spawnNodes, type GatherNode } from './gather';
import { genDarkStock } from './shopRules';
import type { Item } from './items';
import { EvActor } from './actors';
import { Dialogue } from './dialogue';
import { EventRunner } from './events';
import { Popup } from './popup';
import { QuestLog } from './quests';
import { Story, StoryDb } from './story';
import { Field, VIEW_H, VIEW_W, type Drawable } from './field';
import { FIELD_ZONES, FieldHud } from './fieldHud';
import { GlUi } from './ui';
import { button, gt, win } from './view';
import type { DomUi } from './domUi';
import { AVK } from './input';
import { Inventory, ItemDb } from './items';
import { groundBox, groundDrawable, rollBossDrops, rollDrop, updateGround, type GroundItem } from './drops';
import { Monster, overlaps, type MonsterWorld } from './monster';
import { Boss, BossGlobals, MonsterShot, bossDeathEvent, summonStats, type BoxTable } from './boss';
import { Projectile, type ProjRecord } from './projectiles';
import { skillMaxCd, skillRec } from './skillTab';
import { Player, type Blockers, type Dir, type Rect } from './player';
import { CLASSES, MAX_LEVEL, Rng, derive, effectiveSkillLevel, expNeed, idiv, killExp, monsterHit, playerHit, rdiv, skillBaseDamage, type Derived, type EquipTables, type PlayerModel } from './rules';

/** action id a -> skill s (d+0x2558b) */
const A2S = [0, 3, 6, 1, 4, 7, 2, 5, 8];
import type { SaveData } from './save';
import type { GameContext, Scene } from './scene';

/** actor ids below this are monsters, the rest NPCs (assets-data.md) */
const FIRST_NPC = 43;

/** maps where flag 0x1e hides / flag 0x1f shows NPCs (FUN_0001bb8c) */
const HIDE_1E = [0x46, 0x25, 0x51, 0x74, 0x76, 0x77, 0x7a];
const SHOW_1F = [0x74, 0x76, 0x77, 0x7a];
/** first event per class (FUN_00053510 case 2) */
const OPENING = [0, 10, 0x14];

export class FieldScene implements Scene {
  readonly field: Field;
  /** world-space effects (aura, quest marks, status icons, balloons) drawn with WebGL on the tick */
  readonly ui: GlUi;
  /** HUD, minimap, dialogue and event overlays (HTML layer) */
  readonly hudUi: DomUi;
  hud!: FieldHud;
  readonly player: Player;
  readonly model: PlayerModel;
  stats: Derived;
  readonly vitals: { hp: number; mp: number; exp: number; invuln: number; tint: number };
  readonly inv: Inventory;
  private tables: EquipTables;
  private ground: GroundItem[] = [];
  private projectiles: Projectile[] = [];
  private sheets: Cmf[] = [];
  rng = new Rng();
  /** NPCs, bosses (static until boss AI) and event actors */
  actors: EvActor[] = [];
  /** the player as an event actor while an event runs (slot 0) */
  lead: EvActor | null = null;
  /** PART_HIDE value (n << 8 | actor id); only Oswell (0x2c) with n = 2 hides sub images 0x11 / 0x02 */
  partHide = 0;
  private cmfCache = new Map<number, Cmf>();
  readonly sdb: StoryDb;
  story: Story;
  quests: QuestLog;
  readonly events: EventRunner;
  /** event candidates of this map (FUN_000193e0) */
  private candidates: number[] = [];
  /** ordinary NPC talk (state 0x11) */
  private talk: { d: Dialogue; npc: EvActor; mark: number; q: number } | null = null;
  /** NPC within reach for '5' (FUN_0002bfd4) */
  private talkTarget: EvActor | null = null;
  /** map gimmicks (slots 0x65..0x73): barriers and chests */
  gimmicks: Gimmick[] = [];
  /** chest waiting for its reward after popup 0x5F "yes" (DAT_003b3bd4) */
  private pendingChest: Gimmick | null = null;
  /** gathering nodes (slots 0x8d / 0x8e) and the running gauge */
  nodes: GatherNode[] = [];
  private run: GatherRun | null = null;
  /** warp stone move list (menu 0x17): registered rows and the cursor */
  warpList: { rows: number[]; cur: number } | null = null;
  popup: { p: Popup; onYes?: () => void; onNo?: () => void; onCancel?: () => void } | null = null;
  /** a new day: the fortune popup 0x54 opens on the first field frame (FUN_0001a494 / FUN_000200b8) */
  private fortunePending = false;
  /** save once the pending warp has loaded (garden entry) */
  private saveAfterWarp = false;
  /** shop kind requested by NPC talk (the play scene opens the shop screen) */
  shopRequest: number | null = null;
  /** set by the play scene: save to the current slot (shop actions save automatically) */
  autosave: () => void = () => {};
  private pendingEvent: { e: number; t: number } | null = null;
  /** boss room scratch a1c..a26, boss projectiles, box override table */
  private bossG = new BossGlobals();
  private shots: MonsterShot[] = [];
  private bossBoxes: BoxTable = {};
  /** poison timer (player +0x58): every 20 ticks HP -= HP/10 */
  private poison = 0;
  /** screen flash DAT_003ce6a8 (halved every frame) */
  private flash = 0;
  /** elixir buffs (misc-systems.md §1) */
  buffs: Buffs;
  /** day/night counter (gamedata 0x3b0 + 2·slot), phase 0 day 1 dusk 2 night 3 changing, palette fade */
  dayCounter: number;
  dayPh: 0 | 1 | 2 | 3 = 0;
  private dayFade = { steps: 0, target: 0 as 0 | 1 | 2, row: 0 };
  /** return stone destination row (P+0x3290), 100 = class start field */
  returnZone: number;
  /** return stone warp (warp.kind 2): frames since use, -1 = none */
  private warpT = -1;
  /** warp kind 4 (FUN_00024b80): the effect over the player after a garden entry / exit, no movement */
  private arriveT = -1;
  /** dungeon mode DAT_003dc1a8 (1 = 어둠의 정원) and the entry flag DAT_003dc1a9 (leftovers-ui.md §1); not saved */
  gardenMode = 0;
  private gardenFlag = 0;
  /** 차원의 문 run (dungeon mode 2, dimension.md) */
  dim: DimRun | null = null;
  /** set when the run ends: the play scene reloads the slot (the save made before entering) */
  reloadRequest = false;
  /** the open game menu should close (entering the dimension from the community menu) */
  closeMenu = false;
  /** runtime mapType DAT_003b3aae: the header value, 0 after load on maps < 0x165 (FUN_00017838), 2 from DANGER_ON */
  mapType = 0;
  /** garden gate boss kept out of play until its floor event ends (FUN_0001bb8c 5754, garden.md §1.2 / §1.4) */
  private gateBoss: Monster | null = null;
  /** field minimap (option 미니맵) */
  private minimap: Minimap | null = null;
  /** warp kind 8: the warning banner before the gate boss starts (32 frames) */
  private bannerT = -1;
  /** save slot of this play (account-wide day counter, book and reload prevention) */
  slot = -1;
  /** bind to a slot: account day counter and book, reload prevention (FUN_0001a494) */
  bindSlot(slot: number): void {
    this.slot = slot;
    this.dayCounter = accountDay(slot, this.dayCounter);
    this.story.book = accountBook(this.story.book);
    if (this.story.fortuneDay !== today()) { this.story.fortuneDay = today(); this.fortunePending = true; }
    for (const sub of takeUnsavedUses(slot)) {
      const i = this.inv.items.findIndex((it) => it.type === 0x1b && it.sub === sub);
      if (i >= 0) { const it = this.inv.items[i]; if (it.count > 1) it.count--; else this.inv.remove(i); }
    }
  }
  /** a counted consumable (0x1b sub 2, 3, 0x15..0x17) was used */
  countUse(sub: number): void { if (this.slot >= 0) countUnsavedUse(this.slot, sub); }
  /** previous file of this slot, for the partial save in the garden (FUN_0001eba8) */
  prevSave: () => SaveData | null = () => null;
  private gardenEntry: [number, number] = [0, 0];
  /** free rest point: popup shown while inside (gateState 4) */
  private restInside = false;
  /** dark merchant stock (items 700..715, not saved) and its lifecycle DAT_003b3c73 */
  darkStock: (Item | null)[] = [];
  private darkState = 0;
  private statusCmf!: Cmf;
  /** slot lap (gamedata): 2 = hard mode (hardmode.md) */
  lap = 0;
  get hard(): boolean { return this.lap >= 2; }
  /** set when the ending event 0x6A ends (state 0x3D) */
  ending = false;
  monsters: Monster[] = [];
  private tick = 0;
  cam = { x: 0, y: 0 };
  private shake: [number, number][] = [];
  private pendingWarp: { map: number; x: number; y: number } | null = null;
  private busy = true;
  /** set when the player's HP reaches 0 */
  dead = false;
  /** touch buttons are drawn only in plain field play (state 0x10, FUN_000208dc) */
  showButtons = true;
  playTicks: number;
  statPoints: number;
  /** learned skill levels (0..8 actives in tab order tier*3 + group, 9..15 passives) */
  skills: number[];
  skillPoints: number;

  private constructor(readonly ctx: GameContext, save: SaveData, playerCmf: Cmf, readonly db: ItemDb) {
    this.field = new Field(ctx.assets, ctx.compositor);
    this.ui = new GlUi(ctx.assets, ctx.compositor);
    this.hudUi = ctx.hud;
    this.inv = new Inventory(db);
    this.tables = db.equipTables();
    if (save.inv) {
      Object.assign(this.inv, { items: save.inv.items, equip: save.inv.equip, quick: save.inv.quick, gold: save.inv.gold });
      this.inv.setBags(save.inv.bags ?? 0);
      this.inv.unlocks = save.inv.unlocks ?? 0;
      this.inv.migrateUnlocks();
    } else {
      // new game (FUN_00053510 case 2): class weapon, 10 healing potions, 20 pickaxes,
      // quick slot '1' = skill 0, '#' = inventory cell 0 (items.md §0.7)
      this.inv.equip[0] = db.create(save.cls, 0, 0, this.rng);
      this.inv.gain(0x11, 1, 0, 10, this.rng);
      this.inv.gain(0x18, 0, 0, 20, this.rng);
      this.inv.registerQuick(0, 1, 0);
      this.inv.registerQuick(5, 2, 0);
      this.inv.gold = save.gold;
    }
    this.skills = save.skills ? [...save.skills] : [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.buffs = Buffs.from(save.buffs);
    this.dayCounter = save.day ?? 0;
    this.returnZone = save.returnZone ?? 0;
    this.model = { cls: save.cls, level: save.level, stats: [...save.stats], equip: this.inv.equip, skills: this.skills, buffs: this.buffs.effects(ctx.assets) };
    this.stats = derive(this.model, this.tables);
    this.vitals = {
      hp: save.hp < 0 ? this.stats.maxHp : Math.min(save.hp, this.stats.maxHp),
      mp: save.mp < 0 ? this.stats.maxMp : Math.min(save.mp, this.stats.maxMp),
      exp: save.exp, invuln: 0, tint: 0,
    };
    this.playTicks = save.playTicks;
    this.statPoints = save.statPoints;
    // new game: skill 0 at level 1, no skill points (FUN_0001a8d8)
    this.skillPoints = save.skillPoints ?? 0;
    this.player = new Player(playerCmf);
    this.player.cls = save.cls;
    this.player.dir = save.dir;
    this.player.actions = ctx.assets.tables.playerActions[save.cls];
    this.player.mult = ctx.assets.tables.actionMult[save.cls];
    EvActor.poses = { actions: ctx.assets.tables.playerActions, mult: ctx.assets.tables.actionMult };
    EvActor.onPose = (a, ev, sound) => {                             // party pose effects / sounds in events
      if (sound) this.ctx.audio.playSfx(sound);
      if (ev >= 9 && ev <= 26 && this.projectiles.length < 60) {
        const rec = this.projRecord(ev - 8);
        this.projectiles.push(new Projectile(ev - 8, rec, { x: a.x, y: a.y, dir: a.dir, lastH: a.lastH, lastV: a.lastV }, this.sheets[rec.type] ?? this.player.cmf, 0, 0, 0));
      }
    };
    this.sdb = new StoryDb(ctx.assets);
    this.story = Story.from(save.story, save.cls);
    this.quests = this.makeQuests();
    this.events = new EventRunner(this);
  }

  private makeQuests(): QuestLog {
    return new QuestLog(this.sdb, this.story, {
      inv: this.inv, rng: this.rng, hard: () => this.hard, level: () => this.model.level,
      questPopup: (id, q) => { this.popup = { p: new Popup(this.ctx, id, 0, (t) => t.replace('%s', this.quests.name(q))) }; },
      message: (t) => this.hud.message(t),
      grantExp: (e) => this.grantExp(e),
      sfx: (n) => this.ctx.audio.playSfx(n),
    });
  }

  get popupOpen(): boolean { return !!this.popup; }
  get inEvent(): boolean { return this.events.active; }
  /** events and NPC talk (states 0x12 / 0x11) take every key; menu and SAVE are refused */
  get busyTalking(): boolean { return this.events.active || !!this.talk || !!this.popup || !!this.warpList; }

  static async create(ctx: GameContext, save: SaveData, lap = 0): Promise<FieldScene> {
    const db = new ItemDb(ctx.assets);
    await db.init();
    db.tier2 = lap >= 2;                                            // DAT_003b3bef = lap >= 2 ? 2 : 0
    const s = new FieldScene(ctx, save, await ctx.assets.cmf(`cmf_c${save.cls}`), db);
    s.lap = lap;
    await s.ui.init(FieldHud.images);
    s.statusCmf = await ctx.assets.cmf('cmf_status');
    s.hud = new FieldHud(s.hudUi, s.statusCmf, ctx.input);
    s.inv.log = (_kind, text) => s.hud.message(text);
    s.inv.onCollect = (sub) => s.story.collect.add(sub);              // keys / sage stones are flags
    s.sheets = await Promise.all([0, 1, 2].map((c) => ctx.assets.cmf(`cmf_c${c}`)));
    s.bossBoxes = await ctx.assets.json<BoxTable>('boss_boxes.json');
    for (const q of s.inv.quick) if (q.kind === 1 && !q.maxCd) q.maxCd = skillMaxCd(s, q.id);
    s.player.onEvent = (ev) => s.actionEvent(ev);
    ctx.input.zones = FIELD_ZONES;
    await s.enterMap(save.map, save.x < 0 ? undefined : save.x, save.y < 0 ? undefined : save.y);
    s.quests.refresh();
    // new game or an unfinished opening: start the class's first event (classes 1/2 set flag 0 first)
    const first = OPENING[save.cls];
    if (!s.story.isDone(first)) {
      if (save.cls !== 0) s.story.set(0);
      s.events.start(first);
    }
    return s;
  }

  /** challenges waiting for popup 0x79 */
  private achQueue: number[] = [];
  /** frames without moving (title 50), last skill use (title 21 / 22), a kill on this map (title 35) */
  private idleFrames = 0;
  private lastSkillTick = -1000;
  private killedHere = true;

  /** report an achievement event (kills, crafts, ...) */
  achieve(e: AchEvent): void { this.grantAwards(achEvent(this.story.counters, e)); }

  private grantAwards(a: Awards): void {
    for (const n of a.titles) this.awardTitle(n);
    for (const n of a.challenges) if (!this.story.challenges.has(n)) { this.story.challenges.add(n); this.achQueue.push(n); }
  }

  /** polled state conditions (every 20 field frames) and the challenge popup queue */
  private achTick(): void {
    if (this.tick % 20 === 0) {
      const st = this.story, eq = this.inv.equip.map((it) => (it ? it.grade : -1));
      const best = Math.max(-1, ...[...this.inv.items, ...this.inv.equip].filter((it) => it && it.type < 0x10).map((it) => it!.grade));
      this.grantAwards(achCheck({
        level: this.model.level, gold: this.inv.gold, gatherLv: st.gather.lv, traitsSpent: account().traits.reduce((s, v) => s + v, 0),
        bookKinds: st.book.filter((b) => b && b.k > 0).length, subquests: st.qs.filter((v, q) => v === 4 && !this.sdb.mainQuest(q)).length,
        questDone: (q) => st.qs[q] === 4, equipped: eq, bestGrade: best,
        gemTier: Math.max(-1, ...this.inv.equip.flatMap((it) => (it ? it.sockets.filter((g) => g !== 0xff).map((g) => (g % 50) % 5) : []))),
        necklaces: new Set([...this.inv.items, ...this.inv.equip].filter((it) => it && it.type === 15).map((it) => it!.sub)).size,
        regions: st.zones.size, idleFrames: this.idleFrames, slowFrames: st.counters.slowFrames ?? 0,
      }));
    }
    if (!this.popup && this.achQueue.length) {                       // FUN_0001f17c: popup 0x79 + reward gold
      const n = this.achQueue.shift()!, t = this.db.a.text, gold = challengeGold(this.db.a, n);
      const body = (s: string) => `${s.replace('%s', t[0x1bcf + n] ?? '')}|@${(t[0x1c25] ?? '%d').replace('%d', String(gold))}`;
      const give = () => { this.inv.gain(0x1c, gold, 0, 1, this.rng); this.autosave(); };
      this.popup = { p: new Popup(this.ctx, 0x79, 0, body), onYes: give, onNo: give };
    }
  }

  /** popup 0x54: OK draws the fortune (FUN_00052610(1)), CLR gives up today's fortune; both save */
  private openFortune(): void {
    // FUN_00051edc(0x54) loads the portrait actor (어둠의 상인, cmf c72) when the popup opens
    void this.ctx.assets.cmf(FORTUNE_CMF).then((c) => { this.fortuneCmf = c; });
    void this.ctx.ui13.preload(['c72', 'shadow']);
    const p = new Popup(this.ctx, 0x54);
    p.content = () => fortuneAskView(this.db.a.text, this.fortuneArt());
    this.popup = { p, onYes: () => this.runFortune(), onCancel: () => this.autosave() };
  }

  /** the portrait cmf once loaded; its frame counter advances once per popup draw (one tick), frame % 6 */
  private fortuneCmf: import('../assets').Cmf | null = null;
  private fortuneFrame = 0;
  private fortuneArt(): FortuneArt | null {
    return this.fortuneCmf ? { cmf: this.fortuneCmf, frame: this.fortuneFrame++ } : null;
  }

  private runFortune(): void {
    const res = drawFortune(this.db.a, this.rng, this.model.level), t = this.db.a.text;
    let ok = false, item: { name: string; icon: { image: string; sx: number; sy: number } } | null = null;
    if (res) {
      ok = this.inv.gain(res.type, res.sub, 0, res.count, this.rng);
      if (ok) { const it = this.inv.items.find((x) => x.type === res.type && x.sub === res.sub); if (it) item = { name: it.name, icon: this.db.iconRect(it.icon) }; }
      if (res.grade === 1) {                                         // 대길 counter +0x2e24 (max 30), titles 0x18 / 0x19
        const c = this.story.counters, n = c.daegil = Math.min(30, (c.daegil ?? 0) + 1);
        if (n >= 10) this.awardTitle(0x18);
        if (n >= 30) this.awardTitle(0x19);
      }
    }
    const p = new Popup(this.ctx, 0x55);
    p.content = () => fortuneResultView(t, ok ? res : null, item, this.fortuneArt());
    p.hideBody = true;
    this.popup = { p };
    this.autosave();
  }

  /** FUN_0004aa9c: title n (once), toast "칭호 '%s' 획득" (0x1B29, name 0xCFF + n) */
  awardTitle(n: number): void {
    if (this.story.titles.has(n)) return;
    this.story.titles.add(n);
    const t = this.db.a.text;
    this.hud.message((t[0x1b29] ?? '%s').replace('%s', t[0xcff + n] ?? ''));
    this.recompute();
  }

  /** FUN_0001d924: revive in place with full HP / MP, 100 frames of invulnerability, the area BGM */
  revive(): void {
    this.dead = false;
    this.vitals.hp = this.stats.maxHp; this.vitals.mp = this.stats.maxMp;
    this.vitals.invuln = 100;
    this.ctx.audio.playBgm(this.mapType < 2 ? this.field.map.header.bgm : 0x0c);
  }

  /** Snapshot for the save slot. */
  toSave(): SaveData {
    if (this.slot >= 0) { setAccountDay(this.slot, this.dayCounter); clearUnsavedUses(this.slot); saveAccount(); }
    const d = this.fullSave();
    if (this.gardenMode === 0) return d;
    // FUN_0001eba8 partial save: event bits, visited maps / regions, keys and doors keep the file's values
    const prev = this.prevSave()?.story;
    if (prev && d.story) Object.assign(d.story, { done: prev.done, maps: prev.maps, zones: prev.zones, collect: prev.collect, collectDim: prev.collectDim, doors: prev.doors });   // +0x3173 too (garden.md)
    const file = this.prevSave();
    if (this.gardenMode === 2 && file) Object.assign(d, { map: file.map, zone: file.zone, x: file.x, y: file.y, dir: file.dir });
    return d;
  }

  private fullSave(): SaveData {
    return {
      version: 1, cls: this.model.cls, level: this.model.level, exp: this.vitals.exp, gold: this.inv.gold,
      stats: [...this.model.stats], statPoints: this.statPoints, map: this.field.mapId, zone: this.field.map.header.zone,
      x: this.player.x, y: this.player.y, dir: this.player.dir, hp: this.vitals.hp, mp: this.vitals.mp,
      ...(this.gardenMode === 1 ? { map: 0x9f, zone: 7, x: 160, y: 400 } : {}),     // FUN_0001eba8: garden saves point at the entrance
      playTicks: this.playTicks, savedAt: Date.now(), buffs: this.buffs.toJSON(), day: this.dayCounter, returnZone: this.returnZone,
      inv: { items: this.inv.items, equip: this.inv.equip, quick: this.inv.quick, gold: this.inv.gold, bags: this.inv.bags, unlocks: this.inv.unlocks },
      skills: [...this.skills], skillPoints: this.skillPoints, story: this.story.toJSON(),
    };
  }

  private centreSpawn(): [number, number] {
    const { header } = this.field.map;
    let best: [number, number] = [header.width * 8, header.height * 8], bestD = Infinity;
    for (let r = 0; r < header.height; r++) for (let c = 0; c < header.width; c++) {
      const d = (r - header.height / 2) ** 2 + (c - header.width / 2) ** 2;
      if (this.field.walkCell(c, r) && d < bestD) { bestD = d; best = [c * 16 + 8, r * 16 + 12]; }
    }
    return best;
  }

  /** Camera step (locomotion.md §6), run before entities move so it trails by a tick. */
  private updateCamera(): void {
    const { field, player, cam } = this;
    const W = field.width, H = field.height;
    const lx = 2 * Math.abs(player.vx), ly = 2 * Math.abs(player.vy);
    const cx = Math.max(224 - lx, Math.min(W - 224 + lx, player.x));
    cam.x += (cx - cam.x - 240 + 8 + (player.dir === 0 ? -lx : lx)) >> 2;
    cam.x = Math.max(0, Math.min(cam.x, W - VIEW_W));
    const cy = Math.max(213, Math.min(H - 106, player.y));
    cam.y += Math.trunc((cy - cam.y - 213 + (player.dir === 2 ? -ly : ly)) / 3);
    cam.y = Math.max(0, Math.min(cam.y, H - VIEW_H));
  }

  async enterMap(id: number, x?: number, y?: number, forEvent = false): Promise<void> {
    if (!forEvent && !this.killedHere && !isSafeMap(this.field.mapId)) this.achieve({ k: 'peacefulRoom' });
    this.killedHere = false;
    this.busy = true;
    const { field, player, ctx } = this;
    await field.load(id);
    await field.preloadSprite(player.cmfName, player.cmf, player.equip);
    const keep = forEvent ? this.actors.filter((a) => a.party) : [];
    this.actors = [];
    this.monsters = [];
    this.shots = [];
    this.bossG.reset();
    this.ground = [];
    this.projectiles = [];
    for (const c of this.sheets) if (c !== player.cmf) await field.preloadSprite('', c);
    const level = field.map.header.monLevel;
    this.gateBoss = null;
    this.bannerT = -1;
    this.mapType = id < 0x165 ? 0 : field.map.header.mapType;
    // FUN_0001bb8c: garden gate floors start empty; a visited boss room keeps its boss away (not 0x27 / 0x23)
    const bossRoom = field.map.header.mapType === 2, gateFloor = this.gardenMode === 1 && bossRoom;
    const cleared = this.gardenMode === 0 && bossRoom && this.story.maps.has(id);
    const dimActors = this.gardenMode === 2 && this.dim && id >= 0x165 ? await this.dimFloor(id) : null;
    if (dimActors) this.mapType = field.map.header.mapType;           // no barrier hiding on maps >= 0x165
    for (const ac of dimActors ?? field.map.actors) {
      if (ac.actor < 0 || ac.actor >= 260) continue;
      if (cleared && ac.actor < FIRST_NPC && ac.actor !== 0x27 && ac.actor !== 0x23) continue;
      const typeRec = ctx.assets.tables.actorTypes[ac.actor];
      const name = `cmf_c${typeRec[0]}`;
      try {
        const cmf = await ctx.assets.cmf(name);
        await field.preloadSprite(name, cmf);
        this.cmfCache.set(ac.actor, cmf);
        if (ac.actor < FIRST_NPC && typeRec[1] === 1) {
          const m = new Monster(ac.actor, name, cmf, ac.x, ac.y, level, typeRec, this.hard);
          if (dimActors) this.dimMonster(m, ac);
          this.monsters.push(m);
        }
        else if (ac.actor < FIRST_NPC && typeRec[1] === 11) {
          const boss = new Boss(ac.actor, name, cmf, ac.x, ac.y, level, typeRec, this.bossG, this.bossBoxes[String(ac.actor)] ?? {}, ((ac.param ?? 3) & 3) as Dir, this.hard);
          if (gateFloor) { if (!this.gateBoss && ac === field.map.actors[0]) this.gateBoss = boss; continue; }
          if (dimActors) this.dimMonster(boss, ac);
          this.monsters.push(boss);
          if (ac.actor === 35 || ac.actor === 39) this.spawnParts(boss, name, cmf, level, typeRec);
          if (ac.actor === 5) await this.preloadActors([3]);         // King Dusty summons Dusties
        } else {
          const a = new EvActor(ac.actor, name, cmf, ac.x, ac.y, false, 0, typeRec, (ac.param ?? 3) & 3);
          a.visible = this.appears(ac.actor);
          this.actors.push(a);
        }
      } catch { /* actor sprite missing */ }
    }
    this.actors.push(...keep);
    // gimmicks (FUN_000176d8), opened ones removed (FUN_000194bc), battle barriers hidden (FUN_00017838)
    this.gimmicks = [];
    this.pendingChest = null;
    for (const g of field.map.gimmicks ?? []) {
      const gm = new Gimmick(ctx.assets, g.type, g.x, g.y, g.param & 0xff);
      if (gm.kind === 6 && this.story.chests.has(gm.param)) continue;
      if (gm.kind === 5 && gm.param < 16 && this.story.doors.has(gm.param)) continue;
      if (gm.kind === 5 && id === 0x89 && this.story.qs[0x45] > 1) continue;
      if (gm.kind === 5 && gm.param > 15 && id < 0x165) gm.hidden = true;
      if (this.gimmicks.length < 15) this.gimmicks.push(gm);
    }
    await field.preloadSprite('cmf_oc', field.oc);
    this.minimap ??= new Minimap(ctx.assets);
    this.minimap.build(field.map, this.portalMarkers().filter((d) => d.frame >= 112 && d.frame < 120).map((d) => ({ x: d.x, y: d.y })));   // kind-0 markers only
    this.run = null;
    this.nodes = !isSafeMap(id) && !this.events.active && this.mapType !== 2 && this.gardenMode !== 2
      ? spawnNodes(ctx.assets, field, this.rng, field.map.header.zone, dayPhase(this.dayCounter) === 2, player.x, player.y) : [];
    if (this.nodes.length) await field.preloadSprite(...field.objSet);
    if (!forEvent) {
      const [sx, sy] = x === undefined || y === undefined ? this.centreSpawn() : [x, y];
      player.place(sx, sy);
      this.cam = { x: 0, y: 0 };
      for (let i = 0; i < 20; i++) this.updateCamera();
      ctx.audio.playBgm(field.map.header.bgm);
    }
    this.story.zones.add(id === 0x9b ? 5 : field.map.header.zone);  // markVisited (map 0x9b counts as region 5)
    this.story.maps.add(id);                                          // FUN_0006913c map bitset
    if (!isSafeMap(id)) {                                            // FUN_0001e358: class start field rule
      const startMap = [0x71, 0x73, 0x70][this.model.cls], flag = [0x3f, 0x48, 0x8f][this.model.cls];
      if (id === startMap && this.returnZone === this.model.cls && !this.story.isDone(flag)) this.returnZone = 100;
    } else this.returnZone = field.map.header.zone;
    if (this.dayPh === 3) this.dayPh = this.dayFade.target;
    else this.dayPh = dayPhase(this.dayCounter);
    this.updateDarkStock();
    this.restInside = false;
    this.rebuildCandidates();
    this.busy = false;
  }

  /** FUN_0001b334: 35 = main (role 1) + part A (0, y+94) + part B (2, x-180, inactive);
   *  39 = main (0) + arm (1, x+40 y-30) + head (2, x-20 y-10) */
  private spawnParts(main: Boss, name: string, cmf: Cmf, level: number, typeRec: number[]): void {
    const mk = (role: number, x: number, y: number, rec: number) => {
      const p = new Boss(main.type, name, cmf, x, y, level, typeRec, this.bossG, main.boxes, main.dir, this.hard);
      p.role = role; p.main = main; p.rec = rec; p.action = rec;
      main.parts.push(p);
      this.monsters.push(p);
      return p;
    };
    if (main.type === 35) {
      main.role = 1;
      mk(0, main.x, main.y + 94, 1);
      mk(2, main.x - 180, main.y - 10, 2).active = false;
      this.bossG.set(0x1f, 1);
    } else {
      main.role = 0;
      mk(1, main.x + 40, main.y - 30, 1);
      mk(2, main.x - 20, main.y - 10, 2);
    }
  }

  /** NPC appearance by event flags d+0x22d3d +3/+4/+6/+7 (FUN_0001bb8c, events.md §2.4) */
  private appears(id: number): boolean {
    if (id < FIRST_NPC) return true;
    const st = this.story, f = (i: number) => this.sdb.typeByte(id, i);
    let v: boolean;
    if (f(3) === -1) v = true;
    else {
      v = st.isDone(f(3));
      if (f(4) !== -1) {
        if (st.isDone(f(4))) v = false;
        if (f(6) !== -1) {
          if (st.isDone(f(6))) v = true;
          if (f(7) !== -1 && st.isDone(f(7))) v = false;
        }
      }
    }
    if ([0x9e, 0xcd, 0xde, 0xf2].includes(id)) return dayPhase(this.dayCounter) >= 2;   // dark merchants: night only
    const map = this.field.mapId;
    if (st.isDone(0x1e) && HIDE_1E.includes(map)) v = false;
    if (st.isDone(0x1f) && SHOW_1F.includes(map)) v = true;
    return v;
  }

  /** FUN_000193e0 */
  private rebuildCandidates(): void {
    const st = this.story, map = this.field.mapId;
    this.candidates = [];
    this.sdb.headers.forEach((h, e) => {
      if (st.isDone(e) || h.map !== map) return;
      if ((h.kind === 1 || h.kind === 6) && !(st.isDone(h.p1) && st.isDone(h.p2))) return;
      this.candidates.push(e);
    });
  }

  /** FUN_0006913c: map-entry (kind 1) and area (kind 2) triggers, every field frame */
  private checkTriggers(): void {
    const { x, y } = this.player, st = this.story;
    for (const e of this.candidates) {
      if (st.isDone(e)) continue;
      const h = this.sdb.headers[e];
      if (h.kind === 2 || h.kind === 4) {
        const q = (h.p2 + 1) & 0xffff;
        if ((h.p1 >> 8) * 16 <= x && x <= (q >> 8) * 16 && (h.p1 & 0xff) * 16 <= y && y <= (q & 0xff) * 16) { this.events.start(e); return; }
      } else if (h.kind === 1 && st.isDone(h.p1) && st.isDone(h.p2)) { this.events.start(e); return; }
    }
  }

  // ---- event host ----

  private actorCmfName(id: number): string {
    return `cmf_c${id < 3 ? id : this.ctx.assets.tables.actorTypes[id]?.[0] ?? 0}`;
  }

  async preloadActors(ids: number[]): Promise<void> {
    for (const id of [...ids, 0, 1, 2]) {
      if (id < 0 || id >= 260 || this.cmfCache.has(id)) continue;
      try {
        const name = this.actorCmfName(id), cmf = await this.ctx.assets.cmf(name);
        await this.field.preloadSprite(name, cmf);
        this.cmfCache.set(id, cmf);
      } catch { /* missing sprite */ }
    }
  }

  /** a new actor of that id (event spawn / PLACE of an actor not on the map) */
  spawnActor(id: number, forceNew = false): EvActor | null {
    if (!forceNew) { const a = this.actors.find((x) => x.id === id); if (a) return a; }
    const cmf = this.cmfCache.get(id);
    if (!cmf || !this.lead) return null;
    const a = new EvActor(id, this.actorCmfName(id), cmf, this.lead.x, this.lead.y, id < 3, id, this.ctx.assets.tables.actorTypes[id] ?? [], 3);
    a.spawned = true;
    this.actors.push(a);
    return a;
  }

  partyActors(): EvActor[] { return [this.lead!, ...this.actors.filter((a) => a.party)]; }

  /** PARTY_JOIN: the two other heroes at the leader's position and facing */
  partyJoin(): void {
    for (const id of [0, 1, 2]) {
      if (id === this.model.cls) continue;
      const a = this.actors.find((x) => x.id === id) ?? this.spawnActor(id, true);
      if (!a) continue;
      a.x = this.lead!.x; a.y = this.lead!.y; a.face(this.lead!.dir); a.visible = true; a.alpha = 32;
    }
  }
  partyHide(): void { for (const a of this.actors) if (a.party) a.visible = false; }

  beginEvent(): void {
    const p = this.player;
    this.talk = null;
    const lead = new EvActor(this.model.cls, p.cmfName, p.cmf, p.x, p.y, true, this.model.cls, [], p.dir);
    lead.equip = p.equip;
    lead.face(p.dir);
    this.lead = lead;
    p.action = 0; p.attack = null;
  }

  async eventMap(id: number): Promise<void> {
    await this.enterMap(id, undefined, undefined, true);
  }

  endEvent(e: number): void {
    if (e === 0x6a) this.ending = true;
    if (e >= 0x9b && e <= 0xa3 && this.gateBoss) {                  // gate floor event end: the boss appears, banner, then AI
      this.monsters.push(this.gateBoss);
      this.gateBoss = null;
      this.bannerT = 0;
    }
    if (e === 0x6b && this.gateBoss) { this.monsters.push(this.gateBoss); this.gateBoss = null; }   // 100층: PLACE wakes 베르무트, no banner
    if (e === 0x6c) { this.gardenMode = 0; this.gardenFlag = 0; }  // 베르무트 defeated: 0x3dc1a0..af cleared                              // state 0x3D: black screen, popup 0x5C
    if ((e === 0 || e === 10 || e === 0x14) && this.hard) this.autosave();   // hard: the opening end saves
    const lead = this.lead;
    if (lead) {
      this.player.place(lead.x, lead.y);
      this.player.dir = lead.dir; this.player.lastH = lead.lastH; this.player.lastV = lead.lastV;
      this.player.frame = 0;
    }
    this.lead = null;
    this.actors = this.actors.filter((a) => !a.spawned && !a.party);
    for (const a of this.actors) { a.visible = this.appears(a.id); a.balloon = 0; a.anim = -1; a.path = []; a.face(a.homeDir as Dir); }
    this.rebuildCandidates();
    this.quests.refresh();
    this.ctx.audio.playBgm(this.field.map.header.bgm);
    void e;
  }

  afterEvent(_e: number): void { /* a finished event started again: nothing to replay */ }

  /** FUN_000173c4: camera eases 1/4 toward the followed actor or cell */
  eventCamera(): void {
    const ev = this.events, t = ev.camCell ?? (ev.camTarget ? [ev.camTarget.x, ev.camTarget.y] : null);
    if (!t) return;
    const W = this.field.width, H = this.field.height;
    this.cam.x += (t[0] - 240 + 8 - this.cam.x) >> 2;
    this.cam.y += Math.trunc((t[1] - 213 + 53 - this.cam.y) / 4);
    this.cam.x = Math.max(0, Math.min(this.cam.x, W - VIEW_W));
    this.cam.y = Math.max(0, Math.min(this.cam.y, H - VIEW_H));
  }
  snapCamera(): void { for (let i = 0; i < 20; i++) this.eventCamera(); }

  /** popup 0x60 "휴식을 취하시겠습니까?" (+ "50골드가 소비됩니다." at the inn), FUN_00053510 case 0x39 */
  private innPopup(free: boolean): void {
    const cost = free ? '' : (this.db.a.text[0x4d3] ?? '').replace('%d', '50');
    this.popup = { p: new Popup(this.ctx, 0x60, 0, (t) => t.replace('%s', cost)), onYes: () => {
      if (!free) { if (this.inv.gold < 50) { this.hud.message(this.db.a.text[0x1af8] ?? ''); return; } this.inv.gold -= 50; }
      this.vitals.hp = this.stats.maxHp; this.vitals.mp = this.stats.maxMp;           // FUN_0001ead0
      this.achieve({ k: 'inn' });
      this.hud.message(this.db.a.text[0x1a62] ?? '');
      this.flash = 0;
    } };
  }

  /** free rest points in the heroes' homes (d+0x22146 rows 1..3: maps 18 / 54 / 94) */
  private checkRestPoint(): void {
    const a = this.db.a;
    for (let row = 1; row <= 3; row++) {
      const o = 0x22146 + 12 * row;
      if (a.d16(o) !== this.field.mapId) continue;                   // 6 × u16: map, cx, cy, size, flag, gateType
      const cx = a.d16(o + 2), cy = a.d16(o + 4), h = a.d16(o + 6) >> 1;
      const inside = Math.abs(this.player.x - cx) <= h && Math.abs(this.player.y - cy) <= h;
      if (inside && !this.restInside) { this.restInside = true; this.innPopup(true); }
      else if (!inside) this.restInside = false;
    }
  }

  /** FUN_000175a8: saving is allowed when mapType < 2 and no event runs */
  get canSave(): boolean { return this.mapType < 2 && !this.events.active; }

  /** '5' on a node (priority 8): gather level and pickaxe checks, then the gauge */
  private tryGather(): boolean {
    const n = this.nodes.find((x) => x.near(this.player.x, this.player.y));
    if (!n) return false;
    const t = this.db.a.text, zone = this.field.map.header.zone;
    const perm = this.inv.unlocked(1);                               // 천상의 곡괭이: no level / pickaxe checks
    if (zone > GATHER_CAP[this.story.gather.lv] && !perm) { this.hud.message(t[0x1ade] ?? ''); return true; }
    if (!perm && !this.inv.items.some((x) => x.type === 0x18)) { this.hud.message(t[0x1adf] ?? ''); return true; }
    this.run = new GatherRun(n, this.rng);
    n.state = 'gather';
    return true;
  }

  private cancelGather(): void {
    if (this.run) { this.run.node.state = 'idle'; this.run = null; }
  }

  /** one gauge frame; returns true while gathering takes the frame (no movement / attacks) */
  private gatherTick(presses: number[]): boolean {
    const run = this.run!;
    for (const k of presses) {
      if (run.success) break;
      if (k === AVK.OK) { if (run.inWindow) run.hit(); }
      else { this.cancelGather(); return false; }                      // another key cancels
    }
    if (this.ctx.input.direction() && !run.success && run.tail < 0) { this.cancelGather(); return false; }
    if (!run.tick()) return true;
    // finish: 1 item (2 on success) + derived "gather +%" chance (D[18])
    const n = run.node, count = (run.success ? 2 : 1) + (this.rng.rand(100) < (this.stats.D[18] ?? 0) ? 1 : 0)
      + (this.rng.rand(100000) <= traitVal(8) * 1000 ? 1 : 0);        // track 8 채집의 달인
    this.run = null;
    if (!this.inv.gain(n.type, n.sub, 0, count, this.rng)) { n.state = 'idle'; return true; }
    this.nodes = this.nodes.filter((x) => x !== n);
    const perm = this.inv.unlocked(1);
    const [e, up] = gatherExp(this.story.gather, this.field.map.header.zone, perm);
    const t = this.db.a.text;
    if (e) this.hud.message((t[0x1b39] ?? '%d').replace('%d', String(e)));
    if (up) this.hud.message(t[0x1b3a] ?? '');
    const pick = perm ? -1 : this.inv.items.findIndex((x) => x.type === 0x18);   // one pickaxe per gather (none with 천상의 곡괭이)
    if (pick >= 0) { const it = this.inv.items[pick]; if (it.count > 1) it.count--; else this.inv.remove(pick); }
    this.quests.onItems();
    return true;
  }

  /** warp stone row of a zone and its table d+0x220c2 {map, x0, y0, wx, wy, flag} (gimmicks.md §4.1) */
  private stone(row: number): { map: number; x0: number; y0: number; wx: number; wy: number; flag: number } {
    const a = this.db.a, o = 0x220c2 + row * 12, s16 = (v: number) => (v << 16) >> 16;
    return { map: a.d16(o), x0: a.d16(o + 2), y0: a.d16(o + 4), wx: a.d16(o + 6), wy: a.d16(o + 8), flag: s16(a.d16(o + 10)) };
  }
  private stoneRow(): number { const z = this.field.map.header.zone; return z < 6 ? (z === 5 ? 4 : z) : z - 2; }

  /** '5' on a warp stone (register / move list) or at the map-152 well (popup 0x50) */
  private tryGate(): boolean {
    const p = this.player, row = this.stoneRow(), r = this.stone(row);
    if (r.map === this.field.mapId && (r.flag === -1 || this.story.isDone(r.flag))
      && p.x >= r.x0 && p.x <= r.x0 + 50 && p.y >= r.y0 && p.y <= r.y0 + 50) {
      if (this.story.stones.has(row)) {
        const rows = [...this.story.stones].sort((x, y) => x - y);
        this.warpList = { rows, cur: Math.max(0, rows.indexOf(row)) };
      } else {
        this.story.stones.add(row); this.story.stones.add(3);           // row 3 (초원마을) is always registered too
        this.hud.message('공간이동석이 등록되었습니다.');
      }
      return true;
    }
    if (this.field.mapId === 152 && this.story.isDone(54) && this.story.isDone(0x35) && Math.abs(p.x - 256) <= 35 && Math.abs(p.y - 352) <= 35) {
      this.popup = { p: new Popup(this.ctx, 0x50), onYes: () => { this.pendingWarp = { map: 179, x: 784, y: 160 }; } };
      return true;
    }
    return false;
  }

  /** move list keys: up / down, '5' warps (FUN_000619a0), CLR closes */
  private warpKeys(presses: number[]): void {
    const w = this.warpList!;
    for (const k of presses) {
      if (k === AVK.UP) w.cur = (w.cur + w.rows.length - 1) % w.rows.length;
      else if (k === AVK.DOWN) w.cur = (w.cur + 1) % w.rows.length;
      else if (k === AVK.CLR) { this.warpList = null; return; }
      else if (k === AVK.OK) {
        const r = this.stone(w.rows[w.cur]);
        this.warpList = null;
        if (r.map !== this.field.mapId) this.pendingWarp = { map: r.map, x: r.wx, y: r.wy };
        return;
      }
    }
  }

  private drawWarpList(): void {
    const w = this.warpList!, u = this.ctx.ui13, t = this.db.a.text;
    u.begin();
    u.pushCenter220();
    u.view('warps', 20, 30, 180, 30 + w.rows.length * 26, win('.v-col.v-fill.v-center', { style: 'gap:4px;padding:10px 10px' },
      w.rows.map((row, i) => button(gt(t[0x1e4 + this.stone(row).map] ?? ''), {
        sel: i === w.cur, style: 'width:100%',
        on: () => { if (w.cur === i) return [AVK.OK]; w.cur = i; },
      }))));
    u.pop();
    u.closeButton();
    u.end();
  }

  /** portal markers (FUN_00018e6c): oc 112/120/128/136 by d8(0x26f11 + target), 8-frame loop */
  private portalMarkers(): Drawable[] {
    const out: Drawable[] = [];
    for (const pt of this.field.map.portals) {
      if (!pt.rects.length) continue;
      const a = pt.rects[0], b = pt.rects[pt.rects.length - 1];
      const kind = this.db.a.d8(0x26f11 + pt.target);
      if (kind > 3) continue;
      const x = a.cx0 * 16 + (((b.cx1 + 1) * 16 - a.cx0 * 16) >> 1) - 5, y = a.cy0 * 16 - 20 + (((b.cy1 + 1) * 16 - a.cy0 * 16) >> 1);
      out.push({ cmfName: 'cmf_oc', cmf: this.field.oc, frame: [112, 120, 128, 136][kind] + ((this.tick >> 1) % 8), x, y, depth: y });
    }
    return out;
  }

  /** lit warp stone (oc 36) over the static grey one once registered */
  private stoneDrawable(): Drawable | null {
    const row = this.stoneRow(), r = this.stone(row);
    if (r.map !== this.field.mapId || !this.story.stones.has(row) || [0x70, 0x71, 0x73].includes(r.map)) return null;
    return { cmfName: 'cmf_oc', cmf: this.field.oc, frame: 36, x: r.x0, y: r.y0, depth: r.y0 + 1 };
  }

  /** kind 5 barriers open by themselves; kind 6 chests give their reward (gimmicks.md §1.3 / §1.4) */
  private updateGimmicks(): void {
    const pb = this.player.box();
    for (const g of this.gimmicks) {
      if (g.gone) continue;
      if (g.kind === 5 && !g.hidden && !g.timer) {
        const tr = g.trigger();
        const inside = pb[0] < tr[2] && tr[0] < pb[2] && pb[1] < tr[3] && tr[1] < pb[3];
        if ((inside || this.events.active) && g.key && this.story.collect.has(g.key) && this.doorExtra(g.key, g.param)) {
          g.timer = 16;
          if (g.param < 16) this.story.doors.add(g.param);
          this.shakeFrom(5);
        }
      }
      if (g.kind === 6 && this.pendingChest === g) {
        this.pendingChest = null;
        if (!this.giveChest(g.param)) { this.hud.message(this.db.a.text[0x1b3b] ?? ''); continue; }
        this.story.chests.add(g.param);
        g.timer = 16;
        this.autosave();
      }
      g.tick();
    }
    this.gimmicks = this.gimmicks.filter((g) => !g.gone);
  }

  /** extra event conditions of some doors (gimmicks.md §1.4 table) */
  private doorExtra(key: number, param: number): boolean {
    const ev = this.events, st = this.story, during = (e: number, c: number) => ev.active && ev.id === e && ev.progress > c;
    if (key === 3 && param === 8) return st.isDone(0x8c) || during(0x8c, 40);
    if (key === 3 && param === 11) return st.isDone(0x65) || during(0x65, 38);
    if (key === 5 && param === 6) return ev.active ? ev.progress > 36 : st.isDone(0x40);
    if (key === 6 && param === 7) return ev.active && ev.id === 0x49 ? ev.progress > 38 : st.isDone(0x49);
    if (key === 7 && param === 9) return ev.active && ev.id === 0x55 && (ev.progress > 38 || st.isDone(0x55));
    return true;
  }

  /** '5': chest in front (FUN_00063cac facing probe) -> popup 0x5F, key check on "yes" */
  private tryChest(): boolean {
    const p = this.player, off = [[-12, -6], [12, -6], [0, -12], [0, 12]][p.dir];
    const qx = p.x + off[0], qy = p.y + off[1];
    const g = this.gimmicks.find((c) => c.kind === 6 && !c.gone && !c.timer && qx >= c.x && qx <= c.x + 28 && qy >= c.y && qy <= c.y + 28);
    if (!g || this.pendingChest) return false;
    this.popup = { p: new Popup(this.ctx, 0x5f), onYes: () => {
      const need = g.b3 === 0 ? 0 : ((g.b3 - 1) % 3) + 1;
      if (need && !this.story.collect.has(need)) {
        this.hud.message((this.db.a.text[0x3cd] ?? '%s').replace('%s', this.db.a.text[0xa46 + need] ?? ''));
        return;
      }
      this.pendingChest = g;
    } };
    return true;
  }

  /** chest reward d+0x26c30 + 4·idx {type, b1, b2, b3} (FUN_00068be4, hardmode.md §4.6) */
  private giveChest(idx: number): boolean {
    const a = this.db.a, o = 0x26c30 + 4 * idx, hard = this.hard, rng = this.rng, inv = this.inv;
    let type = a.d8(o);
    const b2 = a.d8(o + 2), b3 = a.d8(o + 3);
    switch (type) {
      case 0x10: return inv.gain(0x10, hard ? (Math.trunc(b2 / 5) + 1) * 5 - 1 : b2, 0, b3, rng);
      case 0x11: return inv.gain(0x11, hard ? ((b2 >> 2) + 1) * 4 : b2, 0, b3, rng);
      case 0x12: case 0x13: case 0x14: case 0x15: case 0x17: return inv.gain(type, b2, 0, b3, rng);
      case 0x16: return inv.gain(0x16, b2, 0, b3 * (hard ? 5 : 1), rng);
      case 0x1c: return inv.gain(0x1c, (hard ? 50000 : 0) + b3 * 50, 0, 1, rng);
      default:
        if (type < 0x0f) type += this.model.cls;
        return inv.gain(type, b2, b3, 1, rng);
    }
  }

  /** events DANGER_ON / OFF (0x3A / 0x3B): show / hide the battle barriers */
  setDanger(on: boolean): void {
    for (const g of this.gimmicks) if (g.kind === 5 && g.param > 15) g.hidden = !on;
    this.mapType = on ? 2 : 0;
  }

  /** FUN_0002bfd4: nearest visible NPC (behaviour 2) within 24 px */
  private findTalkTarget(): EvActor | null {
    const { x, y } = this.player;
    let best: EvActor | null = null, bd = Infinity;
    for (const a of this.actors) {
      if (!a.visible || (this.ctx.assets.tables.actorTypes[a.id]?.[1] ?? 0) !== 2) continue;
      if (Math.abs(a.x - x) > 24 || Math.abs(a.y - y) > 24) continue;
      const d = (a.x - x) ** 2 + (a.y - y) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /** '5' on an NPC: kind-3 event, else the NPC's line (FUN_0002bdc4 / FUN_0002bc64) */
  private talkTo(npc: EvActor): void {
    const st = this.story;
    for (const e of this.candidates) {
      const h = this.sdb.headers[e];
      if (h.kind === 3 && h.p1 === npc.id && st.isDone(h.p2) && !st.isDone(e)) { this.events.start(e); return; }
    }
    npc.face(npc.x <= this.player.x ? 1 : 0);
    if (npc.id === 0x5c) npc.face(0);
    const stage = st.qs[0x80] === 4 ? 2 : st.qs[0x5e] === 4 ? 1 : 0;
    let t = this.sdb.npcLine(npc.id, stage);
    const { mark, q } = this.quests.marker(npc.id);
    if (mark === 3) t = 0x644 + q;
    else if (mark === 1) t = 0x5ac + q;
    else if (npc.id === 0x9b && st.qs[0x3b] === 2) t = 0x775;
    if (t <= 0) { this.afterTalk(npc, mark, q); return; }
    const a = this.ctx.assets;
    this.talk = { d: new Dialogue(a.text[t] ?? '', a.text[this.sdb.nameId(npc.id)] ?? '', -1), npc, mark, q };
  }

  /** end of NPC talk (FUN_00045008): quest marks, then shops / inn */
  private afterTalk(npc: EvActor, mark: number, q: number): void {
    npc.face(npc.homeDir as Dir);
    if (mark === 1) { this.quests.accept(q); return; }
    if (mark === 3) { this.quests.complete(q); return; }
    if (mark === 2) return;
    const name = this.sdb.nameId(npc.id);
    if (name >= 0x41c && name <= 0x41e) this.shopRequest = name - 0x41c;     // FUN_00045008 -> state 0x16
    else if (name === 0x442) this.shopRequest = 3;
    else if (name === 0x441) this.innPopup(false);
  }

  /** FUN_000712a4: the inner rect warps (FUN_0006d1ec); the 32 px band around a target-0x100 portal
   *  (the 어둠의 정원 entrance on map 0x9f) asks popup 0x5E once */
  private checkPortals(): void {
    const { x, y } = this.player;
    const inside = (r: { cx0: number; cy0: number; cx1: number; cy1: number }, m: number) =>
      r.cx0 * 16 - m <= x && x <= (r.cx1 + 1) * 16 + m && r.cy0 * 16 - m <= y && y <= (r.cy1 + 1) * 16 + m;
    for (const pt of this.field.map.portals) {
      for (const r of pt.rects) {
        if (inside(r, 0)) {
          if (pt.target === 0x9f && this.gardenFlag) {                  // back out of the garden: entrance room
            this.gardenFlag = 0; this.gardenMode = 0; this.arriveT = 0;
            this.pendingWarp = { map: 0x9f, x: 160, y: 400 };
          } else this.pendingWarp = { map: pt.target, x: pt.destX + 0x16, y: pt.destY + 0x1f };
          return;
        }
        if (pt.target === 0x100 && !this.gardenFlag && inside(r, 32)) {
          this.gardenEntry = [pt.destX + 0x16, pt.destY + 0x1f];
          this.gardenFlag = 1;
          this.autosave();
          const no = () => { this.gardenFlag = 0; this.player.x = 160; this.player.y = 400; };   // walks back in the original [근사: teleport]
          this.popup = { p: new Popup(this.ctx, 0x5e), onYes: () => this.enterGarden(), onNo: no };
          return;
        }
      }
    }
  }

  /** FUN_0006ca90 mode 2: alive bit off, the dedicated drops, exp ×2 into the bonus pool, boss -> clear timer */
  private grantDimKill(m: Monster, extra = 0): void {
    const run = this.dim!, f = (this.field.mapId - run.first) & 0xff, boss = m.type === run.boss;
    if (m.dimIdx >= 0 && run.alive[f]) run.alive[f][m.dimIdx] = false;
    run.kills++;
    this.achieve({ k: 'kill', type: m.type, garden: false });
    let exp = killExp(this.rng, m.level, this.model.level, m.typeRec[4], 0, false);
    if (this.mapType >= 2) exp *= 10;
    exp = rdiv(exp * (100 + (this.stats.D[19] ?? 0) / 10), 100);
    this.hud.label(`+${exp * 2} EXP`, m.x, m.y - 40);
    run.pool += exp * 2;
    this.grantExp(exp * 2);
    const drops = rollDimDrops(this.rng, this.db, m, boss, this.stats.goldPct, this.db.tier2);
    if (extra) drops.push(...rollDimDrops(this.rng, this.db, m, false, this.stats.goldPct, this.db.tier2));
    for (const g of drops) if (this.ground.length < 25) this.ground.push(g);
    if (boss) {
      run.clearT = 200;
      for (const g of this.gimmicks) if (g.kind === 5 && g.param > 16) g.gone = true;
    }
  }

  /** FUN_0002d640: save (still mode 0, the return point), then dungeon d from floor 1 */
  enterDimension(d: number): void {
    this.autosave();
    this.dim = newRun(this.db.a, d);
    this.gardenMode = 2;
    this.closeMenu = true;
    const [map, x, y] = dungeonStart(this.db.a, d);
    this.pendingWarp = { map, x, y };
  }

  /** floor records of the run (generated on the first visit), as map actors of the alive ones */
  private async dimFloor(id: number): Promise<{ actor: number; x: number; y: number; param: number; idx: number }[]> {
    const run = this.dim!, f = (id - run.first) & 0xff;
    if (f > 9) return [];
    if (!run.floors[f]) {
      const arr: [number, number][] = [];
      if (f === 0) { const [, sx, sy] = dungeonStart(this.db.a, run.d); arr.push([sx >> 4, sy >> 4]); }
      for (const p of this.field.map.portals) arr.push([(p.destX + 0x16) >> 4, (p.destY + 0x1f) >> 4]);
      for (const p of this.field.map.portals) for (const r of p.rects) arr.push([r.cx0, r.cy0]);
      run.floors[f] = generateFloor(run, f, this.field, arr, this.rng);
      run.alive[f] = run.floors[f]!.map(() => true);
    }
    return run.floors[f]!.map((r, idx) => ({ actor: r.type, x: r.x, y: r.y, param: 3, idx })).filter((a) => run.alive[f][a.idx]);
  }

  /** header stats, no respawn, the floor slot for the alive bit */
  private dimMonster(m: Monster, ac: object): void {
    const st = dimStats(this.dim!, m.type === this.dim!.boss, this.rng);
    m.level = st.level; m.hp = m.maxHp = st.hp; m.atk = st.atk;
    m.noRespawn = true;
    m.dimIdx = (ac as { idx?: number }).idx ?? -1;
  }

  /** boss down -> 200 frames -> result popup 100; its confirm (or leaving from the game over) ends the run */
  private dimTick(): void {
    const run = this.dim;
    if (!run || !run.clearT || this.popup) return;
    if (--run.clearT > 0) return;
    run.cleared = true;
    this.popup = { p: this.dimResult(), onYes: () => this.leaveDimension(), onNo: () => this.leaveDimension() };
  }

  dimResult(): Popup {
    const v = resultValues(this.dim!);
    return new Popup(this.ctx, 100, 0, () => { let k = 0; return (this.db.a.text[0x4d7] ?? '').replace(/%d/g, () => String(v[k++] ?? 0)); });
  }

  /** 'F' (FUN_0005de24): a clear adds the bonus pool and counts the clear; partial save, then the slot is reloaded */
  leaveDimension(): void {
    const run = this.dim;
    if (!run) return;
    if (run.cleared) { this.vitals.exp += run.pool; this.grantExp(0); this.story.dimClears = Math.min(65000, (this.story.dimClears ?? 0) + 1); this.achieve({ k: 'dimClear' }); }
    if (this.mapType < 2 || run.cleared) this.autosave();
    this.reloadRequest = true;
  }

  /** popup 0x5E "yes" (FUN_00053ca0 case 0x1f): map 0x100, mode 1, the garden floor events reset */
  private enterGarden(): void {
    const [gx, gy] = this.gardenEntry;
    this.gardenMode = 1;
    for (let e = 0x9b; e <= 0xa3; e++) this.story.set(e, false);
    this.story.set(0x6b, false); this.story.set(0x6c, false);
    this.ctx.audio.playSfx(0x1f);
    this.arriveT = 0;
    this.pendingWarp = { map: 0x100, x: gx, y: gy };
    this.saveAfterWarp = true;
  }


  /** Screen shake (DAT_003ce6aa): normal -4,+3,-2,+1 horizontally; heavy -12 vertically first. */
  private addShake(heavy: boolean): void {
    this.shake = heavy ? [[0, -12], [3, 0], [-2, 0], [1, 0]] : [[-4, 0], [3, 0], [-2, 0], [1, 0]];
  }

  private grantKill(m: Monster): void {
    if (m instanceof Boss && m.noReward) return;
    const { model, hud } = this;
    this.ctx.audio.playSfx(0x2b);
    const extra = secondDrop(this.rng) ? 1 : 0;                       // track 9 행운의 동전 (account.md §2.4)
    if (this.gardenMode === 2 && this.dim) { this.grantDimKill(m, extra); return; }
    let exp = killExp(this.rng, m.level, model.level, m.typeRec[4], 0, this.hard);
    const mt = this.mapType;
    if (mt >= 2) exp *= 10;                                            // FUN_0006ca90: special maps ×10
    else if (mt === 0 && this.dayPh === 2) exp = rdiv(exp * 130, 100);  // night ×1.3
    hud.label(`+${exp} EXP`, m.x, m.y - 40);
    // drops: 1 (a second one with the account bonus chance, not ported), objects 116..140
    const who = { cls: model.cls, luck: this.stats.luck, goldPct: this.stats.goldPct, hard: this.hard, pLevel: model.level, cap10: this.field.map.header.zone === 13 };
    const drops = m.isBoss
      ? (m.type === 38 && this.gardenMode === 0 ? [] : rollBossDrops(this.rng, this.db, m, who))   // FUN_00037fe4 (Epsilon drops nothing on normal maps)
      : [rollDrop(this.rng, this.db, m, who), ...(extra ? [rollDrop(this.rng, this.db, { ...m, type: m.type, level: m.level, x: m.x + this.rng.rand(10) - 10, y: m.y }, who)] : [])]
        .filter((g): g is GroundItem => !!g);
    for (const g of drops) {
      if (!g.item && this.dayPh === 2) g.gold = rdiv(g.gold * 130, 100);   // night gold ×1.3 (FUN_0003b9c8)
      if (this.ground.length < 25) this.ground.push(g);
    }
    this.achieve({ k: 'kill', type: m.type, garden: this.gardenMode === 1 });
    this.killedHere = true;
    if (this.gardenMode !== 2) {
      this.quests.onKill(m.type);
      this.story.recordKill(m.type, this.field.map.header.zone);
    }
    this.grantExp(exp);
    if (m.isBoss) {                                  // FUN_00061bb0: the boss event 200 frames later
      this.bossG.reset();
      const e = bossDeathEvent(m.type, this.field.mapId);
      if (this.gardenMode === 1 && this.mapType >= 2 && m.type !== 0x2a) this.setDanger(false);   // LAB_0006d046: gate cleared, no story event
      else if (e >= 0 && (!this.story.isDone(e) || (this.gardenMode === 1 && e === 0x6c))) this.pendingEvent = { e, t: 0 };
    }
  }

  /** FUN_000331e8 / actor placement: empty by day, generated once per night */
  private updateDarkStock(): void {
    if (this.dayCounter < 9600) { this.darkStock = []; this.darkState = 0; }
    else if (this.dayCounter >= 10000 && this.darkState === 0) { this.darkStock = genDarkStock(this.db, this.rng); this.darkState = 2; }
  }

  /** FUN_00025990 + counter (field frames outside events / popups / menus) */
  private dayTick(): void {
    for (const [at, steps, target, log] of DAY_EVENTS) {
      if (this.dayCounter !== at) continue;
      this.dayFade = { steps, target, row: 0 };
      this.dayPh = 3;
      this.hud.message(this.dayText(log));
      if (at === 14800) this.dayCounter = 0;
    }
    if (this.dayPh === 3) {
      if (this.dayFade.steps > 0) { this.dayFade.row = this.dayFade.steps - 1 + TINT_BASE[this.dayFade.target]; this.dayFade.steps--; }
      else this.dayPh = this.dayFade.target;
    }
    this.dayCounter++;
    this.updateDarkStock();
  }
  /** day/night log lines (FUN_0001e6e8 messages 0x11 / 0x12 / 0x14) */
  private dayText(id: number): string {
    return id === 0x11 ? '날이 어두워집니다.' : id === 0x12 ? '밤이 되었습니다. 몬스터들이 강해집니다.' : '낮이 되었습니다.';
  }
  /** palette row of this frame */
  private tintIndex(): number { return this.dayPh === 3 ? this.dayFade.row : TINT_BASE[this.dayPh]; }

  /** return stone warp (FUN_00024b80 kind 2): 18 frames, then the destination with a fade */
  private warpWarp(): boolean {
    if (++this.warpT < 18) return false;
    this.warpT = -1;
    const [map, x, y] = returnPoint(this.db.a, this.returnZone, this.model.cls);
    this.hud.message((this.db.a.text[0x1e4 + map] ?? '') + '|} 이동합니다.');
    this.pendingWarp = { map, x, y };
    return true;
  }

  /** combat.md §3.10 shake from DAT_003ce6aa = v: 1..7 horizontal (8 - v) alternating */
  private shakeFrom(v: number): void {
    this.shake = [];
    for (let k = v; k < 8; k++) this.shake.push([((k & 1) * 2 - 1) * (8 - k), 0]);
  }

  /** boss requests of this tick: shake, flash, roar slow, summons, projectiles */
  private applyBossFx(b: Boss): void {
    const fx = b.fx;
    if (fx.shake) this.shakeFrom(fx.shake);
    if (fx.flash) this.flash = fx.flash;
    if (fx.slowPlayer) this.player.slowT = fx.slowPlayer;
    if (fx.shots) this.shots.push(...fx.shots);
    if (fx.summon) {
      const cmf = this.cmfCacheGet(3);
      if (cmf && this.monsters.length < 38) {
        const m = new Monster(3, `cmf_c${this.ctx.assets.tables.actorTypes[3][0]}`, cmf, fx.summon.x, fx.summon.y, 1, this.ctx.assets.tables.actorTypes[3]);
        Object.assign(m, summonStats(b));
        m.maxHp = m.hp;
        m.parent = b;
        m.state = 2;
        this.monsters.push(m);
      }
    }
    b.fx = {};
  }
  private cmfCacheGet(id: number): Cmf | undefined { return this.cmfCache.get(id); }

  /** experience and level ups (FUN_00029b1c) */
  grantExp(exp: number): void {
    const { model, vitals, hud } = this;
    vitals.exp += exp;
    let ups = 0;
    while (model.level < MAX_LEVEL && vitals.exp >= expNeed(model.level)) {
      model.level++; ups++;
      if (traitOnLevelUp(model.level) === 'full') hud.message(this.db.a.text[0x1a69] ?? '');   // every 20 levels (FUN_00029b1c)
    }
    if (ups) {                                 // FUN_00029b1c: +4 stat / +1 skill point per level, full HP/MP
      this.statPoints += 4 * ups;
      this.skillPoints += ups;
      this.recompute();
      vitals.hp = this.stats.maxHp;
      vitals.mp = this.stats.maxMp;
      hud.label('LEVEL UP', this.player.x, this.player.y - 56);
    }
  }

  recompute(): void {
    this.model.buffs = this.buffs.effects(this.db.a);
    this.model.traits = traitStatBonus();
    this.model.titles = titleBonus(this.db.a, this.story.titles, this.story.title);
    this.stats = derive(this.model, this.tables);
    this.vitals.hp = Math.min(this.vitals.hp, this.stats.maxHp);
    this.vitals.mp = Math.min(this.vitals.mp, this.stats.maxMp);
  }

  /** 오토루팅 (0x1b sub 13, +0x32a5 bit 3; FUN_0002f184 kind 0): every ground item is gained as it is drawn,
   *  coupons (0x1b sub 0x1b) excepted; a refused one is marked failed like a '5' pickup (no pickup sound) */
  private autoLoot(): void {
    let got = false;
    this.ground = this.ground.filter((g) => {
      if (g.failed || (g.item?.type === 0x1b && g.item.sub === 0x1b)) return true;
      const ok = g.item ? this.inv.gain(g.item.type, g.item.sub, g.item.grade, 1, this.rng, g.item) : this.inv.gain(0x1c, g.gold, 0, 1, this.rng);
      if (!ok) g.failed = true;
      got ||= ok;
      return !ok;
    });
    if (got) this.quests.onItems();
  }

  /** '5' on a ground item (FUN_00045570 pickup priority): gain it, or mark it failed. */
  private tryPickup(): boolean {
    const pb = this.player.box();
    const g = this.ground.find((it) => !it.failed && overlaps(pb, groundBox(it)));
    if (!g) return false;
    if (g.item && g.item.type < 0x10 && this.dim) this.dim.equips++;     // DAT_003dc1a0 (counted on the attempt)
    const ok = g.item ? this.inv.gain(g.item.type, g.item.sub, g.item.grade, 1, this.rng, g.item)
      : this.inv.gain(0x1c, g.gold, 0, 1, this.rng);
    if (ok) { this.ground.splice(this.ground.indexOf(g), 1); this.ctx.audio.playSfx(0x17); this.quests.onItems(); } else g.failed = true;
    return true;
  }

  /** FUN_00040498 for potions (0x11 sub 1..12): restore, count--, group cooldown. */
  useItem(idx: number): boolean {
    const it = this.inv.items[idx], v = this.vitals, st = this.stats;
    if (!it || it.count <= 0) return false;
    if (it.enh !== 0) return false;                                      // cooling down
    if (it.type === 0x11 && it.sub === 13) {                             // status cure: +0x54..+0x5a = 0
      if (this.poison || this.player.slowT || this.player.stun) this.achieve({ k: 'cure' });
      this.poison = 0; this.player.slowT = 0; this.player.stun = 0;
      return this.consume(idx);
    }
    if (it.type === 0x11 && it.sub >= 14 && this.gardenMode === 2) { this.hud.message(this.db.a.text[0x1abf] ?? ''); return false; }   // not in the dimension
    if (it.type === 0x11 && it.sub >= 14) {                              // elixirs -> buff slot sub-14
      this.buffs.start(it.sub - 14);
      this.recompute();
      this.hud.message((this.db.a.text[0x1ac0] ?? '%s').replace('%s', it.name));
      this.inv.setGroupCooldown(it.type, it.sub, this.stats.potionCdReduction);
      return this.consume(idx);
    }
    if (it.type === 0x11 && it.sub === 0) return this.useReturnStone(idx);
    if (it.type === 0x1b) return this.useMisc(idx);
    if (it.type !== 0x11 || it.sub < 1 || it.sub > 12) return false;
    const T = this.db.a.d8(0x24b0f + it.sub);
    const amount = idiv((100 + st.potionPct) * 10 * T, 100);
    const hp = it.sub <= 4 || it.sub >= 9, mp = it.sub >= 5;
    if ((!hp || v.hp >= st.maxHp) && (!mp || v.mp >= st.maxMp)) { this.hud.message(this.db.a.text[211] ?? ''); return false; }
    if (hp) v.hp = Math.min(st.maxHp, v.hp + amount);
    if (mp) v.mp = Math.min(st.maxMp, v.mp + (it.sub >= 9 ? idiv((100 + st.potionPct) * 8 * T, 100) : amount));
    it.count--;
    this.achieve({ k: 'potion' });
    this.inv.setGroupCooldown(it.type, it.sub, st.potionCdReduction);
    if (it.count <= 0) this.inv.remove(idx);
    return true;
  }

  private consume(idx: number): boolean {
    const it = this.inv.items[idx]!;
    it.count--;
    if (it.count <= 0) this.inv.remove(idx);
    this.quests.onItems();
    return true;
  }

  /** return stone (misc-systems.md §2.1): refused mid-action, in zone 13 or special maps */
  private useReturnStone(idx: number): boolean {
    const t = this.db.a.text;
    if (this.player.action !== 0 || this.warpT >= 0) { this.hud.message(t[215] ?? ''); return false; }
    if (this.field.map.header.zone === 13 || this.mapType >= 2 || this.gardenMode === 2 || this.vitals.hp <= 0) { this.hud.message(t[0x1abe] ?? ''); return false; }
    if (this.vitals.hp * 10 <= this.stats.maxHp) this.achieve({ k: 'lowHpReturn' });
    this.warpT = 0;
    this.vitals.invuln = 10;
    return this.consume(idx);
  }

  /** FUN_00040498 type 0x1b (game-rules.md §5.4): sub 2 half HP/MP, 4 stat reset, 5 skill reset, 7 both,
   *  0x1e random gem, 0x1f EXP +10000. Boxes, packages and account resets are not ported. */
  private useMisc(idx: number): boolean {
    const it = this.inv.items[idx]!, v = this.vitals, st = this.stats, m = this.model;
    if (it.sub >= 0x15 && it.sub <= 0x17) {                              // 차원의 문 only: every other buff off, slot sub + 7
      if (this.gardenMode !== 2) { this.hud.message(this.db.a.text[0x1ac2] ?? ''); return false; }
      this.buffs.clear(); this.buffs.start(it.sub + 7); this.recompute();
      this.countUse(it.sub);
      this.hud.message((this.db.a.text[0x1ac0] ?? '%s').replace('%s', it.name));
      return this.consume(idx);
    }
    if (it.sub >= 0x23 && it.sub <= 0x26) {                              // special elixirs -> slots 31..34
      this.buffs.start(it.sub - 4); this.recompute();
      this.hud.message((this.db.a.text[0x1ac0] ?? '%s').replace('%s', it.name));
      return this.consume(idx);
    }
    const box = boxEquipment(this.db, this.inv, it.sub, m.level, m.cls, this.rng);   // equipment boxes and packages (§3)
    if (box !== null) {
      if (box === 'full') { this.popup = { p: new Popup(this.ctx, 0x78) }; return false; }
      if (box === 'slots') { this.hud.message(this.db.a.text[0x1ac1] ?? ''); this.popup = { p: new Popup(this.ctx, 0x52) }; return false; }
      if (box === 'gold') { this.hud.message(this.db.a.text[0x1abc] ?? ''); this.popup = { p: new Popup(this.ctx, 0x5a) }; return false; }
      this.consume(idx); this.autosave(); return true;
    }
    switch (it.sub) {
      case 2: v.hp = Math.min(st.maxHp, v.hp + (st.maxHp >> 1)); v.mp = Math.min(st.maxMp, v.mp + (st.maxMp >> 1)); this.countUse(2); break;
      case 6: traitReset(); this.recompute(); break;                     // 특성 초기화
      case 0x20: traitBox(Math.max(1, it.level)); break;               // 특성 스킬 상자: points += item level (FUN_00040498 48232)
      case 4: case 5: case 7:
        if (it.sub === 7) traitReset();
        if (it.sub !== 5) { m.stats.splice(0, 4, ...CLASSES[m.cls].stats); this.statPoints = m.level * 4; }
        if (it.sub !== 4) {
          this.skills.fill(0); this.skills[0] = 1; this.skillPoints = m.level;
          for (const q of this.inv.quick) if (q.kind === 1) { q.kind = 0; q.id = 0; }
        }
        this.recompute();
        break;
      case 0x1e: {                                                        // rare gem box: quality 2..4, tier 2..4
        const kind = this.rng.rand(5);
        this.rng.rand(1000);
        const r2 = this.rng.rand(1000), r3 = this.rng.rand(1000);
        let q = r2 <= 749 ? 2 : r2 <= 989 ? 3 : 4;
        const tier = r3 <= 299 ? 2 : r3 <= 699 ? 3 : 4;
        if (tier < 4) q = Math.min(q, 3);
        if (!this.inv.gain(0x10, kind * 5 + tier, q, 1, this.rng)) { this.hud.message(this.db.a.text[0x1ac1] ?? ''); return false; }
        break;
      }
      case 0x1f: this.grantExp(it.level === 0 ? it.count * 10000 : 10000); break;   // EXP box: count × 10000 (original)
      case 0x22: {                                                        // power elixir box: one special elixir × 5
        this.inv.gain(0x1b, 0x23 + (this.rng.rand(10000) % 4), 0, 5, this.rng);
        break;
      }
      default: this.hud.message(this.db.a.text[0x1ac2] ?? ''); return false;
    }
    return this.consume(idx);
  }

  /** FUN_000452a0 quick slot use: items, or skills (actTick 0, cooldown 0, MP >= cost). */
  private useQuick(slot: number): void {
    const q = this.inv.quick[slot];
    if (q.kind === 2 && q.cd === 0) { this.useItem(q.id); return; }
    if (q.kind !== 1 || q.cd !== 0 || this.player.actTick !== 0 || this.buffs.isOn(20)) return;
    const a = q.id, s = A2S[a], r = skillRec(this, s), D = this.stats.D;
    const eff = effectiveSkillLevel(this.skills[s], s, D);
    const idx = eff === 0 ? -1 : Math.min(eff + D[38] - 1, 14);
    let cost = r[1] + idx * r[4];
    cost -= Math.trunc((cost * traitVal(4)) / 100);                 // track 4 절약 (FUN_000452a0)
    if (this.vitals.mp < cost) return;
    this.vitals.mp -= cost;
    q.cd = q.maxCd;
    if (this.tick - this.lastSkillTick <= 30) this.achieve({ k: 'skillChain' });
    this.lastSkillTick = this.tick;
    this.player.startSkill(a);
  }

  private projRecord(kind: number): ProjRecord {
    const a = this.db.a, o = 0x21592 + kind * 18;
    return { frame: a.d16(o), action: a.d8(o + 2), status: a.d8(o + 6), type: a.d16(o + 8) };
  }

  private spawn(kind: number, idx = 0, ex = 0, ey = 0): void {
    if (this.projectiles.length >= 60) return;
    const rec = this.projRecord(kind);
    this.projectiles.push(new Projectile(kind, rec, this.player, this.sheets[rec.type] ?? this.player.cmf, idx, ex, ey));
  }

  /** Action-record events (skills.md §0.2): projectiles 9..26 (21 = five kind 13), 29 = pull. */
  private actionEvent(ev: number): void {
    if (ev === 21) { for (let i = 0; i < 5; i++) this.spawn(13, i); return; }
    if (ev >= 9 && ev <= 26) { this.spawn(ev - 8); return; }
    if (ev === 29) {
      const hole = this.projectiles.find((p) => p.pulling);
      if (!hole) return;
      for (const m of this.monsters) {
        if (!m.alive || m.typeRec[1] === 11 || Math.hypot(m.x - hole.x, m.y - hole.y) >= 150) continue;
        m.pull = { x: hole.x, y: hole.y, ticks: 28 };
      }
    }
  }

  /** Damage of one hit by the player or a projectile with skill action id aid (100 = basic). */
  private hitMonster(aid: number, m: Monster, b: Rect, srcX: number, srcY: number, dir: number, fromPlayer: boolean): void {
    const { model, stats, hud } = this;
    let base: number | undefined;
    if (aid !== 100) {
      const s = A2S[aid], r = skillRec(this, s);
      const lv = effectiveSkillLevel(this.skills[s], s, stats.D);
      base = skillBaseDamage(stats.atk, r[0], r[3], lv, stats.D[46], s, this.ctx.assets.tables.actorElements[m.type]?.[0] ?? 0);
    }
    const r = playerHit(this.rng, { level: model.level, atk: stats.atk, acc: stats.acc, crit: stats.crit, critDmg: stats.critDmg }, { level: m.level }, base);
    if (r.miss) { hud.miss(srcX, srcY - 43); return; }
    let dmg = r.dmg;
    if (fromPlayer && aid === 100 && this.player.action === 3 && model.cls !== 1) dmg = rdiv(dmg * 120, 100);   // 3rd hit x1.2
    if (r.crit && fromPlayer) hud.crit(srcX, srcY - 43);
    const tgt = m instanceof Boss && m.main ? m.main : m;
    const full = tgt.hp >= tgt.maxHp;
    if (tgt.firstHit < 0) tgt.firstHit = this.tick;
    tgt.hp -= dmg;
    if (dmg * 2 >= tgt.maxHp) this.achieve({ k: 'bigHit' });
    if (tgt.hp <= 0) {
      if (full) this.achieve({ k: 'oneHitKill' });
      if (fromPlayer && aid === 100) this.achieve({ k: 'basicKill' });
      if (this.tick - tgt.firstHit <= 100) this.achieve({ k: 'quickKill' });
    }
    this.ctx.audio.playSfx(0x20 + model.cls);                         // FUN_0006e120 hit sound
    hud.damage(dmg, m.x, b[1] - 33);
    // elixir effects in FUN_0006d2f8: explosion +dmg/5, freeze +dmg/10 and slow 25, plunder gold
    if (this.buffs.isOn(18) && this.rng.rand(1000) < 100) { tgt.hp -= Math.trunc(dmg / 5); hud.damage(Math.trunc(dmg / 5), m.x, b[1] - 48); }
    if (this.buffs.isOn(19) && this.rng.rand(1000) < 100) { tgt.hp -= Math.trunc(dmg / 10); if (!m.isBoss) m.slow = 25; }
    if (this.buffs.isOn(27) && this.rng.rand(1000) < 50) {
      const L = m.level;
      this.inv.gain(0x1c, Math.trunc(((2 * L + 3 + rdiv(this.rng.rand(L), 3)) * 3) / 10), 0, 1, this.rng);
    }
    if (fromPlayer || r.crit) this.addShake(r.crit);
    if (!m.isBoss && m.type <= 42) {
      // FUN_0006d2f8 options 27..30 (stun -> poison -> dark -> slow), duration d8(0x253a7 + k)·6·(100 − D36)/100
      if (fromPlayer || aid === 100) for (let k = 3; k >= 0; k--) {
        const opt = stats.D[27 + k] ?? 0;
        if (!opt || this.rng.rand(100) > opt % 41) continue;
        const dur = Math.trunc((this.db.a.d8(0x253a7 + k) * 6 * (100 - (stats.D[36] ?? 0))) / 100);
        if (k === 3) { if (m.stun <= 0) m.startStun(dur); }
        else if (k === 2) { if (m.poison <= 0) m.poison = dur; }
        else if (k === 1) { if (m.dark <= 0) m.dark = dur; }
        else if (m.slow <= 0) m.slow = dur;
      }
      if (fromPlayer && model.cls === 0 && (this.player.action === 4 || this.player.action === 5)) m.stunAfter = true;   // +0x8f = 3
    }
    m.onHit(dir as Dir, false);
  }

  private updateProjectiles(): void {
    const live = this.monsters.filter((m) => m.alive);
    for (const p of this.projectiles) {
      if (p.fresh) { p.fresh = false; continue; }
      const box = p.attackBox();
      if (box) {
        let hit = false;
        for (const m of live) {
          const b = m.body();
          if (!m.alive || !b || !overlaps(box, b)) continue;
          if (p.contactExplodes()) { hit = false; break; }
          this.hitMonster(p.skillAid, m, b, p.x, p.y, p.dir, false);
          hit = true;
          // c1 ice column slow (skills.md §3.2)
          const slow = p.action === 5 ? (this.skills[1] >> 1) + 25 : p.action === 6 ? (this.skills[4] >> 1) + 30 : p.action === 7 ? this.skills[7] + 30 : 0;
          if (p.type === 1 && slow && m.typeRec[1] !== 11) m.slow = slow;
          if (p.type === 1 && p.action >= 2 && p.action <= 4) m.burn = 12;          // +0x5c burn mark
          if (p.type === 1 && p.action >= 5 && p.action <= 7) m.chill = 9;          // +0x5e chill mark
          if (p.kind === 2) this.projectiles.push(new Projectile(19, this.projRecord(19), { ...this.player, dir: p.dir }, this.sheets[0], 0, m.x, b[1]));
          if (m.hp <= 0 && !m.alive) continue;
        }
        if (hit) p.onHit();
      }
      const out = p.update(live);
      if (out.spawn20) { this.spawn(20, 0, ...out.spawn20); this.spawn(20, 1, ...out.spawn20); }
    }
    this.projectiles = this.projectiles.filter((p) => !p.gone);
  }

  /** Player attack box against monster bodies

  /** Player attack box against monster bodies, nearest first; every overlap is a hit (FUN_0006e8a8). */
  private resolvePlayerAttack(): void {
    const { player } = this;
    const atk = player.attack;
    if (!atk) return;
    const targets = this.monsters.filter((m) => m.alive)
      .map((m) => ({ m, d: (m.x - player.x) ** 2 + (m.y - player.y) ** 2, b: m.body() }))
      .filter((t) => t.b && overlaps(atk, t.b))
      .sort((a, b) => a.d - b.d);
    for (const { m, b } of targets) {
      // "+0x76 == 10" rule hits c0 drill sword: first contact turns the player up, no damage (§2.3)
      if (player.action === 10 && this.model.cls === 0 && player.dir !== 2) { player.dir = 2; player.lastV = 2; return; }
      this.hitMonster(player.skillAid, m, b!, player.x, player.y, player.dir, true);
    }
  }

  /** Monster attack boxes against the player body (FUN_0006fd44 / FUN_0006f370). */
  private resolveMonsterAttacks(): void {
    const pb = this.player.box();
    for (const m of this.monsters) {
      const ab = m.attackBox();
      if (!ab || !overlaps(ab, pb)) continue;
      if (m instanceof Boss && m.type === 39 && m.role === 1 && m.rec === 3) { if (!this.player.grabbed) this.player.grab(); continue; }
      this.monsterHitsPlayer(m, m.action, m instanceof Boss && m.main ? m.main : m);
    }
    for (const s of [...this.shots]) {
      const ab = s.box();
      if (!ab || !overlaps(ab, pb) || s.gone) continue;
      const kind = s.o.onHit ?? 'remove';
      if (kind === 'explode' && !s.exploded) { s.explode(); continue; }       // 38 orb: first touch only explodes
      // the parent boss is the attacker with its current action, except type 17 (the blob itself, action 9)
      const atk = s.selfAttack ? { level: 0, atk: s.owner.atk } : s.owner.main ?? s.owner;   // the parent monster is the attacker
      const hit = this.monsterHitsPlayer(atk, s.selfAttack ? 9 : s.owner.action, s.owner.main ?? s.owner);
      if (!hit) continue;
      if (kind === 'stop') s.stopped = true;
      else if (kind === 'flame') {
        if (s.frame === 0x24) this.shots.push(new MonsterShot(s.owner, this.player.x, this.player.y + 15, { frame: 0x20, life: 20, loop: [0x20, 0x23], onHit: 'keep', flame: true }));
        s.gone = true;
      } else if (kind === 'remove') s.gone = true;
    }
  }

  /** FUN_0006f370: pre-invincibility boss effects, hit roll, boss multiplier and knockback (monster-ai.md §2.3) */
  private monsterHitsPlayer(atk: { level: number; atk: number }, action: number, src: Monster): boolean {
    const { player, vitals, hud } = this;
    if (this.dead) return false;
    const type = src.isBoss ? src.type : -1;
    if (type === 5 && action === 12) {               // landing push: away from the landing corner, +5 speed
      let c = this.bossG.get(0x1d);
      if (c === 3) {
        const dx = player.x - src.x, dy = player.y - src.y;
        c = Math.abs(dy) < Math.abs(dx) ? (src.x < player.x ? 0 : 1) : (src.y < player.y ? 2 : 3);
      }
      player.startKnock(6, src.x, src.y, { dir: c as Dir, bonus: 5 });
    } else if (type === 8 && action === 6) player.startKnock(6, src.x, src.y, { stun: true });
    if (vitals.invuln || vitals.tint) return false;
    const r = monsterHit(this.rng, atk, { level: this.model.level, def: this.stats.def, evade: this.stats.evade + (src.dark > 0 ? 50 : 0), stunned: player.stun > 0 });
    vitals.invuln = 5;
    if (r.miss) { hud.miss(player.x, player.y - 43); this.achieve({ k: 'evade' }); return false; }
    let dmg = r.dmg, knock: 0 | 6 | 7 = 0, pct = 100;
    switch (type) {
      case 5: if (action === 12) pct = 150; break;
      case 8: if (action === 6) pct = 240; break;
      case 11: if (action === 8) { pct = 140; knock = 7; } else if (action !== 6) knock = 6; break;
      case 14: if (action === 9) { pct = 200; if (player.slowT === 0) knock = 6; } break;
      case 17: if (action === 9) this.poison = 200; else if (this.rng.rand(5) <= 1) knock = 7; break;
      case 20: if (action === 6) { pct = 200; knock = 7; } else if (action === 8) pct = 300; break;
      case 23: this.bossG.set(0x1e, this.bossG.get(0x1e) + 1); break;           // times the player was hit
      case 26: if (action === 9) { pct = 200; knock = 6; } break;
      case 29: if (action === 3) { pct = 150; knock = 7; } else if (action === 4) pct = 200; break;
      case 32: if (action === 2) pct = 300; else if (action === 3) pct = 200; else if (action === 4) { pct = 200; knock = 6; } else knock = 6; break;
      case 35: if (action === 2) { pct = 300; knock = 6; } break;
      case 38: if (action === 2) knock = 6; else if (action === 3) pct = 300; else if (action === 4) pct = 70; break;
      case 39: if (action === 5) { pct = 200; knock = 6; } break;
      case 42: if (action === 2) knock = 6; else if (action === 3) pct = 200; break;
    }
    // FUN_00060d10 exceptions: 38/42 action 2 and 32 action 1 push the player down (dir 2)
    const down = ((type === 38 || type === 42) && action === 2) || (type === 32 && action === 1);
    if (pct !== 100) dmg = rdiv(dmg * pct, 100);
    if (this.dayPh === 2 && this.mapType === 0) dmg = rdiv(dmg * 120, 100);   // night
    if (this.buffs.isOn(20) && src.alive) {                            // 인내의 비약: reflect 2·dmg, take half
      const back = 2 * dmg;
      (src instanceof Boss && src.main ? src.main : src).hp -= back;
      hud.damage(back, src.x, src.y - 60);
      if (src.hp <= 0) src.onHit(0, false);
      dmg >>= 1;
    }
    if (knock && !player.knock) player.startKnock(knock, src.x, src.y, down ? { dir: 2 } : {});
    vitals.hp -= dmg;
    vitals.tint = 5;
    hud.hurt(dmg, player.x, player.y - 40);
    if (this.run && !this.run.success) this.cancelGather();
    if (vitals.hp <= 0) { vitals.hp = 0; this.dead = true; player.action = 0; this.story.recordDeath(src.type); this.buffs.clear(); this.achieve({ k: 'death' }); }
    return true;
  }

  update(presses: number[]): void {
    this.tick++;
    if (this.busy || this.dead) return;
    if (this.popup) {
      const r = this.popup.p.handle(presses);
      if (this.popup.onCancel && presses.includes(AVK.CLR)) { const c = this.popup.onCancel; this.popup = null; c(); return; }
      if (r) { const { onYes, onNo } = this.popup; this.popup = null; if (r === 'yes' || r === 'ok') onYes?.(); else onNo?.(); }
      return;
    }
    if (this.warpList) { this.warpKeys(presses); return; }
    if (this.events.active) {
      this.events.update(presses);
      if (this.events.active) {
        const w: MonsterWorld = { field: this.field, rng: this.rng, gtick: this.tick, px: this.player.x, py: this.player.y, playerBox: this.player.box(), playerAlive: true };
        for (const m of this.monsters) if (m instanceof Boss) m.eventTick(w, this.events.id, this.events.progress);
        for (const p of this.projectiles) p.update([]);            // pose effects play out, they hit nothing in events
        this.projectiles = this.projectiles.filter((p) => !p.gone);
      }
      return;
    }
    if (this.talk) {
      const t = this.talk;
      t.npc.update();
      t.d.tick();
      if (presses.includes(AVK.OK) && t.d.advance()) { this.talk = null; this.afterTalk(t.npc, t.mark, t.q); }
      return;
    }
    if (this.pendingEvent && ++this.pendingEvent.t >= 200) { const e = this.pendingEvent.e; this.pendingEvent = null; this.events.start(e); return; }
    if (this.pendingWarp) {
      const w = this.pendingWarp;
      this.pendingWarp = null;
      const save = this.saveAfterWarp;
      this.saveAfterWarp = false;
      void this.enterMap(w.map, w.x, w.y).then(() => { if (save) this.autosave(); });
      return;
    }
    this.playTicks++;
    if (this.buffs.tick(this.db.a)) this.recompute();
    if (this.gardenMode !== 2) this.dayTick();                         // day/night stops in the dimension
    if (this.warpT >= 0 && this.warpWarp()) return;
    if (this.arriveT >= 0 && ++this.arriveT >= 18) this.arriveT = -1;
    this.dimTick();
    this.achTick();
    if (this.fortunePending && !this.popup && !this.events.active && !this.talk) { this.fortunePending = false; this.openFortune(); }
    if (this.bannerT >= 0 && ++this.bannerT >= 32) this.bannerT = -1;
    this.checkRestPoint();
    this.hud.tick();
    if (this.shake.length) this.shake.shift();
    this.inv.tick();
    this.ground = this.ground.filter(updateGround);
    if (this.inv.unlocked(13)) this.autoLoot();
    this.talkTarget = this.findTalkTarget();
    if (this.run) { if (this.gatherTick(presses)) return; }
    if (presses.includes(AVK.OK) && this.player.controllable && this.talkTarget && this.player.action === 0) { this.talkTo(this.talkTarget); return; }
    if (presses.includes(AVK.OK) && this.player.controllable && this.player.action === 0 && this.tryGate()) return;
    if (presses.includes(AVK.OK) && this.player.controllable && this.player.action === 0 && this.tryChest()) return;
    if (presses.includes(AVK.OK) && this.player.controllable && !this.tryPickup()) {
      if (this.player.action === 0 && this.tryGather()) return;
      if (this.buffs.isOn(20)) this.hud.message(this.db.a.text[0x1ae0] ?? '');   // 인내의 비약: no attacks
      else this.player.startAttack();
    }
    const QUICK: number[] = [AVK.K1, AVK.K3, AVK.K7, AVK.K9, AVK.STAR, AVK.POUND];
    for (const k of presses) { const i = QUICK.indexOf(k); if (i >= 0) this.useQuick(i); }
    this.updateCamera();
    const blockers: Blockers = {
      solid: [...this.actors.filter((a) => a.visible).map((a) => a.rect()), ...this.gimmicks.filter((g) => g.solid).map((g) => g.body())],
      monsters: this.monsters.filter((m) => m.alive).map((m) => m.body()).filter((b): b is Rect => !!b),
    };
    for (const a of this.actors) a.update();
    this.updateGimmicks();
    const px0 = this.player.x, py0 = this.player.y;
    this.player.update(this.ctx.input, this.field, blockers);
    this.idleFrames = px0 === this.player.x && py0 === this.player.y ? this.idleFrames + 1 : 0;
    if (this.ctx.options.speed === 0) this.story.counters.slowFrames = (this.story.counters.slowFrames ?? 0) + 1;
    if (this.player.sound) this.ctx.audio.playSfx(this.player.sound);
    this.resolvePlayerAttack();
    this.updateProjectiles();
    const world: MonsterWorld = {
      field: this.field, rng: this.rng, gtick: this.tick, px: this.player.x, py: this.player.y,
      playerBox: this.player.box(), playerAlive: !this.dead,
      monsterBoxes: this.monsters.filter((m) => m.alive && !m.isBoss).map((m) => m.body()).filter((b): b is Rect => !!b),
    };
    for (const m of [...this.monsters]) {
      if (this.bannerT >= 0 && m.isBoss) continue;                    // behaviour 0x11: waits for the banner
      if (m instanceof Boss) { m.playerSlowed = this.player.slowT > 0; m.playerPoisoned = this.poison > 0; m.playerGrabbed = this.player.grabbed; }
      if (m.update(world) === 'dead') this.grantKill(m);
      for (const so of m.shotsOut) this.shots.push(new MonsterShot(m, so.x, so.y, so.o));
      m.shotsOut = [];
      if (m instanceof Boss) {
        this.applyBossFx(m);
        if (m.pullPlayer !== undefined) this.player.pullTo = m.pullPlayer;
        if (m.grab === false) this.player.grabbed = false;
      }
    }
    for (const s of this.shots) s.update(this.player.x, this.player.y, (n) => this.rng.rand(n));
    this.shots = this.shots.filter((s) => !s.gone);
    this.poisonTick();
    if (this.poison > 0) {                           // poison: 1 s ticks of HP/10 (not on the tick it reaches 0)
      if (--this.poison > 0 && this.poison % 20 === 0) { const d = Math.trunc(this.vitals.hp / 10); if (d > 0 && this.vitals.hp > d) { this.vitals.hp -= d; this.hud.hurt(d, this.player.x, this.player.y - 40); } }
    }
    if (this.flash > 0) this.flash >>= 1;
    this.resolveMonsterAttacks();
    if (this.vitals.invuln) this.vitals.invuln--;
    if (this.vitals.tint) this.vitals.tint--;
    this.checkPortals();
    if (!this.pendingWarp) this.checkTriggers();
  }

  /** FUN_0007352c: 극독의 비약 (buff 14) poisons monsters within 50 px every 20 buff frames, and poisoned
   *  monsters take player ATK/20 (min 1) every 20 ticks without dying (leftovers-combat.md §1.1 / §1.5) */
  private poisonTick(): void {
    const b = this.buffs.slots[14], live = this.monsters.filter((m) => m.alive);
    if (b?.on && b.t % 20 === 0) {
      // the original runs this block once per active object, so each monster gets that many rolls
      const rolls = 1 + live.length + this.shots.length + this.projectiles.length;
      for (const m of live) {
        if (Math.hypot(m.x - this.player.x, m.y - this.player.y) >= 50) continue;
        for (let k = 0; k < rolls; k++) {
          const r = this.rng.rand(1000);
          if (m.poison <= 0 && r <= this.model.level - m.level + 299) m.poison = 80;
        }
      }
    }
    const atk = this.stats.atk, dmg = atk >= 20 ? Math.trunc(atk / 20) : 1;
    for (const m of live) {
      if (m.poison <= 0 || --m.poison === 0 || m.poison % 20 !== 0) continue;
      m.hp = Math.max(1, m.hp - dmg);
      const bx = m.body();
      this.hud.damage(dmg, m.x, (bx ? bx[1] : m.y) - 48);
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
      const d = a.drawable();
      if (!d) continue;
      if (this.partHide === 0x22c && a.id === 0x2c) d.hideClips = [0x11, 0x02];
      ents.push(d);
    }
    for (const g of this.gimmicks) ents.push(...g.drawables(field.oc));
    for (const n of this.nodes) { n.t++; ents.push(n.drawable(field)); }
    ents.push(...this.portalMarkers());
    { const sd = this.stoneDrawable(); if (sd) ents.push(sd); }
    // events hide normal monsters (except 0x66 / 0x56 / 0x4f / 0x50); bosses stay as part of the scene
    for (const m of this.monsters.slice().reverse()) { if (ev && !m.isBoss && !this.events.keepsMonsters) continue; const d = m.drawable(); if (d) ents.push(d); }
    for (const g of this.ground) ents.push(groundDrawable(g, this.db));
    for (const p of this.projectiles) ents.push(p.drawable());
    if (!ev) for (const s of this.shots) ents.push(s.drawable());
    const pd = player.drawable();
    // hit tint 12, 8, 4, 0 and off on ticks where (invuln & 2) (combat.md §5.2)
    if (vitals.tint && !(vitals.invuln & 2)) pd.fx = { tint: [255, 0, 0], amount: Math.max(0, vitals.tint * 4 - 8) };
    else if (this.poison > 0 && (this.poison >> 2) & 1) pd.fx = { tint: [0, 0x66, 0], amount: 24 };
    if (this.warpT > 9) pd.fx = { ...pd.fx, alpha: Math.max(0, (13 - this.warpT) * 6) };
    if (this.lead) { const d = this.lead.drawable(); if (d) ents.push(d); } else ents.push(pd);
    const originX = field.width < VIEW_W ? (VIEW_W - field.width) >> 1 : 0;
    const [sx, sy0] = this.shake[0] ?? [0, 0];
    const sy = sy0 + this.events.shakeY;
    if (this.events.grey) greyUniform.grey.value = 1;
    const [tr, tg, tb] = tintRow(this.db.a, this.tintIndex());
    setDayShift(tr, tg, tb);
    field.render(this.cam.x - originX - sx, this.cam.y - sy, ents);
    setDayShift(0, 0, 0);
    if (this.events.grey) greyUniform.grey.value = 0;           // the filter is applied before the dialogue
    this.ui.begin();
    const hud = this.hudUi;
    hud.begin();
    if (ev) {
      this.drawBalloons(originX);
      this.ui.end();
      this.events.drawOverlay(hud);
      this.drawPopup();
      return;
    }
    const ox = this.cam.x - originX - sx, oy = this.cam.y - sy;
    const af = this.buffs.auraFrame();                                // FUN_000250e8 aura [순서 근사: 플레이어 위]
    if (af >= 0) this.ui.effect(af, player.x - ox + (player.dir & 1 ? 2 : -2), player.y + 15 - 8 - oy);
    this.drawQuestMarks(ox, oy);
    this.drawStatus(ox, oy);
    if (this.bannerT >= 0) {                                          // FUN_00024b80 case 8: image t (0x80, 0x60) 83x25
      const t = this.bannerT >> 1;
      if (t < 6) this.ui.image('t', 0x80, 0x60 + t, 83, 4, 240 - 41, 160 - 12 + t);
      else this.ui.image('t', 0x80, 0x60, 83, 25, 240 - 41, 160 - 12);
    }
    if (this.run) this.run.draw(this.ui, this.run.node.x - ox, this.run.node.y - oy);
    if (this.warpT >= 0) this.ui.frame('cmf_status', this.statusCmf, 0x34 + (this.warpT >> 1), player.x - ox, player.y - 90 - oy, 'es');   // image 0x2F (FUN_00024b80)
    if (this.arriveT >= 0) this.ui.frame('cmf_status', this.statusCmf, 0x34 + (this.arriveT >> 1), player.x - ox, player.y - 90 - oy, 'es');
    this.ui.end();
    if (this.ctx.options.minimap && !this.talk && !this.dead && this.showButtons)   // FUN_00022228 in state 0x10
      this.minimap?.draw(hud, player.x, player.y, [
        ...this.monsters.filter((m) => m.alive).map((m) => ({ x: m.x, y: m.y, monster: true })),
        // objects in slots 3..40 that are not monsters (type >= 43): actors created by the event (SPAWN_TYPE)
        ...this.actors.filter((a) => a.spawned && a.visible && a.id >= 43).map((a) => ({ x: a.x, y: a.y, monster: false })),
      ]);
    this.hud.draw({
      clock: clockFrame(this.dayCounter, this.dayPh),
      cls: model.cls, level: model.level, hp: vitals.hp, maxHp: stats.maxHp, mp: vitals.mp, maxMp: stats.maxMp,
      exp: vitals.exp, statPoints: this.statPoints, skillPoints: this.skillPoints, mapId: field.mapId,
      dimGate: this.gardenMode !== 0 || !this.canSave,
      slots: this.inv.quick.map((q) => {
        if (q.kind === 1) return { skill: q.id, cd: q.cd, maxCd: q.maxCd };
        const it = q.kind === 2 ? this.inv.items[q.id] : undefined;
        if (!it) return null;
        return { icon: this.db.iconRect(it.icon), count: this.db.showsCount(it) ? it.count : -1, cd: q.cd, maxCd: it.type === 0x11 && it.sub >= 14 ? 900 : 100 };
      }),
    }, this.cam.x - originX - sx, this.cam.y - sy, this.showButtons && !this.dead && !this.talk);
    if (this.flash) { hud.alpha = Math.min(32, this.flash * 4); hud.fill(0, 0, VIEW_W, VIEW_H, 0xffffff); hud.alpha = 32; }
    if (this.talk) { hud.hit(0, 0, VIEW_W, VIEW_H, () => [AVK.OK]); this.talk.d.draw(hud, this.tick); }
    this.drawPopup();
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
    if (this.warpList) this.drawWarpList();
    if (!this.popup) return;
    this.ctx.ui13.begin();
    this.popup.p.draw();
    this.ctx.ui13.end();
  }

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

  setDir(d: Dir): void {
    this.player.dir = d;
  }
}
