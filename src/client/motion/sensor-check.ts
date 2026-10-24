import {
  SENSOR_CHECK_MIN_READINGS,
  SENSOR_CHECK_TILT_SPAN_DEG,
  SENSOR_READINGS_TIMEOUT_MS,
} from '../../shared/config';

// Setup gating (PRD 5, 7.7; AC3). A granted permission alone proves nothing:
// some browsers grant and then deliver no data or only nulls, so a check
// passes only on real, finite readings that actually move.

export interface TiltCheckSettings {
  readonly minReadings: number;
  readonly spanDeg: number;
}

export const DEFAULT_TILT_CHECK_SETTINGS: TiltCheckSettings = {
  minReadings: SENSOR_CHECK_MIN_READINGS,
  spanDeg: SENSOR_CHECK_TILT_SPAN_DEG,
};

export interface TiltCheckState {
  readonly count: number;
  readonly minDeg: number;
  readonly maxDeg: number;
}

export function createTiltCheck(): TiltCheckState {
  return { count: 0, minDeg: Number.POSITIVE_INFINITY, maxDeg: Number.NEGATIVE_INFINITY };
}

function isTiltCheckPassed(state: TiltCheckState, s: TiltCheckSettings): boolean {
  return state.count >= s.minReadings && state.maxDeg - state.minDeg >= s.spanDeg;
}

export function updateTiltCheck(
  state: TiltCheckState,
  gammaDeg: number | null,
  s: TiltCheckSettings = DEFAULT_TILT_CHECK_SETTINGS,
): { state: TiltCheckState; passed: boolean } {
  if (gammaDeg === null || !Number.isFinite(gammaDeg)) {
    return { state, passed: isTiltCheckPassed(state, s) };
  }
  const next: TiltCheckState = {
    count: state.count + 1,
    minDeg: Math.min(state.minDeg, gammaDeg),
    maxDeg: Math.max(state.maxDeg, gammaDeg),
  };
  return { state: next, passed: isTiltCheckPassed(next, s) };
}

export function isEngineerCheckPassed(checks: {
  readonly tiltPassed: boolean;
  readonly accelerationSeen: boolean;
  readonly shakeDetected: boolean;
}): boolean {
  return checks.tiltPassed && checks.accelerationSeen && checks.shakeDetected;
}

// True only when nothing arrived in time, which sends setup to the
// No-readings recovery card (PRD 7.7).
export function readingsTimedOut(
  startMs: number,
  nowMs: number,
  received: boolean,
  timeoutMs: number = SENSOR_READINGS_TIMEOUT_MS,
): boolean {
  return !received && nowMs - startMs >= timeoutMs;
}
