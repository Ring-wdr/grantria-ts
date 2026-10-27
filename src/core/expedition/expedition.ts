// 원정(가제) (not in the original): a standalone roguelike extra mode, reached from the title's 엑스트라 submenu.
// It stands apart from main play: no save slot (a run lives in memory only), and nothing here imports the field game,
// combat, rules or saves (tests/boundary.test.ts). The run (stage 1): three battle zones on t3, one after another,
// with a rest zone between them half the time and always one before the boss room (초원 - 깊숙한곳, m124). The hero
// walks 360° and fights in the field; an encounter becomes a turn battle. Leaving a battle zone by its exit stone shows
// the reward (a placeholder until the reward system is decided) and heals 30%; a rest zone heals fully. Beating the
// boss clears the stage; a party wipe ends the run. Either way it is back to the title: nothing is kept.
// State and keys; the host draws it (web/expedition/expedition.ts) and steps it every animation frame (frame()).
// Plain fields, no constructor parameter properties: node's type stripping loads core/ in tests.
import { AVK } from '../keys';
import type { Assets } from '../data/assets';
import type { InputState } from '../input';
import type { SoundOut } from '../sound';
import { FieldSim, type Advantage, type FieldEnemy, type Press } from './field';
import { Battle } from './battle';
import { Run, recruit } from './run';
import { Talk } from './talk';
import { BOSS_SPECIES, FIELD_SPECIES } from './species';
import { Rng } from './rng';
import { buildBoss, buildField, zoneSets, type Zone, type ZoneKind, type ZoneSets } from './zone';

/** what the mode needs from its host: the game data, the input, the sound and the way back to the title */
export interface ExpeditionHost {
  readonly assets: Assets;
  readonly input: InputState;
  readonly audio: SoundOut;
  readonly screens: { title(): void };
}

export type Mode = 'loading' | 'field' | 'pause' | 'encounter' | 'battle' | 'reward' | 'over' | 'clear';

/** the zone heal on leaving a battle zone */
export const EXIT_HEAL = 0.3;
export const BATTLE_ZONES = 3;

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
  toasts: Toast[] = [];
  flashes: Flash[] = [];
  /** the encounter being opened: its banner shows this long before the battle */
  encounter: { enemies: FieldEnemy[]; advantage: Advantage; t: number } | null = null;
  /** the zones of this run and the one being played */
  readonly plan: ZoneKind[];
  step = 0;
  /** the reward screen's lines */
  reward: string[] = [];

  constructor(ctx: ExpeditionHost, seed = Date.now() >>> 0) {
    this.ctx = ctx;
    this.seed = seed;
    this.plan = stagePlan(seed);
    void this.enterZone();
  }

  /** the number of the battle zone being played (1..), or 0 */
  get battleNo(): number { return this.plan.slice(0, this.step + 1).filter((k) => k === 'battle').length; }

  /** what the HUD calls the zone */
  get zoneName(): string {
    const k = this.plan[this.step];
    return k === 'battle' ? `초원 ${this.battleNo} / ${BATTLE_ZONES}` : k === 'rest' ? '쉼터' : '초원 - 깊숙한곳';
  }

  /** build the zone of this step and put the hero at its start (the host prepares its drawing in onZone) */
  protected async enterZone(): Promise<void> {
    this.mode = 'loading';
    const a = this.ctx.assets, kind = this.plan[this.step], seed = (this.seed + this.step * 7919) >>> 0;
    this.sets ??= await zoneSets(a);
    const zone = kind === 'boss' ? await buildBoss(a, this.sets, BOSS_SPECIES)
      : kind === 'rest' ? await buildField(a, this.sets, seed, 'rest', { w: 60, h: 44, groups: 0, species: [] })
      : await buildField(a, this.sets, seed, 'battle', { w: 190, h: 160, groups: 10 + this.battleNo * 2, species: FIELD_SPECIES });
    await this.onZone(zone);
    this.zone = zone;
    this.field = new FieldSim(zone, seed ^ 0x5bd1e995);
    this.mode = 'field';
    this.toasts = [];
    if (kind === 'rest') { this.run.heal(1); this.toast('쉼터: 파티가 모두 회복했다'); this.toast('출구의 돌에서 상호작용으로 다음 지역으로'); }
    else if (kind === 'boss') this.toast('깊은 곳에서 무언가가 노려보고 있다...');
    else this.toast(`${this.zoneName} · 동쪽 끝의 돌이 출구다`);
  }

  /** the exit stone: a battle zone gives its reward first, a rest zone goes straight on */
  private leaveZone(): void {
    if (this.plan[this.step] === 'battle') {
      this.run.cleared++;
      this.run.heal(EXIT_HEAL);
      this.run.potions++;
      this.reward = [`${this.zoneName} 돌파!`, `파티 HP ${EXIT_HEAL * 100}% 회복`, '회복약 +1', '보상 선택: 준비 중 (보상 체계는 회의 후 결정)'];
      this.mode = 'reward';
      return;
    }
    this.step++;
    void this.enterZone();
  }

  /** the host loads what the zone draws with before it shows */
  protected async onZone(_zone: Zone): Promise<void> {}

  /** the 20 Hz tick: nothing here, the host steps frame() every animation frame with the presses */
  update(_presses: number[]): void {}

  toast(text: string): void { this.toasts.push({ text, t: 0 }); if (this.toasts.length > 3) this.toasts.shift(); }

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
    if (this.mode === 'reward') { if (keys.includes(AVK.OK)) { this.step++; void this.enterZone(); } return; }
    if (this.mode === 'battle') { this.battleFrame(dt, presses, now, keys); return; }
    if (!this.field) return;
    if (this.mode === 'encounter') {
      this.field.step(dt, this.ctx.input, []);
      if ((this.encounter!.t += dt) > 1.1) this.beginBattle();
      return;
    }
    if (this.mode !== 'field') return;
    if (keys.includes(AVK.CLR)) { this.mode = 'pause'; this.pauseSel = 0; return; }
    this.field.step(dt, this.ctx.input, presses);
    for (const e of this.field.takeEvents()) {
      switch (e.kind) {
        case 'sfx': this.ctx.audio.playSfx(e.id); break;
        case 'hit': this.flashes.push({ kind: e.heavy ? 'heavy' : 'hit', x: e.x, y: e.y, t: 0 }); break;
        case 'parry': this.flashes.push({ kind: 'parry', x: e.x, y: e.y, t: 0 }); this.toast('패링!'); break;
        case 'break': this.flashes.push({ kind: 'break', x: e.enemy.x, y: e.enemy.y - 20, t: 0 }); this.toast(`${e.enemy.sp.name} 브레이크! 다가가서 선제 공격`); break;
        case 'kill': {
          const gain = Math.round(e.enemy.sp.stats.exp * 0.5);
          this.run.kills++;
          this.toast(`${e.enemy.sp.name} 처치 · EXP +${gain}`);
          for (const l of this.run.award(gain)) this.toast(l);
          break;
        }
        case 'battle':
          this.encounter = { enemies: e.enemies, advantage: e.advantage, t: 0 };
          this.mode = 'encounter';
          break;
        case 'exit': this.leaveZone(); return;
        default: break;
      }
    }
  }

  /** the encounter banner is over: the turn battle */
  protected beginBattle(): void {
    const enc = this.encounter!;
    this.battle = new Battle(this.run, enc.enemies, enc.advantage);
    this.battle.onTalk = (talker, enemy) => this.onTalk(talker, enemy);
    this.mode = 'battle';
    this.onBattle(this.battle);
  }

  /** the host loads what the battle draws with */
  protected onBattle(_b: Battle): void {}

  /** 대화 was picked: the negotiation opens over the battle */
  protected onTalk(talker: Battle['party'][number], enemy: Battle['enemies'][number]): void {
    const run = this.run;
    this.talk = new Talk(talker, enemy, { potions: () => run.potions, usePotion: () => { run.potions--; }, room: run.party.length < 3, showHints: true });
  }

  /** the talk is over: a creature that joined fights on the party's side */
  private endTalk(): void {
    const t = this.talk!, b = this.battle!, out = t.outcome!;
    if (out === 'joined') {
      const m = recruit(t.enemy.species!);
      m.hp = Math.max(1, Math.round(m.hpMax * Math.max(0.3, t.enemy.hp / t.enemy.hpMax)));
      this.run.party.push(m);
      this.run.recruits++;
      b.addMember(m);
      b.line = `${m.name}이(가) 동료가 되었다!`;
    } else if (out === 'left') b.line = `${t.enemy.name}이(가) 달아났다`;
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
    else if (b.phase === 'lost' && b.t > 1.2 && keys.includes(AVK.OK)) { this.mode = 'over'; this.battle = null; }
  }

  /** back to the field: the beaten, recruited and departed are gone; after fleeing the group leaves the hero be */
  protected endBattle(): void {
    const b = this.battle!, enc = this.encounter!;
    b.sync();
    if (b.phase === 'won') {
      this.run.kills += b.enemies.filter((e) => !e.gone).length;
      this.field!.resume(enc.enemies, []);
      if (b.isBoss) { this.battle = null; this.encounter = null; this.mode = 'clear'; return; }
    } else {
      const gone = b.enemies.filter((e) => e.gone).map((e) => e.field!);
      this.field!.resume(gone, enc.enemies.filter((e) => !gone.includes(e)));
    }
    for (const m of this.run.party) if (m.hp <= 0) m.hp = 1;      // the fallen get up with 1 HP after a win or an escape
    this.battle = null;
    this.encounter = null;
    this.mode = 'field';
  }

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

  /** a pause row was tapped */
  pickPause(i: number): void { this.pauseSel = i; this.pauseKeys([AVK.OK]); }
}
