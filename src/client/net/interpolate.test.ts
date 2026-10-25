import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INTERPOLATION_DELAY_MS, SNAPSHOT_BUFFER_SIZE } from '../../shared/config';
import {
  createBuffer,
  estimateRenderTime,
  interpolatePose,
  newestSnapshot,
  pushSnapshot,
  sampleAt,
  type Snapshot,
  type SnapshotBuffer,
} from './interpolate';

const EPS = 1e-9;
const poseArb = fc.record({
  x: fc.double({ min: 0, max: 600, noNaN: true }),
  y: fc.double({ min: 0, max: 800, noNaN: true }),
  heading: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
});

function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return d;
}

function snap(sessionMs: number, x: number, receivedAtMs = sessionMs, matchId = 1): Snapshot {
  return { matchId, sessionMs, receivedAtMs, pose: { x, y: 0, heading: 0 } };
}

describe('interpolation', () => {
  // Feature: m2-shared-control, Property 22: Interpolation stays between snapshots
  it('stays on the segment and the shorter arc', () => {
    fc.assert(
      fc.property(poseArb, poseArb, fc.double({ min: 0, max: 1, noNaN: true }), (a, b, t) => {
        const p = interpolatePose(a, b, t);
        expect(p.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x) - EPS);
        expect(p.x).toBeLessThanOrEqual(Math.max(a.x, b.x) + EPS);
        expect(p.y).toBeGreaterThanOrEqual(Math.min(a.y, b.y) - EPS);
        expect(p.y).toBeLessThanOrEqual(Math.max(a.y, b.y) + EPS);
        // On the shorter arc: distance to each end adds up to the arc length.
        const arc = angleDiff(a.heading, b.heading);
        expect(angleDiff(p.heading, a.heading) + angleDiff(p.heading, b.heading)).toBeCloseTo(arc, 6);
        if (t === 0) expect(p).toEqual(a);
        if (t === 1) expect(p).toEqual(b);
      }),
      { numRuns: 300 },
    );
  });

  it('turns through the short way across ±π', () => {
    const p = interpolatePose({ x: 0, y: 0, heading: Math.PI - 0.1 }, { x: 0, y: 0, heading: -Math.PI + 0.1 }, 0.5);
    expect(Math.abs(Math.abs(p.heading) - Math.PI)).toBeLessThan(1e-9);
  });

  it('holds the newest pose past the end and the first before the start', () => {
    let buf: SnapshotBuffer = createBuffer();
    buf = pushSnapshot(buf, snap(0, 0));
    buf = pushSnapshot(buf, snap(100, 10));
    expect(sampleAt(buf, 50)?.x).toBeCloseTo(5);
    expect(sampleAt(buf, 500)?.x).toBe(10);
    expect(sampleAt(buf, -5)?.x).toBe(0);
    expect(sampleAt(createBuffer(), 0)).toBeNull();
  });

  it('drops an older match, ignores out-of-order data, and caps its size', () => {
    let buf = pushSnapshot(createBuffer(), snap(100, 1, 100, 1));
    buf = pushSnapshot(buf, snap(50, 2, 120, 1));
    expect(buf.snapshots).toHaveLength(1);
    buf = pushSnapshot(buf, snap(0, 3, 130, 2));
    expect(buf.snapshots.map((s) => s.matchId)).toEqual([2]);
    for (let i = 1; i <= SNAPSHOT_BUFFER_SIZE + 5; i += 1) buf = pushSnapshot(buf, snap(i * 10, i, 130 + i * 10, 2));
    expect(buf.snapshots).toHaveLength(SNAPSHOT_BUFFER_SIZE);
    expect(newestSnapshot(buf)?.pose.x).toBe(SNAPSHOT_BUFFER_SIZE + 5);
  });

  // Feature: m2-shared-control, Property 23: Render time never runs ahead of received data
  // Receipt = session + clock offset + a nonnegative network delay. Whatever
  // the offset and delays, the render time stays at or behind the server's
  // true session time minus the interpolation delay.
  it('never renders ahead of the server clock minus the delay', () => {
    const arrivals = fc.array(fc.record({ gap: fc.integer({ min: 1, max: 120 }), delay: fc.integer({ min: 0, max: 300 }) }), {
      minLength: 1,
      maxLength: 40,
    });
    fc.assert(
      fc.property(arrivals, fc.integer({ min: -1e6, max: 1e6 }), fc.integer({ min: 0, max: 1000 }), (list, offset, wait) => {
        let buf = createBuffer();
        let session = 0;
        for (const { gap, delay } of list) {
          session += gap;
          buf = pushSnapshot(buf, snap(session, 0, session + offset + delay));
        }
        const newest = newestSnapshot(buf);
        if (!newest) return;
        const now = newest.receivedAtMs + wait;
        const trueSessionNow = now - offset;
        expect(estimateRenderTime(buf, now)).toBeLessThanOrEqual(trueSessionNow - INTERPOLATION_DELAY_MS + EPS);
      }),
      { numRuns: 200 },
    );
  });
});
