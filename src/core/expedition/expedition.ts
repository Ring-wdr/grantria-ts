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
import { FIELD_SPECIES } from './species';
import { buildField, zoneSets, type Zone, type ZoneSets } from './zone';

/** what the mode needs from its host: the game data, the input, the sound and the way back to the title */
export interface ExpeditionHost {
  readonly assets: Assets;
  readonly input: InputState;
  readonly audio: SoundOut;
  readonly screens: { title(): void };
}

export type Mode = 'loading' | 'field' | 'pause' | 'encounter';

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
  exp = 0;
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
  frame(dt: number, presses: Press[]): void {
    dt = Math.min(dt, 0.05);
    const keys = presses.map((p) => p.key);
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < 2.4);
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < 0.5);
    if (this.mode === 'pause') { this.pauseKeys(keys); return; }
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
          this.exp += gain;
          this.toast(`${e.enemy.sp.name} 처치 · EXP +${gain}`);
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

  /** the turn battle (step 4); for now the group is beaten at once */
  protected beginBattle(): void {
    const enc = this.encounter!;
    const gain = enc.enemies.reduce((s, e) => s + e.sp.stats.exp, 0);
    this.exp += gain;
    this.field!.resume(enc.enemies, []);
    this.toast(`승리 · EXP +${gain}`);
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
