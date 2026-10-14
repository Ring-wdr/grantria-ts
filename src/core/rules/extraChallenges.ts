// 추가 도전과제 (not in the original): goals for the content added beside the original 50 challenges
// (achievements.ts). Checked by polling like achCheck; done ones are kept per slot in the story counters
// ('xch<id>'), so the slot save format does not change. Rewards are gold only, so the stat balance stays, and paid
// once per account (records.ts extraPaid): most goals read account-wide records, so a new slot would meet them again.

export interface ExtraState {
  /** boss records: kinds killed, a kind killed without being hit */
  bossKinds: number;
  cleanBoss: boolean;
  /** item kinds in the item book */
  itemKinds: number;
  /** best boss rush (bosses beaten, 0 none) and deepest 심연 depth */
  rushBosses: number;
  rushAll: boolean;
  abyss: number;
  /** attendance days in a row (this slot), events replayed, slot lap */
  attendance: number;
  replays: number;
  lap: number;
}

export interface ExtraChallenge { id: number; name: string; desc: string; gold: number; done(s: ExtraState): boolean }

export const EXTRA_CHALLENGES: ExtraChallenge[] = [
  { id: 0, name: '보스 사냥꾼', desc: '보스 10종을 처치한다', gold: 100_000, done: (s) => s.bossKinds >= 10 },
  { id: 1, name: '무결점', desc: '보스를 한 번도 맞지 않고 처치한다', gold: 150_000, done: (s) => s.cleanBoss },
  { id: 2, name: '수집가', desc: '아이템 도감에 100종을 모은다', gold: 100_000, done: (s) => s.itemKinds >= 100 },
  { id: 3, name: '대수집가', desc: '아이템 도감에 250종을 모은다', gold: 300_000, done: (s) => s.itemKinds >= 250 },
  { id: 4, name: '개근', desc: '7일 연속으로 출석한다', gold: 50_000, done: (s) => s.attendance >= 7 },
  { id: 5, name: '심연 탐험가', desc: '차원의 문 심연 3단계에 이른다', gold: 200_000, done: (s) => s.abyss >= 3 },
  { id: 6, name: '심연의 끝', desc: '차원의 문 심연 10단계에 이른다', gold: 500_000, done: (s) => s.abyss >= 10 },
  { id: 7, name: '연전연승', desc: '보스 러시에서 보스 5마리를 연달아 쓰러뜨린다', gold: 200_000, done: (s) => s.rushBosses >= 5 },
  { id: 8, name: '보스 러시 완주', desc: '기록된 모든 보스를 상대로 보스 러시를 완주한다', gold: 500_000, done: (s) => s.rushAll },
  { id: 9, name: '추억', desc: '회상으로 이벤트를 10번 다시 본다', gold: 30_000, done: (s) => s.replays >= 10 },
  { id: 10, name: '세 번째 여정', desc: '3회차를 시작한다', gold: 300_000, done: (s) => s.lap >= 4 },
];

export const extraKey = (id: number): string => `xch${id}`;

/** challenges newly met (not yet marked in the counters) */
export function extraCheck(counters: Record<string, number>, s: ExtraState): ExtraChallenge[] {
  return EXTRA_CHALLENGES.filter((c) => !counters[extraKey(c.id)] && c.done(s));
}
