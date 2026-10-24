import { PREVIEW_ARENA_HEIGHT, PREVIEW_ARENA_WIDTH } from '../../shared/config';
import { HINT_DURATION_MS } from '../../shared/tokens';
import type { AppContext } from '../app';
import { stepPreviewRocket, type PreviewRocket } from '../preview/rocket-preview';
import { holdWakeLock } from '../wake-lock';
import { createArenaCanvas } from './arena-canvas';
import { createDebugPanel } from './debug-panel';
import { el, setVar } from './dom';
import { createTestTopBar } from './top-bar';

// Pilot sensor test (PRD 7.6): arena with a Comet rocket flying at the real
// speed and turn rate, plus the tilt gauge. Everything renders from the
// latest controller snapshot each frame, so tilt feedback is same-frame.

// Canvas heading 0 points along +x; start pointing up the screen.
const START_HEADING_RAD = -Math.PI / 2;

export function mountPilotScreen(root: HTMLElement, ctx: AppContext): () => void {
  const debug = createDebugPanel(ctx);
  const arena = el('div', { className: 'arena' });

  const deadZone = el('div', { className: 'gauge-dead-zone' });
  const needle = el('div', { className: 'gauge-needle' });
  const gauge = el(
    'div',
    { className: 'gauge', attrs: { 'aria-hidden': 'true' } },
    el('span', { className: 'gauge-side', text: 'L' }),
    el(
      'div',
      { className: 'gauge-track' },
      deadZone,
      el('div', { className: 'gauge-end gauge-end-left' }),
      el('div', { className: 'gauge-end gauge-end-right' }),
      needle,
    ),
    el('span', { className: 'gauge-side', text: 'R' }),
  );
  const hint = el('p', { className: 'panel-hint', text: 'Tilt to steer' });
  const panel = el('section', { className: 'role-panel pilot-panel' }, gauge, hint);

  const screenEl = el(
    'main',
    { className: 'screen test-screen pilot-screen' },
    createTestTopBar(ctx, 'Pilot test', debug.toggle),
    el('div', { className: 'middle' }, arena, debug.panel),
    panel,
  );
  root.append(screenEl);

  const canvas = createArenaCanvas(arena);
  const releaseWakeLock = holdWakeLock();
  const hintTimer = setTimeout(() => {
    hint.hidden = true;
  }, HINT_DURATION_MS);

  let rocket: PreviewRocket = { x: PREVIEW_ARENA_WIDTH / 2, y: PREVIEW_ARENA_HEIGHT / 2, headingRad: START_HEADING_RAD };
  let lastMs: number | null = null;
  let rafId = 0;

  function frame(nowMs: number): void {
    rafId = requestAnimationFrame(frame);
    ctx.controller.drainEvents();
    const snap = ctx.controller.snapshot(nowMs);
    rocket = stepPreviewRocket(rocket, snap.steering, lastMs === null ? 0 : nowMs - lastMs);
    lastMs = nowMs;
    canvas.draw(rocket);

    // The gauge axis is tilt over full scale, so the band is exactly the dead
    // zone and the ends are maximum turn. Outside the band the needle is
    // placed from steering; inside it shows the wobble that steering ignores.
    const { deadZoneDeg, fullScaleDeg } = ctx.settings;
    const band = fullScaleDeg > 0 ? Math.min(1, Math.max(0, deadZoneDeg / fullScaleDeg)) : 0;
    let position: number;
    if (snap.steering !== 0) {
      position = Math.sign(snap.steering) * (band + Math.abs(snap.steering) * (1 - band));
    } else if (snap.blocked || fullScaleDeg <= 0) {
      position = 0;
    } else {
      position = Math.min(band, Math.max(-band, snap.smoothedRelDeg / fullScaleDeg));
    }
    setVar(deadZone, '--band', band);
    setVar(needle, '--needle', position);
    debug.update(snap, nowMs);
  }
  rafId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafId);
    clearTimeout(hintTimer);
    canvas.destroy();
    debug.destroy();
    releaseWakeLock();
  };
}
