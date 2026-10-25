import {
  BASE_SPEED,
  BOOST_SPEED_MULTIPLIER,
  MAX_TURN_DEG_PER_SEC,
  WALL_SPEED_MULTIPLIER,
  WALL_SLOW_MS,
  START_LANES,
} from '../config.js';
import { containPose } from '../course.js';
import type { TeamId } from '../protocol.js';

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

export function createStartPose(team: TeamId = 'comet'): RocketPose {
  const lane = START_LANES[team];
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
  wallSlowed = false,
): RocketPose {
  const steer = Number.isFinite(steering) ? clamp(steering, -1, 1) : 0;
  const dtS = Number.isFinite(dtMs) && dtMs > 0 ? dtMs / MS_PER_SEC : 0;

  // Normalizing the turn first keeps precision and finiteness for huge steps.
  const turn = normalizeHeading(steer * MAX_TURN_RAD_PER_SEC * dtS);
  const heading = normalizeHeading(normalizeHeading(pose.heading) + turn);

  const speed = forwardSpeed(boosted, wallSlowed);
  const distance = speed * dtS;

  return {
    x: pose.x + Math.cos(heading) * distance,
    y: pose.y + Math.sin(heading) * distance,
    heading,
  };
}

export interface RocketState { readonly pose: RocketPose; readonly steering: number; readonly wallSlowUntilMs: number | null }
export function forwardSpeed(boosted: boolean, wallSlowed: boolean): number {
  return BASE_SPEED * (wallSlowed ? WALL_SPEED_MULTIPLIER : boosted ? BOOST_SPEED_MULTIPLIER : 1);
}
export function moveRocket(rocket: RocketState, boosted: boolean, nowMs: number, dtMs: number, fallback: RocketPose): RocketState {
  const moved = stepRocket(rocket.pose, rocket.steering, boosted, dtMs, rocket.wallSlowUntilMs !== null && nowMs < rocket.wallSlowUntilMs);
  const contained = containPose(moved, fallback);
  return { ...rocket, pose: contained.pose, wallSlowUntilMs: contained.contact ? nowMs + WALL_SLOW_MS : rocket.wallSlowUntilMs };
}
