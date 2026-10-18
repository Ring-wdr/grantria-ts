// 음악감상 (not in the original): title screen → 음악감상 → the 19 BGM tracks (s0..s18), the ones ever heard
// playable (records.heard, account-wide, written by every playBgm in app.ts). The tracks heard before that record
// are read from what the slots and the records already show: the zones of visited maps, the BGM switches of the
// story events seen, a boss kill, a death. The track names are this port's own (the original names none).
// The player: OK plays the chosen row (or pauses the one playing), 이전 / 다음 곡 go through the heard tracks only,
// 셔플 picks them at random (이전 곡 then walks back what was played), 계속 재생 plays each once and goes on to the
// next instead of looping it.
// State and keys; the host draws it (web/game/musicRoom.ts).
import { AVK } from '../keys';
import type { SceneHost } from './host';
import { StoryDb, Story } from '../data/story';
import { addHeard, heardBgm, records, seenEvents } from '../rules/records';
import { SLOT_COUNT, loadSlot } from '../save/save';
import type { ScrollRef } from '../render';

/** [name, where it plays]; the order is the file order */
export const TRACKS: [string, string][] = [
  ['그란트리아', '타이틀'],
  ['비토의 탑', '탑 1~15층'],
  ['엘림의 성소', '탑 상층 · 성소'],
  ['브리스톨 광산', '지하 폐광 · 잊혀진 연구실'],
  ['초원', '초원 · 미지의 평원'],
  ['사막', '동쪽·서쪽 사막 · 블랙더스트'],
  ['라이오넬 도서관', '도서관 · 라이오넬 저택'],
  ['호수', '호수 · 이별의 장면'],
  ['무덤', '무덤 · 아칸의 무덤'],
  ['화산', '화산 · 불의 대지'],
  ['협곡', '협곡 · 꿈의 설원'],
  ['비공정', '비공정 · 추락한 비공정'],
  ['결전', '보스전'],
  ['일상', '이야기 장면'],
  ['긴박', '지하 미궁 · 소동 장면'],
  ['불길한 예감', '보스 등장 장면'],
  ['수수께끼', '비밀이 드러나는 장면'],
  ['에필로그', '마지막 장면'],
  ['게임 오버', '쓰러졌을 때'],
];
/** loop lengths in seconds (sound/sN.ogg), for the list before a track is decoded */
export const LENGTH = [58, 47, 54, 55, 43, 47, 55, 48, 55, 47, 46, 38, 42, 49, 69, 32, 48, 86, 6];
/** map header zone -> its BGM (maps/mNNN.json; zone 13 is the 지하 1~100층 dungeon) */
const ZONE_BGM: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 5, 7: 6, 8: 8, 9: 7, 10: 9, 11: 10, 12: 11, 13: 14 };
/** event command 0x16: play BGM arg (events.ts) */
const EV_BGM = 0x16;

/** fold what the saves and records already show into records.heard (each time: a slot may be newer) */
function heardFromSaves(sdb: StoryDb): void {
  const tracks = new Set<number>([0]);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = loadSlot(i);
    if (!s?.story) continue;
    for (const z of Story.from(s.story, s.cls).zones) if (ZONE_BGM[z] !== undefined) tracks.add(ZONE_BGM[z]);
    if ((s.story.counters?.deaths ?? 0) > 0) tracks.add(18);       // the death BGM (achievement counter 'deaths')
  }
  if (Object.keys(records().bosses).length) tracks.add(12);
  for (const cls of [0, 1, 2]) for (const e of seenEvents(cls)) {
    if (e < 0 || e >= sdb.headers.length) continue;
    const [a, b] = sdb.range(e);
    for (let r = a; r < b; r++) { const rec = sdb.rec(e, r); if (rec.cmd === EV_BGM) tracks.add(rec.arg); }
  }
  addHeard(tracks);
}

/** list geometry: the cursor row is kept in view of the scrolled list */
export const ROW_H = 22, LIST_H = 270;

/** the row last looked at and the player's modes, kept while the game runs */
let lastTrack = 0, shuffle = false, continuous = false;
/** 이전 곡 this far into a track starts it over instead */
const RESTART_S = 3;

export class MusicRoomLogic {
  /** the player's modes (kept while the game runs) */
  protected get shuffle(): boolean { return shuffle; }
  protected get continuous(): boolean { return continuous; }

  protected heard: Set<number>;
  protected cur = lastTrack;
  /** the track playing here (the title's when opened) */
  protected playing = 0;
  /** tracks played before, for 이전 곡 while shuffling */
  private history: number[] = [];
  protected scroll: ScrollRef = { y: 0 };

  constructor(protected readonly ctx: SceneHost) {
    heardFromSaves(new StoryDb(ctx.assets));
    this.heard = new Set(heardBgm());
    ctx.audio.setBgmLoop(!continuous);
    this.select(this.cur);
  }

  update(presses: number[]): void {
    for (const k of presses) {
      if (k === AVK.UP || k === AVK.DOWN) this.select((this.cur + (k === AVK.UP ? TRACKS.length - 1 : 1)) % TRACKS.length);
      else if (k === AVK.LEFT || k === AVK.RIGHT) this.select(Math.max(0, Math.min(TRACKS.length - 1, this.cur + (k === AVK.LEFT ? -6 : 6))));
      else if (k === AVK.OK) { if (this.cur !== this.playing) this.play(this.cur); else this.togglePause(); }
      else if (k === AVK.K1) this.togglePause();
      else if (k === AVK.TAB_L) this.prev();
      else if (k === AVK.TAB_R) this.next();
      else if (k === AVK.K3) shuffle = !shuffle;
      else if (k === AVK.STAR) { continuous = !continuous; this.ctx.audio.setBgmLoop(!continuous); }
      else if (k === AVK.CLR) { this.leave(); return; }
    }
    if (continuous && this.ctx.audio.bgmTime()?.ended) this.next();
  }

  /** back to the title: its track loops again, and a paused or finished one makes way for it */
  private leave(): void {
    const a = this.ctx.audio, t = a.bgmTime();
    a.setBgmLoop(true);
    if (t?.paused || t?.ended) a.stopBgm();
    this.ctx.screens.title();
  }

  /** the heard tracks in file order */
  private order(): number[] { return [...this.heard].sort((a, b) => a - b); }

  private play(n: number, remember = true): void {
    if (!this.heard.has(n)) return;
    if (remember && n !== this.playing) this.history = [...this.history.slice(-30), this.playing];
    this.ctx.audio.stopBgm();                                       // the same track again starts over
    this.ctx.audio.playBgm(n);
    this.playing = n;
    this.select(n);
  }

  private next(): void {
    const order = this.order(), others = order.filter((n) => n !== this.playing);
    if (!others.length) { this.play(this.playing); return; }
    if (shuffle) { this.play(others[Math.floor(Math.random() * others.length)]); return; }
    this.play(order.find((n) => n > this.playing) ?? order[0]);
  }

  private prev(): void {
    const t = this.ctx.audio.bgmTime();
    if (t && !t.ended && t.t > RESTART_S) { this.play(this.playing, false); return; }
    if (shuffle && this.history.length) { this.play(this.history.pop()!, false); return; }
    const order = this.order();
    this.play([...order].reverse().find((n) => n < this.playing) ?? order[order.length - 1], false);
  }

  private togglePause(): void {
    const t = this.ctx.audio.bgmTime();
    if (!t) return;
    if (t.ended) this.play(this.playing, false);
    else this.ctx.audio.pauseBgm(!t.paused);
  }

  protected select(i: number): void {
    this.cur = lastTrack = i;
    const y = i * ROW_H;
    if (y < this.scroll.y) this.scroll.y = Math.max(0, y - 4);
    else if (y + ROW_H > this.scroll.y + LIST_H - 4) this.scroll.y = y + ROW_H - LIST_H + 4;
  }
}
