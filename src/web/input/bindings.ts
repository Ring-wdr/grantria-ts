// Key and pad bindings: which keyboard key / pad button sends each virtual key (AVK). Defaults below, player
// overrides in the platform store ('grantria.keys', global like the options, not per slot), edited in
// 환경설정 → 키 설정 (game/keyMap.ts). Touch has its own zones and is not remapped.
import { AVK, HUD } from '../../core/keys';
import { loadJson, saveJson } from '../../core/platform';
import type { PadButton } from './gamepad';

export interface Action {
  key: number;
  label: string;
  /** default keyboard codes (KeyboardEvent.code), the first one is shown */
  kb: string[];
  /** default pad buttons, the first one is shown */
  pad: PadButton[];
}

/** rebindable actions in the order of the key settings list */
export const ACTIONS: Action[] = [
  { key: AVK.UP, label: '위', kb: ['ArrowUp', 'KeyW'], pad: ['up'] },
  { key: AVK.DOWN, label: '아래', kb: ['ArrowDown', 'KeyS'], pad: ['down'] },
  { key: AVK.LEFT, label: '왼쪽', kb: ['ArrowLeft', 'KeyA'], pad: ['left'] },
  { key: AVK.RIGHT, label: '오른쪽', kb: ['ArrowRight', 'KeyD'], pad: ['right'] },
  { key: AVK.OK, label: '확인 / 공격', kb: ['KeyZ', 'Enter', 'Space'], pad: ['south'] },
  { key: AVK.CLR, label: '취소 / 메뉴', kb: ['Escape'], pad: ['east', 'start'] },
  { key: AVK.K1, label: '퀵슬롯 1', kb: ['Digit1'], pad: ['west'] },
  { key: AVK.K3, label: '퀵슬롯 2', kb: ['Digit2'], pad: ['north'] },
  { key: AVK.K7, label: '퀵슬롯 3', kb: ['Digit3'], pad: ['l1'] },
  { key: AVK.K9, label: '퀵슬롯 4', kb: ['Digit4'], pad: ['r1'] },
  { key: AVK.STAR, label: '퀵슬롯 5', kb: ['KeyC'], pad: ['l2'] },
  { key: AVK.POUND, label: '퀵슬롯 6', kb: ['KeyX'], pad: ['r2'] },
  { key: AVK.K0, label: '칭호 / 0', kb: ['Digit0'], pad: [] },
  { key: AVK.MAP, label: '지도', kb: ['KeyM'], pad: ['select', 'touchpad'] },
  { key: AVK.SAVE, label: '저장', kb: ['KeyP'], pad: ['r3'] },
  { key: HUD.QUEST, label: '퀘스트', kb: ['KeyJ'], pad: [] },
  { key: HUD.SHOP, label: '고급상점', kb: ['KeyB'], pad: [] },
  { key: HUD.COMMUNITY, label: '차원의 문', kb: ['KeyG'], pad: [] },
  { key: AVK.TAB_L, label: '이전 탭', kb: ['KeyQ'], pad: [] },
  { key: AVK.TAB_R, label: '다음 탭', kb: ['KeyE'], pad: [] },
];

/** pad buttons the player may assign (the d-pad stays directions / HUD keys, home is the system's) */
export const BINDABLE_PAD: PadButton[] = ['south', 'east', 'west', 'north', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3', 'touchpad'];
/** keys that cannot be taken: Escape always cancels (also cancels a capture) */
export const RESERVED_KB = new Set(['Escape']);

type Lists<T> = Record<number, T[]>;
interface Saved { kb?: Lists<string>; pad?: Lists<PadButton> }
const STORE = 'grantria.keys';

const defaults = <T>(f: (a: Action) => T[]): Lists<T> => Object.fromEntries(ACTIONS.map((a) => [a.key, [...f(a)]]));
let kb: Lists<string> = defaults((a) => a.kb);
let pad: Lists<PadButton> = defaults((a) => a.pad);

/** code -> AVK, rebuilt on every change */
export const KEYMAP: Record<string, number> = {};
/** pad button -> AVK (gamepad.ts reads it), rebuilt on every change */
export const PAD_BINDINGS: Partial<Record<PadButton, number>> = {};

function rebuild(): void {
  for (const k of Object.keys(KEYMAP)) delete KEYMAP[k];
  for (const k of Object.keys(PAD_BINDINGS)) delete PAD_BINDINGS[k as PadButton];
  for (const a of ACTIONS) {
    for (const c of kb[a.key] ?? []) KEYMAP[c] ??= a.key;
    for (const b of pad[a.key] ?? []) PAD_BINDINGS[b] ??= a.key;
  }
}

/** read the player's bindings (call once the platform is installed) */
export function loadBindings(): void {
  const s = loadJson<Saved>(STORE);
  kb = { ...defaults((a) => a.kb), ...(s?.kb ?? {}) };
  pad = { ...defaults((a) => a.pad), ...(s?.pad ?? {}) };
  rebuild();
}
function persist(): void { saveJson(STORE, { kb, pad } satisfies Saved); }

/** keyboard code / pad button shown for an action (its first binding), or null */
export function kbOf(key: number): string | null { return kb[key]?.[0] ?? null; }
export function padOf(key: number): PadButton | null { return pad[key]?.[0] ?? null; }

/** give `code` to `key` as its shown binding; the code leaves every other action */
export function bindKey(key: number, code: string): void {
  for (const a of ACTIONS) kb[a.key] = (kb[a.key] ?? []).filter((c) => c !== code);
  kb[key] = [code, ...(kb[key] ?? []).slice(1)];
  rebuild(); persist();
}
export function bindPad(key: number, b: PadButton): void {
  for (const a of ACTIONS) pad[a.key] = (pad[a.key] ?? []).filter((x) => x !== b);
  pad[key] = [b, ...(pad[key] ?? []).slice(1)];
  rebuild(); persist();
}
export function resetBindings(): void {
  kb = defaults((a) => a.kb);
  pad = defaults((a) => a.pad);
  rebuild(); persist();
}

/** display name of a keyboard code */
export function keyLabel(code: string): string {
  return ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: 'Enter', Space: 'Space',
    ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl', AltLeft: 'LAlt', AltRight: 'RAlt',
    Backspace: 'Back', Tab: 'Tab', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`' } as Record<string, string>)[code]
    ?? code.replace(/^(Key|Digit|Numpad)/, '');
}

rebuild();
