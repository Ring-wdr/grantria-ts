// 개발자 모드 (not in the original): unlocked by changing 편의 설정 → 버프 표시 ten times in a row, then a settings
// row opens the panel (game/devPanel.ts). Kept in the platform store apart from the slots, option.dat and the
// records. Every multiplier is a whole number so the game never makes a value the original rules could not: exp ×N
// is granted as N kills (book, quests, achievements count each), drops ×N as N drop rolls.
import { loadJson, saveJson } from '../platform';

const KEY = 'grantria.dev';

export interface DevSettings {
  /** the 개발자 모드 settings row is shown */
  unlocked: boolean;
  /** kills counted per monster killed, 1..DEV_MAX */
  killMul: number;
  /** drop rolls per monster killed, 1..DEV_MAX */
  dropMul: number;
  /** 성능 기록 (web/perfLog.ts) runs from boot; display only, off by default */
  perfLog: boolean;
}

export const DEV_MAX = 10;
/** consecutive 버프 표시 changes that unlock the row */
export const DEV_TAPS = 10;

let cache: DevSettings | null = null;

const mul = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= DEV_MAX ? v : 1);

export function dev(): DevSettings {
  if (cache) return cache;
  const d = loadJson<Partial<DevSettings>>(KEY) ?? {};
  cache = { unlocked: d.unlocked === true, killMul: mul(d.killMul), dropMul: mul(d.dropMul), perfLog: d.perfLog === true };
  return cache;
}

export function saveDev(): void { if (cache) saveJson(KEY, cache); }

/** drop the cached copy (tests, a backup import) */
export function resetDevCache(): void { cache = null; }

/** multipliers in effect: 1 unless the mode is unlocked */
export function killMul(): number { const d = dev(); return d.unlocked ? d.killMul : 1; }
export function dropMul(): number { const d = dev(); return d.unlocked ? d.dropMul : 1; }

export function unlockDev(): void { dev().unlocked = true; saveDev(); }

/** hide the row again, put every multiplier back to the original 1 and switch 성능 기록 off */
export function lockDev(): void { cache = { unlocked: false, killMul: 1, dropMul: 1, perfLog: false }; saveDev(); }
