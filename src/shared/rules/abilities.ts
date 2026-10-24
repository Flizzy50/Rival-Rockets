import {
  ABILITY_COST,
  ABILITY_DURATION_MS,
  CHARGE_ENERGY,
  CHARGE_INTERVAL_MS,
  INITIAL_ENERGY,
  MAX_ENERGY,
  SHARED_COOLDOWN_MS,
} from '../config';

// Crew energy and ability rules (PRD 5). In M1 the engineer phone runs them
// locally for the sensor test. M2 moves authority to the server, which imports
// this same module, so local feedback and server decisions cannot diverge.
// Kept free of sockets, timers, and clocks: callers pass the time.

export type Ability = 'boost' | 'shield';

export interface CrewAbilityState {
  readonly energy: number;
  // Only accepted charges move this, so spamming shakes cannot push the
  // one-per-second limit forward and starve the crew.
  readonly lastChargeAtMs: number | null;
  readonly activeAbility: Ability | null;
  readonly effectEndsAtMs: number | null;
  readonly cooldownEndsAtMs: number | null;
}

export type ChargeResult = 'accepted' | 'rate-limited' | 'full';
export type ActivationResult = 'activated' | 'not-enough-energy' | 'cooldown';
export type AbilityPhase = 'active' | 'cooldown' | 'not-enough-energy' | 'ready';

export interface AbilityStatus {
  readonly phase: AbilityPhase;
  readonly activeAbility: Ability | null;
  readonly effectRemainingMs: number;
  readonly cooldownRemainingMs: number;
  // Elapsed fraction of the shared cooldown (1 when no cooldown is running),
  // so the Activate button sweep fills left to right.
  readonly cooldownProgress: number;
  readonly energyShortfall: number;
}

export function createCrewAbilityState(): CrewAbilityState {
  return {
    energy: INITIAL_ENERGY,
    lastChargeAtMs: null,
    activeAbility: null,
    effectEndsAtMs: null,
    cooldownEndsAtMs: null,
  };
}

function remainingMs(endsAtMs: number | null, nowMs: number): number {
  return endsAtMs === null ? 0 : Math.max(0, endsAtMs - nowMs);
}

export function applyCharge(
  state: CrewAbilityState,
  nowMs: number,
): { state: CrewAbilityState; result: ChargeResult } {
  if (state.lastChargeAtMs !== null && nowMs - state.lastChargeAtMs < CHARGE_INTERVAL_MS) {
    return { state, result: 'rate-limited' };
  }
  if (state.energy >= MAX_ENERGY) {
    return { state, result: 'full' };
  }
  return {
    state: {
      ...state,
      energy: Math.min(MAX_ENERGY, state.energy + CHARGE_ENERGY),
      lastChargeAtMs: nowMs,
    },
    result: 'accepted',
  };
}

export function requestActivation(
  state: CrewAbilityState,
  ability: Ability,
  nowMs: number,
): { state: CrewAbilityState; result: ActivationResult } {
  // Failures return the same state object: a failed tap must spend nothing.
  if (remainingMs(state.effectEndsAtMs, nowMs) > 0 || remainingMs(state.cooldownEndsAtMs, nowMs) > 0) {
    return { state, result: 'cooldown' };
  }
  if (state.energy < ABILITY_COST) {
    return { state, result: 'not-enough-energy' };
  }
  return {
    state: {
      ...state,
      energy: state.energy - ABILITY_COST,
      activeAbility: ability,
      effectEndsAtMs: nowMs + ABILITY_DURATION_MS,
      cooldownEndsAtMs: nowMs + SHARED_COOLDOWN_MS,
    },
    result: 'activated',
  };
}

export function getAbilityStatus(state: CrewAbilityState, nowMs: number): AbilityStatus {
  const effectRemainingMs = remainingMs(state.effectEndsAtMs, nowMs);
  const cooldownRemainingMs = remainingMs(state.cooldownEndsAtMs, nowMs);
  const energyShortfall = Math.max(0, ABILITY_COST - state.energy);
  const cooldownProgress = Math.min(1, Math.max(0, 1 - cooldownRemainingMs / SHARED_COOLDOWN_MS));

  let phase: AbilityPhase;
  if (effectRemainingMs > 0) phase = 'active';
  else if (cooldownRemainingMs > 0) phase = 'cooldown';
  else if (energyShortfall > 0) phase = 'not-enough-energy';
  else phase = 'ready';

  return {
    phase,
    activeAbility: phase === 'active' ? state.activeAbility : null,
    effectRemainingMs,
    cooldownRemainingMs,
    cooldownProgress,
    energyShortfall,
  };
}
