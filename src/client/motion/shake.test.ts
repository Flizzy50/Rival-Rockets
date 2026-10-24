import { describe, expect, it } from 'vitest';
import { SENSOR_GAP_RESET_MS, SHAKE_QUIET_MS } from '../../shared/config';
import {
  createShakeDetector,
  hasUsableAcceleration,
  updateShake,
  type ShakeSample,
  type ShakeState,
  type ShakeUpdate,
  type Vec3,
} from './shake';

const STEP_MS = 10;
const GRAVITY: Vec3 = { x: 0, y: 0, z: 9.81 };
// Gravity-filtered runs start with quiet samples so the low-pass estimate is
// seeded with gravity rather than with the first jolt.
const GRAVITY_SETTLE_START_MS = -500;

type MagnitudeAt = (t: number) => number;

function linearSample(t: number, magnitude: number, sign = 1): ShakeSample {
  return {
    timeMs: t,
    acceleration: { x: sign * magnitude, y: 0, z: 0 },
    accelerationIncludingGravity: { x: sign * magnitude, y: 0, z: sign * 9.81 },
  };
}

function gravitySample(t: number, magnitude: number, sign = 1): ShakeSample {
  return {
    timeMs: t,
    acceleration: null,
    accelerationIncludingGravity: { x: sign * magnitude, y: 0, z: sign * 9.81 },
  };
}

// Square pulses of `widthMs` starting at each peak time.
function burst(peaks: readonly number[], magnitude = 20, widthMs = 30): MagnitudeAt {
  return (t) => (peaks.some((p) => t >= p && t < p + widthMs) ? magnitude : 0);
}

interface Run {
  state: ShakeState;
  gestures: number[];
  updates: Array<ShakeUpdate & { t: number }>;
}

function run(
  magnitudeAt: MagnitudeAt,
  endMs: number,
  make: (t: number, magnitude: number) => ShakeSample = linearSample,
  startMs = 0,
): Run {
  let state = createShakeDetector();
  const gestures: number[] = [];
  const updates: Run['updates'] = [];
  for (let t = startMs; t <= endMs; t += STEP_MS) {
    const out = updateShake(state, make(t, magnitudeAt(t)));
    state = out.state;
    updates.push({ ...out, t });
    if (out.gesture) gestures.push(t);
  }
  return { state, gestures, updates };
}

describe('shake gestures', () => {
  it('detects exactly one gesture for one two-peak burst', () => {
    expect(run(burst([0, 150]), 1000).gestures).toEqual([150]);
  });

  it('ignores a single peak', () => {
    expect(run(burst([0]), 1000).gestures).toEqual([]);
  });

  it('ignores peaks too close (50 ms) or too far apart (600 ms)', () => {
    expect(run(burst([0, 50]), 1000).gestures).toEqual([]);
    expect(run(burst([0, 600]), 1500).gestures).toEqual([]);
  });

  it('ignores 2 s of sustained above-threshold motion', () => {
    expect(run((t) => (t < 2000 ? 20 : 0), 3000).gestures).toEqual([]);
  });

  it('counts 5 s of continuous oscillation as exactly one gesture', () => {
    const oscillate: MagnitudeAt = (t) => (t < 5000 && t % 200 < 100 ? 20 : 0);
    expect(run(oscillate, 6000).gestures).toHaveLength(1);
  });

  it('allows a new gesture after 300 ms of quiet and 1 s spacing', () => {
    expect(run(burst([0, 150, 1200, 1350]), 2000).gestures).toEqual([150, 1350]);
  });

  it('suppresses gestures less than 1000 ms apart', () => {
    // Quiet re-arms the detector by about 480 ms, but the next burst lands
    // only 600 ms after the first gesture.
    expect(run(burst([0, 150, 600, 750]), 1500).gestures).toEqual([150]);
  });

  it('gives a 40 m/s2 burst the same single gesture as a 13 m/s2 burst', () => {
    const strong = run(burst([0, 150], 40), 1000).gestures;
    const weak = run(burst([0, 150], 13), 1000).gestures;
    expect(strong).toEqual([150]);
    expect(weak).toEqual(strong);
  });

  it('produces identical results for sign-flipped input', () => {
    const shape = burst([0, 150, 1200, 1350]);
    const positive = run(shape, 2000, (t, m) => linearSample(t, m, 1));
    const negative = run(shape, 2000, (t, m) => linearSample(t, m, -1));
    expect(negative.gestures).toEqual(positive.gestures);
    expect(negative.updates.map((u) => u.magnitude)).toEqual(positive.updates.map((u) => u.magnitude));

    const gPositive = run(shape, 2000, (t, m) => gravitySample(t, m, 1), GRAVITY_SETTLE_START_MS);
    const gNegative = run(shape, 2000, (t, m) => gravitySample(t, m, -1), GRAVITY_SETTLE_START_MS);
    expect(gPositive.gestures).toEqual([150, 1350]);
    expect(gNegative.gestures).toEqual(gPositive.gestures);
    gNegative.updates.forEach((u, i) => {
      expect(u.magnitude).toBeCloseTo(gPositive.updates[i]?.magnitude ?? Number.NaN, 10);
    });
  });
});

describe('acceleration sources', () => {
  it('never detects a gesture from a constant gravity vector', () => {
    let state = createShakeDetector();
    for (let t = 0; t <= 2000; t += STEP_MS) {
      const out = updateShake(state, { timeMs: t, acceleration: null, accelerationIncludingGravity: GRAVITY });
      state = out.state;
      expect(out.source).toBe('gravity-filtered');
      expect(out.magnitude).toBeCloseTo(0, 10);
      expect(out.gesture).toBe(false);
      expect(out.shakeActive).toBe(false);
    }
  });

  it('detects a burst through the gravity-filtered fallback', () => {
    expect(run(burst([0, 150]), 1000, gravitySample, GRAVITY_SETTLE_START_MS).gestures).toEqual([150]);
  });

  it('prefers linear acceleration when all three axes are finite', () => {
    const out = updateShake(createShakeDetector(), {
      timeMs: 0,
      acceleration: { x: 1, y: 2, z: 2 },
      accelerationIncludingGravity: GRAVITY,
    });
    expect(out.source).toBe('linear');
    expect(out.magnitude).toBeCloseTo(3);
  });

  it('falls back to gravity filtering when a linear axis is null or NaN', () => {
    for (const acceleration of [
      { x: 1, y: null, z: 2 },
      { x: 1, y: 2, z: Number.NaN },
    ]) {
      const sample: ShakeSample = { timeMs: 0, acceleration, accelerationIncludingGravity: GRAVITY };
      expect(updateShake(createShakeDetector(), sample).source).toBe('gravity-filtered');
      expect(hasUsableAcceleration(sample)).toBe(true);
    }
  });

  it('reports no magnitude when neither source is usable', () => {
    const sample: ShakeSample = {
      timeMs: 0,
      acceleration: null,
      accelerationIncludingGravity: { x: null, y: null, z: null },
    };
    const out = updateShake(createShakeDetector(), sample);
    expect(out.magnitude).toBeNull();
    expect(out.source).toBeNull();
    expect(out.gesture).toBe(false);
    expect(hasUsableAcceleration(sample)).toBe(false);
    expect(hasUsableAcceleration({ timeMs: 0, acceleration: null, accelerationIncludingGravity: null })).toBe(false);
  });
});

describe('shakeActive', () => {
  it('is true from the first above-threshold sample until 300 ms of quiet', () => {
    const { updates } = run(burst([0]), 1000, linearSample, -100);
    const at = (t: number): boolean => updates.find((u) => u.t === t)?.shakeActive ?? false;
    expect(at(-10)).toBe(false);
    expect(at(0)).toBe(true);
    // The last above-threshold sample of the 30 ms pulse is at 20 ms.
    expect(at(20 + SHAKE_QUIET_MS - STEP_MS)).toBe(true);
    expect(at(20 + SHAKE_QUIET_MS)).toBe(false);
  });
});

describe('sample gaps', () => {
  it('reseeds gravity and clears candidates after a gap', () => {
    let state = createShakeDetector();
    for (let t = 0; t <= 500; t += STEP_MS) {
      state = updateShake(state, { timeMs: t, acceleration: null, accelerationIncludingGravity: GRAVITY }).state;
    }
    // A first peak right before the gap.
    state = updateShake(state, gravitySample(510, 20)).state;
    expect(state.candidatePeakMs).toBe(510);
    // The phone was turned while events stalled; without a reset the new
    // gravity direction would read as a 13.9 m/s2 jolt.
    const rotated: Vec3 = { x: 9.81, y: 0, z: 0 };
    const afterGap = updateShake(state, {
      timeMs: 510 + SENSOR_GAP_RESET_MS + 1,
      acceleration: null,
      accelerationIncludingGravity: rotated,
    });
    expect(afterGap.magnitude).toBeCloseTo(0, 10);
    expect(afterGap.gesture).toBe(false);
    expect(afterGap.state.candidatePeakMs).toBeNull();
  });
});
