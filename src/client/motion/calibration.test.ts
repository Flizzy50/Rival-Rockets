import { describe, expect, it } from 'vitest';
import { CALIBRATION_HOLD_MS } from '../../shared/config';
import { createCalibration, updateCalibration, type CalibrationUpdate } from './calibration';

describe('calibration', () => {
  it('finishes after a steady 1 s hold with the mean as neutral', () => {
    let state = createCalibration();
    const readings: number[] = [];
    let last: CalibrationUpdate | null = null;
    for (let t = 0; t <= CALIBRATION_HOLD_MS; t += 50) {
      const gamma = 10 + (t % 100 === 0 ? 0 : 3);
      readings.push(gamma);
      last = updateCalibration(state, gamma, t);
      state = last.state;
      if (t < CALIBRATION_HOLD_MS) {
        expect(last.status).toBe('holding');
        expect(last.neutralDeg).toBeNull();
      }
    }
    const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
    expect(last?.status).toBe('done');
    expect(last?.progress).toBe(1);
    expect(last?.neutralDeg).toBeCloseTo(mean, 10);
  });

  it('reports progress while holding', () => {
    let state = createCalibration();
    state = updateCalibration(state, 5, 0).state;
    state = updateCalibration(state, 5, 250).state;
    const out = updateCalibration(state, 5, 500);
    expect(out.status).toBe('holding');
    expect(out.progress).toBeCloseTo(0.5);
  });

  it('restarts from the sample that drifts more than 4 degrees', () => {
    let state = createCalibration();
    state = updateCalibration(state, 10, 0).state;
    state = updateCalibration(state, 12, 100).state;
    const drift = updateCalibration(state, 15, 200);
    expect(drift.status).toBe('restarted');
    expect(drift.progress).toBe(0);
    state = drift.state;
    state = updateCalibration(state, 15, 600).state;
    const early = updateCalibration(state, 15, 200 + CALIBRATION_HOLD_MS - 1);
    expect(early.status).toBe('holding');
    const done = updateCalibration(early.state, 15, 200 + CALIBRATION_HOLD_MS);
    expect(done.status).toBe('done');
    expect(done.neutralDeg).toBe(15);
  });

  it('ignores non-finite readings', () => {
    let state = updateCalibration(createCalibration(), 8, 0).state;
    for (const gamma of [null, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const out = updateCalibration(state, gamma, 2000);
      expect(out.state).toBe(state);
      expect(out.status).toBe('holding');
      expect(out.neutralDeg).toBeNull();
    }
    const none = updateCalibration(createCalibration(), null, 5000);
    expect(none.status).toBe('holding');
    state = updateCalibration(state, 8, 500).state;
    expect(updateCalibration(state, 8, 1000).status).toBe('done');
  });

  it('never finishes with fewer than 3 readings', () => {
    let state = updateCalibration(createCalibration(), 0, 0).state;
    const two = updateCalibration(state, 0, 5000);
    expect(two.status).toBe('holding');
    state = two.state;
    expect(updateCalibration(state, 0, 5010).status).toBe('done');
  });
});
