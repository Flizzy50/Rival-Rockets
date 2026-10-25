import { PREVIEW_ARENA_HEIGHT, PREVIEW_ARENA_WIDTH } from '../../shared/config';
import type { AppContext } from '../app';
import { stepPreviewRocket, type PreviewRocket } from '../preview/rocket-preview';
import { holdWakeLock } from '../wake-lock';
import { createArenaCanvas } from './arena-canvas';
import { createDebugPanel } from './debug-panel';
import { el } from './dom';
import { createPilotPanel } from './pilot-panel';
import { createTestTopBar } from './top-bar';

// Pilot sensor test (PRD 7.6): arena with a Comet rocket flying at the real
// speed and turn rate, plus the tilt gauge. Everything renders from the
// latest controller snapshot each frame, so tilt feedback is same-frame.

// Canvas heading 0 points along +x; start pointing up the screen.
const START_HEADING_RAD = -Math.PI / 2;

export function mountPilotScreen(root: HTMLElement, ctx: AppContext): () => void {
  const debug = createDebugPanel(ctx);
  const arena = el('div', { className: 'arena' });
  const panel = createPilotPanel();

  const screenEl = el(
    'main',
    { className: 'screen test-screen pilot-screen' },
    createTestTopBar(ctx, 'Pilot test', debug.toggle),
    el('div', { className: 'middle' }, arena, debug.panel),
    panel.element,
  );
  root.append(screenEl);

  const canvas = createArenaCanvas(arena);
  const releaseWakeLock = holdWakeLock();

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
    panel.update({ ...snap, deadZoneDeg: ctx.settings.deadZoneDeg, fullScaleDeg: ctx.settings.fullScaleDeg });
    debug.update(snap, nowMs);
  }
  rafId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafId);
    panel.destroy();
    canvas.destroy();
    debug.destroy();
    releaseWakeLock();
  };
}
