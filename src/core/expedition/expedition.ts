// 원정(가제) (not in the original): a standalone roguelike extra mode, reached from the title's 엑스트라 submenu.
// It stands apart from main play: no save slot (a run lives in memory only), and nothing here imports the field game,
// combat, rules or saves (tests/boundary.test.ts). The run (stage 1): three battle zones on t3, one after another,
// with a rest zone between them half the time and always one before the boss room (초원 - 깊숙한곳, m124). The hero
// walks 360° and fights in the field; an encounter becomes a turn battle. Growth and rewards follow
// web/docs/expedition-balance.md: creatures drop gold and now and then a piece of the main game's equipment (four
// slots, each piece on the whole party, for the run; a piece for a slot already filled is compared with the worn one and
// either put on or thrown away), chests hold gold, potions and equipment, a battle zone may hold a rare creature, and a battle zone grows dark the longer the party stays (§8): at night the
// party takes ×1.2 damage, gold is ×1.3 and the dark merchant appears (§9). Leaving a battle zone by its exit stone heals
// 30% and shows what the zone gave; a rest zone heals fully. Beating the boss clears the stage; a party wipe ends the
// run. Either way it is back to the title: nothing is kept (the host gets the run log, §12.1).
// State and keys; the host draws it (web/expedition/expedition.ts) and steps it every animation frame (frame()).
// Plain fields, no constructor parameter properties: node's type stripping loads core/ in tests.
import { AVK } from '../keys';
import type { Assets } from '../data/assets';
import type { InputState } from '../input';
import type { SoundOut } from '../sound';
import { FieldSim, type Advantage, type FieldChest, type FieldEnemy, type Press } from './field';
import { Battle, talkExp } from './battle';
import { Run, recruit, type Member } from './run';
import { Talk } from './talk';
import { BOSS_SPECIES, FIELD_SPECIES } from './species';
import { Rng } from './rng';
import { CHEST_NAME, DROP_CHANCE, FIELD_DROP_CHANCE, GRADE_NAME, RARE_CHANCE, SLOT_NAME, creatureDrop, gearDesc, gearNamer, merchantStock, openChest, rareDrop,
  type Gear, type Namer, type Ware } from './loot';
import { buildBoss, buildField, zoneSets, type Zone, type ZoneKind, type ZoneSets } from './zone';

/** what the mode needs from its host: the game data, the input, the sound and the way back to the title */
export interface ExpeditionHost {
  readonly assets: Assets;
  readonly input: InputState;
  readonly audio: SoundOut;
  readonly screens: { title(): void };
}

export type Mode = 'loading' | 'field' | 'pause' | 'encounter' | 'battle' | 'summary' | 'shop' | 'gear' | 'over' | 'clear';

/** the rows of the equipment comparison */
export const GEAR_CHOICES = ['교체', '버리기'] as const;

/** a piece found for a slot already filled, waiting for the comparison: where it came from */
export interface GearOffer { gear: Gear; from: string }

/** the zone heal on leaving a battle zone */
export const EXIT_HEAL = 0.3;
export const BATTLE_ZONES = 3;

/** a battle zone's clock (s of its own time, field and battle): dusk, then night (§8). It runs CLOCK_SPEED times
 *  real time: a zone is crossed well within five real minutes, so night (6:00) falls after 2:24 played */
export const DUSK_AT = 300, NIGHT_AT = 360, CLOCK_SPEED = 2.5;
/** at night: damage the party takes ×, gold × */
export const NIGHT_TAKEN = 1.2, NIGHT_GOLD = 1.3;
export type DayPhase = 'day' | 'dusk' | 'night';

/** a stage-1 plan: battle zones in order, a rest zone between them about half the time, always one before the boss */
export function stagePlan(seed: number): ZoneKind[] {
  const rng = new Rng(seed ^ 0x9e3779b9), plan: ZoneKind[] = [];
  for (let i = 0; i < BATTLE_ZONES; i++) {
    plan.push('battle');
    if (i < BATTLE_ZONES - 1 && rng.chance(0.5)) plan.push('rest');
  }
  plan.push('rest', 'boss');
  return plan;
}

/** the pause menu rows */
export const PAUSE_ITEMS = ['계속하기', '원정 포기 (타이틀로)'] as const;

export const ADVANTAGE_LABEL: Record<Advantage, string> = { party: '선제 공격!', none: '전투 개시', enemy: '기습당했다!' };

/** a short line over the field (kills, breaks, rewards) */
export interface Toast { text: string; t: number }

/** what the field drew this frame beyond the sprites: hit sparks and parry flashes, in map pixels */
export interface Flash { kind: 'hit' | 'heavy' | 'parry' | 'break'; x: number; y: number; t: number }

/** a battle zone in the run log (§12.1) */
export interface ZoneLog {
  zone: string;
  /** seconds spent by day, at dusk, at night */
  time: Record<DayPhase, number>;
  battles: Record<Advantage, number>;
  kills: { battle: number; field: number };
  exp: number;
  gold: { got: number; spent: number };
  /** chests by kind (나무, 녹슨, 은, 황금): placed and opened */
  chests: { placed: number[]; opened: number[] };
  rare: { met: number; caught: number; lost: number };
  merchant: { met: boolean; bought: string[] };
  /** equipment found here, put on, and thrown away */
  gear: { found: string[]; worn: number; dropped: number };
}

/** the boss fight in the run log */
export interface BossLog {
  party: string[];
  equip: string[];
  potions: number;
  gold: number;
  advantage: Advantage;
  result: 'won' | 'lost';
  turns: number;
  parries: number;
  hitsTaken: number;
  roarDmg: number;
  enraged: boolean;
}

export class ExpeditionLogic {
  protected readonly ctx: ExpeditionHost;
  mode: Mode = 'loading';
  sets: ZoneSets | null = null;
  zone: Zone | null = null;
  field: FieldSim | null = null;
  pauseSel = 0;
  /** run seed: every zone is built from it and its number */
  readonly seed: number;
  readonly run = new Run();
  battle: Battle | null = null;
  talk: Talk | null = null;
  /** the members a full party may let go for a talked-over creature (the talk names them in this order) */
  private releasable: Member[] = [];
  toasts: Toast[] = [];
  flashes: Flash[] = [];
  /** the encounter being opened: its banner shows this long before the battle */
  encounter: { enemies: FieldEnemy[]; advantage: Advantage; t: number } | null = null;
  /** the zones of this run and the one being played */
  readonly plan: ZoneKind[];
  step = 0;
  /** the lines shown on leaving a battle zone */
  summary: string[] = [];
  /** the battle zone's clock (s of its own time) and its phase (§8) */
  clock = 0;
  dayPhase: DayPhase = 'day';
  /** the dark merchant's stock in this zone, the cursor and the line under it */
  stock: Ware[] = [];
  shopSel = 0;
  shopLine = '';
  /** the run log (§12.1) */
  readonly log: { zones: ZoneLog[]; boss: BossLog | null } = { zones: [], boss: null };
  /** this battle zone's entry in the log */
  zlog: ZoneLog | null = null;
  /** loot rolls (drops, chests, the merchant), from the run seed */
  private readonly lootRng: Rng;
  /** the main game's equipment names (its data, read when a piece is made) */
  private readonly names: Namer;
  /** pieces for filled slots waiting for the comparison, its cursor, and the mode it returns to */
  offers: GearOffer[] = [];
  gearSel = 0;
  private gearBack: 'field' | 'shop' = 'field';
  /** parries before the boss battle began */
  private parriesAtBoss = 0;

  constructor(ctx: ExpeditionHost, seed = Date.now() >>> 0) {
    this.ctx = ctx;
    this.seed = seed;
    this.plan = stagePlan(seed);
    this.lootRng = new Rng((seed ^ 0x2545f491) >>> 0);
    this.names = gearNamer(ctx.assets);
    void this.enterZone();
  }

  /** the number of the battle zone being played (1..), or 0 */
  get battleNo(): number { return this.plan.slice(0, this.step + 1).filter((k) => k === 'battle').length; }

  /** what the HUD calls the zone */
  get zoneName(): string {
    const k = this.plan[this.step];
    return k === 'battle' ? `초원 ${this.battleNo} / ${BATTLE_ZONES}` : k === 'rest' ? '쉼터' : '초원 - 깊숙한곳';
  }

  /** a battle zone is being played (its clock runs) */
  get inBattleZone(): boolean { return this.plan[this.step] === 'battle'; }
  get night(): boolean { return this.inBattleZone && this.dayPhase === 'night'; }
  get goldMul(): number { return this.night ? NIGHT_GOLD : 1; }
  get takenMul(): number { return this.night ? NIGHT_TAKEN : 1; }
  /** 0 (day) .. 1 (night): how dark the field is */
  get darkness(): number {
    if (!this.inBattleZone) return 0;
    return Math.max(0, Math.min(1, (this.clock - DUSK_AT) / (NIGHT_AT - DUSK_AT)));
  }

  /** build the zone of this step and put the hero at its start (the host prepares its drawing in onZone) */
  protected async enterZone(): Promise<void> {
    this.mode = 'loading';
    const a = this.ctx.assets, kind = this.plan[this.step], seed = (this.seed + this.step * 7919) >>> 0;
    this.sets ??= await zoneSets(a);
    const zone = kind === 'boss' ? await buildBoss(a, this.sets, BOSS_SPECIES)
      : kind === 'rest' ? await buildField(a, this.sets, seed, 'rest', { w: 60, h: 44, groups: 0, species: [] })
      : await buildField(a, this.sets, seed, 'battle', { w: 190, h: 160, groups: 10 + this.battleNo * 2, species: FIELD_SPECIES, zoneNo: this.battleNo, rare: RARE_CHANCE });
    await this.onZone(zone);
    this.zone = zone;
    this.field = new FieldSim(zone, seed ^ 0x5bd1e995, kind === 'battle' ? this.battleNo - 1 : 0);
    this.mode = 'field';
    this.toasts = [];
    this.clock = 0;
    this.dayPhase = 'day';
    this.stock = [];
    this.zlog = null;
    if (kind === 'battle') {
      const placed = [0, 0, 0, 0];
      for (const c of zone.chests ?? []) placed[c.kind]++;
      this.zlog = { zone: this.zoneName, time: { day: 0, dusk: 0, night: 0 }, battles: { party: 0, none: 0, enemy: 0 }, kills: { battle: 0, field: 0 }, exp: 0,
        gold: { got: 0, spent: 0 }, chests: { placed, opened: [0, 0, 0, 0] }, rare: { met: zone.spawns.filter((s) => s.rare).length, caught: 0, lost: 0 },
        merchant: { met: false, bought: [] }, gear: { found: [], worn: 0, dropped: 0 } };
      this.log.zones.push(this.zlog);
    }
    if (kind === 'rest') { this.run.heal(1); this.toast('쉼터: 파티가 모두 회복했다'); this.toast('출구의 돌에서 상호작용으로 다음 지역으로'); }
    else if (kind === 'boss') this.toast('깊은 곳에서 무언가가 노려보고 있다...');
    else this.toast(`${this.zoneName} · 동쪽 끝의 돌이 출구다`);
  }

  /** the exit stone: a battle zone shows what it gave first, a rest zone goes straight on */
  private leaveZone(): void {
    if (this.plan[this.step] === 'battle') {
      const z = this.zlog!, opened = z.chests.opened.reduce((s, n) => s + n, 0), placed = z.chests.placed.reduce((s, n) => s + n, 0);
      this.run.cleared++;
      this.run.heal(EXIT_HEAL);
      this.summary = [`${this.zoneName} 돌파!`, `파티 HP ${EXIT_HEAL * 100}% 회복`,
        `쓰러뜨린 적 ${z.kills.battle + z.kills.field} · EXP +${z.exp}`, `골드 +${z.gold.got}${z.gold.spent ? ` (쓴 골드 ${z.gold.spent})` : ''}`,
        `연 상자 ${opened} / ${placed}`, `얻은 장비 ${z.gear.found.length} (착용 ${z.gear.worn})`, ...(z.rare.met ? [`빛나는 몬스터 ${z.rare.caught ? '포획' : '놓침'}`] : [])];
      this.mode = 'summary';
      return;
    }
    this.step++;
    void this.enterZone();
  }

  /** the summary was read: on to the next zone */
  nextZone(): void {
    if (this.mode !== 'summary') return;
    this.step++;
    void this.enterZone();
  }

  /** the host loads what the zone draws with before it shows */
  protected async onZone(_zone: Zone): Promise<void> {}

  /** the 20 Hz tick: nothing here, the host steps frame() every animation frame with the presses */
  update(_presses: number[]): void {}

  toast(text: string): void { this.toasts.push({ text, t: 0 }); if (this.toasts.length > 3) this.toasts.shift(); }

  /** gold the zone gave (the run's purse is filled where it is earned) */
  private gainGold(n: number): void {
    if (this.zlog) this.zlog.gold.got += n;
  }

  /** the battle zone's clock: dusk and night fall (§8); the merchant comes with the night */
  private tickClock(dt: number): void {
    if (!this.inBattleZone || !this.field) return;
    this.clock += dt * CLOCK_SPEED;
    if (this.zlog) this.zlog.time[this.dayPhase] += dt;
    const ph: DayPhase = this.clock >= NIGHT_AT ? 'night' : this.clock >= DUSK_AT ? 'dusk' : 'day';
    if (ph === this.dayPhase) return;
    this.dayPhase = ph;
    if (ph === 'dusk') this.toast('날이 어두워집니다.');
    else if (ph === 'night') {
      this.toast('밤이 되었습니다. 몬스터들이 강해집니다.');
      this.field.placeMerchant();
      this.stock = merchantStock(this.battleNo, this.lootRng, this.names);
      this.toast('어디선가 상인의 등불이 켜졌다');
    }
  }

  /** one animation frame: dt seconds, the presses since the last one */
  frame(dt: number, presses: Press[], now: number): void {
    dt = Math.min(dt, 0.05);
    const keys = presses.map((p) => p.key);
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < 2.4);
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < 0.5);
    if (this.mode === 'pause') { this.pauseKeys(keys); return; }
    if (this.mode === 'over' || this.mode === 'clear') { if (keys.includes(AVK.OK)) this.ctx.screens.title(); return; }
    if (this.mode === 'summary') { if (keys.includes(AVK.OK)) this.nextZone(); return; }
    if (this.mode === 'shop') { this.shopKeys(keys); return; }
    if (this.mode === 'gear') { this.gearKeys(keys); return; }
    if (this.mode === 'battle') { this.tickClock(dt); this.battleFrame(dt, presses, now, keys); return; }
    if (!this.field) return;
    if (this.mode === 'encounter') {
      this.tickClock(dt);
      this.field.step(dt, this.ctx.input, []);
      if ((this.encounter!.t += dt) > 1.1) this.beginBattle();
      return;
    }
    if (this.mode !== 'field') return;
    if (keys.includes(AVK.CLR)) { this.mode = 'pause'; this.pauseSel = 0; return; }
    this.tickClock(dt);
    this.field.step(dt, this.ctx.input, presses);
    for (const e of this.field.takeEvents()) {
      switch (e.kind) {
        case 'sfx': this.ctx.audio.playSfx(e.id); break;
        case 'hit': this.flashes.push({ kind: e.heavy ? 'heavy' : 'hit', x: e.x, y: e.y, t: 0 }); break;
        case 'parry': this.flashes.push({ kind: 'parry', x: e.x, y: e.y, t: 0 }); this.toast('패링!'); break;
        case 'break': this.flashes.push({ kind: 'break', x: e.enemy.x, y: e.enemy.y - 20, t: 0 }); this.toast(`${e.enemy.sp.name} 브레이크! 다가가서 선제 공격`); break;
        case 'notice': if (e.enemy.rare) this.toast(`빛나는 ${e.enemy.sp.name}이(가) 달아난다!`); break;
        case 'vanish': if (this.zlog) this.zlog.rare.lost++; this.toast(`빛나는 ${e.enemy.sp.name}이(가) 사라졌다`); break;
        case 'kill': {
          const gain = Math.round(e.enemy.stats.exp * 0.5), gold = Math.round(e.enemy.stats.gold * 0.5 * this.goldMul);
          this.run.kills++;
          this.run.gold += gold;
          this.gainGold(gold);
          if (this.zlog) { this.zlog.kills.field++; this.zlog.exp += gain; }
          this.toast(`${e.enemy.sp.name} 처치 · EXP +${gain} · ${gold}G`);
          for (const l of this.run.award(gain)) this.toast(l);
          if (this.lootRng.chance(FIELD_DROP_CHANCE)) this.gainGear(creatureDrop(this.battleNo, this.lootRng, this.names), e.enemy.sp.name);
          break;
        }
        case 'chest': this.openChest(e.chest); break;
        case 'shop': this.openShop(); return;
        case 'battle':
          this.encounter = { enemies: e.enemies, advantage: e.advantage, t: 0 };
          this.mode = 'encounter';
          break;
        case 'exit': this.leaveZone(); return;
        default: break;
      }
    }
    this.openOffer();
  }

  /** a chest opened: its gold, potion or piece (§6.3) */
  private openChest(c: FieldChest): void {
    const loot = openChest(c.kind, this.battleNo, this.lootRng, this.names);
    if (this.zlog) this.zlog.chests.opened[c.kind]++;
    if (loot.kind === 'gold') { this.run.gold += loot.gold; this.gainGold(loot.gold); this.toast(`${CHEST_NAME[c.kind]}: ${loot.gold}G`); }
    else if (loot.kind === 'potion') { this.run.potions += loot.n; this.toast(`${CHEST_NAME[c.kind]}: 회복약 +${loot.n}`); }
    else this.gainGear(loot.gear, CHEST_NAME[c.kind]);
  }

  // --- equipment ------------------------------------------------------------------------------------------------

  /** a piece found: an empty slot puts it on at once, a filled one waits for the comparison */
  private gainGear(g: Gear, from: string): void {
    this.zlog?.gear.found.push(`[${GRADE_NAME[g.grade]}] ${g.name}`);
    if (!this.run.equip[g.slot]) {
      this.run.wear(g);
      if (this.zlog) this.zlog.gear.worn++;
      this.toast(`${from}: [${GRADE_NAME[g.grade]}] ${g.name} 장착`);
      this.toast(gearDesc(g));
      return;
    }
    this.toast(`${from}: [${GRADE_NAME[g.grade]}] ${g.name}`);
    this.offers.push({ gear: g, from });
  }

  /** the comparison opens over the field or the merchant when a piece waits */
  private openOffer(): void {
    if (!this.offers.length || (this.mode !== 'field' && this.mode !== 'shop')) return;
    this.gearBack = this.mode;
    this.mode = 'gear';
    this.gearSel = 0;
  }

  /** the waiting piece: put on (the worn one is thrown away) or thrown away */
  chooseGear(wear: boolean): void {
    const o = this.offers[0];
    if (!o || this.mode !== 'gear') return;
    this.offers.shift();
    if (wear) {
      const old = this.run.wear(o.gear);
      if (this.zlog) { this.zlog.gear.worn++; this.zlog.gear.dropped++; }
      this.toast(`${SLOT_NAME[o.gear.slot]} 교체: ${o.gear.name}${old ? ` (${old.name} 버림)` : ''}`);
    } else {
      if (this.zlog) this.zlog.gear.dropped++;
      this.toast(`${o.gear.name}을(를) 버렸다`);
    }
    this.gearSel = 0;
    if (!this.offers.length) this.mode = this.gearBack;
  }

  private gearKeys(keys: number[]): void {
    for (const k of keys) {
      if (k === AVK.UP || k === AVK.DOWN) this.gearSel = (this.gearSel + 1) % GEAR_CHOICES.length;
      else if (k === AVK.CLR) { this.chooseGear(false); return; }
      else if (k === AVK.OK) { this.chooseGear(this.gearSel === 0); return; }
    }
  }

  // --- the dark merchant ----------------------------------------------------------------------------------------

  private openShop(): void {
    this.mode = 'shop';
    this.shopSel = 0;
    this.shopLine = '어둠 속에서 거래를 청한다. 무엇을 사겠나?';
    if (this.zlog) this.zlog.merchant.met = true;
  }

  /** buy what slot i holds: a potion (one at a time) or a piece (compared with the worn one when its slot is filled) */
  buy(i: number): void {
    const w = this.stock[i];
    if (!w || this.mode !== 'shop') return;
    this.shopSel = i;
    if (w.sold) { this.shopLine = '이미 팔린 물건이다'; return; }
    if (this.run.gold < w.price) { this.shopLine = `골드가 모자라다 (${w.price}G)`; return; }
    this.run.gold -= w.price;
    if (this.zlog) this.zlog.gold.spent += w.price;
    if (!w.gear) {
      this.run.potions++;
      if (--w.n <= 0) w.sold = true;
      this.shopLine = `회복약을 샀다 (보유 ${this.run.potions})`;
      this.zlog?.merchant.bought.push('회복약');
      return;
    }
    w.sold = true;
    this.shopLine = `${w.gear.name}을(를) 샀다`;
    this.zlog?.merchant.bought.push(w.gear.name);
    this.gainGear(w.gear, '암흑상인');
    this.openOffer();
  }

  /** leave the merchant */
  closeShop(): void { if (this.mode === 'shop') this.mode = 'field'; }

  private shopKeys(keys: number[]): void {
    const n = this.stock.length + 1;                              // the stock, then 떠나기
    for (const k of keys) {
      if (k === AVK.UP) this.shopSel = (this.shopSel + n - 1) % n;
      else if (k === AVK.DOWN) this.shopSel = (this.shopSel + 1) % n;
      else if (k === AVK.CLR) { this.closeShop(); return; }
      else if (k === AVK.OK) { if (this.shopSel >= this.stock.length) { this.closeShop(); return; } this.buy(this.shopSel); }
    }
  }

  // --- battles --------------------------------------------------------------------------------------------------

  /** the encounter banner is over: the turn battle */
  protected beginBattle(): void {
    const enc = this.encounter!;
    this.battle = new Battle(this.run, enc.enemies, enc.advantage);
    this.battle.takenMul = this.takenMul;
    this.battle.goldMul = this.goldMul;
    this.battle.onTalk = (talker, enemy) => this.onTalk(talker, enemy);
    if (this.zlog) this.zlog.battles[enc.advantage]++;
    if (this.battle.isBoss) this.parriesAtBoss = this.run.parries;
    this.mode = 'battle';
    this.onBattle(this.battle);
  }

  /** the host loads what the battle draws with */
  protected onBattle(_b: Battle): void {}

  /** 대화 was picked: the negotiation opens over the battle */
  protected onTalk(talker: Battle['party'][number], enemy: Battle['enemies'][number]): void {
    const run = this.run;
    this.releasable = run.party.filter((m) => m.species !== null);
    this.talk = new Talk(talker, enemy, { potions: () => run.potions, usePotion: () => { run.potions--; }, block: this.battle!.recruitBlock(enemy),
      release: this.releasable.map((m) => ({ name: m.name, lv: m.lv })), showHints: true });
  }

  /** the talk is over: a creature that joined fights on the party's side (a rare one shines, ×1.2) */
  private endTalk(): void {
    const t = this.talk!, b = this.battle!, out = t.outcome!;
    if (out === 'joined') {
      const gone = t.released !== null ? this.releasable[t.released] : null;
      if (gone) b.release(gone);
      const m = recruit(t.enemy.species!, t.enemy.rare);
      m.hp = Math.max(1, Math.round(m.hpMax * Math.max(0.3, t.enemy.hp / t.enemy.hpMax)));
      this.run.join(m);
      this.run.recruits++;
      if (t.enemy.rare && this.zlog) this.zlog.rare.caught++;
      b.addMember(m);
      b.line = `${t.enemy.rare ? '빛나는 ' : ''}${m.name}이(가) 동료가 되었다!`;
    } else if (out === 'bonded') b.line = `${t.enemy.name}의 마음을 얻었다! 승리하면 EXP +${talkExp(t.enemy)}`;
    else if (out === 'left') b.line = `${t.enemy.name}이(가) 달아났다`;
    else if (out === 'angry') b.line = `${t.enemy.name}이(가) 화가 났다!`;
    else b.line = '협상 실패';
    b.endTalk(out, t.enemy);
    this.talk = null;
  }

  protected battleFrame(dt: number, presses: Press[], now: number, keys: number[]): void {
    const b = this.battle!;
    if (this.talk) {
      this.talk.rollT += dt;
      for (const k of keys) this.talk.key(k);
      if (this.talk.outcome) this.endTalk();
      return;
    }
    b.frame(dt, presses, now);
    if (b.phase === 'won' && b.t > 0.6 && keys.includes(AVK.OK)) this.endBattle();
    else if (b.phase === 'fled' && b.t > 0.8) this.endBattle();
    else if (b.phase === 'lost' && b.t > 1.2 && keys.includes(AVK.OK)) {
      if (b.isBoss) this.logBoss(b, 'lost');
      this.mode = 'over';
      this.battle = null;
      this.finishLog();
    }
  }

  /** back to the field: the beaten, recruited and departed are gone; after fleeing the group leaves the hero be */
  protected endBattle(): void {
    const b = this.battle!, enc = this.encounter!;
    b.sync();
    if (b.phase === 'won') {
      const beaten = b.enemies.filter((e) => !e.gone).length;
      this.run.kills += beaten;
      this.gainGold(b.gold);
      if (this.zlog) { this.zlog.kills.battle += beaten; this.zlog.exp += b.exp; }
      this.field!.resume(enc.enemies, []);
      if (b.isBoss) { this.logBoss(b, 'won'); this.battle = null; this.encounter = null; this.mode = 'clear'; this.finishLog(); return; }
      const first = b.enemies.find((e) => !e.gone);                // one roll for the won battle (§4.3)
      if (first && this.lootRng.chance(DROP_CHANCE)) this.gainGear(creatureDrop(this.battleNo, this.lootRng, this.names), first.name);
      for (const r of b.rares) {                                   // a beaten rare creature drops a piece of its own (§7)
        if (this.zlog) this.zlog.rare.caught++;
        this.gainGear(rareDrop(this.battleNo, this.lootRng, this.names), `빛나는 ${r.name}`);
      }
    } else {
      const gone = b.enemies.filter((e) => e.gone).map((e) => e.field!);
      this.field!.resume(gone, enc.enemies.filter((e) => !gone.includes(e)));
    }
    // a rare creature that ran from the battle is gone for good
    for (const e of b.enemies) if (e.rare && e.gone && e.fled && this.zlog) this.zlog.rare.lost++;
    for (const m of this.run.party) if (m.hp <= 0) m.hp = 1;      // the fallen get up with 1 HP after a win or an escape
    this.battle = null;
    this.encounter = null;
    this.mode = 'field';
    this.openOffer();
  }

  // --- the run log (§12.1) --------------------------------------------------------------------------------------

  private logBoss(b: Battle, result: 'won' | 'lost'): void {
    const boss = b.enemies.find((e) => e.sp?.boss);
    this.log.boss = {
      party: this.run.party.map((m) => `${m.shiny ? '빛나는 ' : ''}${m.name} Lv.${m.lv}`),
      equip: this.run.equip.flatMap((g) => g ? [`[${GRADE_NAME[g.grade]}] ${g.name}`] : []), potions: this.run.potions, gold: this.run.gold,
      advantage: b.advantage, result, turns: boss?.turns ?? 0, parries: this.run.parries - this.parriesAtBoss, hitsTaken: b.hitsTaken,
      roarDmg: b.roarDmg, enraged: !!boss?.enraged,
    };
  }

  /** the run is over: the host keeps its log (the web host prints it to the console) */
  private finishLog(): void { this.onRunEnd(this.log); }

  protected onRunEnd(_log: ExpeditionLogic['log']): void {}

  protected pauseKeys(keys: number[]): void {
    for (const k of keys) {
      if (k === AVK.UP || k === AVK.DOWN) this.pauseSel = (this.pauseSel + 1) % PAUSE_ITEMS.length;
      else if (k === AVK.CLR) { this.mode = 'field'; return; }
      else if (k === AVK.OK) {
        if (this.pauseSel === 0) this.mode = 'field';
        else this.ctx.screens.title();
        return;
      }
    }
  }

  pickPause(i: number): void { this.pauseSel = i; this.pauseKeys([AVK.OK]); }
}
