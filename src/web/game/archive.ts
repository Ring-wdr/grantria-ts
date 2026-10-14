// 기록실 (not in the original): 게임 메뉴 → 환경설정 → 기록실 (the original 몬스터도감 row, optionTab.ts) lists 몬스터 도감
// (the original book) and these pages (←→ between them): 아이템 도감, 보스 기록 with the 보스 러시, 도전과제 (the
// original 50 and the added ones) and 출석 · 심연. Records are account-wide (core/rules/records.ts); attendance and
// challenges per slot. 회상 is on the title screen (replay.ts).
import { AVK } from '../input/input';
import type { FieldScene } from './fieldScene';
import type { GameContext } from './scene';
import { button, gt, h, sprite, type ScrollRef, type VChild, type VNode } from '../render/view';
import { records } from '../../core/rules/records';
import { EXTRA_CHALLENGES, extraKey } from '../../core/rules/extraChallenges';
import { challengeGold } from '../../core/rules/achievements';
import { PORTED_BOSSES } from '../../core/combat/boss';
import '../styles/convenience.css';

/** the 기록실 list: 몬스터 도감 (the original book screens in optionTab.ts), then the archive pages */
export const RECORD_ROWS = ['몬스터 도감', '아이템 도감', '보스 기록', '도전과제', '출석 · 심연'];
const PAGES = RECORD_ROWS.slice(1);
const ROW_H = 18;
const DUNGEON_COUNT = 9;

/** what the archive asks its owner (the play scene) to start */
export type Launch = { kind: 'rush' };

/** "mm:ss" of a tick count at 20 ticks a second */
export function ticksText(t: number): string {
  const s = Math.round(t / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** bosses the rush can bring back: killed in their story room (records), in story order */
export function rushBosses(): { type: number; map: number }[] {
  const r = records();
  return PORTED_BOSSES.map((type) => ({ type, map: r.bosses[type]?.map ?? -1 })).filter((b) => b.map >= 0);
}

export class ArchivePanel {
  private cur = 0;
  private scroll: ScrollRef = { y: 0 };
  launch: Launch | null = null;

  /** page: 0 아이템 도감, 1 보스 기록, 2 도전과제, 3 출석 · 심연 */
  constructor(private ctx: GameContext, private fs: FieldScene, private page = 0) {}

  private get rows(): number { return this.page === 1 ? 1 : 0; }   // the 보스 러시 button

  /** false once closed */
  update(presses: number[]): boolean {
    for (const k of presses) {
      if (k === AVK.LEFT || k === AVK.TAB_L) this.go((this.page + PAGES.length - 1) % PAGES.length);
      else if (k === AVK.RIGHT || k === AVK.TAB_R) this.go((this.page + 1) % PAGES.length);
      else if (k === AVK.UP) { if (this.rows) this.move(Math.max(0, this.cur - 1)); else this.scroll.y = Math.max(0, this.scroll.y - ROW_H * 2); }
      else if (k === AVK.DOWN) { if (this.rows) this.move(Math.min(this.rows - 1, this.cur + 1)); else this.scroll.y += ROW_H * 2; }
      else if (k === AVK.OK) this.activate();
      else if (k === AVK.CLR) return false;
    }
    return true;
  }

  private go(p: number): void { this.page = p; this.cur = 0; this.scroll.y = 0; }

  private move(i: number): void {
    this.cur = i;
    const top = i * ROW_H, view = 7 * ROW_H;
    if (top < this.scroll.y) this.scroll.y = top;
    else if (top + ROW_H > this.scroll.y + view) this.scroll.y = top + ROW_H - view;
  }

  private activate(): void {
    if (this.page === 1 && rushBosses().length) this.launch = { kind: 'rush' };
  }

  view(): VNode {
    const tabs = h('div.v-row.ar-tabs', null,
      h('span.v-opt-arrow', { on: () => [AVK.LEFT] }, '◀'),
      h('span.v-grow.ar-title', null, `${PAGES[this.page]}  ${this.page + 1}/${PAGES.length}`),
      h('span.v-opt-arrow', { on: () => [AVK.RIGHT] }, '▶'));
    const body = [this.itemView, this.bossView, this.challengeView, this.attendView][this.page].call(this);
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px' },
      h('div.v-box.v-heading', null, tabs),
      h('div.v-box.v-grow.v-scroll.ar-list', { scroll: this.scroll }, h('div.v-col', null, body)));
  }

  private row(i: number, kids: VChild, on?: () => number[] | void): VNode {
    return h(`div.v-row.ar-row${i === this.cur && this.rows ? '.cur' : ''}`, { on: on ?? (() => { if (this.cur === i) return [AVK.OK]; this.move(i); }) }, kids);
  }

  private itemView(): VChild {
    const db = this.fs.db, t = this.ctx.assets.text, items = records().items;
    const keys = Object.keys(items).map((k) => k.split(':').map(Number) as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (!keys.length) return h('div.ar-empty', null, '아직 기록된 아이템이 없습니다.');
    return [h('div.ar-sub', null, `발견한 아이템 ${keys.length}종`), keys.map(([type, sub]) => {
      const grade = items[`${type}:${sub}`], r = db.iconRect(db.icon(type, sub));
      return h('div.v-row.ar-row', null, sprite(r.image, r.sx, r.sy, 16, 16),
        gt(t[0x7fc + db.model(type, sub, Math.min(grade, 4))] ?? '', { cls: 'v-grow ar-line' }),
        type < 0x10 && h('span.ar-sub', null, `등급 ${grade}`));
    })];
  }

  private bossView(): VChild {
    const t = this.ctx.assets.text, r = records(), rush = rushBosses();
    const rows = PORTED_BOSSES.map((type) => {
      const b = r.bosses[type];
      return h('div.v-row.ar-row', null,
        gt(b ? t[0x3e1 + type] ?? '' : '???', { cls: 'v-grow ar-line' }),
        h('span.ar-sub', null, b ? `${b.k}회 · ${b.best ? ticksText(b.best) : '-'}${b.clean ? ' · 무피격' : ''}` : '미발견'));
    });
    const best = r.rush ? `최고 기록: 보스 ${r.rush.bosses}마리 ${ticksText(r.rush.ticks)}${r.rush.all ? ' (완주)' : ''}` : '최고 기록 없음';
    return [
      this.row(0, button(rush.length ? `보스 러시 시작 (보스 ${rush.length}마리)` : '보스 러시: 이야기 속 보스를 먼저 처치하세요', {
        sel: true, glow: false, cls: `ar-btn${rush.length ? '' : ' off'}`, on: () => [AVK.OK],
      })),
      h('div.ar-sub', null, best),
      rows,
    ];
  }

  private challengeView(): VChild {
    const t = this.ctx.assets.text, st = this.fs.story;
    const orig = Array.from({ length: 50 }, (_, n) => h(`div.v-row.ar-row${st.challenges.has(n) ? '.done' : ''}`, null,
      h('span.ar-check', null, st.challenges.has(n) ? '✓' : '·'),
      gt(t[0x1bcf + n] ?? '', { cls: 'v-grow ar-line' }),
      h('span.ar-sub', null, `${challengeGold(this.ctx.assets, n).toLocaleString('en-US')}G`)));
    const extra = EXTRA_CHALLENGES.map((c) => {
      const done = !!st.counters[extraKey(c.id)];
      return h(`div.v-row.ar-row${done ? '.done' : ''}`, null,
        h('span.ar-check', null, done ? '✓' : '·'),
        h('div.v-col.v-grow.ar-cell', null, h('span.ar-line', null, c.name), h('span.ar-sub', null, c.desc)),
        h('span.ar-sub', null, `${c.gold.toLocaleString('en-US')}G`));
    });
    const n = orig.filter((_, i) => st.challenges.has(i)).length + EXTRA_CHALLENGES.filter((c) => st.counters[extraKey(c.id)]).length;
    return [h('div.ar-sub', null, `달성 ${n} / ${50 + EXTRA_CHALLENGES.length}`), orig, h('div.ar-sub.ar-head', null, '추가 도전과제'), extra];
  }

  private attendView(): VChild {
    const t = this.ctx.assets.text, c = this.fs.story.counters, r = records();
    const day = (c.attendCycle ?? 0) % 7;
    return [
      h('div.ar-sub.ar-head', null, '출석 보상'),
      h('div.v-row.ar-days', null, Array.from({ length: 7 }, (_, i) => h(`span.ar-day${i < day ? '.done' : ''}${i === 6 ? '.big' : ''}`, null, String(i + 1)))),
      h('div.ar-sub', null, `연속 출석 ${c.attendStreak ?? 0}일 · 7일째에는 황금알`),
      h('div.ar-sub.ar-head', null, '차원의 문 심연 최고 단계'),
      Array.from({ length: DUNGEON_COUNT }, (_, d) => h('div.v-row.ar-row', null,
        gt(t[0x4d8 + d] ?? '', { cls: 'v-grow ar-line' }),
        h('span.ar-sub', null, r.abyss[d] ? `심연 ${r.abyss[d]}단계` : '-'))),
      h('div.ar-sub', null, `회상 ${r.replays}회`),
    ];
  }
}
