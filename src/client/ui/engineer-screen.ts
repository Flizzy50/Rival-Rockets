import { ABILITY_COST, CHARGE_ENERGY, MAX_ENERGY, SELECTION_TILT_DEG } from '../../shared/config';
import type { Ability, AbilityPhase } from '../../shared/rules/abilities';
import { EFFECT_FLICKER_MS, FAIL_REASON_MS, HAPTIC_SHAKE_MS } from '../../shared/tokens';
import type { AppContext } from '../app';
import { pulse } from '../haptics';
import type { ControllerEvent } from '../motion/controller';
import { holdWakeLock } from '../wake-lock';
import { createDebugPanel } from './debug-panel';
import { el, replayClass, setText, setVar } from './dom';
import { boostIcon, lockIcon, progressRing, shieldIcon } from './icons';
import { createTestTopBar } from './top-bar';

// Engineer sensor test (PRD 5, 7.6, 7.8; AC4): energy meter, tilt-and-hold
// ability selector with the shake lock, and the Activate button. The crew
// rules run locally in M1; M2 moves them to the server unchanged.

const ABILITY_LABEL: Record<Ability, string> = { boost: 'BOOST', shield: 'SHIELD' };
const SEGMENT_COUNT = MAX_ENERGY / CHARGE_ENERGY;
// The indicator spans twice the selection threshold so the marks sit halfway out.
const INDICATOR_RANGE_DEG = SELECTION_TILT_DEG * 2;
const MS_PER_S = 1000;
const TENTHS_PER_S = 10;

// One decimal, rounded up so the label never reads 0.0s while time remains.
function seconds(ms: number): string {
  return `${(Math.ceil((ms / MS_PER_S) * TENTHS_PER_S) / TENTHS_PER_S).toFixed(1)}s`;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
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

export function mountEngineerScreen(root: HTMLElement, ctx: AppContext): () => void {
  const debug = createDebugPanel(ctx);

  // Middle: smoothed tilt with the selection thresholds marked.
  const tiltDot = el('span', { className: 'tilt-dot' });
  const tiltTrack = el(
    'div',
    { className: 'tilt-track selection-track' },
    el('span', { className: 'selection-mark selection-mark-left' }),
    el('span', { className: 'selection-mark selection-mark-right' }),
    tiltDot,
  );
  setVar(tiltTrack, '--mark', SELECTION_TILT_DEG / INDICATOR_RANGE_DEG);
  const indicator = el(
    'div',
    { className: 'tilt-indicator', attrs: { 'aria-hidden': 'true' } },
    el('span', { className: 'gauge-side', text: ABILITY_LABEL.boost }),
    tiltTrack,
    el('span', { className: 'gauge-side', text: ABILITY_LABEL.shield }),
  );

  // Energy meter
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

  // Selector
  const boost = tile('boost', boostIcon());
  const shield = tile('shield', shieldIcon());
  const lockRow = el(
    'p',
    { className: 'selection-lock' },
    lockIcon(),
    el('span', { text: 'Locked while charging' }),
  );
  const selector = el('div', { className: 'selector' }, boost.tile, el('div', { className: 'selector-center' }, lockRow), shield.tile);

  // Activate
  const failReason = el('p', { className: 'fail-reason' });
  const activateLabel = el('span', { className: 'btn-label tabular' });
  const activate = el('button', { className: 'activate', attrs: { type: 'button' } }, activateLabel);
  activate.addEventListener('click', () => {
    ctx.controller.activate(performance.now());
    // Same-frame feedback: handle the result now instead of on the next frame.
    render(performance.now());
  });

  const panel = el('section', { className: 'role-panel engineer-panel' }, energyRow, selector, failReason, activate);

  root.append(
    el(
      'main',
      { className: 'screen test-screen engineer-screen' },
      createTestTopBar(ctx, 'Engineer test', debug.toggle),
      el('div', { className: 'middle' }, indicator, debug.panel),
      panel,
    ),
  );

  const releaseWakeLock = holdWakeLock();
  let failTimer: ReturnType<typeof setTimeout> | undefined;
  let previousPhase: AbilityPhase | null = null;
  let lastRenderMs = 0;
  let rafId = 0;

  function showFailure(text: string): void {
    failReason.textContent = text;
    failReason.hidden = false;
    replayClass(activate, 'nudge');
    ctx.announce('assertive', text);
    clearTimeout(failTimer);
    failTimer = setTimeout(() => {
      failReason.hidden = true;
    }, FAIL_REASON_MS);
  }

  function handleEvent(event: ControllerEvent): void {
    switch (event.type) {
      case 'charge-accepted': {
        const segment = segments[Math.round(event.energy / CHARGE_ENERGY) - 1];
        if (segment) replayClass(segment, 'pop');
        replayClass(chargeFloat, 'float');
        pulse(HAPTIC_SHAKE_MS);
        break;
      }
      case 'charge-ignored':
        // Ignored shakes get no pop; a full meter already glows with FULL.
        break;
      case 'selection-changed':
        replayClass(event.selected === 'boost' ? boost.tile : shield.tile, 'bump');
        break;
      case 'activation-failed':
        showFailure(
          event.reason === 'cooldown' ? `Cooldown ${seconds(event.cooldownRemainingMs)}` : 'Not enough energy',
        );
        break;
      case 'activated':
        failReason.hidden = true;
        replayClass(activate, 'flash');
        break;
    }
  }

  function render(timeMs: number): void {
    // Clicks render with performance.now() and frames with the rAF time;
    // keeping time monotonic stops a label from briefly stepping backwards.
    const nowMs = Math.max(timeMs, lastRenderMs);
    lastRenderMs = nowMs;
    for (const event of ctx.controller.drainEvents()) handleEvent(event);
    const snap = ctx.controller.snapshot(nowMs);

    setVar(tiltDot, '--tilt', snap.blocked ? 0 : clampUnit(snap.smoothedRelDeg / INDICATOR_RANGE_DEG));

    segments.forEach((segment, index) => {
      segment.classList.toggle('is-filled', snap.energy >= (index + 1) * CHARGE_ENERGY);
    });
    setText(energyValue, String(snap.energy));
    const full = snap.energy >= MAX_ENERGY;
    meter.classList.toggle('is-full', full);
    fullTag.hidden = !full;

    for (const [ability, parts] of [['boost', boost], ['shield', shield]] as const) {
      parts.tile.classList.toggle('is-selected', snap.selected === ability);
      const pending = snap.pendingTarget === ability;
      parts.ring.classList.toggle('is-idle', !pending);
      setVar(parts.ring, '--progress', pending ? snap.pendingProgress : 0);
    }
    lockRow.hidden = !snap.shakeActive;

    const status = snap.ability;
    switch (status.phase) {
      case 'ready':
        setText(activateLabel, `ACTIVATE ${ABILITY_LABEL[snap.selected]} · ${ABILITY_COST}`);
        break;
      case 'not-enough-energy':
        setText(activateLabel, `Need ${status.energyShortfall} more`);
        break;
      case 'cooldown':
        setText(activateLabel, seconds(status.cooldownRemainingMs));
        break;
      case 'active':
        setText(
          activateLabel,
          `${ABILITY_LABEL[status.activeAbility ?? snap.selected]} · ${seconds(status.effectRemainingMs)}`,
        );
        break;
    }
    activate.dataset.state = status.phase;
    setVar(activate, '--sweep', status.phase === 'cooldown' ? status.cooldownProgress : 0);
    activate.classList.toggle('is-ending', status.phase === 'active' && status.effectRemainingMs <= EFFECT_FLICKER_MS);
    // A single pulse when the shared cooldown ends (PRD 7.8).
    if (previousPhase === 'cooldown' && status.phase !== 'cooldown') replayClass(activate, 'refill');
    previousPhase = status.phase;

    debug.update(snap, nowMs);
  }

  failReason.hidden = true;
  fullTag.hidden = true;
  lockRow.hidden = true;

  function frame(nowMs: number): void {
    rafId = requestAnimationFrame(frame);
    render(nowMs);
  }
  rafId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafId);
    clearTimeout(failTimer);
    debug.destroy();
    releaseWakeLock();
  };
}
