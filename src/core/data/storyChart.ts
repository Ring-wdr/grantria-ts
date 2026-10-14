// 회상 story chart (not in the original): every replayable story event in play order. Each class has its own
// opening arc (러스티 1..9, 엘 10..19, 알피 20..29: the end hooks of events 0 / 10 / 0x14 mark the other two arcs
// done unplayed), the three meet at event 30 (초원 - 고대유적) and from there the route is one, whatever the class.
// The order follows the trigger chains of the event headers (kind 1 / 6: after p1 and p2, kind 3: after p2, kind 0:
// the boss of the event before it, events.md §0.5); the area events (kind 2) sit where their map and lines put them.
import { OPENING, REPEATABLE, type StoryDb } from './story';

/** the opening arc of each class (index = class), from its opening event to the boss that ends it */
export const BRANCHES: readonly (readonly number[])[] = [
  [0, 109, 1, 2, 3, 114, 116, 115, 117, 4, 5, 6, 7, 118, 119, 120, 8, 9],
  [10, 11, 12, 13, 14, 15, 16, 17, 132, 133, 134, 18, 19],
  [20, 149, 21, 151, 22, 23, 24, 25, 26, 27, 152, 153, 154, 28, 29],
];

/** the shared route after the meeting, in chapters */
export const CHAPTERS: readonly { title: string; events: readonly number[] }[] = [
  { title: '만남 · 초원', events: [30, 31, 32, 33] },
  { title: '블랙더스트', events: [122, 34, 123, 35, 36, 37] },
  { title: '동쪽 · 서쪽 사막', events: [38, 39, 40, 41, 42, 43] },
  { title: '라이오넬 도서관', events: [44, 45, 125, 46, 47, 48, 49, 126, 50, 51, 52, 53] },
  { title: '무덤', events: [54, 55, 56, 57] },
  { title: '러스티의 탑 · 호수', events: [58, 135, 59, 60, 61, 62, 63, 64, 65, 66] },
  { title: '엘의 탑 · 화산', events: [67, 136, 68, 69, 70, 71, 72, 73, 74, 75, 76] },
  { title: '알피의 광산', events: [77, 78, 79, 80, 81, 83, 143, 82, 137, 84] },
  { title: '협곡', events: [85, 87, 86, 88] },
  { title: '비공정 잠입', events: [89, 90, 91, 92, 93, 94, 139, 95] },
  { title: '도서관 4층', events: [96, 97, 98, 99, 100] },
  { title: '결전', events: [101, 102, 103, 104, 106] },
  { title: '어둠의 정원', events: [140, 105, 145, 108] },
];

/** the story as class cls plays it: its own opening arc, then the shared route */
export function route(cls: number): number[] {
  return [...(BRANCHES[cls] ?? []), ...CHAPTERS.flatMap((c) => c.events)];
}

/** 회상 opens the whole route up to the furthest event a class has seen: whoever saw event 9 has been through 1..8,
 *  even when those were played before the seen record existed (older versions) or their slot is gone */
export function seenAlongRoute(cls: number, seen: Iterable<number>): number[] {
  const path = route(cls), have = new Set(seen);
  let last = -1;
  path.forEach((e, i) => { if (have.has(e)) last = i; });
  for (let i = 0; i <= last; i++) have.add(path[i]);
  return [...have].sort((a, b) => a - b);
}

/** text ids of an event's dialogue pages and captions, in script order */
export function lineIds(sdb: StoryDb, e: number): number[] {
  const [a, b] = sdb.range(e), out: number[] = [];
  let id = sdb.headers[e].textBase - 1;
  for (let s = a; s < b; s++) {
    const c = sdb.rec(e, s).cmd;
    if (c === 5 || c === 6 || c === 7 || c === 0x1d) out.push(++id);
  }
  return out;
}

/** events worth a replay: with lines and a map (the openings place themselves), not the repeatable hints, the
 *  garden gate floors or 0x6B */
export function replayable(sdb: StoryDb, e: number): boolean {
  if (REPEATABLE.includes(e) || (e >= 0x9b && e <= 0xa3) || e === 0x6b) return false;
  if (sdb.headers[e].map < 0 && !OPENING.includes(e)) return false;
  return lineIds(sdb, e).length > 0;
}
