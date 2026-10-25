import { ABILITY_COST, CHARGE_ENERGY, MAX_ENERGY } from '../../shared/config';
import type { Ability, AbilityPhase } from '../../shared/rules/abilities';
import { EFFECT_FLICKER_MS, FAIL_REASON_MS, HAPTIC_SHAKE_MS } from '../../shared/tokens';
import { pulse } from '../haptics';
import { el, replayClass, setText, setVar } from './dom';
import { boostIcon, lockIcon, progressRing, shieldIcon } from './icons';

// Engineer role panel (PRD 7.6, 7.8): energy meter, tilt-and-hold selector
// with the shake lock, and Activate. Shared by the M1 sensor test (local
// rules) and the M2 control screen (server state), which only differ in
// where the view numbers come from.

export const ABILITY_LABEL: Record<Ability, string> = { boost: 'BOOST', shield: 'SHIELD' };
const SEGMENT_COUNT = MAX_ENERGY / CHARGE_ENERGY;
const MS_PER_S = 1000;
const TENTHS_PER_S = 10;

// One decimal, rounded up so the label never reads 0.0s while time remains.
export function seconds(ms: number): string {
  return `${(Math.ceil((ms / MS_PER_S) * TENTHS_PER_S) / TENTHS_PER_S).toFixed(1)}s`;
}

// M1 failure copy (PRD 7.8), reused for server rejections (Requirement 19.6).
export function failureText(reason: 'cooldown' | 'not-enough-energy', cooldownRemainingMs: number): string {
  return reason === 'cooldown' ? `Cooldown ${seconds(cooldownRemainingMs)}` : 'Not enough energy';
}

export interface EngineerView {
  readonly energy: number;
  readonly selected: Ability;
  readonly pendingTarget: Ability | null;
  readonly pendingProgress: number;
  readonly shakeActive: boolean;
  readonly phase: AbilityPhase;
  readonly activeAbility: Ability | null;
  readonly effectRemainingMs: number;
  readonly cooldownRemainingMs: number;
  readonly cooldownProgress: number;
  readonly energyShortfall: number;
}

export interface EngineerPanel {
  readonly element: HTMLElement;
  update(view: EngineerView): void;
  // Same-frame feedback hooks.
  chargePop(energyAfter: number): void;
  selectionBump(ability: Ability): void;
  pressed(): void;
  showFailure(text: string): void;
  destroy(): void;
}

function tile(ability: Ability, icon: SVGSVGElement): { tile: HTMLElement; ring: SVGSVGElement } {
  const ring = progressRing('selection-ring');
  ring.classList.add('is-idle');
  const node = el(
    'div',
    { className: `ability-tile ability-${ability}` },
    icon,
    el('span', { className: 'ability-label', text: ABILITY_LABEL[ability] }),
    ring,
  );
  return { tile: node, ring };
}

export function createEngineerPanel(onActivate: () => void, announce: (text: string) => void): EngineerPanel {
  const segments = Array.from({ length: SEGMENT_COUNT }, () => el('span', { className: 'energy-segment' }));
  const energyValue = el('span', { className: 'energy-value tabular' });
  const fullTag = el('span', { className: 'energy-full', text: 'FULL' });
  const chargeFloat = el('span', { className: 'charge-float', text: `+${CHARGE_ENERGY}`, attrs: { 'aria-hidden': 'true' } });
  const meter = el('div', { className: 'energy-meter' }, ...segments);
  const energyRow = el(
    'div',
    { className: 'energy-row' },
    el('span', { className: 'energy-label', text: 'ENERGY' }),
    meter,
    energyValue,
    fullTag,
    chargeFloat,
  );

  const boost = tile('boost', boostIcon());
  const shield = tile('shield', shieldIcon());
  const lockRow = el('p', { className: 'selection-lock' }, lockIcon(), el('span', { text: 'Locked while charging' }));
  const selector = el(
    'div',
    { className: 'selector' },
    boost.tile,
    el('div', { className: 'selector-center' }, lockRow),
    shield.tile,
  );

  const failReason = el('p', { className: 'fail-reason' });
  const activateLabel = el('span', { className: 'btn-label tabular' });
  const activate = el('button', { className: 'activate', attrs: { type: 'button' } }, activateLabel);
  activate.addEventListener('click', onActivate);

  const element = el('section', { className: 'role-panel engineer-panel' }, energyRow, selector, failReason, activate);
  fullTag.hidden = true;
  lockRow.hidden = true;

  let failTimer: ReturnType<typeof setTimeout> | undefined;
  let previousPhase: AbilityPhase | null = null;

  return {
    element,
    update(view) {
      segments.forEach((segment, index) => {
        segment.classList.toggle('is-filled', view.energy >= (index + 1) * CHARGE_ENERGY);
      });
      setText(energyValue, String(view.energy));
      const full = view.energy >= MAX_ENERGY;
      meter.classList.toggle('is-full', full);
      fullTag.hidden = !full;

      for (const [ability, parts] of [
        ['boost', boost],
        ['shield', shield],
      ] as const) {
        parts.tile.classList.toggle('is-selected', view.selected === ability);
        const pending = view.pendingTarget === ability;
        parts.ring.classList.toggle('is-idle', !pending);
        setVar(parts.ring, '--progress', pending ? view.pendingProgress : 0);
      }
      lockRow.hidden = !view.shakeActive;

      switch (view.phase) {
        case 'ready':
          setText(activateLabel, `ACTIVATE ${ABILITY_LABEL[view.selected]} · ${ABILITY_COST}`);
          break;
        case 'not-enough-energy':
          setText(activateLabel, `Need ${view.energyShortfall} more`);
          break;
        case 'cooldown':
          setText(activateLabel, seconds(view.cooldownRemainingMs));
          break;
        case 'active':
          setText(activateLabel, `${ABILITY_LABEL[view.activeAbility ?? view.selected]} · ${seconds(view.effectRemainingMs)}`);
          break;
      }
      activate.dataset.state = view.phase;
      setVar(activate, '--sweep', view.phase === 'cooldown' ? view.cooldownProgress : 0);
      activate.classList.toggle('is-ending', view.phase === 'active' && view.effectRemainingMs <= EFFECT_FLICKER_MS);
      // A single pulse when the shared cooldown ends (PRD 7.8).
      if (previousPhase === 'cooldown' && view.phase !== 'cooldown') replayClass(activate, 'refill');
      previousPhase = view.phase;
    },
    chargePop(energyAfter) {
      const segment = segments[Math.round(energyAfter / CHARGE_ENERGY) - 1];
      if (segment) replayClass(segment, 'pop');
      replayClass(chargeFloat, 'float');
      pulse(HAPTIC_SHAKE_MS);
    },
    selectionBump(ability) {
      replayClass(ability === 'boost' ? boost.tile : shield.tile, 'bump');
    },
    pressed() {
      failReason.classList.remove('is-visible');
      replayClass(activate, 'flash');
    },
    showFailure(text) {
      failReason.textContent = text;
      failReason.classList.add('is-visible');
      replayClass(activate, 'nudge');
      announce(text);
      clearTimeout(failTimer);
      failTimer = setTimeout(() => {
        failReason.classList.remove('is-visible');
      }, FAIL_REASON_MS);
    },
    destroy() {
      clearTimeout(failTimer);
    },
  };
}
