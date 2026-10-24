import {
  PREVIEW_ARENA_HEIGHT,
  PREVIEW_ARENA_WIDTH,
  PREVIEW_MAX_STEP_MS,
  PREVIEW_MAX_TURN_DEG_PER_S,
  PREVIEW_SPEED_UNITS_PER_S,
} from '../../shared/config';

// Pilot sensor-test preview: a rocket flying at the PRD 4 speed and turn rate
// so tilt comfort is judged at the real feel. No walls or physics in M1.

export interface PreviewRocket {
  readonly x: number;
  readonly y: number;
  // Screen-space angle: 0 points along +x, and because y points down,
  // increasing heading turns clockwise (to the right) on screen.
  readonly headingRad: number;
}

export interface PreviewSettings {
  readonly arenaWidth: number;
  readonly arenaHeight: number;
  readonly speedUnitsPerS: number;
  readonly maxTurnDegPerS: number;
  readonly maxStepMs: number;
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  arenaWidth: PREVIEW_ARENA_WIDTH,
  arenaHeight: PREVIEW_ARENA_HEIGHT,
  speedUnitsPerS: PREVIEW_SPEED_UNITS_PER_S,
  maxTurnDegPerS: PREVIEW_MAX_TURN_DEG_PER_S,
  maxStepMs: PREVIEW_MAX_STEP_MS,
};

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

export function stepPreviewRocket(
  rocket: PreviewRocket,
  steering: number,
  dtMs: number,
  s: PreviewSettings = DEFAULT_PREVIEW_SETTINGS,
): PreviewRocket {
  const steer = Number.isFinite(steering) ? Math.min(1, Math.max(-1, steering)) : 0;
  // Capped so a stalled frame (tab switch, GC pause) never teleports the rocket.
  const dtS = Math.min(s.maxStepMs, Math.max(0, Number.isFinite(dtMs) ? dtMs : 0)) / 1000;
  const headingRad = rocket.headingRad + steer * ((s.maxTurnDegPerS * Math.PI) / 180) * dtS;
  const distance = s.speedUnitsPerS * dtS;
  return {
    x: wrap(rocket.x + Math.cos(headingRad) * distance, s.arenaWidth),
    y: wrap(rocket.y + Math.sin(headingRad) * distance, s.arenaHeight),
    headingRad,
  };
}
