import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ABILITY_COST,
  BASE_SPEED,
  BOOST_SPEED_MULTIPLIER,
  CHARGE_ENERGY,
  INITIAL_ENERGY,
  SHARED_COOLDOWN_MS,
  START_LANES,
  STEP_MS,
} from '../config.js';
import {
  createControlTest,
  stepControlTest,
  withNeutralSteering,
  type ControlTestState,
  type QueuedInput,
} from './control-test.js';

const MS_PER_S = 1000;

const inputArb: fc.Arbitrary<QueuedInput> = fc.oneof(
  fc.record({ kind: fc.constant('steer' as const), seq: fc.nat(), steering: fc.double({ min: -1, max: 1, noNaN: true }) }),
  fc.record({ kind: fc.constant('charge' as const), seq: fc.nat() }),
  fc.record({ kind: fc.constant('select' as const), seq: fc.nat(), ability: fc.constantFrom('boost' as const, 'shield' as const) }),
  fc.record({ kind: fc.constant('activate' as const), seq: fc.nat() }),
);

// Reachable states: a fresh test advanced by arbitrary batches.
const stateArb: fc.Arbitrary<ControlTestState> = fc
  .array(fc.array(inputArb, { maxLength: 4 }), { maxLength: 40 })
  .map((batches) => batches.reduce((s, batch) => stepControlTest(s, batch).state, createControlTest(1)));

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('control test', () => {
  it('starts at the Comet upper lane with a fresh crew (Requirements 14.1, 15.5)', () => {
    const s = createControlTest(7);
    expect(s).toMatchObject({ matchId: 7, tick: 0, sessionMs: 0, steering: 0 });
    expect(s.pose).toEqual({ x: START_LANES.comet.x, y: START_LANES.comet.y, heading: 0 });
    expect(s.crew).toMatchObject({ energy: INITIAL_ENERGY, selectedAbility: 'boost', activeAbility: null, cooldownEndsAtMs: null });
  });

  // Feature: m2-shared-control, Property 14: Each step advances one tick and answers every input
  it('advances one tick and answers every input in order, deterministically', () => {
    fc.assert(
      fc.property(stateArb, fc.array(inputArb, { maxLength: 8 }), (state, inputs) => {
        const out = stepControlTest(state, inputs);
        expect(out.state.tick).toBe(state.tick + 1);
        expect(out.state.sessionMs).toBe((state.tick + 1) * STEP_MS);
        expect(out.state.matchId).toBe(state.matchId);
        expect(out.results.map((r) => [r.seq, r.kind])).toEqual(inputs.map((i) => [i.seq, i.kind]));
        for (const r of out.results) {
          if (r.status === 'rejected') expect(typeof r.reason).toBe('string');
        }
        expect(stepControlTest(state, inputs)).toEqual(out);
      }),
      { numRuns: 200 },
    );
  });

  it('moves a boost activated this step at the boosted speed in the same step (Requirement 16.3)', () => {
    const s = createControlTest(1);
    const out = stepControlTest(s, [{ kind: 'activate', seq: 1 }]);
    expect(out.results[0]?.status).toBe('applied');
    expect(out.state.crew.activeAbility).toBe('boost');
    const expected = (BASE_SPEED * BOOST_SPEED_MULTIPLIER * STEP_MS) / MS_PER_S;
    expect(distance(out.state.pose, s.pose)).toBeCloseTo(expected, 9);
  });

  it('uses the new energy when a charge and an activation share a step (Requirement 16.3)', () => {
    let s = createControlTest(1);
    // Spend the starting 50, leaving 0.
    s = stepControlTest(s, [{ kind: 'activate', seq: 1 }]).state;
    while (s.sessionMs < SHARED_COOLDOWN_MS) s = stepControlTest(s, []).state;
    // 0 + 25 is still short; two charges a second apart reach 50.
    s = stepControlTest(s, [{ kind: 'charge', seq: 2 }]).state;
    const chargedAt = s.crew.lastChargeAtMs ?? 0;
    while (s.sessionMs < chargedAt + MS_PER_S) s = stepControlTest(s, []).state;
    const out = stepControlTest(s, [
      { kind: 'charge', seq: 3 },
      { kind: 'activate', seq: 4 },
    ]);
    expect(out.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(out.state.crew.energy).toBe(2 * CHARGE_ENERGY - ABILITY_COST);
  });

  it('accepts an activation exactly at the end of the shared cooldown', () => {
    let s = createControlTest(1);
    s = stepControlTest(s, [{ kind: 'activate', seq: 1 }]).state;
    const cooldownEnd = s.crew.cooldownEndsAtMs ?? 0;
    // Give the crew enough energy at a session time away from the boundary.
    s = { ...s, crew: { ...s.crew, energy: ABILITY_COST } };
    // Land a step exactly on the deadline.
    s = { ...s, tick: 0, sessionMs: cooldownEnd };
    const out = stepControlTest(s, [{ kind: 'activate', seq: 2 }]);
    expect(out.results[0]?.status).toBe('applied');
  });

  it('rejects a second activation during the cooldown and spends nothing', () => {
    let s = createControlTest(1);
    s = { ...s, crew: { ...s.crew, energy: 100 } };
    s = stepControlTest(s, [{ kind: 'activate', seq: 1 }]).state;
    const out = stepControlTest(s, [{ kind: 'activate', seq: 2 }]);
    expect(out.results[0]).toMatchObject({ status: 'rejected', reason: 'cooldown' });
    expect(out.state.crew.energy).toBe(s.crew.energy);
  });

  it('activates the server-selected ability and clears it once the effect ends', () => {
    let s = createControlTest(1);
    s = stepControlTest(s, [
      { kind: 'select', seq: 1, ability: 'shield' },
      { kind: 'activate', seq: 2 },
    ]).state;
    expect(s.crew.activeAbility).toBe('shield');
    while (s.crew.activeAbility !== null) s = stepControlTest(s, []).state;
    expect(s.crew.effectEndsAtMs).toBeNull();
  });

  it('keeps the last steering value of a step and neutralizes it on demand', () => {
    const s = stepControlTest(createControlTest(1), [
      { kind: 'steer', seq: 1, steering: 0.5 },
      { kind: 'steer', seq: 2, steering: -0.25 },
    ]).state;
    expect(s.steering).toBe(-0.25);
    expect(withNeutralSteering(s).steering).toBe(0);
  });
});
