import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PublicCrewState } from '../shared/protocol';
import { cooldownRemainingMs, createCrewView, effectRemainingMs, reduceCrewView, type CrewEvent } from './crew-view';

const abilityArb = fc.constantFrom('boost' as const, 'shield' as const);
const crewArb: fc.Arbitrary<PublicCrewState> = fc.record({
  energy: fc.integer({ min: 0, max: 100 }),
  selected: abilityArb,
  active: fc.option(abilityArb, { nil: null }),
  effectRemainingMs: fc.integer({ min: 0, max: 2000 }),
  cooldownRemainingMs: fc.integer({ min: 0, max: 3000 }),
});
const localArb: fc.Arbitrary<CrewEvent> = fc.oneof(
  fc.constant({ type: 'charge-predicted' as const }),
  abilityArb.map((ability) => ({ type: 'selection-local' as const, ability })),
  fc.constant({ type: 'activate-pressed' as const }),
);

describe('crew view', () => {
  // Feature: m2-shared-control, Property 24: Displayed crew state follows the server
  it('shows the authoritative state after any local predictions', () => {
    fc.assert(
      fc.property(fc.array(localArb, { maxLength: 10 }), crewArb, fc.integer({ min: 0, max: 1e6 }), fc.boolean(), (locals, crew, nowMs, viaAck) => {
        let view = locals.reduce(reduceCrewView, createCrewView());
        // Any pending select is answered first, as the server always replies.
        if (view.selectPending !== null) view = reduceCrewView(view, { type: 'ack', kind: 'select', crew: null, nowMs });
        view = viaAck
          ? reduceCrewView(view, { type: 'ack', kind: 'activate', crew, nowMs })
          : reduceCrewView(view, { type: 'snapshot', crew, nowMs });
        expect(view.energy).toBe(crew.energy);
        expect(view.selected).toBe(crew.selected);
        expect(view.active).toBe(crew.active);
        expect(effectRemainingMs(view, nowMs)).toBe(crew.active === null ? 0 : crew.effectRemainingMs);
        expect(cooldownRemainingMs(view, nowMs)).toBe(crew.cooldownRemainingMs);
      }),
      { numRuns: 200 },
    );
  });

  it('keeps a pending local selection on screen until its ack', () => {
    let view = reduceCrewView(createCrewView(), { type: 'selection-local', ability: 'shield' });
    view = reduceCrewView(view, {
      type: 'snapshot',
      nowMs: 0,
      crew: { energy: 50, selected: 'boost', active: null, effectRemainingMs: 0, cooldownRemainingMs: 0 },
    });
    expect(view.selected).toBe('shield');
    view = reduceCrewView(view, {
      type: 'ack',
      kind: 'select',
      nowMs: 1,
      crew: { energy: 50, selected: 'shield', active: null, effectRemainingMs: 0, cooldownRemainingMs: 0 },
    });
    expect(view).toMatchObject({ selected: 'shield', selectPending: null });
  });
});
