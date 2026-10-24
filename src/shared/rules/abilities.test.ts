import { describe, expect, it } from 'vitest';
import {
  ABILITY_COST,
  ABILITY_DURATION_MS,
  CHARGE_ENERGY,
  CHARGE_INTERVAL_MS,
  DEFAULT_ABILITY,
  INITIAL_ENERGY,
  MAX_ENERGY,
  SHARED_COOLDOWN_MS,
} from '../config.js';
import {
  activateSelected,
  applyCharge,
  clearExpiredEffect,
  createCrewAbilityState,
  getAbilityStatus,
  requestActivation,
  selectAbility,
  type CrewAbilityState,
} from './abilities.js';

function withEnergy(energy: number): CrewAbilityState {
  return { ...createCrewAbilityState(), energy };
}

describe('crew energy', () => {
  it('starts at 50 energy with nothing active', () => {
    const state = createCrewAbilityState();
    expect(state.energy).toBe(INITIAL_ENERGY);
    expect(state.energy).toBe(50);
    expect(getAbilityStatus(state, 0).phase).toBe('ready');
  });

  it('adds 25 per accepted charge', () => {
    const { state, result } = applyCharge(createCrewAbilityState(), 0);
    expect(result).toBe('accepted');
    expect(state.energy).toBe(INITIAL_ENERGY + CHARGE_ENERGY);
    expect(state.lastChargeAtMs).toBe(0);
  });

  it('never exceeds 100 and reports full with the identical state', () => {
    let state = createCrewAbilityState();
    for (let i = 0; i < 10; i += 1) {
      state = applyCharge(state, i * CHARGE_INTERVAL_MS).state;
      expect(state.energy).toBeLessThanOrEqual(MAX_ENERGY);
    }
    expect(state.energy).toBe(100);
    const full = applyCharge(state, 100 * CHARGE_INTERVAL_MS);
    expect(full.result).toBe('full');
    expect(full.state).toBe(state);
  });

  it('accepts at most one charge per 1000 ms', () => {
    const first = applyCharge(createCrewAbilityState(), 5000).state;
    const early = applyCharge(first, 5000 + CHARGE_INTERVAL_MS - 1);
    expect(early.result).toBe('rate-limited');
    expect(early.state).toBe(first);
    expect(early.state.lastChargeAtMs).toBe(5000);
    const onTime = applyCharge(first, 5000 + CHARGE_INTERVAL_MS);
    expect(onTime.result).toBe('accepted');
    expect(onTime.state.energy).toBe(100);
  });

  it('allows charging during the cooldown', () => {
    const activated = requestActivation(withEnergy(50), 'boost', 0).state;
    const charged = applyCharge(activated, 1500);
    expect(charged.result).toBe('accepted');
    expect(charged.state.energy).toBe(CHARGE_ENERGY);
    expect(getAbilityStatus(charged.state, 2500).phase).toBe('cooldown');
  });
});

describe('ability activation', () => {
  it('spends 50 energy, runs the effect 2000 ms, and starts a 3000 ms cooldown', () => {
    const { state, result } = requestActivation(withEnergy(75), 'shield', 1000);
    expect(result).toBe('activated');
    expect(state.energy).toBe(75 - ABILITY_COST);
    expect(state.activeAbility).toBe('shield');
    expect(state.effectEndsAtMs).toBe(1000 + ABILITY_DURATION_MS);
    expect(state.cooldownEndsAtMs).toBe(1000 + SHARED_COOLDOWN_MS);
  });

  it('fails without enough energy and spends nothing', () => {
    const start = withEnergy(25);
    const { state, result } = requestActivation(start, 'boost', 0);
    expect(result).toBe('not-enough-energy');
    expect(state).toBe(start);
    expect(getAbilityStatus(start, 0).energyShortfall).toBe(25);
  });

  it('fails during the effect and the cooldown and spends nothing', () => {
    const active = requestActivation(withEnergy(100), 'boost', 0).state;
    for (const t of [0, 1000, 1999, 2000, 2999]) {
      const attempt = requestActivation(active, 'shield', t);
      expect(attempt.result).toBe('cooldown');
      expect(attempt.state).toBe(active);
      expect(attempt.state.energy).toBe(50);
    }
  });

  it('is ready again at exactly 3000 ms', () => {
    const active = requestActivation(withEnergy(100), 'boost', 0).state;
    expect(getAbilityStatus(active, SHARED_COOLDOWN_MS).phase).toBe('ready');
    const again = requestActivation(active, 'shield', SHARED_COOLDOWN_MS);
    expect(again.result).toBe('activated');
    expect(again.state.energy).toBe(0);
  });
});

describe('ability status', () => {
  it('reports phases in priority order across the effect and cooldown', () => {
    const active = requestActivation(withEnergy(50), 'boost', 0).state;

    const at0 = getAbilityStatus(active, 0);
    expect(at0.phase).toBe('active');
    expect(at0.activeAbility).toBe('boost');
    expect(at0.effectRemainingMs).toBe(2000);
    expect(at0.cooldownRemainingMs).toBe(3000);
    expect(at0.cooldownProgress).toBe(0);

    const at1999 = getAbilityStatus(active, 1999);
    expect(at1999.phase).toBe('active');
    expect(at1999.effectRemainingMs).toBe(1);

    const at2000 = getAbilityStatus(active, 2000);
    expect(at2000.phase).toBe('cooldown');
    expect(at2000.activeAbility).toBeNull();
    expect(at2000.effectRemainingMs).toBe(0);
    expect(at2000.cooldownRemainingMs).toBe(1000);
    expect(at2000.cooldownProgress).toBeCloseTo(2 / 3);

    const at2999 = getAbilityStatus(active, 2999);
    expect(at2999.phase).toBe('cooldown');
    expect(at2999.cooldownRemainingMs).toBe(1);

    // Energy is 0 after the activation, so the next phase is not-enough-energy.
    const at3000 = getAbilityStatus(active, 3000);
    expect(at3000.phase).toBe('not-enough-energy');
    expect(at3000.cooldownRemainingMs).toBe(0);
    expect(at3000.cooldownProgress).toBe(1);
    expect(at3000.energyShortfall).toBe(50);
  });

  it('reports a 25 shortfall at 25 energy and none when ready', () => {
    expect(getAbilityStatus(withEnergy(25), 0)).toMatchObject({
      phase: 'not-enough-energy',
      energyShortfall: 25,
    });
    expect(getAbilityStatus(withEnergy(50), 0)).toMatchObject({ phase: 'ready', energyShortfall: 0 });
  });
});

describe('server-owned selection', () => {
  it('starts with Boost selected, no effect, and no cooldown', () => {
    const state = createCrewAbilityState();
    expect(state.selectedAbility).toBe(DEFAULT_ABILITY);
    expect(state.selectedAbility).toBe('boost');
    expect(state.activeAbility).toBeNull();
    expect(state.effectEndsAtMs).toBeNull();
    expect(state.cooldownEndsAtMs).toBeNull();
  });

  it('selects at no cost, even during the cooldown', () => {
    const start = withEnergy(25);
    const shield = selectAbility(start, 'shield');
    expect(shield).toEqual({ ...start, selectedAbility: 'shield' });

    const active = activateSelected(withEnergy(100), 0).state;
    const switched = selectAbility(active, 'shield');
    expect(switched.selectedAbility).toBe('shield');
    expect(switched.energy).toBe(active.energy);
    expect(switched.activeAbility).toBe('boost');
    expect(switched.cooldownEndsAtMs).toBe(active.cooldownEndsAtMs);
  });

  it('returns the same object when the ability is already selected', () => {
    const start = createCrewAbilityState();
    expect(selectAbility(start, 'boost')).toBe(start);
  });

  it('activates the server selection with the PRD cost, duration, and cooldown', () => {
    const selected = selectAbility(withEnergy(75), 'shield');
    const { state, result } = activateSelected(selected, 1000);
    expect(result).toBe('activated');
    expect(state.activeAbility).toBe('shield');
    expect(state.selectedAbility).toBe('shield');
    expect(state.energy).toBe(75 - ABILITY_COST);
    expect(state.effectEndsAtMs).toBe(1000 + ABILITY_DURATION_MS);
    expect(state.cooldownEndsAtMs).toBe(1000 + SHARED_COOLDOWN_MS);
  });

  it('returns the identical state for rejected activations', () => {
    const poor = withEnergy(25);
    const noEnergy = activateSelected(poor, 0);
    expect(noEnergy.result).toBe('not-enough-energy');
    expect(noEnergy.state).toBe(poor);

    const active = activateSelected(withEnergy(100), 0).state;
    const busy = activateSelected(active, SHARED_COOLDOWN_MS - 1);
    expect(busy.result).toBe('cooldown');
    expect(busy.state).toBe(active);
  });
});

describe('clearing expired effects', () => {
  it('keeps the effect until its end time, then clears it', () => {
    const active = activateSelected(withEnergy(100), 0).state;
    expect(clearExpiredEffect(active, ABILITY_DURATION_MS - 1)).toBe(active);

    const cleared = clearExpiredEffect(active, ABILITY_DURATION_MS);
    expect(cleared.activeAbility).toBeNull();
    expect(cleared.effectEndsAtMs).toBeNull();
    // The shared cooldown, energy, and selection outlive the effect.
    expect(cleared.cooldownEndsAtMs).toBe(SHARED_COOLDOWN_MS);
    expect(cleared.energy).toBe(active.energy);
    expect(cleared.selectedAbility).toBe(active.selectedAbility);
    expect(getAbilityStatus(cleared, ABILITY_DURATION_MS).phase).toBe('cooldown');
  });

  it('returns the same object when no effect is running', () => {
    const idle = createCrewAbilityState();
    expect(clearExpiredEffect(idle, 10_000)).toBe(idle);
    const cleared = clearExpiredEffect(activateSelected(withEnergy(100), 0).state, ABILITY_DURATION_MS);
    expect(clearExpiredEffect(cleared, ABILITY_DURATION_MS + 1)).toBe(cleared);
  });
});
