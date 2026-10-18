// The quantity flow statechart (FUN_0005f4f8, shop buy / sell) through flowOverlay: which popup follows which answer,
// and the commit action.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowOverlay, type Step } from '../src/core/ui/flow.ts';
import { quantityFlow, type QuantityEvent, type QuantityInput } from '../src/core/ui/flows/quantityFlow.ts';
import { OverlayStack } from '../src/core/ui/overlays.ts';

/** steps that answer from a script: each tick the current state's step sends the next scripted event */
function run(input: Partial<QuantityInput> & { held: number; stack: boolean }, script: QuantityEvent[]) {
  const visited: string[] = [], commits: number[] = [], roles: string[] = [];
  const machine = quantityFlow.provide({ actions: { commit: (_, p) => { commits.push(p.n); } } });
  const step = (name: string) => (): Step<QuantityEvent> => {
    visited.push(name);
    return { handle: () => script.shift() ?? null, model: name };
  };
  const s = new OverlayStack();
  s.open(flowOverlay(machine, { tooManyBack: true, ...input }, { qty: step('qty'), none: step('none'), tooMany: step('tooMany'), confirm: step('confirm') }),
    { on: { close: (r) => roles.push(r) } });
  for (let i = 0; i < 20 && s.size; i++) s.update([]);
  return { visited, commits, roles, open: s.size };
}

test('a single item goes straight to the confirm popup with n = 1; yes commits it', () => {
  assert.deepEqual(run({ held: 1, stack: false }, [{ type: 'yes' }]),
    { visited: ['confirm'], commits: [1], roles: ['yes'], open: 0 });
});

test('a stack: 0 and too many show their message and come back to the quantity (drop)', () => {
  const r = run({ held: 5, stack: true }, [{ type: 'qty', n: 0 }, { type: 'ok' }, { type: 'qty', n: 9 }, { type: 'ok' }, { type: 'qty', n: 3 }, { type: 'yes' }]);
  assert.deepEqual(r.visited, ['qty', 'none', 'qty', 'tooMany', 'qty', 'confirm']);
  assert.deepEqual(r.commits, [3]);
  assert.deepEqual(r.roles, ['yes']);
});

test('in a shop, too many ends the flow after its message', () => {
  const r = run({ held: 5, stack: true, tooManyBack: false }, [{ type: 'qty', n: 9 }, { type: 'ok' }]);
  assert.deepEqual([r.visited, r.commits, r.roles], [['qty', 'tooMany'], [], ['cancel']]);
});

test('buying has no upper bound', () => {
  assert.deepEqual(run({ held: Infinity, stack: true }, [{ type: 'qty', n: 9999 }, { type: 'yes' }]).commits, [9999]);
});

test('cancel on the quantity, or no on the confirm, commits nothing', () => {
  assert.deepEqual(run({ held: 5, stack: true }, [{ type: 'cancel' }]).commits, []);
  const r = run({ held: 5, stack: true }, [{ type: 'qty', n: 5 }, { type: 'no' }]);
  assert.deepEqual([r.commits, r.roles], [[], ['cancel']]);
});

test('a step with nothing to say keeps the flow open', () => {
  assert.equal(run({ held: 2, stack: true }, []).open, 1);
});
