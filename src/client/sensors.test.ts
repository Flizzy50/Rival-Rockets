import { describe, expect, it } from 'vitest';
import { toMotionSample, toOrientationSample } from './sensors';

describe('toOrientationSample', () => {
  it('passes finite angles and the event time through', () => {
    expect(toOrientationSample({ gamma: 12.5, beta: 40, timeStamp: 1234 })).toEqual({
      gamma: 12.5,
      beta: 40,
      timeMs: 1234,
    });
  });

  it('maps null fields to null', () => {
    expect(toOrientationSample({ gamma: null, beta: null, timeStamp: 5 })).toEqual({
      gamma: null,
      beta: null,
      timeMs: 5,
    });
  });

  it('maps non-finite fields to null', () => {
    const sample = toOrientationSample({ gamma: Number.NaN, beta: Number.POSITIVE_INFINITY, timeStamp: 5 });
    expect(sample.gamma).toBeNull();
    expect(sample.beta).toBeNull();
  });
});

describe('toMotionSample', () => {
  it('copies finite axes from both acceleration sources', () => {
    const sample = toMotionSample({
      acceleration: { x: 1, y: -2, z: 3 },
      accelerationIncludingGravity: { x: 0, y: 9.8, z: 0.5 },
      timeStamp: 99,
    });
    expect(sample).toEqual({
      acceleration: { x: 1, y: -2, z: 3 },
      accelerationIncludingGravity: { x: 0, y: 9.8, z: 0.5 },
      timeMs: 99,
    });
  });

  it('maps missing sources to null', () => {
    const sample = toMotionSample({ acceleration: null, accelerationIncludingGravity: null, timeStamp: 1 });
    expect(sample.acceleration).toBeNull();
    expect(sample.accelerationIncludingGravity).toBeNull();
  });

  it('maps null and non-finite axes to null', () => {
    const sample = toMotionSample({
      acceleration: { x: null, y: Number.NaN, z: 2 },
      accelerationIncludingGravity: { x: Number.NEGATIVE_INFINITY, y: 9.8, z: null },
      timeStamp: 1,
    });
    expect(sample.acceleration).toEqual({ x: null, y: null, z: 2 });
    expect(sample.accelerationIncludingGravity).toEqual({ x: null, y: 9.8, z: null });
  });
});
