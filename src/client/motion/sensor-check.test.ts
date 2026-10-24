import { describe, expect, it } from 'vitest';
import { SENSOR_READINGS_TIMEOUT_MS } from '../../shared/config';
import {
  createTiltCheck,
  isEngineerCheckPassed,
  readingsTimedOut,
  updateTiltCheck,
  type TiltCheckState,
} from './sensor-check';

function feed(readings: readonly (number | null)[]): { state: TiltCheckState; passed: boolean } {
  let state = createTiltCheck();
  let passed = false;
  for (const gamma of readings) {
    const out = updateTiltCheck(state, gamma);
    state = out.state;
    passed = out.passed;
  }
  return { state, passed };
}

describe('tilt check', () => {
  it('passes with 3 finite readings spanning 2 degrees', () => {
    expect(feed([10, 11, 12]).passed).toBe(true);
  });

  it('fails when the span is only 1.5 degrees', () => {
    expect(feed([10, 10.5, 11.5]).passed).toBe(false);
  });

  it('fails with only 2 readings even when they span enough', () => {
    expect(feed([0, 10]).passed).toBe(false);
  });

  it('never counts null or NaN readings', () => {
    const out = feed([0, null, Number.NaN, 5, Number.POSITIVE_INFINITY, null]);
    expect(out.state.count).toBe(2);
    expect(out.passed).toBe(false);
  });
});

describe('engineer check', () => {
  it('requires tilt, usable acceleration, and a detected shake', () => {
    expect(isEngineerCheckPassed({ tiltPassed: true, accelerationSeen: true, shakeDetected: true })).toBe(true);
    expect(isEngineerCheckPassed({ tiltPassed: true, accelerationSeen: true, shakeDetected: false })).toBe(false);
    expect(isEngineerCheckPassed({ tiltPassed: true, accelerationSeen: false, shakeDetected: false })).toBe(false);
    expect(isEngineerCheckPassed({ tiltPassed: false, accelerationSeen: true, shakeDetected: true })).toBe(false);
  });
});

describe('readings timeout', () => {
  it('is true only when nothing has arrived by 3000 ms', () => {
    expect(readingsTimedOut(1000, 1000 + SENSOR_READINGS_TIMEOUT_MS - 1, false)).toBe(false);
    expect(readingsTimedOut(1000, 1000 + SENSOR_READINGS_TIMEOUT_MS, false)).toBe(true);
    expect(readingsTimedOut(1000, 1000 + SENSOR_READINGS_TIMEOUT_MS * 2, true)).toBe(false);
  });
});

describe('AC3: a granted permission without real readings never passes', () => {
  it('stays failed with no readings or only null readings', () => {
    // The permission result is not an input to any check; only readings are.
    const noData = feed([]);
    const nullData = feed([null, null, null, null, Number.NaN]);
    for (const out of [noData, nullData]) {
      expect(out.passed).toBe(false);
      expect(
        isEngineerCheckPassed({ tiltPassed: out.passed, accelerationSeen: false, shakeDetected: false }),
      ).toBe(false);
    }
    expect(readingsTimedOut(0, SENSOR_READINGS_TIMEOUT_MS, false)).toBe(true);
  });
});
