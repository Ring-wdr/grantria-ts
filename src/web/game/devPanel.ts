// 환경설정 → 개발자 모드 (not in the original, core/rules/dev.ts): whole-number kill / drop / 영웅·전설 multipliers, the
// 성능 기록 switch and its JSON export (web/perfLog.ts), and a row that hides the mode again. Same keys and look as
// 편의 설정 (convenience.ts): ↑↓ row, ←→ / 5 change, Esc closes.
import { AVK } from '../input/input';
import { DEV_MAX, dev, lockDev, saveDev } from '../../core/rules/dev';
import { gt, h, type VNode } from '../render/view';
import { exportPerf, perf, perfRecordCount, startPerf, stopPerf } from '../perfLog';
import '../styles/convenience.css';

interface Row {
  key: 'killMul' | 'dropMul' | 'rareMul' | 'perfLog' | 'perfExport' | 'lock';
  label: string;
  help: string;
}

const ROWS: Row[] = [
  { key: 'killMul', label: '사냥 경험치 배율', help: '한 마리를 이 수만큼 잡은 것으로 칩니다(경험치·도감·퀘스트·업적).' },
  { key: 'dropMul', label: '드랍 배율', help: '한 마리의 드랍을 이 횟수만큼 굴립니다(바닥은 25개까지).' },
  { key: 'rareMul', label: '영웅·전설 확률', help: '장비·보석·조합서가 영웅·전설 등급으로 나올 확률을 이 배만큼 높입니다.' },
  { key: 'perfLog', label: '성능 기록', help: '1분마다 프레임 시간·롱태스크·메모리를 기록합니다(켜면 새로 시작, 앱을 다시 켜도 유지).' },
  { key: 'perfExport', label: '성능 기록 내보내기', help: '지금까지의 기록을 JSON 파일로 저장합니다(최근 4시간).' },
  { key: 'lock', label: '개발자 모드 닫기', help: '배율을 모두 ×1로 되돌리고 이 메뉴를 숨깁니다.' },
];

export class DevPanel {
  private cur = 0;
  /** last export's result, shown in place of the help line */
  private note = '';

  /** false once closed (CLR, or the mode hidden) */
  update(presses: number[]): boolean {
    for (const k of presses) {
      if (k === AVK.UP) this.cur = (this.cur + ROWS.length - 1) % ROWS.length;
      else if (k === AVK.DOWN) this.cur = (this.cur + 1) % ROWS.length;
      else if (k === AVK.LEFT || k === AVK.RIGHT || k === AVK.OK) {
        const r = ROWS[this.cur];
        if (r.key === 'lock') { if (k === AVK.OK) { stopPerf(); lockDev(); return false; } continue; }
        if (r.key === 'perfExport') { if (k === AVK.OK) this.export(); continue; }
        if (r.key === 'perfLog') {
          const d = dev();
          d.perfLog = !d.perfLog;
          if (d.perfLog) startPerf(); else stopPerf();
          saveDev();
          continue;
        }
        const d = dev(), v = d[r.key];
        d[r.key] = Math.max(1, Math.min(DEV_MAX, v + (k === AVK.LEFT ? -1 : 1)));
        saveDev();
      }
      else if (k === AVK.CLR) return false;
    }
    return true;
  }

  private export(): void {
    if (!perfRecordCount() && !perf) { this.note = '기록이 없습니다. 성능 기록을 먼저 켜 주세요.'; return; }
    this.note = '저장하는 중…';
    exportPerf().then((name) => { this.note = name ? `저장함: ${name}` : '기록이 없습니다.'; },
      (e: unknown) => { this.note = `저장 실패: ${String(e)}`; });
  }

  private value(r: Row): string {
    const d = dev();
    if (r.key === 'lock') return '확인 ▶';
    if (r.key === 'perfExport') return `${perfRecordCount()}분 ▶`;
    if (r.key === 'perfLog') return d.perfLog ? '켜짐' : '꺼짐';
    return `×${d[r.key]}`;
  }

  view(): VNode {
    const rows = ROWS.map((r, i) => {
      const cur = i === this.cur, lock = r.key === 'lock' || r.key === 'perfExport';
      return h(`div.v-row.cv-row${cur ? '.cur' : ''}`, { on: () => { if (this.cur === i) return [lock ? AVK.OK : AVK.RIGHT]; this.cur = i; } },
        h('span.cv-label', null, r.label),
        h('span.v-opt-arrow', { on: () => { this.cur = i; if (!lock) return [AVK.LEFT]; } }, cur && !lock ? '◀' : ''),
        h('span.cv-value', null, this.value(r)),
        h('span.v-opt-arrow', { on: () => { this.cur = i; return [lock ? AVK.OK : AVK.RIGHT]; } }, cur && !lock ? '▶' : ''));
    });
    return h('div.v-col.v-fill.v-tab', { style: 'gap:3px' },
      h('div.v-box.v-heading', null, gt('개발자 모드')),
      h('div.v-box.v-grow.cv-list', { style: 'padding:4px 6px' }, h('div.v-col', null, rows)),
      h('div.v-box.km-foot.cv-foot', null, gt(ROWS[this.cur].key === 'perfExport' && this.note ? this.note : ROWS[this.cur].help)));
  }
}
