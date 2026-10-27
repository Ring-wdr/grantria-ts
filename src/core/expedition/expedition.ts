// 원정(가제) (not in the original): a standalone roguelike extra mode, reached from the title's 엑스트라 submenu.
// It stands apart from main play: no save slot (a run lives in memory only), and nothing here imports the field game,
// combat, rules or saves (tests/boundary.test.ts). The run: battle zones on t3 with the hero walking 360°.
// State and keys; the host draws it (web/expedition/expedition.ts) and steps it every animation frame (frame()).
// Plain fields, no constructor parameter properties: node's type stripping loads core/ in tests.
import { AVK } from '../keys';
import type { Assets } from '../data/assets';
import type { InputState } from '../input';
import type { SoundOut } from '../sound';
import { FieldSim, type Press } from './field';
import { buildField, zoneSets, type Zone, type ZoneSets } from './zone';

/** what the mode needs from its host: the game data, the input, the sound and the way back to the title */
export interface ExpeditionHost {
  readonly assets: Assets;
  readonly input: InputState;
  readonly audio: SoundOut;
  readonly screens: { title(): void };
}

export type Mode = 'loading' | 'field' | 'pause';

/** the pause menu rows */
export const PAUSE_ITEMS = ['계속하기', '원정 포기 (타이틀로)'] as const;

export class ExpeditionLogic {
  protected readonly ctx: ExpeditionHost;
  mode: Mode = 'loading';
  sets: ZoneSets | null = null;
  zone: Zone | null = null;
  field: FieldSim | null = null;
  pauseSel = 0;
  /** run seed: every zone is built from it and its number */
  readonly seed: number;

  constructor(ctx: ExpeditionHost, seed = Date.now() >>> 0) {
    this.ctx = ctx;
    this.seed = seed;
    void this.enterZone();
  }

  /** build the next zone and put the hero at its start (the host prepares its drawing in onZone) */
  protected async enterZone(): Promise<void> {
    this.mode = 'loading';
    this.sets ??= await zoneSets(this.ctx.assets);
    const zone = await buildField(this.ctx.assets, this.sets, this.seed, 'battle', { w: 190, h: 160, groups: 0, species: [] });
    await this.onZone(zone);
    this.zone = zone;
    this.field = new FieldSim(zone);
    this.mode = 'field';
  }

  /** the host loads what the zone draws with before it shows */
  protected async onZone(_zone: Zone): Promise<void> {}

  /** the 20 Hz tick: nothing here, the host steps frame() every animation frame with the presses */
  update(_presses: number[]): void {}

  /** one animation frame: dt seconds, the presses since the last one */
  frame(dt: number, presses: Press[]): void {
    dt = Math.min(dt, 0.05);
    const keys = presses.map((p) => p.key);
    if (this.mode === 'pause') { this.pauseKeys(keys); return; }
    if (this.mode !== 'field' || !this.field) return;
    if (keys.includes(AVK.CLR)) { this.mode = 'pause'; this.pauseSel = 0; return; }
    this.field.step(dt, this.ctx.input, presses);
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
