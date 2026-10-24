import { DEFAULT_ABILITY, SELECTION_HOLD_MS, SELECTION_TILT_DEG } from '../../shared/config';
import type { Ability } from '../../shared/rules/abilities';

// Engineer ability selection by tilt-and-hold (PRD 5; AC4). Shaking tilts the
// phone too, so a shake (or the rotate overlay) locks selection and wipes any
// pending hold; after unlock a fresh stable hold is needed to switch.

export interface SelectionSettings {
  readonly tiltDeg: number;
  readonly holdMs: number;
}

export const DEFAULT_SELECTION_SETTINGS: SelectionSettings = {
  tiltDeg: SELECTION_TILT_DEG,
  holdMs: SELECTION_HOLD_MS,
};

export interface SelectionState {
  readonly selected: Ability;
  readonly pendingTarget: Ability | null;
  readonly pendingSinceMs: number | null;
}

export interface SelectionInput {
  readonly smoothedRelDeg: number;
  readonly shakeActive: boolean;
  readonly blocked: boolean;
  readonly nowMs: number;
}

export interface SelectionUpdate {
  readonly state: SelectionState;
  readonly changed: boolean;
  readonly pendingTarget: Ability | null;
  readonly progress: number;
  readonly locked: boolean;
}

export function createSelection(initial: Ability = DEFAULT_ABILITY): SelectionState {
  return { selected: initial, pendingTarget: null, pendingSinceMs: null };
}

function clearPending(state: SelectionState): SelectionState {
  return state.pendingTarget === null && state.pendingSinceMs === null
    ? state
    : { selected: state.selected, pendingTarget: null, pendingSinceMs: null };
}

function targetFor(relDeg: number, tiltDeg: number): Ability | null {
  if (!Number.isFinite(relDeg)) return null;
  if (relDeg <= -tiltDeg) return 'boost';
  if (relDeg >= tiltDeg) return 'shield';
  return null;
}

export function updateSelection(
  state: SelectionState,
  input: SelectionInput,
  s: SelectionSettings = DEFAULT_SELECTION_SETTINGS,
): SelectionUpdate {
  if (input.shakeActive || input.blocked) {
    return { state: clearPending(state), changed: false, pendingTarget: null, progress: 0, locked: true };
  }

  const target = targetFor(input.smoothedRelDeg, s.tiltDeg);
  // Neutral, or holding toward the current ability, keeps the selection and
  // shows no pending ring.
  if (target === null || target === state.selected) {
    return { state: clearPending(state), changed: false, pendingTarget: null, progress: 0, locked: false };
  }

  const sinceMs =
    state.pendingTarget === target && state.pendingSinceMs !== null ? state.pendingSinceMs : input.nowMs;
  const elapsedMs = input.nowMs - sinceMs;
  if (elapsedMs >= s.holdMs) {
    return {
      state: { selected: target, pendingTarget: null, pendingSinceMs: null },
      changed: true,
      pendingTarget: null,
      progress: 0,
      locked: false,
    };
  }
  const progress = s.holdMs > 0 ? Math.min(1, Math.max(0, elapsedMs / s.holdMs)) : 1;
  return {
    state: { selected: state.selected, pendingTarget: target, pendingSinceMs: sinceMs },
    changed: false,
    pendingTarget: target,
    progress,
    locked: false,
  };
}
