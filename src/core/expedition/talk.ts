// 원정(가제): negotiation (대화), after the 3D prototype's: the creature asks two questions whose answers move its mood
// by its temperament, may ask for something, and then the chance is rolled: a base by temperament, the mood, every
// parry made against it in this battle, the HP it has lost, being broken, the level gap. A good roll and it joins the
// party for the run. The lines are this mode's own.
import { AVK } from '../keys';
import type { BUnit } from './battle';
import type { Personality } from './species';

export type Tone = 'kind' | 'bold' | 'witty' | 'logical' | 'flatter' | 'threat';
export const TONE_LABEL: Record<Tone, string> = { kind: '다정', bold: '대담', witty: '유머', logical: '논리', flatter: '칭찬', threat: '위협' };

interface Temper {
  name: string;
  desc: string;
  likes: Record<Tone, number>;
  base: number;
  demandRate: number;
  greet: string[];
  greetBroken: string[];
  like: string[];
  neutral: string[];
  dislike: string[];
  angry: string;
  join: string;
  refuse: string;
}

export const TEMPERS: Record<Personality, Temper> = {
  timid: {
    name: '소심', desc: '따뜻한 말에 마음을 연다. 큰소리에는 움츠러든다.',
    likes: { kind: 2, bold: -1, witty: 0, logical: 1, flatter: 1, threat: -2 },
    base: 0.35, demandRate: 0.35,
    greet: ['사, 사락... 가까이 오지 마...', '...날 베러 온 거 아니야?'],
    greetBroken: ['잎이 다 떨어졌어... 이제 그만해 줘...'],
    like: ['...그렇게 말해 주는 사람, 처음이야.', '사락사락. 조금 안심했어.'],
    neutral: ['으응... 그렇구나.', '잘... 모르겠어.'],
    dislike: ['히익, 무서워...', '그런 말은 싫어...'],
    angry: '저리 가! 가시로 찔러 버릴 거야!',
    join: '...따라가도 돼? 햇볕 드는 곳이면 좋겠어.',
    refuse: '역시 아직은 무서워. 미안해...',
  },
  childish: {
    name: '장난꾸러기', desc: '재미있는 것이 제일이다. 어려운 이야기는 금방 지루해한다.',
    likes: { kind: 1, bold: 0, witty: 2, logical: -1, flatter: 1, threat: -2 },
    base: 0.4, demandRate: 0.45,
    greet: ['퐁! 너 누구야? 놀아 줄 거야?', '찰랑찰랑~ 심심했는데 잘 왔어!'],
    greetBroken: ['으앙, 물이 다 튀어나갔잖아...'],
    like: ['꺄하하! 너 재밌다!', '퐁퐁! 그거 좋아!'],
    neutral: ['흐음~?', '찰랑?'],
    dislike: ['우웅, 재미없어.', '머리가 빙글빙글해...'],
    angry: '흥! 너랑은 안 놀아! 물벼락이다!',
    join: '정했다! 너희랑 같이 놀러 갈래!',
    refuse: '오늘은 그냥 물장구 칠래~ 안녕!',
  },
  proud: {
    name: '오만', desc: '추켜세우면 기분이 좋아진다. 비웃음은 참지 않는다.',
    likes: { kind: 0, bold: 1, witty: -1, logical: 0, flatter: 2, threat: -2 },
    base: 0.3, demandRate: 0.5,
    greet: ['이 초원에서 감히 고개를 드는가.', '흥, 무슨 용건이지?'],
    greetBroken: ['크윽... 이 몸이 무릎을 꿇다니...'],
    like: ['흠, 보는 눈은 있군.', '그래, 바로 그거다.'],
    neutral: ['흥.', '...그래서?'],
    dislike: ['감히 이 몸을!', '무례하구나.'],
    angry: '말은 끝이다. 갈기갈기 찢어 주마!',
    join: '좋다. 특별히 함께 걸어 주지.',
    refuse: '아직 이 몸이 따를 그릇이 아니다.',
  },
  curious: {
    name: '탐구', desc: '새로운 지식과 조리 있는 대답을 좋아한다. 빈말은 꿰뚫어 본다.',
    likes: { kind: 0, bold: 0, witty: 1, logical: 2, flatter: -1, threat: -1 },
    base: 0.35, demandRate: 0.3,
    greet: ['어머, 뭍사람이네. 물어볼 게 있어.', '흐응... 너, 처음 맡아 보는 냄새가 나.'],
    greetBroken: ['노래가... 안 나와... 그래도 궁금한 건 궁금해.'],
    like: ['오, 그건 몰랐어!', '재미있는 생각이야. 더 들려줘.'],
    neutral: ['흔한 대답이네.', '그렇구나...'],
    dislike: ['그건 대답이 아니잖아.', '속 보이는 말은 싫어.'],
    angry: '시시해! 물속으로 끌고 갈 테야!',
    join: '너희를 따라가면 모르는 노래를 잔뜩 듣겠지? 갈래!',
    refuse: '조금 더 지켜볼래.',
  },
  honorable: {
    name: '무인', desc: '정면으로 맞서는 용기를 존중한다. 아첨을 경멸한다. 패링으로 실력을 보이면 마음이 움직인다.',
    likes: { kind: 0, bold: 2, witty: -1, logical: 1, flatter: -2, threat: -1 },
    base: 0.22, demandRate: 0.2,
    greet: ['발톱을 거두고 말을 건다... 이유를 들어 보지.', '...말로 하겠다는 건가.'],
    greetBroken: ['훌륭한 일격이었다. 귀를 기울이마.'],
    like: ['좋은 대답이다.', '그 눈빛, 거짓이 없군.'],
    neutral: ['...음.', '그런가.'],
    dislike: ['가볍구나.', '그런 말로는 움직이지 않는다.'],
    angry: '말은 필요 없다. 발톱으로 답하라!',
    join: '그대의 등을 지켜 주지. 함께 가자.',
    refuse: '아직 그대를 인정할 수 없다.',
  },
};

export interface Question { text: string; answers: { text: string; tone: Tone }[] }

export const QUESTIONS: Question[] = [
  { text: '너는 왜 이 초원을 지나가는 거야?', answers: [
    { text: '끝에 뭐가 있는지 보고 싶어서.', tone: 'logical' }, { text: '그냥 걷는 게 좋아서!', tone: 'witty' },
    { text: '네가 걱정돼서 들렀어.', tone: 'kind' }, { text: '길을 막으면 벤다.', tone: 'threat' }] },
  { text: '싸우는 거, 무섭지 않아?', answers: [
    { text: '무서워. 그래도 너랑은 싸우고 싶지 않아.', tone: 'kind' }, { text: '전혀. 덤벼 봐.', tone: 'bold' },
    { text: '무서우니까 칼을 드는 거지.', tone: 'logical' }, { text: '너처럼 강해 보이는 상대는 처음이야.', tone: 'flatter' }] },
  { text: '바람이 왜 부는지 알아?', answers: [
    { text: '따뜻한 곳과 차가운 곳이 있어서.', tone: 'logical' }, { text: '누가 하품을 해서?', tone: 'witty' },
    { text: '네 노래를 실어 나르려고.', tone: 'flatter' }, { text: '알 게 뭐야.', tone: 'threat' }] },
  { text: '나랑 내기할래? 지면 어떻게 할 건데?', answers: [
    { text: '지면 지는 거지. 받아들일게.', tone: 'bold' }, { text: '이길 때까지 다시 하자고 조를 거야.', tone: 'witty' },
    { text: '너한테 지는 건 영광이지.', tone: 'flatter' }, { text: '내기보다 같이 노는 게 좋아.', tone: 'kind' }] },
  { text: '강한 게 좋은 거야?', answers: [
    { text: '지키고 싶은 걸 지킬 수 있으면.', tone: 'kind' }, { text: '당연하지. 그러니까 내가 이긴다.', tone: 'bold' },
    { text: '강함에도 여러 종류가 있어.', tone: 'logical' }, { text: '너만큼 강하면 좋겠다.', tone: 'flatter' }] },
  { text: '내 노래... 아니, 내 목소리 어때?', answers: [
    { text: '초원에서 들은 것 중에 제일 좋아.', tone: 'flatter' }, { text: '조금 더 크게 해 봐!', tone: 'witty' },
    { text: '듣고 있으면 마음이 편해져.', tone: 'kind' }, { text: '시끄러워.', tone: 'threat' }] },
];

export interface Demand { text: string; kind: 'potion' | 'hp' }
const DEMANDS: Demand[] = [
  { text: '그 반짝이는 병, 하나만 줄래?', kind: 'potion' },
  { text: '진심이라면... 상처 하나쯤은 감수할 수 있겠지?', kind: 'hp' },
];

export type TalkStep =
  | { kind: 'say'; who: string; text: string }
  | { kind: 'choose'; who: string; text: string; options: string[]; tones: (Tone | null)[] }
  | { kind: 'roll'; parts: [string, number][]; chance: number; success: boolean };

export type TalkOutcome = 'joined' | 'failed' | 'angry' | 'left';

/** a talk in a battle: steps shown one at a time; the owner applies the outcome when it is done */
export class Talk {
  readonly enemy: BUnit;
  readonly talker: BUnit;
  readonly temper: Temper;
  step: TalkStep;
  sel = 0;
  outcome: TalkOutcome | null = null;
  /** the steps still to show after this one */
  private queue: TalkStep[] = [];
  private questions: number[];
  private pendingDemand: Demand | null = null;
  private readonly rnd: () => number;
  /** what the run can give (potions) and party room */
  private readonly ctx: { potions: () => number; usePotion: () => void; room: boolean; showHints: boolean };
  /** the roll was shown */
  rolled = false;
  /** seconds since the roll step appeared (its animation) */
  rollT = 0;

  constructor(talker: BUnit, enemy: BUnit, ctx: Talk['ctx'], rnd: () => number = Math.random) {
    this.talker = talker;
    this.enemy = enemy;
    this.ctx = ctx;
    this.rnd = rnd;
    this.temper = TEMPERS[enemy.sp!.personality];
    enemy.talks++;
    const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const ids = QUESTIONS.map((_, i) => i).sort(() => rnd() - 0.5);
    this.questions = ids.slice(0, 2);
    this.step = { kind: 'say', who: enemy.name, text: enemy.broken ? pick(this.temper.greetBroken) : pick(this.temper.greet) };
    if (enemy.talks === 1 && ctx.showHints) this.queue.push({ kind: 'say', who: '', text: `성격: 「${this.temper.name}」 — ${this.temper.desc}` });
    this.queue.push(this.question(this.questions[0]));
  }

  private question(qi: number): TalkStep {
    const q = QUESTIONS[qi];
    const answers = [...q.answers].sort(() => this.rnd() - 0.5);
    return { kind: 'choose', who: this.enemy.name, text: q.text, options: answers.map((a) => a.text), tones: answers.map((a) => a.tone) };
  }

  private pick<T>(xs: T[]): T { return xs[Math.floor(this.rnd() * xs.length)]; }

  /** a key while the talk is open */
  key(k: number): void {
    if (this.outcome) return;
    const st = this.step;
    if (st.kind === 'choose') {
      const n = st.options.length;
      if (k === AVK.UP) this.sel = (this.sel + n - 1) % n;
      else if (k === AVK.DOWN) this.sel = (this.sel + 1) % n;
      else if (k === AVK.OK) this.answer(this.sel);
      return;
    }
    if (k === AVK.OK) this.advance();
  }

  /** a tapped option */
  choose(i: number): void { if (this.step.kind === 'choose') this.answer(i); }

  private answer(i: number): void {
    const st = this.step as Extract<TalkStep, { kind: 'choose' }>;
    this.sel = 0;
    const tone = st.tones[i];
    if (this.pendingDemand) { this.settleDemand(i === 0); return; }
    const delta = this.temper.likes[tone!];
    this.enemy.mood += delta;
    const hint = this.ctx.showHints ? `  (${TONE_LABEL[tone!]} ${delta >= 0 ? '+' : ''}${delta})` : '';
    const line = delta >= 1 ? this.pick(this.temper.like) : delta === 0 ? this.pick(this.temper.neutral) : this.pick(this.temper.dislike);
    this.queue.unshift({ kind: 'say', who: this.enemy.name, text: line + hint });
    if (this.enemy.mood <= -3) {
      this.queue = [{ kind: 'say', who: this.enemy.name, text: line }, { kind: 'say', who: this.enemy.name, text: this.temper.angry }];
      this.outcomeAfter = 'angry';
      this.enemy.mood = -1;
    } else if (this.questions.length > 1 && st.text === QUESTIONS[this.questions[0]].text) {
      this.queue.push(this.question(this.questions[1]));
    } else this.queueEnding();
    this.advance();
  }

  /** after the last question: maybe a demand, then the roll */
  private queueEnding(): void {
    if (this.rnd() < this.temper.demandRate) {
      const d = this.pick(DEMANDS);
      const can = d.kind === 'potion' ? this.ctx.potions() > 0 : this.talker.hp > Math.ceil(this.talker.hpMax * 0.15);
      const what = d.kind === 'potion' ? `회복약 1개 (보유 ${this.ctx.potions()})` : `${this.talker.name}의 HP ${Math.ceil(this.talker.hpMax * 0.15)}`;
      this.pendingDemand = d;
      this.queue.push({ kind: 'choose', who: this.enemy.name, text: `${d.text}\n요구: ${what}`, options: [can ? '건넨다' : '건넨다 (부족함)', '거절한다'], tones: [null, null] });
      this.demandOk = can;
      return;
    }
    this.queue.push(this.roll());
  }

  private demandOk = false;
  private outcomeAfter: TalkOutcome | null = null;

  private settleDemand(give: boolean): void {
    const d = this.pendingDemand!;
    this.pendingDemand = null;
    if (give && this.demandOk) {
      if (d.kind === 'potion') this.ctx.usePotion();
      else this.talker.hp -= Math.ceil(this.talker.hpMax * 0.15);
      this.enemy.mood += 2;
      this.queue.unshift({ kind: 'say', who: this.enemy.name, text: this.pick(this.temper.like) });
    } else {
      this.enemy.mood -= 1;
      this.queue.unshift({ kind: 'say', who: this.enemy.name, text: give ? '...없잖아.' : this.pick(this.temper.dislike) });
    }
    this.queue.push(this.roll());
    this.advance();
  }

  /** the chance and its parts, rolled now */
  private roll(): TalkStep {
    const e = this.enemy, t = this.temper;
    const parts: [string, number][] = [
      [`기본 (성격: ${t.name})`, t.base],
      [`분위기 ${e.mood >= 0 ? '+' : ''}${e.mood}`, e.mood * 0.07],
      [`패링 성공 ×${e.rapport}`, Math.min(0.36, e.rapport * 0.08)],
      ['적 HP 손실', (1 - e.hp / e.hpMax) * 0.25],
      ['브레이크 상태', e.broken ? 0.15 : 0],
      ['레벨 차이', Math.max(-0.12, Math.min(0.1, (this.talker.lv - e.lv) * 0.03))],
    ];
    let chance = parts.reduce((s, [, v]) => s + v, 0);
    if (e.sp!.personality === 'honorable' && e.rapport === 0) { parts.push(['실력 미증명 (패링 0회) ×0.5', -chance * 0.5]); chance *= 0.5; }
    chance = Math.max(0.05, Math.min(0.95, chance));
    return { kind: 'roll', parts, chance, success: this.rnd() < chance };
  }

  /** show the next step, or finish */
  private advance(): void {
    const st = this.step;
    if (st.kind === 'roll' && !this.rolled) {
      this.rolled = true;
      if (st.success) { this.queue = [{ kind: 'say', who: this.enemy.name, text: this.temper.join }]; this.outcomeAfter = 'joined'; }
      else {
        const left = this.enemy.sp!.personality === 'timid' && this.enemy.mood < 0 && this.rnd() < 0.4;
        this.queue = [{ kind: 'say', who: this.enemy.name, text: left ? '히익—! (도망쳤다)' : this.temper.refuse }];
        if (!left && this.enemy.sp!.personality === 'honorable' && this.enemy.rapport === 0) this.queue.push({ kind: 'say', who: this.enemy.name, text: '...발톱을 막아 보아라. 그 뒤에 다시 이야기하지.' });
        this.outcomeAfter = left ? 'left' : 'failed';
      }
    }
    const next = this.queue.shift();
    if (!next) { this.outcome = this.outcomeAfter ?? 'failed'; return; }
    this.step = next;
    this.sel = 0;
    this.rollT = 0;
  }
}
