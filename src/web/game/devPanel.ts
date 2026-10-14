// 환경설정 → 개발자 모드 (not in the original, core/rules/dev.ts): whole-number kill / drop multipliers and a row
// that hides the mode again. Same keys and look as 편의 설정 (convenience.ts): ↑↓ row, ←→ / 5 change, Esc closes.
import { AVK } from '../input/input';
import { DEV_MAX, dev, lockDev, saveDev, type DevSettings } from '../../core/rules/dev';
import { gt, h, type VNode } from '../render/view';
import '../styles/convenience.css';

interface Row {
  key: keyof DevSettings | 'lock';
  label: string;
  help: string;
}

const ROWS: Row[] = [
  { key: 'killMul', label: '사냥 경험치 배율', help: '한 마리를 이 수만큼 잡은 것으로 칩니다(경험치·도감·퀘스트·업적).' },
  { key: 'dropMul', label: '드랍 배율', help: '한 마리의 드랍을 이 횟수만큼 굴립니다(바닥은 25개까지).' },
  { key: 'lock', label: '개발자 모드 닫기', help: '배율을 모두 ×1로 되돌리고 이 메뉴를 숨깁니다.' },
];

export class DevPanel {
  private cur = 0;

  /** false once closed (CLR, or the mode hidden) */
  update(presses: number[]): boolean {
    for (const k of presses) {
      if (k === AVK.UP) this.cur = (this.cur + ROWS.length - 1) % ROWS.length;
      else if (k === AVK.DOWN) this.cur = (this.cur + 1) % ROWS.length;
      else if (k === AVK.LEFT || k === AVK.RIGHT || k === AVK.OK) {
        const r = ROWS[this.cur];
        if (r.key === 'lock') { if (k === AVK.OK) { lockDev(); return false; } continue; }
        const d = dev(), v = d[r.key] as number;
        d[r.key as 'killMul' | 'dropMul'] = Math.max(1, Math.min(DEV_MAX, v + (k === AVK.LEFT ? -1 : 1)));
        saveDev();
      }
      else if (k === AVK.CLR) return false;
    }
    return true;
  }

  view(): VNode {
    const d = dev();
    const rows = ROWS.map((r, i) => {
      const cur = i === this.cur, lock = r.key === 'lock';
      return h(`div.v-row.cv-row${cur ? '.cur' : ''}`, { on: () => { if (this.cur === i) return [lock ? AVK.OK : AVK.RIGHT]; this.cur = i; } },
        h('span.cv-label', null, r.label),
        h('span.v-opt-arrow', { on: () => { this.cur = i; if (!lock) return [AVK.LEFT]; } }, cur && !lock ? '◀' : ''),
        h('span.cv-value', null, lock ? '확인 ▶' : `×${d[r.key as 'killMul' | 'dropMul']}`),
        h('span.v-opt-arrow', { on: () => { this.cur = i; return [lock ? AVK.OK : AVK.RIGHT]; } }, cur && !lock ? '▶' : ''));
    });
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px' },
      h('div.v-box.v-heading', null, gt('개발자 모드')),
      h('div.v-box.v-grow.cv-list', { style: 'padding:4px 6px' }, h('div.v-col', null, rows)),
      h('div.v-box.km-foot.cv-foot', null, gt(ROWS[this.cur].help)));
  }
}
