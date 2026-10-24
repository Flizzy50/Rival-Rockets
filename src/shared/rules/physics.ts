import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BASE_SPEED,
  BOOST_SPEED_MULTIPLIER,
  MAX_TURN_DEG_PER_SEC,
  ROCKET_RADIUS,
  START_LANES,
} from '../config.js';

// Server-authoritative rocket movement (PRD 4). Pure: no clock, random, or
// DOM access, so the server step and tests share one implementation.

export interface RocketPose {
  readonly x: number;
  readonly y: number;
  // Radians, 0 = +x. Because y points down, positive turns clockwise on screen.
  readonly heading: number;
}

const TWO_PI = 2 * Math.PI;
const MAX_TURN_RAD_PER_SEC = (MAX_TURN_DEG_PER_SEC * Math.PI) / 180;
const MS_PER_SEC = 1000;

// M2 boundary (design M2-4): the arena inset by the collision radius so the
// whole rocket stays visible. M3 replaces this with the course walls.
const MIN_X = ROCKET_RADIUS;
const MAX_X = ARENA_WIDTH - ROCKET_RADIUS;
const MIN_Y = ROCKET_RADIUS;
const MAX_Y = ARENA_HEIGHT - ROCKET_RADIUS;

export function createStartPose(): RocketPose {
  const lane = START_LANES.comet;
  return { x: lane.x, y: lane.y, heading: normalizeHeading(lane.heading) };
}

// Maps to (-PI, PI]. Non-finite input becomes 0 so a bad value can never
// poison later steps.
export function normalizeHeading(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  let r = rad % TWO_PI;
  if (r <= -Math.PI) r += TWO_PI;
  else if (r > Math.PI) r -= TWO_PI;
  return r;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function stepRocket(
  pose: RocketPose,
  steering: number,
  boosted: boolean,
  dtMs: number,
): RocketPose {
  const steer = Number.isFinite(steering) ? clamp(steering, -1, 1) : 0;
  const dtS = Number.isFinite(dtMs) && dtMs > 0 ? dtMs / MS_PER_SEC : 0;

  // Normalizing the turn first keeps precision and finiteness for huge steps.
  const turn = normalizeHeading(steer * MAX_TURN_RAD_PER_SEC * dtS);
  const heading = normalizeHeading(normalizeHeading(pose.heading) + turn);

  const speed = boosted ? BASE_SPEED * BOOST_SPEED_MULTIPLIER : BASE_SPEED;
  const distance = speed * dtS;

  // Per-axis clamp lets the rocket slide along an edge instead of sticking;
  // the pilot can always turn away.
  return {
    x: clamp(pose.x + Math.cos(heading) * distance, MIN_X, MAX_X),
    y: clamp(pose.y + Math.sin(heading) * distance, MIN_Y, MAX_Y),
    heading,
  };
}
