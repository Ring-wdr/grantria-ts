// How many, then are you sure (FUN_0005f4f8 and the shop's buy / sell, FUN_0003f9ec): a stack asks the amount with
// the quantity popup 0x0C first (0 -> message 0x0D, back to the amount; more than held -> 0x58, back to the amount
// for a drop, out of the flow in a shop), then the confirm popup (0xB drop, 0x0E buy, 0x0F sell). A single item goes
// straight to the confirm with n = 1. The flow closes with role 'yes' after a confirmed yes, after running the
// 'commit' action (provided by the caller; it must not open overlays, use the 'yes' handler for follow-up popups).
import { assign, setup } from 'xstate';

export type QuantityEvent = { type: 'qty'; n: number } | { type: 'ok' } | { type: 'yes' } | { type: 'no' } | { type: 'cancel' };

export interface QuantityInput {
  /** most that may be taken (Infinity when buying) */
  held: number;
  /** ask the amount first */
  stack: boolean;
  /** after 0x58, back to the amount (drop) instead of leaving the flow (shop) */
  tooManyBack: boolean;
}

export const quantityFlow = setup({
  types: {
    input: {} as QuantityInput,
    context: {} as QuantityInput & { n: number; done: boolean },
    events: {} as QuantityEvent,
  },
  actions: {
    commit: (_, _params: { n: number }) => {},
  },
}).createMachine({
  id: 'quantity',
  context: ({ input }) => ({ ...input, n: input.stack ? 0 : 1, done: false }),
  /** the overlay role: 'yes' once committed */
  output: ({ context }) => (context.done ? 'yes' : 'cancel'),
  initial: 'start',
  states: {
    start: { always: [{ guard: ({ context }) => context.stack, target: 'qty' }, { target: 'confirm' }] },
    qty: {
      on: {
        qty: [
          { guard: ({ event }) => event.n === 0, target: 'none' },
          { guard: ({ context, event }) => event.n > context.held, target: 'tooMany' },
          { target: 'confirm', actions: assign({ n: ({ event }) => event.n }) },
        ],
        cancel: 'cancelled',
      },
    },
    /** popup 0x0D */
    none: { on: { ok: 'qty' } },
    /** popup 0x58 */
    tooMany: { on: { ok: [{ guard: ({ context }) => context.tooManyBack, target: 'qty' }, { target: 'cancelled' }] } },
    confirm: { on: { yes: 'committed', no: 'cancelled' } },
    committed: { type: 'final', entry: [{ type: 'commit', params: ({ context }) => ({ n: context.n }) }, assign({ done: true })] },
    cancelled: { type: 'final' },
  },
});
