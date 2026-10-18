// Field play (drawHandle 0x10): locomotion (locomotion.md), basic melee combat (combat.md,
// game-rules.md §3) and items (items.md: drops, pickup, potions, quick slots), started from a save slot.
// The game state and the 20 Hz tick only: the host draws it (web/game/fieldScene.ts extends this with the field,
// HUD and overlay passes) and fills in the hooks below that need its renderer.
import type { Assets, Cmf } from '../data/assets';
import { equipLook } from '../render';
import { Buffs, DAY_EVENTS, TINT_BASE, dayPhase, isSafeMap, returnPoint } from '../rules/buffs';
import { boxEquipment } from '../rules/boxes';
import { Gimmick } from '../world/gimmicks';
import { drawFortune, today, type FortuneResult } from '../rules/fortune';
import { achCheck, achEvent, challengeGold, titleBonus, type AchEvent, type Awards } from '../rules/achievements';
import { accountBook, accountDay, clearUnsavedUses, countUnsavedUse, saveAccount, setAccountDay, takeUnsavedUses, account, secondDrop, traitBox, traitOnLevelUp, traitReset, traitStatBonus, traitVal } from '../rules/account';
import { ABYSS_RULES, DUNGEONS, abyssHeader, abyssRule, dimLevel, dimStats, dungeonStart, generateFloor, newRun, resultValues, rollDimDrops, type DimRun } from '../rules/dimension';
import { findPath } from '../world/pathfind';
import { vibrate } from '../vibrate';
import { GATHER_CAP, GatherRun, gatherExp, spawnNodes, type GatherNode } from '../rules/gather';
import { genDarkStock } from '../rules/shopRules';
import type { Item } from '../rules/items';
import { BossProxy, EvActor } from '../world/actors';
import { pickGuide, type Guide } from '../rules/guide';
import { Dialogue, HoldSkip } from '../ui/dialogue';
import { backlog } from '../ui/backlog';
import { EventRunner } from './events';
import { Popup, popupOverlay } from '../ui/popup';
import { OverlayStack, type OpenOpts, type Overlay, type Role } from '../ui/overlays';
import { deepestAbyss, extraPaid, itemKinds, markExtraPaid, records, recordAbyss, recordBoss, recordItem } from '../rules/records';
import { dropMul, killMul } from '../rules/dev';
import { extraCheck, extraKey, type ExtraChallenge } from '../rules/extraChallenges';
import { attend, fortunePrize, GOLDEN_EGG } from '../rules/attendance';
import { QuestLog } from '../rules/quests';
import { OPENING, Story, StoryDb } from '../data/story';
import { VIEW_H, VIEW_W } from '../render';
import type { FieldMap } from '../world/fieldMap';
import { HudFeed } from './hudFeed';
import { AVK } from '../keys';
import type { Host } from '../host';
import { platform } from '../platform';
import { Inventory, ItemDb } from '../rules/items';
import { compareGear, type GearDiff } from '../rules/compare';
import { autoLootGround, groundBox, rollBossDrops, rollDrop, updateGround, type GroundItem } from '../rules/drops';
import { Monster, overlaps, type MonsterWorld } from '../combat/monster';
import { Boss, BossGlobals, MonsterShot, bossDeathEvent, summonStats, type BoxTable } from '../combat/boss';
import { Projectile, type ProjRecord } from '../combat/projectiles';
import { skillMaxCd, skillRec } from '../rules/skills';
import { Player, type Blockers, type Dir, type Rect } from '../combat/player';
import { CLASSES, MAX_LEVEL, Rng, cdiv, derive, effectiveSkillLevel, expNeed, idiv, killExp, monsterHit, playerHit, rdiv, skillBaseDamage, type Derived, type EquipTables, type PlayerModel } from '../rules/rules';
import type { SaveData } from '../save/save';

/** action id a -> skill s (d+0x2558b) */
const A2S = [0, 3, 6, 1, 4, 7, 2, 5, 8];

/** what the field logic needs from its host: game data, options, the tick's input and the sound */
export type FieldHost = Host;

/** actor ids below this are monsters, the rest NPCs (assets-data.md) */
const FIRST_NPC = 43;

/** maps where flag 0x1e hides / flag 0x1f shows NPCs (FUN_0001bb8c) */
const HIDE_1E = [0x46, 0x25, 0x51, 0x74, 0x76, 0x77, 0x7a];
const SHOW_1F = [0x74, 0x76, 0x77, 0x7a];
export { OPENING };
/** FUN_0004618c: the map an opening starts on (검사 10, 마법사 0x2f, 격투가 0x62); the event places the player */
const OPENING_MAP = [10, 0x2f, 0x62];
/** the map event e plays on: its header's, or for an opening (header map -1, started by a new game) the class's first map;
 *  -1 for other events with no map */
export function eventMap(e: number, headerMap: number): number {
  if (headerMap >= 0) return headerMap;
  const i = OPENING.indexOf(e);
  return i >= 0 ? OPENING_MAP[i] : -1;
}

/** OverlayStack.enqueue priorities: challenge rewards first (FUN_0001f17c), then the added ones, the day's fortune
 *  and 출석 보상 */
const QUEUE = { challenge: 3, extra: 2, fortune: 1, attendance: 0 } as const;

/** the warp stone move list (state 0x17): an overlay model the host draws */
export class WarpList {
  constructor(readonly rows: number[], public cur: number) {}
}

/** the fortune result popup's contents (FieldGame.fortuneResult) */
export interface FortuneShown { res: FortuneResult | null; item: { name: string; icon: { image: string; sx: number; sy: number } } | null; held: boolean }

export class FieldGame {
  /** combat text and the message log the HUD shows */
  readonly hud = new HudFeed();
  readonly player: Player;
  readonly model: PlayerModel;
  stats: Derived;
  readonly vitals: { hp: number; mp: number; exp: number; invuln: number; tint: number };
  readonly inv: Inventory;
  private tables: EquipTables;
  protected ground: GroundItem[] = [];
  protected projectiles: Projectile[] = [];
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
  protected talk: { d: Dialogue; npc: EvActor; mark: number; q: number } | null = null;
  /** held fast-forward of NPC talk (편의 설정 빨리 넘기기) */
  private talkHold = new HoldSkip();
  /** NPC within reach for '5' (FUN_0002bfd4) */
  private talkTarget: EvActor | null = null;
  /** map gimmicks (slots 0x65..0x73): barriers and chests */
  gimmicks: Gimmick[] = [];
  /** chest waiting for its reward after popup 0x5F "yes" (DAT_003b3bd4) */
  private pendingChest: Gimmick | null = null;
  /** gathering nodes (slots 0x8d / 0x8e) and the running gauge */
  nodes: GatherNode[] = [];
  protected run: GatherRun | null = null;
  /** gathering success effects: list effect 0xa7 (star) and the hit spark of FUN_0006101c */
  /** event ground items (SPAWN_TYPE low ids): icons on the field until HIDE -100 or a map load */
  eventItems: { cat: number; sub: number; x: number; y: number }[] = [];
  protected gatherFx: { x: number; y: number; t: number; kind: 'star' | 'spark' }[] = [];
  /** FUN_000613fc ids 0xc9 / 0xd4 / 0xdf on the player (item use): screen position fixed at spawn, rises 3 px a tick */
  protected useFxs: { id: number; x: number; y: number; t: number }[] = [];
  /** hit sparks DAT_00408428 (6 slots, FUN_0006101c / FUN_00030734): set 0 normal, 1 strong (full-screen rim at t 1..3); hidden = kind 0xFF */
  protected sparks: { x: number; y: number; t: number; set: number; hidden: boolean }[] = [];
  private flashTick = -1;
  /** target panel DAT_003b3c49 and its trailing bar (old HP DAT_003b3ab0, counter DAT_003b3aaa) */
  protected panelTarget: Monster | null = null;
  protected ghost: { m: Monster; old: number; n: number } | null = null;
  /** HIT counter DAT_003b61c8 (hits, display timer) and the last hit's real time */
  protected hits = { count: 0, timer: 0, at: 0 };
  /** guide marker DAT_003b1dc6 / 1dc8 / 3cc2 (guide.ts) */
  protected guide: Guide | null = null;
  /** c71: a '5' pickup is under way (cleared by a pickup or an attack start) */
  private picking = false;
  /** warp stone move list (menu 0x17): registered rows and the cursor */
  /** popups and the warp stone list, top-most last; challenge / fortune / attendance popups queue on it */
  readonly overlays = new OverlayStack();
  /** save once the pending warp has loaded (garden entry) */
  private saveAfterWarp = false;
  /** shop kind requested by NPC talk (the play scene opens the shop screen) */
  shopRequest: number | null = null;
  /** set by the play scene: save to the current slot (shop actions save automatically) */
  autosave: (partial?: boolean) => void = () => {};
  /** the frame-end save request DAT_0040f754 (FUN_00020960 -> FUN_0001eba8, misc-systems.md §7.3). Refused with
   *  "저장이 불가능한 지역입니다." (0x1A61) on special maps unless 3, and where saving is not allowed if 1; 1 logs 0x17
   *  "게임 데이터 저장됨" (text 0x3B3 + 0x17); 3 saves anywhere, silently (the garden / dimension partial save of toSave) */
  requestSave(kind: 1 | 2 | 3): void { this.saveReq = kind; }
  private saveReq: 0 | 1 | 2 | 3 = 0;
  /** end of the play scene's frame (FUN_00020960): run the pending request, menus and popups open or not */
  flushSave(): void {
    const kind = this.saveReq, t = this.db.a.text;
    if (!kind) return;
    this.saveReq = 0;
    if ((kind !== 3 && this.mapType >= 2) || (kind === 1 && !this.canSave)) { this.hud.message(t[0x1a61] ?? ''); return; }
    this.autosave(kind === 3);
    if (kind === 1) this.hud.message(t[0x3ca] ?? '');
  }
  protected pendingEvent: { e: number; t: number } | null = null;
  /** boss room scratch a1c..a26, boss projectiles, box override table */
  private bossG = new BossGlobals();
  protected shots: MonsterShot[] = [];
  private bossBoxes: BoxTable = {};
  /** poison timer (player +0x58): every 20 ticks HP -= HP/10 */
  protected poison = 0;
  /** screen flash DAT_003ce6a8 (halved every frame) */
  protected flash = 0;
  /** elixir buffs (misc-systems.md §1) */
  buffs: Buffs;
  /** day/night counter (gamedata 0x3b0 + 2·slot), phase 0 day 1 dusk 2 night 3 changing, palette fade */
  dayCounter: number;
  dayPh: 0 | 1 | 2 | 3 = 0;
  private dayFade = { steps: 0, target: 0 as 0 | 1 | 2, row: 0 };
  /** return stone destination row (P+0x3290), 100 = class start field */
  returnZone: number;
  /** return stone warp (warp.kind 2): frames since use, -1 = none */
  protected warpT = -1;
  /** warp kind 4 (FUN_00024b80): the effect over the player after a garden entry / exit, no movement */
  protected arriveT = -1;
  /** dungeon mode DAT_003dc1a8 (1 = 어둠의 정원) and the entry flag DAT_003dc1a9 (leftovers-ui.md §1); not saved */
  gardenMode = 0;
  private gardenFlag = 0;
  /** 차원의 문 run (dungeon mode 2, dimension.md) */
  dim: DimRun | null = null;
  /** set when the run ends: the play scene reloads the slot (the save made before entering) */
  reloadRequest = false;
  /** the open game menu should close (entering the dimension from the community menu, a return stone used from the bag) */
  closeMenu = false;
  /** runtime mapType DAT_003b3aae: the header value, 0 after load on maps < 0x165 (FUN_00017838), 2 from DANGER_ON */
  mapType = 0;
  /** garden gate boss kept out of play until its floor event ends (FUN_0001bb8c 5754, garden.md §1.2 / §1.4) */
  private gateBoss: Monster | null = null;
  /** warp kind 8: the warning banner before the gate boss starts (32 frames) */
  protected bannerT = -1;
  /** save slot of this play (account-wide day counter, book and reload prevention) */
  slot = -1;
  /** 회상 / 보스 러시 (not in the original): a throwaway copy of the slot (never saved); no exp, no account effects,
   *  no new events; in a rush the exits are shut */
  sandbox: 'replay' | 'rush' | null = null;
  /** tick the player last lost HP (boss records: a kill without being hit) */
  private lastHurt = -1;
  /** bind to a slot: account day counter and book, reload prevention (FUN_0001a494) */
  bindSlot(slot: number): void {
    this.slot = slot;
    this.dayCounter = accountDay(slot, this.dayCounter);
    if (this.dayCounter >= 10000) { this.darkStock = genDarkStock(this.db, this.rng, this.field.mapId); this.darkState = 2; }   // load (FUN_0001a494)
    this.story.book = accountBook(this.story.book);
    // a new day: the fortune popup 0x54 opens on the first free field frame (FUN_0001a494 / FUN_000200b8), then 출석 보상
    if (this.story.fortuneDay !== today()) { this.story.fortuneDay = today(); this.overlays.enqueue(() => this.openFortune(), QUEUE.fortune); }
    if ((this.story.counters.attendDay ?? 0) !== today()) this.overlays.enqueue(() => this.openAttendance(), QUEUE.attendance);
    this.inv.onGot = (it) => { if (it.type !== 0x1a) recordItem(it.type, it.sub, it.grade); };   // 아이템 도감
    for (const sub of takeUnsavedUses(slot)) {
      const i = this.inv.items.findIndex((it) => it.type === 0x1b && it.sub === sub);
      if (i < 0) continue;
      const it = this.inv.items[i];
      if (it.count > 1) it.count--; else this.inv.remove(i);
      this.requestSave(2);                                           // 4590: saved at once, so quitting cannot bring it back
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
  protected statusCmf!: Cmf;
  /** slot lap (gamedata): 2 = hard mode (hardmode.md) */
  lap = 0;
  get hard(): boolean { return this.lap >= 2; }
  /** set when the ending event 0x6A ends (state 0x3D) */
  ending = false;
  monsters: Monster[] = [];
  protected tick = 0;
  cam = { x: 0, y: 0 };
  protected shake: [number, number][] = [];
  private pendingWarp: { map: number; x: number; y: number } | null = null;
  /** not in the original: set on every map entry, cleared once the player stands outside all portal rects */
  private portalHold = false;
  protected busy = true;
  /** set when the player's HP reaches 0 */
  dead = false;
  /** touch buttons are drawn only in plain field play (state 0x10, FUN_000208dc) */
  showButtons = true;
  playTicks: number;
  statPoints: number;
  /** bought AP / SP packs (+0x32a7 / +0x32a8): the reset items add 30 / 5 per pack */
  packs: [number, number] = [0, 0];
  /** learned skill levels (0..8 actives in tab order tier*3 + group, 9..15 passives) */
  skills: number[];
  skillPoints: number;

  /** field: the map, or a renderer's subclass of it (web/render/field.ts) */
  protected constructor(readonly ctx: FieldHost, save: SaveData, playerCmf: Cmf, readonly db: ItemDb, readonly field: FieldMap) {
    this.inv = new Inventory(db);
    this.tables = db.equipTables();
    if (save.inv) {
      Object.assign(this.inv, { items: save.inv.items, equip: save.inv.equip, quick: save.inv.quick, gold: save.inv.gold });
      this.inv.setBags(save.inv.bags ?? 0);
      this.inv.unlocks = save.inv.unlocks ?? 0;
      this.inv.keys = save.inv.keys ?? [];
      this.inv.migrateUnlocks();
      this.inv.migrateKeys();
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
    this.story = Story.from(save.story, save.cls);
    // traits and titles too, as recompute() does: without them the loaded stats (and the HP / MP clamp) miss both
    this.model = {
      cls: save.cls, level: save.level, stats: [...save.stats], equip: this.inv.equip, skills: this.skills, buffs: this.buffs.effects(ctx.assets),
      traits: traitStatBonus(), titles: titleBonus(db.a, this.story.titles, this.story.title),
    };
    this.stats = derive(this.model, this.tables);
    this.vitals = {
      hp: save.hp < 0 ? this.stats.maxHp : Math.min(save.hp, this.stats.maxHp),
      mp: save.mp < 0 ? this.stats.maxMp : Math.min(save.mp, this.stats.maxMp),
      exp: save.exp, invuln: 0, tint: 0,
    };
    this.playTicks = save.playTicks;
    this.statPoints = save.statPoints;
    this.packs = [save.packs?.[0] ?? 0, save.packs?.[1] ?? 0];
    // new game: skill 0 at level 1, no skill points (FUN_0001a8d8)
    this.skillPoints = save.skillPoints ?? 0;
    this.player = new Player(playerCmf);
    this.player.equip = equipLook(this.inv.equip);                   // preloaded with the first map
    this.player.cls = save.cls;
    this.player.dir = save.dir;
    this.player.actions = ctx.assets.tables.playerActions[save.cls];
    this.player.mult = ctx.assets.tables.actionMult[save.cls];
    this.installStatics();
    this.sdb = new StoryDb(ctx.assets);
    this.field.storyDone = (e) => this.story.isDone(e);
    this.quests = this.makeQuests();
    this.events = new EventRunner(this);
    // saves made before the event 0x28 key grant was ported: quest 0x45 waits for 투명한 허물 forever
    if (this.story.isDone(0x28) && this.story.qs[0x45] === 2 && !this.inv.keyCount(0x0b)) { this.inv.gain(0x1a, 0x0b, 0, 1, this.rng); this.quests.onItems(); }
    // saves made while the sage-stone-3 barrier (door 9) could not open during event 0x55
    if (this.story.isDone(0x55) && this.story.collect.has(7)) this.story.doors.add(9);
  }

  private makeQuests(): QuestLog {
    return new QuestLog(this.sdb, this.story, {
      inv: this.inv, rng: this.rng, hard: () => this.hard, level: () => this.model.level, eventId: () => this.events.id,
      questPopup: (id, q) => this.ask(new Popup(this.ctx, id, 0, (t) => t.replace('%s', this.quests.name(q)))),
      message: (t) => this.hud.message(t),
      grantExp: (e) => this.grantExp(e),
      sfx: (n) => this.ctx.audio.playSfx(n),
    });
  }

  /** open a Popup over the field: on its roles' handlers (ok answers 'yes') */
  ask(p: Popup, opts: OpenOpts = {}): void { this.overlays.open(popupOverlay(p), { kind: 'popup', ...opts }); }
  get popupOpen(): boolean { return this.overlays.kindOpen('popup'); }
  get warpListOpen(): boolean { return this.overlays.kindOpen('warps'); }
  /** an event or NPC dialogue page is on screen (LOG / AUTO keys) */
  get dialogueShown(): boolean { return !this.popupOpen && (!!this.talk || (this.events.active && !!this.events.dialogue)); }
  get inEvent(): boolean { return this.events.active; }
  /** events and NPC talk (states 0x12 / 0x11) take every key; menu and SAVE are refused */
  get busyTalking(): boolean { return this.events.active || !!this.talk || this.overlays.size > 0; }

  /** the item tables of a play on lap `lap` (DAT_003b3bef = lap >= 2 ? 2 : 0) */
  static async itemDb(assets: Assets, lap: number): Promise<ItemDb> {
    const db = new ItemDb(assets);
    await db.init();
    db.tier2 = lap >= 2;
    db.lap = lap;
    db.dimLvl = null;
    return db;
  }

  /** after construction: the shared sheets and tables, the first map, and a new game's opening event */
  protected async start(save: SaveData, lap: number, sandbox: FieldGame['sandbox']): Promise<void> {
    const assets = this.ctx.assets;
    this.lap = lap;
    this.sandbox = sandbox;
    this.events.replay = sandbox === 'replay';
    this.statusCmf = await assets.cmf('cmf_status');
    this.inv.log = (_kind, text) => this.hud.message(text);
    this.inv.onCollect = (sub) => this.story.collect.add(sub);         // keys / sage stones are flags
    this.sheets = await Promise.all([0, 1, 2].map((c) => assets.cmf(`cmf_c${c}`)));
    this.bossBoxes = await assets.json<BoxTable>('boss_boxes.json');
    for (const q of this.inv.quick) if (q.kind === 1 && !q.maxCd) q.maxCd = skillMaxCd(this, q.id);
    this.player.onEvent = (ev) => this.actionEvent(ev);
    this.player.onPickup = () => this.doPickup();
    // FUN_0004618c: with no opening bit (0 / 10 / 0x14) — a new game or a hardcore conversion — the class's first map
    const fresh = !this.story.isDone(0) && !this.story.isDone(10) && !this.story.isDone(0x14);
    if (fresh) await this.enterMap(OPENING_MAP[save.cls]);
    else await this.enterMap(save.map, save.x < 0 ? undefined : save.x, save.y < 0 ? undefined : save.y);
    this.quests.refresh();
    // new game or an unfinished opening: start the class's first event (classes 1/2 set flag 0 first)
    const first = OPENING[save.cls];
    if (!this.story.isDone(first)) {
      if (save.cls !== 0) this.story.set(0);
      this.events.start(first);
    }
  }

  /** frames without moving (title 50), last skill use (title 21 / 22), a kill on this map (title 35) */
  private idleFrames = 0;
  private lastSkillTick = -1000;
  private killedHere = true;

  /** report an achievement event (kills, crafts, ...) */
  achieve(e: AchEvent): void { this.grantAwards(achEvent(this.story.counters, e)); }

  private grantAwards(a: Awards): void {
    for (const n of a.titles) this.awardTitle(n);
    for (const n of a.challenges) if (!this.story.challenges.has(n)) { this.story.challenges.add(n); this.overlays.enqueue(() => this.openChallenge(n), QUEUE.challenge); }
  }

  /** polled state conditions (every 20 field frames); their popups queue on the overlays */
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
    if (this.tick % 20 === 10) {                                     // 추가 도전과제 (not in the original)
      const r = records(), c = this.story.counters;
      for (const x of extraCheck(c, {
        bossKinds: Object.values(r.bosses).filter((b) => b.k > 0).length, cleanBoss: Object.values(r.bosses).some((b) => b.clean),
        itemKinds: itemKinds(), rushBosses: r.rush?.bosses ?? 0, rushAll: !!r.rush?.all, abyss: deepestAbyss(),
        attendance: c.attendStreak ?? 0, replays: r.replays, lap: this.lap,
      })) { c[extraKey(x.id)] = 1; if (!extraPaid(x.id)) this.overlays.enqueue(() => this.openExtra(x), QUEUE.extra); }   // done on this slot; gold once an account
    }
  }

  /** FUN_0001f17c: popup 0x79 + reward gold */
  private openChallenge(n: number): void {
    const t = this.db.a.text, gold = challengeGold(this.db.a, n);
    const body = (s: string) => `${s.replace('%s', t[0x1bcf + n] ?? '')}|@${(t[0x1c25] ?? '%d').replace('%d', String(gold))}`;
    this.ask(new Popup(this.ctx, 0x79, 0, body), { on: { close: () => { this.inv.gain(0x1c, gold, 0, 1, this.rng); this.autosave(); } } });
  }

  /** 추가 도전과제: the same popup 0x79 with the new challenge's name, after the original challenges */
  private openExtra(x: ExtraChallenge): void {
    const t = this.db.a.text;
    const body = (s: string) => `${s.replace('%s', x.name)}|@${x.desc}|@${(t[0x1c25] ?? '%d').replace('%d', String(x.gold))}`;
    this.ask(new Popup(this.ctx, 0x79, 0, body), { on: { close: () => {
      if (!extraPaid(x.id)) { markExtraPaid(x.id); this.inv.gain(0x1c, x.gold, 0, 1, this.rng); }
      this.autosave();
    } } });
  }

  /** 출석 보상 (not in the original, rules/attendance.ts): message popup 0x18 with the day's prizes; a prize that does
   *  not fit waits like the fortune's (fortuneHold) when that slot is free, else it is paid in gold */
  private openAttendance(): void {
    const r = attend(this.story.counters, today(), this.db.a, this.model.level);
    if (!r) return;
    const names: string[] = [];
    this.inv.gain(0x1c, r.gold, 0, 1, this.rng);
    for (const p of r.items) {
      const it = this.db.create(p.type, p.sub, 0, new Rng(1n, () => 0));
      if (this.inv.gain(p.type, p.sub, 0, p.count, this.rng)) names.push(`${it.name} x${p.count}`);
      else if (!this.story.fortuneHold) { this.story.fortuneHold = { type: p.type, sub: p.sub, count: p.count }; names.push(`${it.name} x${p.count} (가방에 자리가 나면 받습니다)`); }
      else { const g = this.model.level * 300; this.inv.gain(0x1c, g, 0, 1, this.rng); names.push(`${g} 골드 (가방이 가득 참)`); }
    }
    const streak = this.story.counters.attendStreak ?? 1;
    const body = `출석 ${r.day}일째 보상${streak > 1 ? ` (${streak}일 연속)` : ''}|@${r.gold} 골드|@${names.join('|@')}`;
    this.ask(new Popup(this.ctx, 0x18, 0, () => body));
    this.quests.onItems();
    this.autosave();
  }

  /** popup 0x54: OK draws the fortune (FUN_00052610(1)), CLR gives up today's fortune; both save */
  private openFortune(): void {
    const p = new Popup(this.ctx, 0x54);
    this.fortuneAsk(p);
    this.ask(p, { closedby: 'cancel', on: { yes: () => this.runFortune(), cancel: () => this.autosave() } });
  }

  /** host views of the fortune popups 0x54 / 0x55 (the teller's portrait, the prize); nothing by default */
  protected fortuneAsk(_p: Popup): void {}
  protected fortuneResult(_p: Popup, _shown: FortuneShown): void {}

  /** a fortune prize that did not fit (the original loses it): kept until the bag has room, then given */
  private fortuneHoldTick(): void {
    const h = this.story.fortuneHold;
    if (!h || this.overlays.size || this.events.active || this.talk) return;
    if (!this.inv.gain(h.type, h.sub, 0, h.count, this.rng)) return;
    this.story.fortuneHold = undefined;
    this.hud.message(this.db.a.text[0x1b5f] ?? '');
    this.quests.onItems();
    this.autosave();
  }

  private runFortune(): void {
    const res = drawFortune(this.db.a, this.rng, this.model.level);
    let ok = false, held = false, item: { name: string; icon: { image: string; sx: number; sy: number } } | null = null;
    if (res) {
      ok = this.inv.gain(res.type, res.sub, 0, res.count, this.rng);
      if (ok) { const it = this.inv.items.find((x) => x.type === res.type && x.sub === res.sub); if (it) item = { name: it.name, icon: this.db.iconRect(it.icon) }; }
      else {                                                         // bag full: keep the prize until a slot is free
        this.story.fortuneHold = { type: res.type, sub: res.sub, count: res.count };
        const it = this.db.create(res.type, res.sub, 0, new Rng(1n, () => 0));
        item = { name: it.name, icon: this.db.iconRect(it.icon) };
        held = true; ok = true;
      }
      if (res.grade === 1) {                                         // 대길 counter +0x2e24 (max 30), titles 0x18 / 0x19
        const c = this.story.counters, n = c.daegil = Math.min(30, (c.daegil ?? 0) + 1);
        if (n >= 10) this.awardTitle(0x18);
        if (n >= 30) this.awardTitle(0x19);
      }
    }
    const p = new Popup(this.ctx, 0x55);
    p.hideBody = true;
    this.fortuneResult(p, { res: ok ? res : null, item, held });
    this.ask(p);
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

  /** Snapshot for the save slot. partial = save request 3; special maps (mapType >= 2: the original only saves
   *  there through request 3) and the garden / dimension modes are partial whatever was asked. */
  toSave(partial = false): SaveData {
    if (this.slot >= 0) { setAccountDay(this.slot, this.dayCounter); clearUnsavedUses(this.slot); saveAccount(); }
    const d = this.fullSave();
    const file = (partial || this.mapType >= 2 || this.gardenMode !== 0) ? this.prevSave() : null;
    if (!file) return d;
    // FUN_0001eba8 7571 partial save: the file's record with progress copied over it. Kept from the file: map +0x30dc,
    // position +0x30e0, facing +0x31ce, region +0x3104, return region +0x3290, keys +0x3171 / +0x3173, visited maps
    // +0x3175, event bits +0x31ad, doors +0x32a1; HP is written as the max HP (+0x30d8 = +0x301c)
    Object.assign(d, { map: file.map, zone: file.zone, x: file.x, y: file.y, dir: file.dir, returnZone: file.returnZone, hp: this.stats.maxHp });
    if (this.gardenMode === 1) Object.assign(d, { map: 0x9f, zone: 7, x: 160, y: 400 });   // then the garden entrance
    const prev = file.story;
    if (prev && d.story) Object.assign(d.story, { done: prev.done, maps: prev.maps, zones: prev.zones, collect: prev.collect, collectDim: prev.collectDim, doors: prev.doors });
    return d;
  }

  /** a deep copy of the current state for 회상 / 보스 러시, without toSave's account bookkeeping */
  snapshot(): SaveData { return JSON.parse(JSON.stringify(this.fullSave())) as SaveData; }

  /** a boss of this room is alive (보스 러시) */
  get bossAlive(): boolean { return this.monsters.some((m) => m.isBoss && m.alive); }
  /** EvActor's shared pose tables and pose hook point at this scene (a sandbox scene takes them over meanwhile) */
  private installStatics(): void {
    EvActor.poses = { actions: this.ctx.assets.tables.playerActions, mult: this.ctx.assets.tables.actionMult };
    EvActor.onPose = (a, ev, sound) => {                             // party pose effects / sounds in events
      if (sound) this.ctx.audio.playSfx(sound);
      if (ev >= 9 && ev <= 26 && this.projectiles.length < 60) {
        const rec = this.projRecord(ev - 8);
        this.projectiles.push(new Projectile(ev - 8, rec, { x: a.x, y: a.y, dir: a.dir, lastH: a.lastH, lastV: a.lastV }, this.sheets[rec.type] ?? this.player.cmf, 0, 0, 0));
      }
    };
  }
  /** back from a sandbox scene (회상 / 보스 러시): the shared actor statics and the room's music again */
  resumeFromSandbox(): void {
    this.installStatics();
    EvActor.freeze = -1;
    this.ctx.audio.playBgm(this.field.map.header.bgm);
  }
  /** 3회차 (not in the original): HP ×1.5, ATK ×1.25 outside the dimension */
  private scaleLap(m: Monster): void {
    if (this.lap < 4 || this.gardenMode === 2) return;
    m.hp = m.maxHp = Math.trunc(m.maxHp * 1.5);
    m.atk = Math.trunc(m.atk * 1.25);
  }
  /** full HP / MP (보스 러시 start) */
  refill(): void { this.vitals.hp = this.stats.maxHp; this.vitals.mp = this.stats.maxMp; }

  private fullSave(): SaveData {
    return {
      version: 1, cls: this.model.cls, level: this.model.level, exp: this.vitals.exp, gold: this.inv.gold,
      stats: [...this.model.stats], statPoints: this.statPoints, packs: [...this.packs], map: this.field.mapId, zone: this.field.map.header.zone,
      x: this.player.x, y: this.player.y, dir: this.player.dir, hp: this.vitals.hp, mp: this.vitals.mp,
      ...(this.gardenMode === 1 ? { map: 0x9f, zone: 7, x: 160, y: 400 } : {}),     // FUN_0001eba8: garden saves point at the entrance
      playTicks: this.playTicks, savedAt: Date.now(), buffs: this.buffs.toJSON(), day: this.dayCounter, returnZone: this.returnZone,
      inv: { items: this.inv.items, equip: this.inv.equip, quick: this.inv.quick, gold: this.inv.gold, bags: this.inv.bags, unlocks: this.inv.unlocks, keys: this.inv.keys },
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

  /** the host's fullscreen bleed: virtual pixels the view reaches past each side of the 480-wide window */
  protected viewPad(): number { return 0; }

  /** keep the view inside the map; with the fullscreen bleed (viewPad) the wider view too, and a map
   *  narrower than that wider view is centred (narrower than 480: originX in draw() centres it) */
  private clampCamX(x: number): number {
    const W = this.field.width, pad = this.viewPad();
    if (W >= VIEW_W + 2 * pad) return Math.max(pad, Math.min(x, W - VIEW_W - pad));
    return W >= VIEW_W ? (W - VIEW_W) >> 1 : 0;
  }

  /** Camera step (locomotion.md §6), run before entities move so it trails by a tick. */
  private updateCamera(): void {
    const { field, player, cam } = this;
    const W = field.width, H = field.height;
    const lx = 2 * Math.abs(player.vx), ly = 2 * Math.abs(player.vy);
    const cx = Math.max(224 - lx, Math.min(W - 224 + lx, player.x));
    cam.x += (cx - cam.x - 240 + 8 + (player.dir === 0 ? -lx : lx)) >> 2;
    cam.x = this.clampCamX(cam.x);
    const cy = Math.max(213, Math.min(H - 106, player.y));
    cam.y += Math.trunc((cy - cam.y - 213 + (player.dir === 2 ? -ly : ly)) / 3);
    cam.y = Math.max(0, Math.min(cam.y, H - VIEW_H));
  }

  /** a map was loaded and its actors placed (the host builds its map views: the minimap) */
  protected mapLoaded(): void {}

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
    // FUN_0001bb8c: garden gate floors start empty; a visited boss room keeps its boss away (0x27 / 0x23 too: their
    // three slots a1c..a1e are cleared instead). Not in the original: a story room whose boss death event has not run
    // yet keeps its boss, so a save made after entering (autosaves, being pushed out) cannot strand the story.
    const bossRoom = field.map.header.mapType === 2, gateFloor = this.gardenMode === 1 && bossRoom;
    const storyRoom = bossRoom && field.map.header.zone !== 13;
    const cleared = this.gardenMode === 0 && bossRoom && this.story.maps.has(id)
      && (!storyRoom || field.map.actors.every((ac) => {
        const rec = ac.actor >= 0 && ac.actor < FIRST_NPC ? ctx.assets.tables.actorTypes[ac.actor] : null, e = rec?.[1] === 11 ? bossDeathEvent(ac.actor, id) : -1;
        return e < 0 || this.story.isDone(e);
      }));
    // FUN_0001bb8c end: after event 0x1e (the party joins) every monster of the HIDE_1E maps is off: the early boss rooms
    // (0x25 / 0x46 / 0x51, so the other two classes' first bosses are not met again) and the fields 0x74 / 0x76 / 0x77 /
    // 0x7a until event 0x1f turns those four back on
    const hide1e = this.gardenMode === 0 && this.story.isDone(0x1e) && HIDE_1E.includes(id) && !(this.story.isDone(0x1f) && SHOW_1F.includes(id));
    if (this.gardenMode === 2 && this.dim && id >= 0x165) {          // FUN_0001dd48: tier2 from the run's floor level
      this.db.dimLvl = dimLevel(this.dim);
      this.db.tier2 = this.db.dimLvl > 88;
    }
    const dimActors = this.gardenMode === 2 && this.dim && id >= 0x165 ? await this.dimFloor(id) : null;
    if (dimActors) this.mapType = field.map.header.mapType;           // no barrier hiding on maps >= 0x165
    for (const ac of dimActors ?? field.map.actors) {
      if (ac.actor < 0 || ac.actor >= 260) continue;
      if ((cleared || hide1e) && ac.actor < FIRST_NPC) continue;
      const typeRec = ctx.assets.tables.actorTypes[ac.actor];
      const name = `cmf_c${typeRec[0]}`;
      try {
        const cmf = await ctx.assets.cmf(name);
        await field.preloadSprite(name, cmf);
        this.cmfCache.set(ac.actor, cmf);
        if (ac.actor < FIRST_NPC && typeRec[1] === 1) {
          const m = new Monster(ac.actor, name, cmf, ac.x, ac.y, level, typeRec, this.hard);
          m.boxes = this.bossBoxes[String(ac.actor)] ?? {};               // FUN_000231e4 type cases (e.g. 24's up attack)
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
    for (const m of this.monsters) this.scaleLap(m);
    if (this.gateBoss) this.scaleLap(this.gateBoss);
    this.actors.push(...keep);
    this.placeDarkMerchant();
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
    this.mapLoaded();
    this.run = null;
    this.gatherFx = [];
    this.useFxs = [];
    this.sparks = [];
    this.panelTarget = null; this.ghost = null;
    EvActor.freeze = -1;                                              // FUN_00019dd0
    this.eventItems = [];
    this.picking = false;
    player.gatherSwing = null;
    // the player already stands at the entry point when FUN_00019734 measures the distance (FUN_0001dd48)
    const [sx, sy] = forEvent ? [player.x, player.y] : x === undefined || y === undefined ? this.centreSpawn() : [x, y];
    this.nodes = !isSafeMap(id) && !this.events.active && this.mapType !== 2 && this.gardenMode !== 2
      ? spawnNodes(ctx.assets, field, this.rng, field.map.header.zone, dayPhase(this.dayCounter) === 2, sx, sy) : [];
    if (this.nodes.length) await field.preloadSprite(...field.objSet);
    await Promise.all([field.preloadSprite('cmf_status', this.statusCmf), field.preloadImages(['shadow', 't', 'ec', 'c', 'oc', 'es'])]);
    if (!forEvent) {
      player.place(sx, sy);
      this.portalHold = true;
      this.cam = { x: 0, y: 0 };
      for (let i = 0; i < 20; i++) this.updateCamera();
      ctx.audio.playBgm(field.map.header.bgm);
    }
    this.story.zones.add(id === 0x9b ? 5 : field.map.header.zone);  // markVisited (map 0x9b counts as region 5)
    this.story.maps.add(id);                                          // FUN_0006913c map bitset
    this.updateGuide();
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

  /** an event record naming a boss of this room (ids 3..42 with a Boss on the map): the boss itself while it lives
   *  (BossProxy), a hidden stand-in at its place after it fell (a later PLACE shows it); null when there is none */
  bossActor(id: number, aliveOnly = false): EvActor | null {
    if (id < 3 || id >= FIRST_NPC) return null;
    const b = this.monsters.find((m): m is Boss => m instanceof Boss && m.type === id && !m.main);
    if (!b || (aliveOnly && !b.alive)) return null;
    if (b.alive) {
      const have = this.actors.find((a) => a instanceof BossProxy && a.boss === b);
      if (have) return have;
      const p = new BossProxy(b);
      this.actors.push(p);
      return p;
    }
    const a = this.spawnActor(id, true);
    if (a) { a.x = b.x; a.y = b.y; a.face(b.dir); a.visible = false; }
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
    p.pullTo = p.pullRef = null;                                       // the scene ignores a boss's pull while it runs
    // FUN_00034e24 first frame: every monster of type 3..0x2a leaves the scene, bosses too (events 0x66 / 0x56 / 0x4f
    // / 0x50 keep them); the script's PLACE / SPAWN_TYPE brings a boss in, the end of the event restores them
    if (!this.events.keepsMonsters) for (const m of this.monsters) if (m.isBoss) m.evHidden = true;
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
    if (e === 0x6c) { this.gardenMode = 0; this.gardenFlag = 0; }
    if (e === 0x5d && this.field.mapId === 0xd0) void this.field.load(0xd0);   // the wind barrier broke: redraw it as the broken barrier  // 베르무트 defeated: 0x3dc1a0..af cleared                              // state 0x3D: black screen, popup 0x5C
    if ((e === 0 || e === 10 || e === 0x14) && this.hard) this.autosave();   // hard: the opening end saves
    const lead = this.lead;
    if (lead) {
      this.player.place(lead.x, lead.y);
      this.player.dir = lead.dir; this.player.lastH = lead.lastH; this.player.lastV = lead.lastV;
      this.player.frame = 0;
    }
    this.lead = null;
    for (const a of this.actors) if (a instanceof BossProxy) a.sync();        // a skipped PLACE still moves the boss
    for (const m of this.monsters) m.evHidden = false;
    this.actors = this.actors.filter((a) => !a.spawned && !a.party);
    for (const a of this.actors) { a.visible = this.appears(a.id); a.balloon = 0; a.anim = -1; a.path = []; a.face(a.homeDir as Dir); }
    this.rebuildCandidates();
    this.quests.refresh();
    // FUN_0002cdc8: the boss theme when the scene raised the danger state (DANGER_ON, the boss entrances), silence
    // after the ending, else the map's music (events.md §0.6)
    this.ctx.audio.playBgm(e === 0x6a ? 0 : this.mapType >= 2 ? 0x0c : this.field.map.header.bgm);
    this.updateGuide();                                               // FUN_0002cdc8
    void e;
  }

  /** FUN_0001dd48 / FUN_0002cdc8: the class guide marker for this map and the first main quest (mode 0 only) */
  private updateGuide(): void {
    const g = this.gardenMode !== 0 ? null : pickGuide(this.ctx.assets.tables.guideMarkers, this.model.cls, this.field.mapId, (m) => this.story.maps.has(m),
      this.story.active.map((a) => a.q), (q) => this.sdb.mainQuest(q));
    if (g !== 'keep') this.guide = g;
  }

  afterEvent(_e: number): void { /* a finished event started again: nothing to replay */ }

  /** FUN_000173c4: camera eases 1/4 toward the followed actor or cell */
  eventCamera(): void {
    const ev = this.events, t = ev.camCell ?? (ev.camTarget ? [ev.camTarget.x, ev.camTarget.y] : null);
    if (!t) return;
    const H = this.field.height;
    this.cam.x += (t[0] - 240 + 8 - this.cam.x) >> 2;
    this.cam.y += Math.trunc((t[1] - 213 + 53 - this.cam.y) / 4);
    this.cam.x = this.clampCamX(this.cam.x);
    this.cam.y = Math.max(0, Math.min(this.cam.y, H - VIEW_H));
  }
  snapCamera(): void { for (let i = 0; i < 20; i++) this.eventCamera(); }

  /** popup 0x60 "휴식을 취하시겠습니까?" (+ "50골드가 소비됩니다." at the inn), FUN_00053510 case 0x39 */
  private innPopup(free: boolean): void {
    const cost = free ? '' : (this.db.a.text[0x4d3] ?? '').replace('%d', '50');
    this.ask(new Popup(this.ctx, 0x60, 0, (t) => t.replace('%s', cost)), { on: { yes: () => {
      if (!free) { if (this.inv.gold < 50) { this.hud.message(this.db.a.text[0x1af8] ?? ''); return; } this.inv.gold -= 50; }
      this.vitals.hp = this.stats.maxHp; this.vitals.mp = this.stats.maxMp;           // FUN_0001ead0
      this.achieve({ k: 'inn' });
      this.hud.message(this.db.a.text[0x1a62] ?? '');
      this.flash = 0;
    } } });
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

  /** '5' on a node (priority 8): gather level and pickaxe checks, then the interaction action and the gauge */
  private tryGather(): boolean {
    const n = this.nodes.find((x) => x.near(this.player.x, this.player.y));
    if (!n) return false;
    const t = this.db.a.text, zone = this.field.map.header.zone;
    const perm = this.inv.unlocked(1);                               // 천상의 곡괭이: no level / pickaxe checks
    if (zone > GATHER_CAP[this.story.gather.lv] && !perm) { this.hud.message(t[0x1ade] ?? ''); return true; }
    if (!perm && !this.inv.items.some((x) => x.type === 0x18)) { this.hud.message(t[0x1adf] ?? ''); return true; }
    this.run = new GatherRun(n, this.rng);                           // c65 = 1, c69 = 10, c68 = 0, c66 = rand(20)
    this.player.startInteract();
    return true;
  }

  /** cancel (FUN_00045570 key / FUN_0006f370 hit): the node goes idle; a key also ends the action (+0x76 = 0) */
  private cancelGather(byKey: boolean): void {
    if (!this.run) return;
    this.run.node.depleting = false;
    this.run = null;
    this.player.gatherSwing = null;
    if (byKey) this.player.action = 0;
  }

  /** keys while gathering (FUN_00045570): after success (c62 4) every key is ignored; '5' only lands in the window;
   *  another key press with c62 ∈ {1, 2} cancels and is then handled as usual. Returns the keys left to handle. */
  private gatherKeys(presses: number[]): number[] {
    const run = this.run;
    if (!run) return presses;
    if (run.c62 === 4) return [];
    const out: number[] = [];
    for (const k of presses) {
      if (!this.run) { out.push(k); continue; }
      if (k === AVK.OK) {
        if (run.press()) {
          const ex = run.node.x - 6 + run.c66, ey = run.node.y - 46;
          this.gatherFx.push({ x: ex, y: ey, t: 0, kind: 'star' }, { x: ex, y: ey, t: 1, kind: 'spark' });
        }
        continue;
      }
      if (run.cancellable) this.cancelGather(true);
      out.push(k);
    }
    return out;
  }

  /** node updates (FUN_000731a4, slots 0x8e then 0x8d, before the player): each rolls the trait 8 bonus every
   *  frame; the active one runs the gauge and finishes the gathering */
  private nodeTick(): void {
    for (const n of this.nodes.slice().reverse()) {
      const bonus = this.rng.rand(100000) <= traitVal(8) * 1000 ? 1 : 0;   // track 8 채집의 달인
      const run = this.run;
      if (run?.node === n && run.update()) this.finishGather(run, bonus);
    }
  }

  /** finish: bonus + (success ? 2 : 1) + derived "gather +%" (D[18]); a full bag sends the node back to idle */
  private finishGather(run: GatherRun, bonus: number): void {
    const n = run.node;
    this.run = null;
    this.player.gatherSwing = null;                                  // the action plays its 7 frames out
    const count = bonus + (run.c68 ? 2 : 1) + (this.rng.rand(100) < (this.stats.D[18] ?? 0) ? 1 : 0);
    if (!this.inv.gain(n.type, n.sub, 0, count, this.rng)) { n.depleting = false; return; }
    this.nodes = this.nodes.filter((x) => x !== n);
    const perm = this.inv.unlocked(1);
    const [e, up] = gatherExp(this.story.gather, this.field.map.header.zone, perm);
    const t = this.db.a.text;
    if (e) this.hud.message((t[0x1b39] ?? '%d').replace('%d', String(e)));
    if (up) this.hud.message(t[0x1b3a] ?? '');
    const pick = perm ? -1 : this.inv.items.findIndex((x) => x.type === 0x18);   // one pickaxe per gather (none with 천상의 곡괭이)
    if (pick >= 0) { const it = this.inv.items[pick]; if (it.count > 1) it.count--; else this.inv.remove(pick); }
    this.quests.onItems();
  }

  /** list effect 0xa7 (FUN_0002c99c case 0x10) and the hit spark: one update per frame */
  private gatherFxTick(): void {
    this.gatherFx = this.gatherFx.filter((f) => {
      f.t++;
      if (f.kind === 'spark') return f.t <= 6;
      if (f.t <= 4) { this.rng.rand(7); this.rng.rand(5); }        // the FUN_00029604 draw rolls and discards these
      if (f.t > 7) f.y -= 3;
      if (f.t === 12) { this.run?.fxFire(); return false; }
      return true;
    });
  }

  /** warp stone row of a zone and its table d+0x220c2 {map, x0, y0, wx, wy, flag} (gimmicks.md §4.1) */
  protected stone(row: number): { map: number; x0: number; y0: number; wx: number; wy: number; flag: number } {
    const a = this.db.a, o = 0x220c2 + row * 12, s16 = (v: number) => (v << 16) >> 16;
    return { map: a.d16(o), x0: a.d16(o + 2), y0: a.d16(o + 4), wx: a.d16(o + 6), wy: a.d16(o + 8), flag: s16(a.d16(o + 10)) };
  }
  protected stoneRow(): number { const z = this.field.map.header.zone; return z < 6 ? (z === 5 ? 4 : z) : z - 2; }

  /** '5' on a warp stone (register / move list) or at the map-152 well (popup 0x50) */
  private tryGate(): boolean {
    const p = this.player, row = this.stoneRow(), r = this.stone(row);
    if (r.map === this.field.mapId && (r.flag === -1 || this.story.isDone(r.flag))
      && p.x >= r.x0 && p.x <= r.x0 + 50 && p.y >= r.y0 && p.y <= r.y0 + 50) {
      if (this.story.stones.has(row)) {
        this.openWarpList(row);
      } else {
        this.story.stones.add(row); this.story.stones.add(3);           // row 3 (초원마을) is always registered too
        this.hud.message('공간이동석이 등록되었습니다.');
      }
      return true;
    }
    if (this.field.mapId === 152 && this.story.isDone(54) && this.story.isDone(0x35) && Math.abs(p.x - 256) <= 35 && Math.abs(p.y - 352) <= 35) {
      this.ask(new Popup(this.ctx, 0x50), { on: { yes: () => { this.pendingWarp = { map: 179, x: 784, y: 160 }; } } });
      return true;
    }
    return false;
  }

  /** zone name of a warp stone row (text 0x1D6 + zone; rows 0..3 = zones 0..3, 4 = zone 5, 5.. = zone row + 2) */
  protected stoneName(row: number): string {
    return this.db.a.text[row < 4 ? 0x1d6 + row : row === 4 ? 0x1db : 0x1d8 + row] ?? '';
  }

  /** state 0x17: the move list over all 11 rows, the cursor on this stone's */
  private openWarpList(row: number): void {
    const w = new WarpList(Array.from({ length: 11 }, (_, i) => i), row);
    const o: Overlay = { handle: (presses) => this.warpKeys(o, w, presses), model: w };
    this.overlays.open(o, { kind: 'warps' });
  }

  /** move list keys (FUN_00043f3c): up / down, '5' asks with popup 0x19 for a registered row (0x1A otherwise), CLR closes */
  private warpKeys(o: Overlay, w: WarpList, presses: number[]): Role | null {
    for (const k of presses) {
      if (k === AVK.UP) { if (w.cur > 0) w.cur--; }
      else if (k === AVK.DOWN) { if (w.cur < 10) w.cur++; }
      else if (k === AVK.CLR) return 'cancel';
      else if (k === AVK.OK) {
        const row = w.rows[w.cur];
        if (!this.story.stones.has(row)) { this.ask(new Popup(this.ctx, 0x1a)); return null; }
        this.ask(new Popup(this.ctx, 0x19, 0, (t) => t.replace('%s', this.stoneName(row))), { on: { yes: () => {
          const r = this.stone(row);                                   // FUN_000619a0
          this.overlays.close(o, 'yes');
          if (r.map !== this.field.mapId) this.pendingWarp = { map: r.map, x: r.wx, y: r.wy };
        } } });
        return null;
      }
    }
    return null;
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

  /** barriers only (kind 5) during events: the opening check and the 16-frame blink */
  private updateBarriers(): void {
    for (const g of this.gimmicks) {
      if (g.kind !== 5 || g.gone) continue;
      if (!g.hidden && !g.timer && g.key && this.story.collect.has(g.key) && this.doorExtra(g.key, g.param)) {
        g.timer = 16;
        if (g.param < 16) this.story.doors.add(g.param);
        this.shakeFrom(5);
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
    this.ask(new Popup(this.ctx, 0x5f), { on: { yes: () => {
      const need = g.b3 === 0 ? 0 : ((g.b3 - 1) % 3) + 1;
      if (need && !this.story.collect.has(need)) {
        this.hud.message((this.db.a.text[0x3cd] ?? '%s').replace('%s', this.db.a.text[0xa46 + need] ?? ''));
        return;
      }
      this.pendingChest = g;
    } } });
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
    // FUN_0002bdc4: lost quest keys come back (chest 0x5E + quest 0x90 running -> key 0x10; chest 0x34 + quest 0x50
    // running -> key 0x0D). Owning key 0x10 skips the second check (original).
    const inv = this.inv;
    if (st.chests.has(0x5e) && st.qs[0x90] === 2 && inv.keyCount(0x10)) { /* owned: stop here */ }
    else {
      if (st.chests.has(0x5e) && st.qs[0x90] === 2) inv.gain(0x1a, 0x10, 0, 1, this.rng);
      if (st.chests.has(0x34) && st.qs[0x50] === 2 && !inv.keyCount(0x0d)) inv.gain(0x1a, 0x0d, 0, 1, this.rng);
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
    const a = this.ctx.assets, text = a.text[t] ?? '', name = a.text[this.sdb.nameId(npc.id)] ?? '';
    this.talk = { d: new Dialogue(text, name, -1, false, t), npc, mark, q };
    this.talkHold.reset();
    backlog.push({ name, text, textId: t, kind: 'talk' });
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
    if (this.player.autoWalking || this.sandbox === 'rush') return;     // 보스 러시: the room stays shut                              // state 9 skips FUN_00071424
    const x = this.player.portalX ?? this.player.x, y = this.player.portalY ?? this.player.y;   // before the corner correction
    const inside = (r: { cx0: number; cy0: number; cx1: number; cy1: number }, m: number) =>
      r.cx0 * 16 - m <= x && x <= (r.cx1 + 1) * 16 + m && r.cy0 * 16 - m <= y && y <= (r.cy1 + 1) * 16 + m;
    // not in the original: two arrival points sit inside the way back (m171 -> m170 on the edge of the m171 portal,
    // m70 -> m69 inside the m70 one), so standing still after the warp bounced straight back. The rect only warps
    // once the player has stepped off every portal since entering the map.
    if (this.portalHold) {
      if (this.field.map.portals.some((pt) => pt.rects.some((r) => inside(r, 0)))) return;
      this.portalHold = false;
    }
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
          const no = () => {                                          // FUN_0005eb62: walk back (A*), or teleport without a path
            const p = this.player, W = this.field.map.header.width;
            const path = findPath((c, r) => this.field.walkAt(c + r * W) === 1, W, this.field.map.header.height,
              { x: p.x, y: p.y, lastH: p.lastH, lastV: p.lastV, body: [-8, -8, 16, 8] }, 0xa0, 400, true);
            if (!path) { this.gardenFlag = 0; p.x = 160; p.y = 400; return; }
            p.startAutoWalk(path, () => { this.gardenFlag = 0; });
          };
          this.ask(new Popup(this.ctx, 0x5e), { on: { yes: () => this.enterGarden(), no } });
          return;
        }
      }
    }
  }

  /** FUN_0006ca90 mode 2: alive bit off, the dedicated drops, exp ×2 into the bonus pool, boss -> clear timer */
  private grantDimKill(m: Monster, extra = 0): void {
    const run = this.dim!, f = (this.field.mapId - run.first) & 0xff, boss = m.type === run.boss;
    if (m.dimIdx >= 0 && run.alive[f]) run.alive[f][m.dimIdx] = false;
    let exp = 0;
    for (let i = 0, n = killMul(); i < n; i++) {                       // 개발자 모드: ×N = N kills (grantKill)
      run.kills++;
      this.achieve({ k: 'kill', type: m.type, garden: false });
      if (m.type === 0x2a) this.requestSave(3);                      // 베르무트 (FUN_0006d2f8 101691)
      let e = killExp(this.rng, m.level, this.model.level, m.typeRec[4], 0, false);
      if (this.mapType >= 2) e *= 10;
      e = rdiv(e * (100 + (this.stats.D[19] ?? 0) / 10), 100);
      if (run.depth) e = rdiv(e * (100 + 10 * run.depth), 100);       // 심연 (not in the original): +10 % per depth
      exp += e;
    }
    this.hud.label(`+${exp * 2} EXP`, m.x, m.y - 40);
    run.pool += exp * 2;
    this.grantExp(exp * 2);
    const drops: GroundItem[] = [];
    for (let i = 0, n = dropMul(); i < n; i++) {
      drops.push(...rollDimDrops(this.rng, this.db, m, boss, this.stats.goldPct, this.db.tier2));
      if (i === 0 ? extra : secondDrop(this.rng)) drops.push(...rollDimDrops(this.rng, this.db, m, false, this.stats.goldPct, this.db.tier2));
    }
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
    this.hud.noSlideOn(map);                                       // no entry effect: the map just appears
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
      const types = f === 9 ? [run.boss] : DUNGEONS[run.d].pool;
      await this.preloadActors(types);                                // the body boxes the placement checks
      const body = (t: number) => { const c = this.cmfCache.get(t); return c?.frames[c.anims[0]?.frames[0] ?? 0]?.body_box ?? null; };
      run.floors[f] = generateFloor(run, f, this.field, arr, this.rng, body);
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
    if (!run || !run.clearT || this.overlays.size) return;
    if (--run.clearT > 0) return;
    run.cleared = true;
    const result = () => this.ask(this.dimResult(), { on: { close: () => this.leaveDimension() } });
    // 심연 (not in the original, 편의 설정): go on below the boss with stronger floors, or leave with the result as before
    if (!this.ctx.options.abyss) { recordAbyss(run.d, run.depth ?? 0); result(); return; }
    const deeper = (run.depth ?? 0) + 1, rule = ABYSS_RULES[abyssRule()];
    recordAbyss(run.d, run.depth ?? 0);
    const body = `심연 ${deeper}단계로 내려가시겠습니까?|@몬스터 HP·공격력 +${(run.d === 0 ? 25 : 30) * deeper}%, 경험치 +${10 * deeper}%|@이번 주 규칙: ${rule.name} (${rule.desc})|@아니오를 고르면 결과를 받고 나갑니다.`;
    this.ask(new Popup(this.ctx, 0x0e, 0, () => body), { on: { yes: () => this.descend(), no: result } });
  }

  /** 심연 n: the same dungeon from floor 1, every floor generated again from the stronger header */
  private descend(): void {
    const run = this.dim!;
    run.base ??= [...run.header];
    // the clear above is kept: dying or leaving below gives it, not the deeper floors' pool
    run.banked = (run.banked ?? 0) + run.pool;
    run.pool = 0;
    run.cleared = false;
    run.depth = (run.depth ?? 0) + 1;
    run.header = abyssHeader(run.base, run.d, run.depth, abyssRule());
    run.floors = new Array(10).fill(null);
    run.alive = Array.from({ length: 10 }, () => []);
    run.clearT = 0;
    recordAbyss(run.d, run.depth);
    const [map, x, y] = dungeonStart(this.db.a, run.d);
    this.pendingWarp = { map, x, y };
    this.hud.message(`심연 ${run.depth}단계`);
  }

  dimResult(): Popup {
    const v = resultValues(this.dim!);
    return new Popup(this.ctx, 100, 0, () => { let k = 0; return (this.db.a.text[0x4d7] ?? '').replace(/%d/g, () => String(v[k++] ?? 0)); });
  }

  /** 'F' (FUN_0005de24): a clear adds the bonus pool and counts the clear; partial save, then the slot is reloaded */
  leaveDimension(): void {
    const run = this.dim;
    if (!run) return;
    const won = run.cleared || run.banked !== undefined;          // 심연: an earlier depth was cleared
    if (won) {
      this.vitals.exp += (run.cleared ? run.pool : 0) + (run.banked ?? 0);
      this.grantExp(0); this.story.dimClears = Math.min(65000, (this.story.dimClears ?? 0) + 1); this.achieve({ k: 'dimClear' });
    }
    if (this.mapType < 2 || won) this.autosave();
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
    if (m instanceof Boss && m.noReward) { this.ctx.audio.playSfx(0x2b); this.quests.onKill(m.type); return; }   // each fading object counts
    const { model, hud } = this;
    this.ctx.audio.playSfx(0x2b);
    const extra = secondDrop(this.rng) ? 1 : 0;                       // track 9 행운의 동전 (account.md §2.4)
    if (this.gardenMode === 2 && this.dim) { this.grantDimKill(m, extra); return; }
    // 개발자 모드 (core/rules/dev.ts): exp ×N is N kills, each rolled and counted like one; drops ×N is N drop rolls
    const kills = killMul(), mt = this.mapType;
    let exp = 0;
    for (let i = 0; i < kills; i++) {
      let e = killExp(this.rng, m.level, model.level, m.typeRec[4], 0, this.hard);
      if (mt >= 2) e *= 10;                                            // FUN_0006ca90: special maps ×10
      else if (mt === 0 && this.dayPh === 2) e = rdiv(e * 130, 100);   // night ×1.3
      if (this.lap >= 4) e = rdiv(e * 150, 100);                      // 3회차 (not in the original): ×1.5
      exp += e;
    }
    hud.label(`+${exp} EXP`, m.x, m.y - 40);
    // drops: 1, a second one with the account trait 9 chance (extra), objects 116..140
    const who = { cls: model.cls, luck: this.stats.luck, goldPct: this.stats.goldPct, hard: this.hard, pLevel: model.level, cap10: this.field.map.header.zone === 13 };
    const drops: GroundItem[] = [];
    for (let i = 0, n = dropMul(); i < n; i++) {
      if (m.isBoss) {
        if (!(m.type === 38 && this.gardenMode === 0)) drops.push(...rollBossDrops(this.rng, this.db, m, who));   // FUN_00037fe4 (Epsilon drops nothing on normal maps)
        continue;
      }
      const x2 = i === 0 ? extra : secondDrop(this.rng) ? 1 : 0;
      drops.push(...[rollDrop(this.rng, this.db, m, who), ...(x2 ? [rollDrop(this.rng, this.db, { ...m, type: m.type, level: m.level, x: m.x + this.rng.rand(10) - 10, y: m.y }, who)] : [])]
        .filter((g): g is GroundItem => !!g));
    }
    for (const g of drops) {
      if (!g.item && this.dayPh === 2) g.gold = rdiv(g.gold * 130, 100);   // night gold ×1.3 (FUN_0003b9c8)
      if (this.ground.length < 25) this.ground.push(g);
    }
    this.killedHere = true;
    for (let i = 0; i < kills; i++) {
      this.achieve({ k: 'kill', type: m.type, garden: this.gardenMode === 1 });
      if (m.type === 0x2a) this.requestSave(3);                      // 베르무트: +0x30fe, then a save (FUN_0006e120 117434)
      if (this.gardenMode !== 2 && !this.sandbox) {
        this.quests.onKill(m.type);
        this.story.recordKill(m.type, this.field.map.header.zone);
      }
      if (m.isBoss) {                                                  // 보스 기록 (not in the original)
        const clean = m.firstHit >= 0 && this.lastHurt < m.firstHit;
        recordBoss(m.type, m.firstHit >= 0 ? this.tick - m.firstHit : -1, clean,
          this.gardenMode === 0 && this.field.map.header.mapType === 2 && this.field.mapId < 0x165 ? this.field.mapId : -1);
      }
    }
    this.grantExp(exp);
    if (m.isBoss) {                                  // FUN_00061bb0: the boss event 200 frames later
      this.bossG.reset();
      const e = bossDeathEvent(m.type, this.field.mapId);
      if (this.gardenMode === 1 && this.mapType >= 2 && m.type !== 0x2a) this.setDanger(false);   // LAB_0006d046: gate cleared, no story event
      else if (e >= 0 && (!this.story.isDone(e) || (this.gardenMode === 1 && e === 0x6c))) this.pendingEvent = { e, t: 0 };
    }
  }

  /** DAT_003b3c73: empty by day; at night the state goes to 1, and the stock is made when a dark merchant is placed */
  private updateDarkStock(): void {
    if (this.dayCounter < 9600) { this.darkStock = []; this.darkState = 0; }
    else if (this.dayCounter >= 10000 && this.darkState === 0) this.darkState = 1;
  }

  /** FUN_0001bb8c: placing a dark merchant (0x9E / 0xCD / 0xDE / 0xF2) with the state 1 makes the stock for this map */
  private placeDarkMerchant(): void {
    if (this.darkState !== 1 || !this.actors.some((a) => [0x9e, 0xcd, 0xde, 0xf2].includes(a.id))) return;
    this.darkStock = genDarkStock(this.db, this.rng, this.field.mapId);
    this.darkState = 2;
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
  protected tintIndex(): number { return this.dayPh === 3 ? this.dayFade.row : TINT_BASE[this.dayPh]; }

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
    if (fx.slowPlayer) this.player.slow(fx.slowPlayer);
    if (fx.shots) this.shots.push(...fx.shots);
    if (fx.summon) {
      const cmf = this.cmfCacheGet(3);
      if (cmf && this.monsters.length < 38) {
        const m = new Monster(3, `cmf_c${this.ctx.assets.tables.actorTypes[3][0]}`, cmf, fx.summon.x, fx.summon.y, 1, this.ctx.assets.tables.actorTypes[3]);
        Object.assign(m, summonStats(b));
        m.maxHp = m.hp;
        m.parent = b;
        m.state = 2;
        this.scaleLap(m);
        this.monsters.push(m);
      }
    }
    b.fx = {};
  }
  private cmfCacheGet(id: number): Cmf | undefined { return this.cmfCache.get(id); }

  /** experience and level ups (FUN_00029b1c) */
  grantExp(exp: number): void {
    if (this.sandbox) return;                                          // 회상 / 보스 러시: nothing carries over
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

  /** worn equipment -> sprite look (FUN_000385e0 runs inside the stat rebuild); new item sheets load in the background */
  private updateLook(): void {
    const p = this.player, look = equipLook(this.inv.equip), old = p.equip;
    if (look.w === old.w && look.h === old.h && look.a === old.a && look.p === old.p) return;
    p.equip = look;
    if (this.lead?.party && this.lead.cls === this.model.cls) this.lead.equip = look;
    void this.field.preloadSprite(p.cmfName, p.cmf, look);
  }

  recompute(): void {
    this.model.buffs = this.buffs.effects(this.db.a);
    this.model.traits = traitStatBonus();
    this.model.titles = titleBonus(this.db.a, this.story.titles, this.story.title);
    this.stats = derive(this.model, this.tables);
    this.vitals.hp = Math.min(this.vitals.hp, this.stats.maxHp);
    this.updateLook();
    this.vitals.mp = Math.min(this.vitals.mp, this.stats.maxMp);
  }

  /** 비교: `it` against the item worn in its slot, through the stat rebuild (compare.ts) */
  gearDiff(it: Item): GearDiff { return compareGear(it, this.inv.equip, this.model, this.tables); }

  /** 오토루팅 (drops.ts autoLootGround) */
  private autoLoot(): void {
    const r = autoLootGround(this.ground, this.inv, this.rng);
    this.ground = r.ground;
    if (r.got) this.quests.onItems();
  }

  /** FUN_000610e0: the first ground item overlapping the player (DAT_003b3bd3) */
  private pickTarget(): GroundItem | undefined {
    const pb = this.player.box();
    return this.ground.find((it) => overlaps(pb, groundBox(it)));
  }

  /** '5' on a ground item (FUN_00045570 pickup priority): start the interaction action; the item is taken on
   *  its pickup frame (doPickup). Skipped while a pickup is pending (c71) or when the target already failed. */
  private tryPickup(): boolean {
    const g = this.pickTarget();
    if (!g || g.failed || this.picking) return false;
    this.picking = true;
    this.player.startInteract();
    return true;
  }

  /** FUN_00041798 on the pickup frame: gain it (sfx 0x17) or mark it failed (c71 stays set) */
  private doPickup(): void {
    const g = this.pickTarget();
    if (!g) return;
    if (g.item && g.item.type < 0x10 && this.dim) this.dim.equips++;     // DAT_003dc1a0 (counted on the attempt)
    const ok = g.item ? this.inv.gain(g.item.type, g.item.sub, g.item.grade, 1, this.rng, g.item)
      : this.inv.gain(0x1c, g.gold, 0, 1, this.rng);
    if (ok) { this.ground.splice(this.ground.indexOf(g), 1); this.picking = false; this.ctx.audio.playSfx(0x17); this.quests.onItems(); } else g.failed = true;
  }

  /** FUN_00040498 for potions (0x11 sub 1..12): restore, count--, group cooldown. */
  useItem(idx: number): boolean {
    const it = this.inv.items[idx], v = this.vitals, st = this.stats;
    if (!it || it.count <= 0) return false;
    if (it.enh !== 0) return false;                                      // cooling down
    if (it.type === 0x11 && it.sub === 13) {                             // status cure: +0x54..+0x5a = 0
      this.achieve({ k: 'cure' });                                       // +0x2e48 counts every use (title 37)
      this.poison = 0; this.player.slowT = 0; this.player.slowed = false; this.player.stun = 0;
      this.useFx(0xd4);
      this.inv.setGroupCooldown(it.type, it.sub, this.stats.potionCdReduction);   // FUN_000404d0 tail: 100 frames
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
    this.useFx(0xdf);
    this.achieve({ k: 'potion' });
    this.inv.setGroupCooldown(it.type, it.sub, st.potionCdReduction);
    if (it.count <= 0) this.inv.remove(idx);
    return true;
  }

  /** FUN_0006101c: a free slot of six; a strong spark is skipped while another strong one is up */
  private spawnSpark(x: number, y: number, set: number, hidden = false): void {
    if (this.sparks.length >= 6 || (set === 1 && this.sparks.some((f) => f.set === 1))) return;
    this.sparks.push({ x, y, t: 1, set, hidden });
  }

  /** FUN_000613fc(0, id) for 0xc9 / 0xd4 / 0xdf: (x − 4 ± 2 by facing, y + 2·body dy + 15) in screen space */
  private useFx(id: number): void {
    const p = this.player;
    this.useFxs.push({ id, x: p.x - 4 - this.cam.x + ((p.dir & 1) * 2 - 1) * 2, y: p.y - 1 - this.cam.y, t: 0 });
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
    this.closeMenu = true;                                             // used from the inventory: every menu closes for the warp
    return this.consume(idx);
  }

  /** FUN_00040498 type 0x1b (game-rules.md §5.4): sub 2 half HP/MP, 4 stat reset, 5 skill reset, 7 both,
   *  6 / 0x20 account traits, 0x1e random gem box, 0x1f EXP box; boxes and packages go to boxes.ts first. */
  private useMisc(idx: number): boolean {
    const it = this.inv.items[idx]!, v = this.vitals, st = this.stats, m = this.model;
    if (it.sub === GOLDEN_EGG[1]) {                                      // 황금알 (not in the original): gold and a 대길 prize
      const p = fortunePrize(this.db.a, m.level, this.rng.rand(10));
      if (!this.inv.canGain(p.type, p.sub, 0, p.count) && this.inv.items.length >= this.inv.cap) { this.hud.message(this.db.a.text[0x3cc] ?? ''); return false; }
      this.consume(idx);
      this.inv.gain(0x1c, m.level * 1000, 0, 1, this.rng);
      this.inv.gain(p.type, p.sub, 0, p.count, this.rng);
      this.useFx(0xd4);
      this.autosave();
      return true;
    }
    if (it.sub >= 0x15 && it.sub <= 0x17) {                              // 차원의 문 only: every other buff off, slot sub + 7
      if (this.gardenMode !== 2) { this.hud.message(this.db.a.text[0x1ac2] ?? ''); return false; }
      this.buffs.clearNormal(); this.buffs.start(it.sub + 7); this.recompute();
      this.countUse(it.sub);
      this.hud.message((this.db.a.text[0x1ac0] ?? '%s').replace('%s', it.name));
      this.inv.setGroupCooldown(it.type, it.sub, 0);                     // one group, 900 frames
      return this.consume(idx);
    }
    if (it.sub >= 0x23 && it.sub <= 0x26) {                              // special elixirs -> slots 31..34
      this.buffs.start(it.sub - 4); this.recompute();
      this.hud.message((this.db.a.text[0x1ac0] ?? '%s').replace('%s', it.name));
      this.inv.setGroupCooldown(it.type, it.sub, 0);                     // each its own 900 frames
      if (!this.consume(idx)) return false;
      this.requestSave(3);                                               // FUN_00040498 48257
      return true;
    }
    const box = boxEquipment(this.db, this.inv, it.sub, m.level, m.cls, this.rng);   // equipment boxes and packages (§3)
    if (box !== null) {
      if (box === 'full') { this.ask(new Popup(this.ctx, 0x78)); return false; }
      if (box === 'slots') { this.hud.message(this.db.a.text[0x1ac1] ?? ''); this.ask(new Popup(this.ctx, 0x52)); return false; }
      if (box === 'gold') { this.hud.message(this.db.a.text[0x1abc] ?? ''); this.ask(new Popup(this.ctx, 0x5a)); return false; }
      this.consume(idx); this.autosave(); return true;
    }
    switch (it.sub) {
      case 2:                                                             // 영웅의 물약: HP / MP half, refused when both are full
        if (v.hp >= st.maxHp && v.mp >= st.maxMp) { this.hud.message(this.db.a.text[211] ?? ''); return false; }
        v.hp = Math.min(st.maxHp, v.hp + (st.maxHp >> 1)); v.mp = Math.min(st.maxMp, v.mp + (st.maxMp >> 1));
        this.useFx(0xdf);
        this.hud.message((this.db.a.text[0x1ac0] ?? '%s').replace('%s', it.name));
        this.countUse(2);
        this.inv.setGroupCooldown(it.type, it.sub, 0);                   // 16 frames
        break;
      case 6: traitReset(); this.recompute(); break;                     // 특성 초기화
      case 0x20: traitBox(Math.max(1, it.level)); break;               // 특성 스킬 상자: points += item level (FUN_00040498 48232)
      case 4: case 5: case 7:
        if (it.sub === 7) traitReset();
        if (it.sub !== 5) { m.stats.splice(0, 4, ...CLASSES[m.cls].stats); this.statPoints = m.level * 4 + this.packs[0] * 30; }   // FUN_00040498 case 4
        if (it.sub !== 4) {
          this.skills.fill(0); this.skills[0] = 1; this.skillPoints = m.level + this.packs[1] * 5;
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
      case 0x1f: this.grantExp(it.level === 0 ? it.count * 10000 : expNeed(it.level - 1)); break;   // FUN_00040498: level 0 -> count × 10000, else the EXP of level - 1
      case 0x22: {                                                        // power elixir box: one special elixir × 5
        this.inv.gain(0x1b, 0x23 + (this.rng.rand(10000) % 4), 0, 5, this.rng);
        break;
      }
      default: this.hud.message(this.db.a.text[0x1ac2] ?? ''); return false;
    }
    if (!this.consume(idx)) return false;
    // FUN_00040498 48353: every use but the counted ones (2, 0x15..0x17; a reload takes those back) asks for a save,
    // the EXP box with the "saved" log (48229)
    if (it.sub !== 2) this.requestSave(it.sub === 0x1f ? 1 : 3);
    return true;
  }

  /** MP cost of skill action a after trait track 4 절약 (FUN_000452a0, FUN_00029108) */
  protected skillCost(a: number): number {
    const s = A2S[a], r = skillRec(this, s), D = this.stats.D;
    const eff = effectiveSkillLevel(this.skills[s], s, D);
    const idx = eff === 0 ? -1 : Math.min(eff + D[38] - 1, 14);
    const cost = r[1] + idx * r[4];
    return cost - Math.trunc((cost * traitVal(4)) / 100);
  }

  /** FUN_000452a0 quick slot use: items, or skills (actTick 0, cooldown 0, MP >= cost). */
  private useQuick(slot: number): void {
    const q = this.inv.quick[slot];
    if (q.kind === 2 && q.cd === 0) { this.useItem(q.id); return; }
    if (q.kind !== 1 || q.cd !== 0 || this.player.actTick !== 0 || this.buffs.isOn(20)) return;
    const a = q.id, cost = this.skillCost(a);
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

  /** Damage of one hit by the player or a projectile with skill action id aid (100 = basic), FUN_0006d2f8.
   *  keepFacing: El's basic projectile (type 1, action 1) does not turn the target (FUN_00060d10);
   *  second: the EXTRA follow-up hit FUN_0006e120 makes with ~attacker (no EXTRA again, number 36px higher). */
  private hitMonster(aid: number, m: Monster, b: Rect, srcX: number, srcY: number, dir: number, fromPlayer: boolean,
    opt: { keepFacing?: boolean; second?: boolean; hitRect?: Rect } = {}): void {
    const { model, stats, hud, vitals } = this, D = stats.D;
    let base: number | undefined;
    if (aid !== 100) {
      const s = A2S[aid], r = skillRec(this, s);
      const lv = effectiveSkillLevel(this.skills[s], s, D);
      base = skillBaseDamage(stats.atk, r[0], r[3], lv, D[46], s, this.ctx.assets.tables.actorElements[m.type]?.[0] ?? 0);
    }
    const r = playerHit(this.rng, {
      level: model.level, atk: stats.atk, acc: stats.acc, crit: stats.crit, critDmg: stats.critDmg,
      basicPct: D[54] ?? 0,
      bonusPct: model.cls === 1 && this.player.action === 1 ? rdiv(D[9] ?? 0, 10) : 0,     // El in action 1: +INT/10 %
    }, { level: m.level, stunned: m.stun > 0 }, base);
    this.panelTarget = m;                                              // DAT_003b3c49 = target
    if (r.miss) { hud.miss(srcX, srcY - 43); return; }
    const extra = !opt.second && (D[42] ?? 0) !== 0;                   // FUN_0006dcd4: any extra-damage option fires
    if (extra) { hud.extra(srcX, srcY - 43 - (r.crit ? 12 : 0)); this.spawnSpark(m.x, m.y, 0); }
    // HP / MP drain (D40 / D41) on the damage after the critical multiplier, x max(5, 101 - level) / 10000
    const drainMul = model.level > 100 ? 5 : Math.max(5, 101 - model.level), pre = r.pre ?? r.dmg;
    if ((D[40] ?? 0) > 0) vitals.hp = Math.min(stats.maxHp, vitals.hp + cdiv(drainMul * pre * D[40], 10000));
    if ((D[41] ?? 0) !== 0) vitals.mp = Math.min(stats.maxMp, vitals.mp + cdiv(drainMul * pre * D[41], 10000));
    let dmg = r.dmg;
    if (fromPlayer && aid === 100 && this.player.action === 3 && model.cls !== 1) dmg = rdiv(dmg * 120, 100);   // 3rd hit x1.2
    if (dmg < 1) dmg = 1;
    if (r.crit && fromPlayer) hud.crit(srcX, srcY - 43);
    const tgt = m;                                                     // the hit object's own HP (FUN_0006e120)
    const full = tgt.hp >= tgt.maxHp;
    if (tgt.firstHit < 0) tgt.firstHit = this.tick;
    const alive = tgt.hp > 0;
    this.ghost = { m: tgt, old: tgt.hp, n: 1 };                         // DAT_003b3ab0 / 3ab4, DAT_003b3aaa = 1
    tgt.hp -= dmg + rdiv(dmg * (D[42] ?? 0), 100);                     // extra damage % on every hit
    const guarding = tgt.type === 0x1a && tgt.action === 12;          // Gardius in action 12 heals 3/2 of half the damage
    if (guarding) tgt.hp = Math.min(tgt.maxHp, tgt.hp + 3 * (dmg >> 1));
    if (dmg * 2 >= tgt.maxHp) this.achieve({ k: 'bigHit' });
    if (alive && tgt.hp <= 0) {                                       // counted once: the monster dies in its own update
      if (full) this.achieve({ k: 'oneHitKill' });
      if (aid === 100) this.achieve({ k: 'basicKill' });               // swings and c1's kind 3 basic projectile (skillAid 100)
      if (this.tick - tgt.firstHit <= 100) this.achieve({ k: 'quickKill' });
    }
    this.ctx.audio.playSfx(0x20 + model.cls);                         // FUN_0006e120 hit sound
    // number kind: crit / EXTRA and second hits show the big kind 2, plain hits (and Gardius guarding) kind 1
    if (opt.second) hud.damage(dmg, m.x, b[1] - 33 - 36, m);
    else if ((r.crit || extra) && !guarding) hud.damage(dmg, m.x, b[1] - 33, m);
    else hud.pop(dmg, m.x, b[1] - 33, false, m);
    // elixir effects in FUN_0006d2f8: explosion +dmg/5, freeze +dmg/10 and slow 25, plunder gold
    if (this.buffs.isOn(18) && this.rng.rand(1000) < 100) { tgt.hp -= Math.trunc(dmg / 5); hud.pop(Math.trunc(dmg / 5), m.x, b[1] - 33, false, m); }
    if (this.buffs.isOn(19) && this.rng.rand(1000) < 100) { tgt.hp -= Math.trunc(dmg / 10); hud.pop(Math.trunc(dmg / 10), m.x, b[1] - 33, false, m); if (!m.isBoss) m.slow = 25; }
    if (this.buffs.isOn(27) && this.rng.rand(1000) < 50) {
      const L = m.level;
      this.inv.gain(0x1c, Math.trunc(((2 * L + 3 + rdiv(this.rng.rand(L), 3)) * 3) / 10), 0, 1, this.rng);
    }
    // HIT counter: +1 within 1000 ms of the last hit, else 1; spark at the overlap centre (the player's own swings;
    // a projectile attacker's slot index lands outside cmf_status, so the original shows none for it)
    const now = platform().now();
    this.hits = { count: this.hits.count && now - this.hits.at <= 1000 ? this.hits.count + 1 : 1, timer: 0, at: now };
    if (fromPlayer && opt.hitRect) {
      const a = opt.hitRect, x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]);
      this.spawnSpark(x0 + ((x1 - x0) >> 1), y0 + ((y1 - y0) >> 1), r.crit || extra || dmg >= 2 * pre ? 1 : 0);
    }
    if (fromPlayer || r.crit) this.addShake(r.crit);
    // FUN_0006d2f8: a skill / projectile hit vibrates, and again on a strong hit (crit, or twice the base damage)
    if (aid !== 100) vibrate(this.ctx.options.vibration);
    if (r.crit || (base !== undefined && dmg >= 2 * base)) vibrate(this.ctx.options.vibration);
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
    // FUN_0006e120: knockback (7) instead of a stagger (6) with the D31 option, rolled only for a non-boss target not stunned
    const knock = !m.isBoss && m.stun <= 0 && this.rng.rand(100) < (D[31] ?? 0);
    m.onHit(dir as Dir, knock, opt.keepFacing);
    if (extra && m.alive && m.hp > 0) this.hitMonster(aid, m, b, srcX, srcY, dir, fromPlayer, { ...opt, second: true });
  }

  private updateProjectiles(): void {
    const live = this.monsters.filter((m) => m.alive);
    for (const p of this.projectiles) {
      if (p.fresh) { p.fresh = false; continue; }
      const prevFrame = p.frame;
      const after = p.hitsAfterMove;
      const out = after ? p.update(live) : {};
      const box = after ? p.attackBox(prevFrame) : p.attackBox();
      if (box) {
        let hit = false;
        for (const m of live) {
          const b = m.body();
          if (!m.alive || !b || !overlaps(box, b)) continue;
          if (p.contactExplodes()) { hit = false; break; }
          this.hitMonster(p.skillAid, m, b, p.x, p.y, p.dir, false, { keepFacing: p.type === 1 && p.action === 1 });
          hit = true;
          // c1 ice column slow (skills.md §3.2)
          const slow = p.action === 5 ? (this.skills[1] >> 1) + 25 : p.action === 6 ? (this.skills[4] >> 1) + 30 : p.action === 7 ? this.skills[7] + 30 : 0;
          if (p.type === 1 && slow && m.typeRec[1] !== 11 && m.stun <= 0) m.slow = slow;   // not a boss, not in state 0xd
          if (p.type === 1 && p.action >= 2 && p.action <= 4) m.burn = 12;          // +0x5c burn mark
          if (p.type === 1 && p.action >= 5 && p.action <= 7) m.chill = 9;          // +0x5e chill mark
          if (p.kind === 2) this.projectiles.push(new Projectile(19, this.projRecord(19), { ...this.player, dir: p.dir }, this.sheets[0], 0, m.x, b[1]));
          if (m.hp <= 0 && !m.alive) continue;
        }
        if (hit) p.onHit();
      }
      if (!after) Object.assign(out, p.update(live));
      if (out.spawn20) { this.spawn(20, 0, ...out.spawn20); this.spawn(20, 1, ...out.spawn20); }
    }
    this.projectiles = this.projectiles.filter((p) => !p.gone);
  }

  /** Player attack box against monster bodies, nearest first; every overlap is a hit (FUN_0006e8a8).
   *  Not ported: the "+0x76 == 10" rule (skills.md §2.3) that turned c0 드릴소드 upward on first contact,
   *  which made monsters below or beside the player hard to hit. The drill keeps its cast direction. */
  private resolvePlayerAttack(): void {
    const { player } = this;
    const atk = player.attack;
    if (!atk) return;
    const targets = this.monsters.filter((m) => m.alive)
      .map((m) => ({ m, d: (m.x - player.x) ** 2 + (m.y - player.y) ** 2, b: m.body() }))
      .filter((t) => t.b && overlaps(atk, t.b))
      .sort((a, b) => a.d - b.d);
    for (const { m, b } of targets) {
      this.hitMonster(player.skillAid, m, b!, player.x, player.y, player.dir, true, { hitRect: atk });
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
    // FUN_0006f370: DAT_003b3c49 = attacker; for 35 / 39 the part that takes hits, so the panel keeps the HP being fought
    const foe = src instanceof Boss ? src.hitTarget : src;
    this.panelTarget = foe;
    const r = monsterHit(this.rng, atk, { level: this.model.level, def: this.stats.def, evade: this.stats.evade + (src.dark > 0 ? 50 : 0), stunned: player.stun > 0 });
    vitals.invuln = 5;
    if (r.miss) { hud.miss(player.x, player.y - 43); this.achieve({ k: 'evade' }); return false; }
    let dmg = r.dmg, knock: 0 | 6 | 7 = 0, pct = 100;
    switch (type) {
      case 5: if (action === 12) pct = 150; break;
      case 8: if (action === 6) pct = 240; break;
      case 11: if (action === 8) { pct = 140; knock = 7; } else if (action !== 6) knock = 6; break;
      case 14: if (action === 9) { pct = 200; if (!player.slowed) knock = 6; } break;
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
    if (this.buffs.isOn(20) && foe.alive) {                            // 인내의 비약: reflect 2·dmg, take half
      const back = 2 * dmg;
      foe.hp -= back;
      hud.damage(back, foe.x, foe.y - 60);
      if (foe.hp <= 0) foe.onHit(0, false);
      dmg >>= 1;
    }
    if (knock && !player.knock) player.startKnock(knock, src.x, src.y, down ? { dir: 2 } : {});
    vitals.hp -= dmg;
    if (dmg > 0) this.lastHurt = this.tick;
    vitals.tint = 5;
    hud.hurt(dmg, player.x, player.y - 40, player);
    vibrate(this.ctx.options.vibration);                               // FUN_0006f370: the player is hurt
    if (this.run) this.cancelGather(false);                          // even after success (FUN_0006f370)
    if (vitals.hp <= 0) { vitals.hp = 0; this.dead = true; player.action = 0; this.story.recordDeath(src.type); this.buffs.clear(); this.achieve({ k: 'death' }); }
    return true;
  }

  update(presses: number[]): void {
    this.tick++;
    if (this.busy || this.dead) return;
    this.field.animateObjects();                                      // FUN_00034e24 -> FUN_00063640
    if (this.overlays.update(presses)) return;
    if (this.events.active) {
      this.events.update(presses);
      if (this.events.active) {
        const w: MonsterWorld = { field: this.field, rng: this.rng, gtick: this.tick, px: this.player.x, py: this.player.y, playerBox: this.player.box(), playerAlive: true };
        for (const m of this.monsters) if (m instanceof Boss) m.eventTick(w, this.events.id, this.events.progress);
        for (const p of this.projectiles) p.update([]);            // pose effects play out, they hit nothing in events
        this.projectiles = this.projectiles.filter((p) => !p.gone);
        this.updateBarriers();                                      // FUN_00068be4 also runs in events (doors opened by a scene)
      }
      return;
    }
    if (this.talk) {
      const t = this.talk;
      t.npc.update();
      t.d.tick(this.ctx.options);
      const inp = this.ctx.input, holding = this.talkHold.update(inp.isHeld(AVK.OK) || inp.isHeld(AVK.FAST));
      if ((t.d.autoDue(this.ctx.options) || t.d.fastDue(this.ctx.options, holding)) && !presses.includes(AVK.OK)) presses = [...presses, AVK.OK];   // 편의 설정
      if (presses.includes(AVK.OK) && t.d.advance()) { t.d.markRead(); this.talk = null; this.afterTalk(t.npc, t.mark, t.q); }
      return;
    }
    if (this.pendingEvent && this.sandbox) this.pendingEvent = null;
    if (this.pendingEvent && ++this.pendingEvent.t >= 200) { const e = this.pendingEvent.e; this.pendingEvent = null; this.events.start(e); return; }
    if (this.pendingWarp) {
      const w = this.pendingWarp;
      this.pendingWarp = null;
      const save = this.saveAfterWarp;
      this.saveAfterWarp = false;
      void this.enterMap(w.map, w.x, w.y).then(() => {
        if (save) { this.autosave(); return; }
        // 편의 설정 맵 이동 자동 저장 (not in the original): where a manual save is allowed, outside the garden / dimension
        if (this.ctx.options.autosaveMap && this.canSave && this.gardenMode === 0 && !this.dead) { this.autosave(); this.hud.message('자동 저장'); }
      });
      return;
    }
    this.playTicks++;
    if (this.buffs.tick(this.db.a)) this.recompute();
    if (this.gardenMode !== 2) this.dayTick();                         // day/night stops in the dimension
    if (this.warpT >= 0 && this.warpWarp()) return;
    if (this.arriveT >= 0 && ++this.arriveT >= 18) this.arriveT = -1;
    this.dimTick();
    if (!this.sandbox) { this.achTick(); this.overlays.drain(); }   // queued challenge / fortune / attendance popups
    this.fortuneHoldTick();
    if (this.bannerT >= 0 && ++this.bannerT >= 32) this.bannerT = -1;
    this.checkRestPoint();
    this.hud.tick();
    if (this.shake.length) this.shake.shift();
    this.inv.tick();
    this.ground = this.ground.filter(updateGround);
    if (this.inv.unlocked(13) && this.ctx.options.autoLoot) this.autoLoot();          // 편의 설정 오토루팅 can turn it off
    this.talkTarget = this.findTalkTarget();
    if (this.player.autoWalking) presses = [];                        // FUN_00045570 returns while the path is set
    presses = this.gatherKeys(presses);
    this.nodeTick();
    if (presses.includes(AVK.OK) && this.player.controllable && this.talkTarget && this.player.action === 0) { this.talkTo(this.talkTarget); return; }
    if (presses.includes(AVK.OK) && this.player.controllable && this.player.action === 0 && this.tryGate()) return;
    if (presses.includes(AVK.OK) && this.player.controllable && this.player.action === 0 && this.tryChest()) return;
    if (presses.includes(AVK.OK) && this.player.controllable && this.player.action === 0 && !this.tryPickup()) {   // +0x76 != 0: '5' ignored
      if (this.tryGather()) return;
      if (this.buffs.isOn(20)) this.hud.message(this.db.a.text[0x1ae0] ?? '');   // 인내의 비약: no attacks
      else { this.player.startAttack(); this.picking = false; }
    }
    const QUICK: number[] = [AVK.K1, AVK.K3, AVK.K7, AVK.K9, AVK.STAR, AVK.POUND];
    for (const k of presses) { if (this.overlays.size) break; const i = QUICK.indexOf(k); if (i >= 0) this.useQuick(i); }
    this.updateCamera();
    const blockers: Blockers = {
      solid: [...this.actors.filter((a) => a.visible).map((a) => a.rect()), ...this.gimmicks.filter((g) => g.solid).map((g) => g.body())],
      monsters: this.monsters.filter((m) => m.alive).map((m) => m.body()).filter((b): b is Rect => !!b),
    };
    for (const a of this.actors) a.update();
    this.updateGimmicks();
    const px0 = this.player.x, py0 = this.player.y;
    this.player.gatherSwing = this.run ? this.run.swing(this.tick) : null;
    this.player.update(this.ctx.input, this.field, blockers);
    if (this.run && this.player.action === this.player.interactAction) this.run.playerTick();   // FUN_000618f4
    this.gatherFxTick();
    this.useFxs = this.useFxs.filter((f) => { f.t++; f.y -= 3; return f.t <= 10; });   // FUN_0002c99c
    this.sparks = this.sparks.filter((f) => ++f.t <= (f.set === 2 ? 4 : 6));
    if (this.ghost) this.ghost.n++;
    this.hits.timer++;
    if (this.hits.count && platform().now() - this.hits.at > 1000) this.hits.count = 0;   // FUN_0006e8a8: 1000 ms
    // FUN_00063ab4 / 63948 / 637dc: a skill action's 3rd tick flashes the screen rim (option 화면효과)
    const pl = this.player, skillAct = pl.cls === 1 ? pl.action >= 2 && pl.action <= 10 : pl.action >= 4 && pl.action <= 12;
    if (skillAct && pl.actTick === 3 && pl.actTick !== this.flashTick && this.ctx.options.effects) this.spawnSpark(0, 0, 1, true);
    this.flashTick = skillAct ? pl.actTick : -1;
    this.run?.judge();
    this.idleFrames = px0 === this.player.x && py0 === this.player.y ? this.idleFrames + 1 : 0;
    if (this.ctx.options.speed === 0) this.story.counters.slowFrames = (this.story.counters.slowFrames ?? 0) + 1;
    if (this.player.sound) this.ctx.audio.playSfx(this.player.sound);
    this.resolvePlayerAttack();
    this.updateProjectiles();
    const world: MonsterWorld = {
      field: this.field, rng: this.rng, gtick: this.tick, px: this.player.x, py: this.player.y,
      playerBox: this.player.box(), playerAlive: !this.dead,
    };
    for (const m of [...this.monsters]) {
      if (this.bannerT >= 0 && m.isBoss) continue;                    // behaviour 0x11: waits for the banner
      if (m instanceof Boss) { m.playerSlowed = this.player.slowed; m.playerPoisoned = this.poison > 0; m.playerGrabbed = this.player.grabbed; }
      if (m.update(world) === 'dead') this.grantKill(m);
      for (const so of m.shotsOut) this.shots.push(new MonsterShot(m, so.x, so.y, so.o));
      m.shotsOut = [];
      if (m instanceof Boss) {
        this.applyBossFx(m);
        if (m.pullPlayer !== undefined) {
          this.player.pullTo = m.pullPlayer;
          const q = m.main ?? m;                                       // slot 3: the main body
          this.player.pullRef = { x: q.x, y: q.y };
        }
        if (m.grab === false) this.player.grabbed = false;
      }
    }
    // web-only safety: the arm's release never runs once Mother is dead (the original may leave state 1)
    if (this.player.grabbed && !this.monsters.some((m) => m.type === 39 && m.alive)) this.player.grabbed = false;
    // web-only safety: the suction (state 8) ends with part A's cycle; once the Queen is dead nothing would end it
    if (this.player.pullTo && !this.monsters.some((m) => m.type === 35 && m.alive)) this.player.pullTo = this.player.pullRef = null;
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
    if (!this.pendingWarp && !this.sandbox) this.checkTriggers();
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



  setDir(d: Dir): void {
    this.player.dir = d;
  }
}
