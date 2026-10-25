import { GATE_SEGMENTS, INNER_WALL, OUTER_WALL, ROCKET_RADIUS, START_LANES } from './config.js';
import type { RocketPose } from './rules/physics.js';

export interface Vec { readonly x: number; readonly y: number }
export interface RoundRect { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; readonly radius: number }
export interface WallContact { readonly intoWall: Vec; readonly tangent: Vec }

export function signedDistance(r: RoundRect, p: Vec): number {
  const x = Math.abs(p.x - (r.minX + r.maxX) / 2) - (r.maxX - r.minX) / 2 + r.radius;
  const y = Math.abs(p.y - (r.minY + r.maxY) / 2) - (r.maxY - r.minY) / 2 + r.radius;
  return Math.hypot(Math.max(x, 0), Math.max(y, 0)) + Math.min(Math.max(x, y), 0) - r.radius;
}

export function gradient(r: RoundRect, p: Vec): Vec {
  const dx = p.x - (r.minX + r.maxX) / 2;
  const dy = p.y - (r.minY + r.maxY) / 2;
  const x = Math.abs(dx) - (r.maxX - r.minX) / 2 + r.radius;
  const y = Math.abs(dy) - (r.maxY - r.minY) / 2 + r.radius;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  if (x <= 0 || y <= 0) return x >= y ? { x: sx, y: 0 } : { x: 0, y: sy };
  const scale = Math.max(x, y);
  const length = Math.hypot(x / scale, y / scale);
  return { x: sx * (x / scale) / length, y: sy * (y / scale) / length };
}

// Tolerance only absorbs floating-point projection error, not gameplay space.
const EPSILON = 1e-8;
export function isDrivable(p: Vec): boolean {
  return signedDistance(OUTER_WALL, p) <= -ROCKET_RADIUS + EPSILON && signedDistance(INNER_WALL, p) >= ROCKET_RADIUS - EPSILON;
}

export function containPoint(p: Vec): { point: Vec; contact: WallContact | null } {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { point: START_LANES.comet, contact: null };
  const outer = signedDistance(OUTER_WALL, p) + ROCKET_RADIUS;
  if (outer > EPSILON) {
    const n = gradient(OUTER_WALL, p);
    // Construct from the rounded corner center to avoid cancellation at huge coordinates.
    const cx = Math.max(OUTER_WALL.minX + OUTER_WALL.radius, Math.min(OUTER_WALL.maxX - OUTER_WALL.radius, p.x));
    const cy = Math.max(OUTER_WALL.minY + OUTER_WALL.radius, Math.min(OUTER_WALL.maxY - OUTER_WALL.radius, p.y));
    const radius = OUTER_WALL.radius - ROCKET_RADIUS;
    return { point: { x: cx + radius * n.x, y: cy + radius * n.y }, contact: { intoWall: n, tangent: { x: -n.y, y: n.x } } };
  }
  const inner = ROCKET_RADIUS - signedDistance(INNER_WALL, p);
  if (inner > EPSILON) {
    const n = gradient(INNER_WALL, p);
    return { point: { x: p.x + inner * n.x, y: p.y + inner * n.y }, contact: { intoWall: { x: -n.x, y: -n.y }, tangent: { x: -n.y, y: n.x } } };
  }
  return { point: p, contact: null };
}

export function containPose(pose: RocketPose, fallback: RocketPose): { pose: RocketPose; contact: WallContact | null } {
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return { pose: fallback, contact: null };
  const { point, contact } = containPoint(pose);
  let heading = Number.isFinite(pose.heading) ? pose.heading : fallback.heading;
  if (contact && Math.cos(heading) * contact.intoWall.x + Math.sin(heading) * contact.intoWall.y > EPSILON) {
    heading = Math.atan2(contact.tangent.y, contact.tangent.x);
  }
  return { pose: { x: point.x, y: point.y, heading }, contact };
}

export const GATES = GATE_SEGMENTS;
export type Gate = (typeof GATES)[number];
export function crossesForward(gate: Gate, from: Vec, to: Vec): boolean {
  const side = (p: Vec) => (p.x - gate.a.x) * gate.forward.x + (p.y - gate.a.y) * gate.forward.y;
  const a = side(from), b = side(to);
  if (!(a <= 0 && b > 0)) return false;
  const t = -a / (b - a);
  const p = { x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) };
  return p.x >= Math.min(gate.a.x, gate.b.x) && p.x <= Math.max(gate.a.x, gate.b.x)
    && p.y >= Math.min(gate.a.y, gate.b.y) && p.y <= Math.max(gate.a.y, gate.b.y);
}
