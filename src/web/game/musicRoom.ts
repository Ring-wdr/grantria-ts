// 음악감상 (not in the original): title screen → 음악감상 → the 19 BGM tracks (s0..s18), the ones ever heard
// playable (records.heard, account-wide, written by every playBgm in app.ts). The tracks heard before that record
// are read from what the slots and the records already show: the zones of visited maps, the BGM switches of the
// story events seen, a boss kill, a death. The track names are this port's own (the original names none).
// The player: OK plays the chosen row (or pauses the one playing), 이전 / 다음 곡 go through the heard tracks only,
// 셔플 picks them at random (이전 곡 then walks back what was played), 계속 재생 plays each once and goes on to the
// next instead of looping it.
// The state and keys are core/scenes/musicRoom.ts; this draws them.
import { AVK } from '../input/input';
import type { GameContext } from './scene';
import { frozenTitle, render } from './screens';
import { h, padBadge, type VNode } from '../render/view';
import { tabHint } from '../input/keyHints';
import type { Sound } from '../audio';
import { LENGTH, MusicRoomLogic, ROW_H, TRACKS } from '../../core/scenes/musicRoom';
import '../styles/convenience.css';

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const no = (n: number) => String(n + 1).padStart(2, '0');

export class MusicRoomScene extends MusicRoomLogic {
  declare protected readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    super(ctx);
    ctx.input.uiMode = true; ctx.input.zones = []; ctx.input.padField = false; ctx.input.confirm = false;
  }

  override update(presses: number[]): void {
    for (const t of this.ctx.input.takeTaps()) { const k = this.ctx.ui.tapAt(t.x, t.y); if (k) presses = [...presses, ...k]; }
    super.update(presses);
  }

  readonly wide = true;

  /** a key's glyph for the device in use (L1 / R1 by their tab glyphs) */
  private badge(key: number): VNode | null {
    const inp = this.ctx.input;
    if (key !== AVK.TAB_L && key !== AVK.TAB_R) return padBadge(inp, key, 'v-pad-corner');
    const k = tabHint(inp, key === AVK.TAB_L ? 'l1' : 'r1');
    return k && h(`span.u-pad.${k.cls.split(' ').join('.')}`, { cls: 'v-pad-corner' }, k.glyph);
  }

  private listView(stopped: boolean): VNode {
    return h('div.v-scroll.mr-scroll', { scroll: this.scroll },
      TRACKS.map(([name], i) => {
        const known = this.heard.has(i);
        const cls = [i === this.cur ? 'cur' : '', known ? '' : 'locked', i === this.playing ? 'playing' : '', stopped ? 'stopped' : ''].filter(Boolean).join(' ');
        return h('div.v-row.mr-row', { cls, style: `height:${ROW_H}px`, on: () => { this.select(i); return [AVK.OK]; } },
          h('span.mr-no', null, no(i)),
          h('span.mr-name', null, known ? name : '???'),
          i === this.playing ? h('span.mr-eq', null, h('i'), h('i'), h('i')) : h('span.mr-len', null, known ? time(LENGTH[i]) : ''));
      }));
  }

  private playerView(pt: BgmTime | null, stopped: boolean): VNode {
    const n = this.playing, d = pt?.d ?? LENGTH[n], t = pt?.t ?? 0;
    const ctl = (key: number, icon: string, cls = '') =>
      h(`div.mr-ctl${cls}`, { on: () => [key] }, h(`i.mr-ic.${icon}`), this.badge(key));
    const mode = (key: number, on: boolean, label: string) =>
      h(`div.v-row.mr-mode${on ? '.on' : ''}`, { on: () => [key] },
        h('span.rc-check', null, on ? '✓' : ''), h('span.v-grow', null, label), padBadge(this.ctx.input, key));
    return h('div.v-col.mr-info', null,
      h('div.v-col.v-grow.v-box.mr-detail', null,
        h('div.mr-label', null, `TRACK ${no(n)}`),
        h('div.mr-title', null, TRACKS[n][0]),
        h('div.mr-where', null, TRACKS[n][1]),
        h(`div.mr-disc${stopped ? '' : '.spin'}`),
        h('div.v-col.mr-progress', null,
          h('div.mr-bar', null, h('div.mr-fill', { style: `width:${(100 * t) / d}%` })),
          h('div.v-row.mr-times', null, h('span', null, time(t)), h('span', null, time(d)))),
        h('div.v-row.mr-transport', null,
          ctl(AVK.TAB_L, 'prev'), ctl(AVK.K1, stopped ? 'play' : 'pause', '.main'), ctl(AVK.TAB_R, 'next'))),
      h('div.v-row.mr-modes', null, mode(AVK.K3, this.shuffle, '셔플'), mode(AVK.STAR, this.continuous, '계속 재생')));
  }

  draw(): void {
    const pt = this.ctx.audio.bgmTime() ?? null, stopped = !!pt && (pt.paused || pt.ended);
    render(this.ctx, () => {
      const u = this.ctx.ui;
      frozenTitle(this.ctx);
      u.view('musicRoom', 0, 0, 480, 320, h('div.v-fill.v-col.rc-screen', null,
        h('div.v-row.rc-top', null, h('span.rc-title', null, '음악감상'), h('span.mr-count', null, `${this.heard.size} / ${TRACKS.length}`),
          h('span.rc-sub', null, '들어본 곡만 다시 들을 수 있습니다')),
        h('div.v-row.v-grow.rc-body', null, h('div.v-box.mr-list-box', null, this.listView(stopped)), this.playerView(pt, stopped))));
      u.closeButton(-44);                                           // top right, in the title row (C220 y -44 = screen 6)
    });
  }
}

type BgmTime = NonNullable<ReturnType<Sound['bgmTime']>>;
