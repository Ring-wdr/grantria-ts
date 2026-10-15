// The original virtual keys (AVK, analysis/features/game-flow-ui.md §2.1).
export const AVK = {
  UP: 0x32, DOWN: 0x38, LEFT: 0x34, RIGHT: 0x36, OK: 0x35,
  K1: 0x31, K3: 0x33, K7: 0x37, K9: 0x39, K0: 0x30, STAR: 0x2a, POUND: 0x23,
  CLR: -16, SAVE: -10, MAP: -6,
  /** not in the original: previous / next menu tab (pad L1 / R1, keyboard Q / E) */
  TAB_L: -101, TAB_R: -102,
  /** not in the original: dialogue log, dialogue auto advance on / off (game/backlog.ts) */
  LOG: -103, AUTO: -104,
  /** not in the original: held to fast-forward dialogue (편의 설정 빨리 넘기기) */
  FAST: -105,
  /** not in the original (2.5D): dash */
  DASH: -108,
} as const;

/** the six quick-slot keys in slot order (HUD slots 0..5) */
export const QUICK_KEYS: readonly number[] = [AVK.K1, AVK.K3, AVK.K7, AVK.K9, AVK.STAR, AVK.POUND];

/**
 * Key in a quick-slot picker (six slots drawn in a column): LEFT / UP previous, RIGHT / DOWN next,
 * a slot's own key picks that slot at once. Returns the new cursor and whether it was picked, or null.
 */
export function slotPickerKey(k: number, cur: number): { cur: number; pick: boolean } | null {
  if (k === AVK.LEFT || k === AVK.UP) return { cur: (cur + 5) % 6, pick: false };
  if (k === AVK.RIGHT || k === AVK.DOWN) return { cur: (cur + 1) % 6, pick: false };
  const i = QUICK_KEYS.indexOf(k);
  return i >= 0 ? { cur: i, pick: true } : null;
}

/** HUD touch keys (not original key codes): gate icon -> community, SHOP -> premium shop,
 *  QUEST -> quest tab (10000 also lights the QUEST pill, FUN_0004b128 idx 12).
 *  The original's coupon shop button is gone: the shop is in the community menu (gate icon). */
export const HUD = { COMMUNITY: -30, SHOP: -7, QUEST: 10000 } as const;
