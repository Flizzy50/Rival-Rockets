import { describe, expect, it } from 'vitest';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BASE_SPEED,
  BOOST_SPEED_MULTIPLIER,
  MAX_TURN_DEG_PER_SEC,
  ROCKET_RADIUS,
  START_LANES,
  OUTER_WALL,
} from '../config.js';
import { createStartPose, moveRocket, normalizeHeading, stepRocket, type RocketPose } from './physics.js';
import { isDrivable } from '../course.js';

const TURN_RAD_PER_SEC = (MAX_TURN_DEG_PER_SEC * Math.PI) / 180;
const CENTER: RocketPose = { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, heading: 0 };

function expectInArena(p: RocketPose): void {
  expect(Number.isFinite(p.x)).toBe(true);
  expect(Number.isFinite(p.y)).toBe(true);
  expect(Number.isFinite(p.heading)).toBe(true);
  expect(p.x).toBeGreaterThanOrEqual(ROCKET_RADIUS);
  expect(p.x).toBeLessThanOrEqual(ARENA_WIDTH - ROCKET_RADIUS);
  expect(p.y).toBeGreaterThanOrEqual(ROCKET_RADIUS);
  expect(p.y).toBeLessThanOrEqual(ARENA_HEIGHT - ROCKET_RADIUS);
}

describe('createStartPose', () => {
  it('places the rocket at the Comet upper lane heading right', () => {
    expect(createStartPose()).toEqual({ x: 240, y: 78, heading: 0 });
    expect(createStartPose()).toEqual(START_LANES.comet);
  });
});

describe('normalizeHeading', () => {
  it('maps angles into (-PI, PI]', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeHeading(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeHeading(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeHeading(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2);
    expect(normalizeHeading(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });

  it('turns non-finite angles into 0', () => {
    expect(normalizeHeading(Number.NaN)).toBe(0);
    expect(normalizeHeading(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeHeading(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('stepRocket movement', () => {
  it('flies straight at the base speed', () => {
    const next = stepRocket(CENTER, 0, false, 1000);
    expect(next.x).toBeCloseTo(CENTER.x + BASE_SPEED);
    expect(next.y).toBeCloseTo(CENTER.y);
    expect(next.heading).toBe(0);
  });

  it('moves along the heading', () => {
    const down: RocketPose = { ...CENTER, heading: Math.PI / 2 };
    const next = stepRocket(down, 0, false, 500);
    expect(next.x).toBeCloseTo(CENTER.x);
    expect(next.y).toBeCloseTo(CENTER.y + BASE_SPEED / 2);
  });

  it('applies the boost multiplier while boosted', () => {
    const next = stepRocket(CENTER, 0, true, 1000);
    expect(next.x).toBeCloseTo(CENTER.x + BASE_SPEED * BOOST_SPEED_MULTIPLIER);
  });
});

describe('stepRocket turning', () => {
  it('turns clockwise on screen for positive steering at the full rate', () => {
    const next = stepRocket(CENTER, 1, false, 250);
    expect(next.heading).toBeCloseTo(TURN_RAD_PER_SEC * 0.25);
    // Clockwise with y down means the nose swings toward +y.
    expect(next.y).toBeGreaterThan(CENTER.y);
  });

  it('turns counter-clockwise for negative steering, scaled by the value', () => {
    const next = stepRocket(CENTER, -0.5, false, 1000);
    expect(next.heading).toBeCloseTo(-TURN_RAD_PER_SEC * 0.5);
    expect(next.y).toBeLessThan(CENTER.y);
  });

  it('keeps the heading unchanged with zero steering', () => {
    const pose: RocketPose = { ...CENTER, heading: 1.234 };
    expect(stepRocket(pose, 0, false, 33).heading).toBe(1.234);
    expect(stepRocket(pose, 0, true, 5000).heading).toBe(1.234);
  });

  it('clamps steering to [-1, 1]', () => {
    expect(stepRocket(CENTER, 5, false, 100).heading).toBeCloseTo(
      stepRocket(CENTER, 1, false, 100).heading,
    );
    expect(stepRocket(CENTER, -5, false, 100).heading).toBeCloseTo(
      stepRocket(CENTER, -1, false, 100).heading,
    );
  });
});

function onCourse(pose: RocketPose, dtMs: number): RocketPose {
  return moveRocket({ pose, steering: 0, wallSlowUntilMs: null }, false, 0, dtMs, createStartPose()).pose;
}

describe('movement on the course', () => {
  const min = OUTER_WALL.minX + ROCKET_RADIUS;
  const maxX = OUTER_WALL.maxX - ROCKET_RADIUS;
  const maxY = OUTER_WALL.maxY - ROCKET_RADIUS;

  it('stops at the right edge and slides along it', () => {
    const diagonal: RocketPose = { x: maxX - 1, y: 400, heading: Math.PI / 4 };
    const next = onCourse(diagonal, 1000);
    expect(next.x).toBe(maxX);
    expect(next.y).toBeCloseTo(400 + BASE_SPEED * Math.SQRT1_2);
  });

  it('stops at the left edge', () => {
    const next = onCourse({ x: min + 1, y: 400, heading: Math.PI }, 1000);
    expect(next.x).toBe(min);
    expect(next.y).toBeCloseTo(400);
  });

  it('stops at the top edge and slides along it', () => {
    const next = onCourse({ x: 300, y: min + 1, heading: -Math.PI / 4 }, 1000);
    expect(next.y).toBe(min);
    expect(next.x).toBeCloseTo(300 + BASE_SPEED * Math.SQRT1_2);
  });

  it('stops at the bottom edge', () => {
    const next = onCourse({ x: 300, y: maxY - 1, heading: Math.PI / 2 }, 1000);
    expect(next.y).toBe(maxY);
    expect(next.x).toBeCloseTo(300);
  });

  it('pulls an out-of-bounds pose back inside', () => {
    expect(isDrivable(onCourse({ x: -500, y: 5000, heading: 0 }, 0))).toBe(true);
  });
});

describe('stepRocket input sanitizing', () => {
  it('treats non-finite steering as 0', () => {
    for (const s of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = stepRocket(CENTER, s, false, 100);
      expect(next.heading).toBe(0);
      expectInArena(next);
    }
  });

  it('treats non-finite or negative dt as 0', () => {
    for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -100]) {
      expect(stepRocket(CENTER, 1, true, dt)).toEqual(CENTER);
    }
  });

  it('stays finite and inside the arena for a huge step', () => {
    expect(isDrivable(onCourse(CENTER, Number.MAX_VALUE))).toBe(true);
  });

  it('does not mutate the input pose', () => {
    const pose: RocketPose = { ...CENTER };
    stepRocket(pose, 1, true, 100);
    expect(pose).toEqual(CENTER);
  });
});
