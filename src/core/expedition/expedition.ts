// 원정(가제) (not in the original): a standalone roguelike extra mode, reached from the title's 엑스트라 submenu.
// It stands apart from main play: no save slot (a run lives in memory only), and nothing here imports the field game,
// combat, rules or saves (tests/boundary.test.ts). The run: battle zones on t3 with the hero walking 360° and fighting
// in the field; an encounter becomes a turn battle.
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
import { FIELD_SPECIES } from './species';
import { buildField, zoneSets, type Zone, type ZoneSets } from './zone';

/** what the mode needs from its host: the game data, the input, the sound and the way back to the title */
export interface ExpeditionHost {
  readonly assets: Assets;
  readonly input: InputState;
  readonly audio: SoundOut;
  readonly screens: { title(): void };
}

export type Mode = 'loading' | 'field' | 'pause' | 'encounter' | 'battle' | 'over';

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

  constructor(ctx: ExpeditionHost, seed = Date.now() >>> 0) {
    this.ctx = ctx;
    this.seed = seed;
    void this.enterZone();
  }

  /** build the next zone and put the hero at its start (the host prepares its drawing in onZone) */
  protected async enterZone(): Promise<void> {
    this.mode = 'loading';
    this.sets ??= await zoneSets(this.ctx.assets);
    const zone = await buildField(this.ctx.assets, this.sets, this.seed, 'battle', { w: 190, h: 160, groups: 14, species: FIELD_SPECIES });
    await this.onZone(zone);
    this.zone = zone;
    this.field = new FieldSim(zone, this.seed ^ 0x5bd1e995);
    this.mode = 'field';
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
    if (this.mode === 'over') { if (keys.includes(AVK.OK) || keys.includes(AVK.CLR)) this.ctx.screens.title(); return; }
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
