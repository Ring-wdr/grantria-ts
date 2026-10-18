// 환경설정 → 편의 설정 (not in the original): settings kept outside option.dat (core/save/options.ts EXTRA_COUNTS).
// ↑↓ pick a row, ←→ / 5 change it (applied at once), Esc closes and saves. Every default is the original behaviour.
// State and keys; the host draws it (web/game/convenience.ts).
import { AVK } from '../keys';
import { defaultOptions, saveOptions, type Options } from '../save/options';
import { DEV_TAPS, dev, unlockDev } from '../rules/dev';
import type { Host } from '../host';
import type { ScrollRef } from '../render';

interface Row {
  /** the option it changes, or an action row that opens a screen of the host (openAction) */
  key: keyof Options | 'touchLayout' | 'reset';
  label: string;
  /** value names; a volume row (bar) has none */
  values?: string[];
  count: number;
  help: string;
}

export const ROWS: Row[] = [
  { key: 'bgm', label: '배경음 볼륨', count: 11, help: '배경음 크기입니다. 소리 설정을 끄면 모두 꺼집니다.' },
  { key: 'sfx', label: '효과음 볼륨', count: 11, help: '효과음 크기입니다.' },
  { key: 'textSpeed', label: '텍스트 속도', values: ['원본', '빠르게', '매우 빠르게', '즉시'], count: 4, help: '대사 글자가 나오는 속도입니다. 원본은 한 틱에 한 글자입니다.' },
  { key: 'auto', label: '자동 진행', values: ['끔', '켬'], count: 2, help: '다 읽을 시간이 지나면 넘깁니다. 대사 중 AUTO·K·패드 △로도 바꿉니다.' },
  { key: 'autoSpeed', label: '자동 진행 속도', values: ['느리게', '보통', '빠르게'], count: 3, help: '자동 진행이 다음 대사로 넘어가기까지 기다리는 시간입니다.' },
  { key: 'skip', label: '빨리 넘기기', values: ['끔', '읽은 대사만', '모든 대사'], count: 3, help: '확인 키나 Ctrl을 누르고 있으면 대사를 빠르게 넘깁니다.' },
  { key: 'skipThrough', label: 'SKIP 이어 넘기기', values: ['끔', '켬'], count: 2, help: '이벤트 SKIP이 중간에 멈추지 않습니다. 퀘스트를 받거나 완료하면 창을 닫은 뒤 끝까지 넘깁니다.' },
  { key: 'shake', label: '화면 흔들림', values: ['원본', '약하게', '끄기'], count: 3, help: '타격·보스·이벤트의 화면 흔들림을 줄입니다.' },
  { key: 'flash', label: '화면 번쩍임', values: ['원본', '약하게', '끄기'], count: 3, help: '번개와 섬광처럼 화면이 하얗게 번쩍이는 효과를 줄입니다.' },
  { key: 'hudNumbers', label: 'HUD 수치', values: ['끔', '켬'], count: 2, help: '왼쪽 아래에 HP·MP 수치를, 경험치 막대 옆에 EXP %를 보여 줍니다.' },
  { key: 'hudBuffs', label: '버프 표시', values: ['끔', '켬'], count: 2, help: '걸려 있는 비약 버프의 아이콘과 남은 시간(초)을 화면 위쪽에 보여 줍니다.' },
  { key: 'hudBoss', label: '보스 HP 바', values: ['끔', '켬'], count: 2, help: '가까이 있는 보스의 이름과 HP를 화면 아래쪽에 크게 보여 줍니다.' },
  { key: 'hudQuests', label: '퀘스트 추적', values: ['끔', '켬'], count: 2, help: '진행 중인 퀘스트 3개와 처치·수집 진행도를 미니맵 아래에 보여 줍니다.' },
  { key: 'hudCooldown', label: '쿨다운 숫자', values: ['끔', '켬'], count: 2, help: '퀵슬롯의 재사용 대기 원 위에 남은 시간(초)을 씁니다.' },
  { key: 'minimapIcons', label: '미니맵 아이콘', values: ['끔', '켬'], count: 2, help: '미니맵에 퀘스트 NPC(받기 + / 보고 ■)와 공간이동석(◆)을 표시합니다.' },
  { key: 'mapQuests', label: '퀘스트 위치', values: ['끔', '켬'], count: 2, help: '지도에 진행 중인 모든 퀘스트의 목적지를 파란 표시로 더합니다(방문한 방만).' },
  { key: 'autosaveMap', label: '맵 이동 자동 저장', values: ['끔', '켬'], count: 2, help: '저장할 수 있는 맵에 들어갈 때마다 저장합니다(쓰러지면 그곳부터).' },
  { key: 'autoLoot', label: '오토루팅', values: ['끔', '켬'], count: 2, help: '오토루팅을 산 뒤 땅의 아이템을 저절로 주울지 고릅니다. 끄면 직접 줍습니다.' },
  { key: 'abyss', label: '심연 도전', values: ['끔', '켬'], count: 2, help: '차원의 문 보스를 잡으면 결과 대신 더 강한 심연으로 내려갈지 묻습니다.' },
  { key: 'touchLayout', label: '조작 배치', values: ['편집'], count: 1, help: '터치 버튼과 스틱의 위치·크기·투명도를 바꿉니다.' },
  { key: 'powerSave', label: '절전 모드', values: ['끔', '켬'], count: 2, help: '발열을 줄입니다(실험). 기기에 따라 덜 부드러울 수 있습니다.' },
  { key: 'reset', label: '기본값으로', values: ['되돌리기'], count: 1, help: '위의 편의 설정을 모두 처음 값으로 되돌립니다. 조작 배치는 그대로 둡니다.' },
];

const ROW_H = 20;

export class ConveniencePanelLogic {
  protected cur = 0;
  protected scroll: ScrollRef = { y: 0 };
  /** 버프 표시 changed this many times in a row (개발자 모드 opens at DEV_TAPS), and the note shown when it did */
  private taps = 0;
  protected note = '';

  constructor(protected readonly ctx: Host) {}

  /** false once closed (CLR) */
  update(presses: number[]): boolean {
    if (this.busy) return true;
    for (const k of presses) {
      if (!((k === AVK.LEFT || k === AVK.RIGHT || k === AVK.OK) && ROWS[this.cur].key === 'hudBuffs')) this.taps = 0;
      if (!((k === AVK.RIGHT || k === AVK.OK) && ROWS[this.cur].key === 'reset')) this.armed = false;
      if (k === AVK.UP) this.move((this.cur + ROWS.length - 1) % ROWS.length);
      else if (k === AVK.DOWN) this.move((this.cur + 1) % ROWS.length);
      else if (k === AVK.LEFT) this.change(-1);
      else if (k === AVK.RIGHT || k === AVK.OK) this.change(1);
      else if (k === AVK.CLR) { saveOptions(this.ctx.options); return false; }
    }
    return true;
  }

  protected move(i: number): void {
    this.cur = i;
    this.note = '';
    const top = i * ROW_H, view = 6 * ROW_H;
    if (top < this.scroll.y) this.scroll.y = top;
    else if (top + ROW_H > this.scroll.y + view) this.scroll.y = top + ROW_H - view;
  }

  /** an action row (조작 배치) was chosen; the host opens its screen and sets busy until it closes */
  protected openAction(_key: Row['key']): void { /* no such screen on this host */ }
  /** 기본값으로 was pressed once: the next press resets */
  private armed = false;
  /** a host screen opened from a row is up: keys are dropped */
  protected busy = false;

  private change(d: number): void {
    const r = ROWS[this.cur];
    if (r.key === 'touchLayout') { if (d > 0) this.openAction(r.key); return; }
    if (r.key === 'reset') { if (d > 0) this.reset(); return; }
    const o = this.ctx.options, v = o[r.key];
    // volumes stop at the ends; the other rows wrap like the original option rows
    o[r.key] = r.values ? (v + d + r.count) % r.count : Math.max(0, Math.min(r.count - 1, v + d));
    this.ctx.applyOptions();
    if (r.key === 'powerSave') this.note = '앱을 다시 시작하면 적용됩니다.';           // power.ts: fixed at launch
    if (r.key === 'hudBuffs' && ++this.taps >= DEV_TAPS && !dev().unlocked) {
      unlockDev();
      this.note = '개발자 모드가 열렸습니다. 환경설정 맨 아래에서 들어갈 수 있습니다.';
    }
  }

  /** 기본값으로: the first press asks, the second sets every row of this panel to defaultOptions() (the layout of
   *  조작 배치 and the settings outside the panel stay) */
  private reset(): void {
    if (!this.armed) { this.armed = true; this.note = '한 번 더 누르면 모두 처음 값으로 되돌립니다.'; return; }
    this.armed = false;
    const o = this.ctx.options, d = defaultOptions(), power = o.powerSave;
    for (const r of ROWS) if (r.key !== 'touchLayout' && r.key !== 'reset') o[r.key] = d[r.key];
    this.ctx.applyOptions();
    this.note = o.powerSave !== power ? '처음 값으로 되돌렸습니다. 절전 모드는 앱을 다시 시작하면 적용됩니다.' : '처음 값으로 되돌렸습니다.';
  }
}
