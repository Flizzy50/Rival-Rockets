import { describe, expect, it } from 'vitest';
import { SENSOR_GAP_RESET_MS, TILT_SMOOTHING_TAU_MS } from '../../shared/config';
import { createTiltState, relativeGamma, smoothingAlpha, steeringFromRelative, updateTilt } from './tilt';

describe('steeringFromRelative', () => {
  it('returns 0 inside the dead zone and exactly at 4 degrees', () => {
    expect(steeringFromRelative(0)).toBe(0);
    expect(steeringFromRelative(3)).toBe(0);
    expect(steeringFromRelative(4)).toBe(0);
    expect(steeringFromRelative(-4)).toBe(0);
  });

  it('maps linearly to full input at 28 degrees and clamps beyond', () => {
    expect(steeringFromRelative(16)).toBeCloseTo(0.5);
    expect(steeringFromRelative(28)).toBe(1);
    expect(steeringFromRelative(60)).toBe(1);
  });

  it('mirrors for negative tilt', () => {
    expect(steeringFromRelative(-16)).toBeCloseTo(-0.5);
    expect(steeringFromRelative(-28)).toBe(-1);
    expect(steeringFromRelative(-60)).toBe(-1);
  });

  it('always stays within [-1, 1]', () => {
    for (let deg = -180; deg <= 180; deg += 0.5) {
      const value = steeringFromRelative(deg);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(steeringFromRelative(Number.NaN)).toBe(0);
  });
});

describe('smoothingAlpha', () => {
  it('passes samples through when tau is 0 or negative', () => {
    expect(smoothingAlpha(16, 0)).toBe(1);
    expect(smoothingAlpha(16, -5)).toBe(1);
  });
});

describe('updateTilt', () => {
  it('works relative to the calibrated neutral', () => {
    expect(relativeGamma(22, 10)).toBe(12);
    const out = updateTilt(createTiltState(), 22, 10, 0);
    expect(out.smoothedRelDeg).toBe(12);
    expect(out.steering).toBeCloseTo((12 - 4) / 24);
  });

  it('gives the same result for two 40 ms steps as one 80 ms step', () => {
    const start = updateTilt(createTiltState(), 0, 0, 0).state;
    const twoSteps = updateTilt(updateTilt(start, 20, 0, 40).state, 20, 0, 80);
    const oneStep = updateTilt(start, 20, 0, 80);
    expect(twoSteps.smoothedRelDeg).toBeCloseTo(oneStep.smoothedRelDeg, 10);
  });

  it('reaches about 63% of a step after one time constant', () => {
    const start = updateTilt(createTiltState(), 0, 0, 0).state;
    const out = updateTilt(start, 20, 0, TILT_SMOOTHING_TAU_MS);
    expect(out.smoothedRelDeg / 20).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(out.smoothedRelDeg / 20).toBeCloseTo(0.632, 3);
  });

  it('ignores null and NaN gamma and keeps the previous output', () => {
    const first = updateTilt(createTiltState(), 20, 0, 0);
    for (const gamma of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = updateTilt(first.state, gamma, 0, 16);
      expect(out.state).toBe(first.state);
      expect(out.smoothedRelDeg).toBe(first.smoothedRelDeg);
      expect(out.steering).toBe(first.steering);
    }
    const none = updateTilt(createTiltState(), null, 0, 0);
    expect(none.steering).toBe(0);
    expect(none.smoothedRelDeg).toBe(0);
  });

  it('snaps to the new value after a sample gap instead of smoothing', () => {
    const start = updateTilt(createTiltState(), 0, 0, 0).state;
    const withinGap = updateTilt(start, 20, 0, SENSOR_GAP_RESET_MS);
    expect(withinGap.smoothedRelDeg).toBeLessThan(20);
    const afterGap = updateTilt(start, 20, 0, SENSOR_GAP_RESET_MS + 1);
    expect(afterGap.smoothedRelDeg).toBe(20);
  });
});
