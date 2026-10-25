import { ABILITY_COST } from '../../shared/config';
import { cooldownRemainingMs, effectRemainingMs, type CrewView } from '../crew-view';
import { el, setText } from './dom';
import { ABILITY_LABEL, seconds } from './engineer-panel';

// Pilot's read-only crew status row (PRD 7.6, Requirement 19.8): the
// server's selected ability, energy, cooldown, and active effect, so the
// pilot can call the play without looking at the engineer's phone.

export interface CrewStatus {
  readonly element: HTMLElement;
  update(view: CrewView, nowMs: number): void;
}

export function crewStatusText(view: CrewView, nowMs: number): { ability: string; state: string } {
  const effect = effectRemainingMs(view, nowMs);
  const cooldown = cooldownRemainingMs(view, nowMs);
  let state: string;
  if (effect > 0 && view.active !== null) state = `${ABILITY_LABEL[view.active]} · ${seconds(effect)}`;
  else if (cooldown > 0) state = `Cooldown ${seconds(cooldown)}`;
  else if (view.energy < ABILITY_COST) state = `Need ${ABILITY_COST - view.energy} more`;
  else state = `${ABILITY_LABEL[view.selected]} READY`;
  return { ability: ABILITY_LABEL[view.selected], state };
}

export function createCrewStatus(): CrewStatus {
  const ability = el('span', { className: 'crew-ability' });
  const state = el('span', { className: 'crew-state tabular' });
  const energy = el('span', { className: 'crew-energy tabular' });
  const element = el(
    'div',
    { className: 'crew-status', attrs: { 'aria-label': 'Crew status' } },
    ability,
    state,
    el('span', { className: 'crew-energy-label', text: 'ENERGY' }),
    energy,
  );
  return {
    element,
    update(view, nowMs) {
      const text = crewStatusText(view, nowMs);
      setText(ability, text.ability);
      setText(state, text.state);
      setText(energy, view.synced ? String(view.energy) : '–');
    },
  };
}
