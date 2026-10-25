import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containPoint, containPose, GATES, crossesForward, isDrivable } from './course.js';
import { BASE_SPEED, WALL_SLOW_MS, WALL_SPEED_MULTIPLIER } from './config.js';
import { createStartPose, moveRocket } from './rules/physics.js';
import { advanceCrossings, breakdown, matchResult } from './rules/scoring.js';

describe('course and gate rules', () => {
  it('projects arbitrary positions onto the ring and is idempotent', () => {
    fc.assert(fc.property(fc.record({ x: fc.double({ min: -10000, max: 10000, noNaN: true }), y: fc.double({ min: -10000, max: 10000, noNaN: true }) }), (p) => {
      const projected = containPoint(p).point;
      expect(isDrivable(projected)).toBe(true);
      expect(containPoint(projected)).toEqual({ point: projected, contact: null });
    }), { numRuns: 500 });
    for (const x of [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE]) {
      expect(isDrivable(containPoint({ x, y: x }).point)).toBe(true);
      expect(containPose({ x, y: NaN, heading: NaN }, createStartPose('nova')).pose).toEqual(createStartPose('nova'));
    }
  });
  it('redirects into-wall headings clockwise on both walls and retains headings away', () => {
    const outer = containPose({ x: 300, y: 20, heading: -Math.PI / 2 }, createStartPose());
    const inner = containPose({ x: 300, y: 180, heading: Math.PI / 2 }, createStartPose());
    expect(outer.pose.heading).toBe(0);
    expect(inner.pose.heading).toBe(0);
    expect(containPose({ x: 300, y: 20, heading: Math.PI / 2 }, createStartPose()).pose.heading).toBe(Math.PI / 2);
  });
  it('wall slowing overrides Boost until the exact expiry', () => {
    const base = { pose: createStartPose(), steering: 0, wallSlowUntilMs: WALL_SLOW_MS };
    const slow = moveRocket(base, true, WALL_SLOW_MS - 1, 10, base.pose);
    const fast = moveRocket(base, true, WALL_SLOW_MS, 10, base.pose);
    expect(slow.pose.x - base.pose.x).toBeCloseTo(BASE_SPEED * WALL_SPEED_MULTIPLIER / 100);
    expect(fast.pose.x - base.pose.x).toBeCloseTo(1.8);
  });
  it('scores only ordered forward crossings, wraps laps, and counts a departure from the line', () => {
    let crossings = 0;
    for (let lap = 0; lap < 2; lap += 1) for (const g of GATES) {
      const center = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
      const from = { x: center.x - g.forward.x, y: center.y - g.forward.y };
      const to = { x: center.x + g.forward.x, y: center.y + g.forward.y };
      expect(crossesForward(g, from, center)).toBe(false);
      expect(crossesForward(g, center, to)).toBe(true);
      expect(advanceCrossings(crossings, to, from)).toBe(crossings);
      crossings = advanceCrossings(crossings, from, to);
      expect(advanceCrossings(crossings, from, to)).toBe(crossings);
    }
    expect(crossings).toBe(8);
    expect(advanceCrossings(0, { x: 498, y: 399 }, { x: 498, y: 401 })).toBe(0);
    expect(advanceCrossings(0, { x: 299, y: 400 }, { x: 301, y: 400 })).toBe(0);
    expect(breakdown(crossings, 3)).toEqual({ crossings: 8, checkpointPoints: 200, carried: 3, corePoints: 30, total: 230 });
    expect(matchResult({ comet: { crossings: 2, carried: 0 }, nova: { crossings: 0, carried: 5 } }).outcome).toBe('draw');
  });
});
