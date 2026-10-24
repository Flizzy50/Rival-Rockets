import { describe, expect, it } from 'vitest';
import {
  PREVIEW_ARENA_HEIGHT,
  PREVIEW_ARENA_WIDTH,
  PREVIEW_MAX_STEP_MS,
  PREVIEW_MAX_TURN_DEG_PER_S,
  PREVIEW_SPEED_UNITS_PER_S,
} from '../../shared/config';
import { stepPreviewRocket, type PreviewRocket } from './rocket-preview';

function fly(start: PreviewRocket, steering: number, totalMs: number, stepMs = 10): PreviewRocket {
  let rocket = start;
  for (let t = 0; t < totalMs; t += stepMs) rocket = stepPreviewRocket(rocket, steering, stepMs);
  return rocket;
}

const DEG = Math.PI / 180;

describe('stepPreviewRocket', () => {
  it('flies straight at 0 steering', () => {
    const out = fly({ x: 100, y: 400, headingRad: 0 }, 0, 1000);
    expect(out.headingRad).toBe(0);
    expect(out.x).toBeCloseTo(100 + PREVIEW_SPEED_UNITS_PER_S);
    expect(out.y).toBeCloseTo(400);
  });

  it('turns +120 degrees (clockwise on screen) in 1 s at full right steering', () => {
    const out = fly({ x: 300, y: 400, headingRad: 0 }, 1, 1000);
    expect(out.headingRad).toBeCloseTo(PREVIEW_MAX_TURN_DEG_PER_S * DEG);
    // Heading 0 is +x and y points down, so a right turn first moves the
    // rocket toward larger y.
    const early = stepPreviewRocket({ x: 300, y: 400, headingRad: 0 }, 1, 50);
    expect(early.y).toBeGreaterThan(400);
  });

  it('treats steering 3 as 1 and -3 as -1', () => {
    const start: PreviewRocket = { x: 300, y: 400, headingRad: 0 };
    expect(stepPreviewRocket(start, 3, 50)).toEqual(stepPreviewRocket(start, 1, 50));
    expect(stepPreviewRocket(start, -3, 50)).toEqual(stepPreviewRocket(start, -1, 50));
  });

  it('caps one step at the maximum step length', () => {
    const start: PreviewRocket = { x: 300, y: 400, headingRad: 0 };
    expect(stepPreviewRocket(start, 1, 5000)).toEqual(stepPreviewRocket(start, 1, PREVIEW_MAX_STEP_MS));
  });

  it('wraps at each arena edge', () => {
    const dt = 50;
    const move = (PREVIEW_SPEED_UNITS_PER_S * dt) / 1000;
    const right = stepPreviewRocket({ x: PREVIEW_ARENA_WIDTH - 1, y: 400, headingRad: 0 }, 0, dt);
    expect(right.x).toBeCloseTo(move - 1);
    const left = stepPreviewRocket({ x: 1, y: 400, headingRad: Math.PI }, 0, dt);
    expect(left.x).toBeCloseTo(PREVIEW_ARENA_WIDTH + 1 - move);
    const bottom = stepPreviewRocket({ x: 300, y: PREVIEW_ARENA_HEIGHT - 1, headingRad: Math.PI / 2 }, 0, dt);
    expect(bottom.y).toBeCloseTo(move - 1);
    const top = stepPreviewRocket({ x: 300, y: 1, headingRad: -Math.PI / 2 }, 0, dt);
    expect(top.y).toBeCloseTo(PREVIEW_ARENA_HEIGHT + 1 - move);
  });
});
