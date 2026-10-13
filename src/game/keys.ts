// The original virtual keys (AVK, analysis/features/game-flow-ui.md §2.1).
export const AVK = {
  UP: 0x32, DOWN: 0x38, LEFT: 0x34, RIGHT: 0x36, OK: 0x35,
  K1: 0x31, K3: 0x33, K7: 0x37, K9: 0x39, K0: 0x30, STAR: 0x2a, POUND: 0x23,
  CLR: -16, SAVE: -10, MAP: -6,
  /** not in the original: previous / next menu tab (pad L1 / R1, keyboard Q / E) */
  TAB_L: -101, TAB_R: -102,
} as const;

/** HUD touch keys (not original key codes): gate icon -> community, SHOP -> premium shop, coupon button,
 *  QUEST -> quest tab (10000 also lights the QUEST pill, FUN_0004b128 idx 12) */
export const HUD = { COMMUNITY: -30, SHOP: -7, COUPON: -31, QUEST: 10000 } as const;
