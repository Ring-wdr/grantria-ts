// A multi-step popup flow as one overlay: an XState machine declares which popup follows which answer, a step per
// state draws that popup and turns the tick's keys into the machine's events. The machine runs synchronously inside
// the tick (send -> next snapshot at once), so a flow behaves like any other overlay of an OverlayStack: it closes
// when the machine reaches a final state, with that state's output as the role.
import { createActor, type AnyStateMachine, type EventFromLogic, type InputFrom } from 'xstate';
import type { Overlay, Role } from './overlays';

/** the popup of one flow state: reads the keys, answers an event for the machine (or nothing yet) */
export interface Step<E> {
  handle(presses: number[]): E | null;
  draw(): void;
}

/** state name -> its step, made on entering the state (keep an instance in the closure to reuse it on re-entry);
 *  flows are flat machines, so the state value is the name */
export type Steps<M extends AnyStateMachine> = Record<string, () => Step<EventFromLogic<M>>>;

export function flowOverlay<M extends AnyStateMachine>(machine: M, input: InputFrom<M>, steps: Steps<M>): Overlay {
  const actor = createActor(machine, { input } as never).start();
  /** the parts of the machine snapshot read here (flat machines: value is the state name) */
  const snap = () => actor.getSnapshot() as unknown as { value: string; status: string; output?: unknown };
  let state = '', step: Step<EventFromLogic<M>> | null = null;
  const current = () => {
    const v = snap().value;
    if (v !== state) { state = v; step = steps[v]?.() ?? null; }
    return step;
  };
  return {
    handle(presses) {
      const e = current()?.handle(presses);
      if (e) actor.send(e);
      const s = snap();
      if (s.status !== 'done') return null;
      actor.stop();
      return (s.output as Role | undefined) ?? 'cancel';
    },
    draw() { current()?.draw(); },
  };
}
