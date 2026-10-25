import { STEP_MS } from '../config.js';
import type { RejectReason } from '../protocol.js';
import {
  activateSelected,
  applyCharge,
  clearExpiredEffect,
  createCrewAbilityState,
  getAbilityStatus,
  selectAbility,
  type Ability,
  type CrewAbilityState,
} from './abilities.js';
import { createStartPose, stepRocket, type RocketPose } from './physics.js';

// M2 control test (design M2-1, M2-5): one Comet rocket flown by one crew.
// One call is one fixed step. Pure: no clock, random source, or socket, so the
// server loop and the tests run the exact same rules (Requirement 16.4).

export interface ControlTestState {
  readonly matchId: number;
  readonly tick: number;
  // Always tick × STEP_MS, recomputed rather than summed so it never drifts.
  readonly sessionMs: number;
  readonly pose: RocketPose;
  readonly steering: number;
  // Deadlines are in session ms, so a frozen test also freezes them.
  readonly crew: CrewAbilityState;
}

export type QueuedInput =
  | { readonly kind: 'steer'; readonly seq: number; readonly steering: number }
  | { readonly kind: 'charge'; readonly seq: number }
  | { readonly kind: 'select'; readonly seq: number; readonly ability: Ability }
  | { readonly kind: 'activate'; readonly seq: number };

export type InputKind = QueuedInput['kind'];

export type InputResult =
  | { readonly seq: number; readonly kind: InputKind; readonly status: 'applied' }
  | { readonly seq: number; readonly kind: InputKind; readonly status: 'rejected'; readonly reason: RejectReason };

export function createControlTest(matchId: number): ControlTestState {
  return {
    matchId,
    tick: 0,
    sessionMs: 0,
    pose: createStartPose(),
    steering: 0,
    crew: createCrewAbilityState(),
  };
}

// Used when a crew phone drops: the rocket must never fly on a stale tilt
// (Requirement 11.4).
export function withNeutralSteering(state: ControlTestState): ControlTestState {
  return state.steering === 0 ? state : { ...state, steering: 0 };
}

function applied(input: QueuedInput): InputResult {
  return { seq: input.seq, kind: input.kind, status: 'applied' };
}

function rejected(input: QueuedInput, reason: RejectReason): InputResult {
  return { seq: input.seq, kind: input.kind, status: 'rejected', reason };
}

export function stepControlTest(
  state: ControlTestState,
  inputs: readonly QueuedInput[],
): { state: ControlTestState; results: InputResult[] } {
  const now = state.sessionMs;
  // PRD 8 order: expirations, then crew requests in arrival order, then movement.
  let crew = clearExpiredEffect(state.crew, now);
  let steering = state.steering;
  const results: InputResult[] = [];

  for (const input of inputs) {
    switch (input.kind) {
      case 'steer':
        // Last value in the step wins; earlier ones are still applied, because
        // each was the crew's steering at the moment it arrived.
        steering = input.steering;
        results.push(applied(input));
        break;
      case 'charge': {
        const out = applyCharge(crew, now);
        crew = out.state;
        results.push(out.result === 'accepted' ? applied(input) : rejected(input, out.result));
        break;
      }
      case 'select':
        crew = selectAbility(crew, input.ability);
        results.push(applied(input));
        break;
      case 'activate': {
        const out = activateSelected(crew, now);
        crew = out.state;
        results.push(out.result === 'activated' ? applied(input) : rejected(input, out.result));
        break;
      }
    }
  }

  // An ability activated in this step already boosts this step's movement.
  const boosted = getAbilityStatus(crew, now).activeAbility === 'boost';
  const tick = state.tick + 1;
  return {
    state: {
      matchId: state.matchId,
      tick,
      sessionMs: tick * STEP_MS,
      pose: stepRocket(state.pose, steering, boosted, STEP_MS),
      steering,
      crew,
    },
    results,
  };
}
