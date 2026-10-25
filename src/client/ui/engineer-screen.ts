import { SELECTION_TILT_DEG } from '../../shared/config';
import type { AppContext } from '../app';
import type { ControllerEvent } from '../motion/controller';
import { holdWakeLock } from '../wake-lock';
import { createDebugPanel } from './debug-panel';
import { el, setVar } from './dom';
import { ABILITY_LABEL, createEngineerPanel, failureText } from './engineer-panel';
import { createTestTopBar } from './top-bar';

// Engineer sensor test (PRD 5, 7.6, 7.8; AC4): energy meter, tilt-and-hold
// ability selector with the shake lock, and the Activate button. The crew
// rules run locally here; the M2 control screen feeds the same panel from
// the server.

// The indicator spans twice the selection threshold so the marks sit halfway out.
const INDICATOR_RANGE_DEG = SELECTION_TILT_DEG * 2;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
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

  const panel = createEngineerPanel(
    () => {
      ctx.controller.activate(performance.now());
      // Same-frame feedback: handle the result now instead of on the next frame.
      render(performance.now());
    },
    (text) => ctx.announce('assertive', text),
  );

  root.append(
    el(
      'main',
      { className: 'screen test-screen engineer-screen' },
      createTestTopBar(ctx, 'Engineer test', debug.toggle),
      el('div', { className: 'middle' }, indicator, debug.panel),
      panel.element,
    ),
  );

  const releaseWakeLock = holdWakeLock();
  let lastRenderMs = 0;
  let rafId = 0;

  function handleEvent(event: ControllerEvent): void {
    switch (event.type) {
      case 'charge-accepted':
        panel.chargePop(event.energy);
        break;
      case 'selection-changed':
        panel.selectionBump(event.selected);
        break;
      case 'activation-failed':
        panel.showFailure(failureText(event.reason, event.cooldownRemainingMs));
        break;
      case 'activated':
        panel.pressed();
        break;
      default:
        // Ignored shakes get no pop; a full meter already glows with FULL.
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
    panel.update({ ...snap, ...snap.ability, shakeActive: snap.shakeActive });
    debug.update(snap, nowMs);
  }

  function frame(nowMs: number): void {
    rafId = requestAnimationFrame(frame);
    render(nowMs);
  }
  rafId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafId);
    panel.destroy();
    debug.destroy();
    releaseWakeLock();
  };
}
