import {
  CALIBRATION_HOLD_MS,
  CALIBRATION_STABILITY_DEG,
  SENSOR_CHECK_MIN_READINGS,
} from '../../shared/config';

// Neutral gamma calibration (PRD 5, 7.7): the player holds the phone the way
// they will play, and neutral is set only once real readings stay steady.

export interface CalibrationSettings {
  readonly stabilityDeg: number;
  readonly holdMs: number;
  readonly minReadings: number;
}

export const DEFAULT_CALIBRATION_SETTINGS: CalibrationSettings = {
  stabilityDeg: CALIBRATION_STABILITY_DEG,
  holdMs: CALIBRATION_HOLD_MS,
  minReadings: SENSOR_CHECK_MIN_READINGS,
};

export interface CalibrationState {
  readonly startMs: number | null;
  readonly count: number;
  readonly sumDeg: number;
  readonly minDeg: number;
  readonly maxDeg: number;
  readonly progress: number;
  // Frozen once done so later wobble cannot move the neutral.
  readonly neutralDeg: number | null;
}

export type CalibrationStatus = 'holding' | 'restarted' | 'done';

export interface CalibrationUpdate {
  readonly state: CalibrationState;
  readonly status: CalibrationStatus;
  readonly progress: number;
  readonly neutralDeg: number | null;
}

export function createCalibration(): CalibrationState {
  return {
    startMs: null,
    count: 0,
    sumDeg: 0,
    minDeg: Number.POSITIVE_INFINITY,
    maxDeg: Number.NEGATIVE_INFINITY,
    progress: 0,
    neutralDeg: null,
  };
}

function startHold(gammaDeg: number, timeMs: number): CalibrationState {
  return {
    startMs: timeMs,
    count: 1,
    sumDeg: gammaDeg,
    minDeg: gammaDeg,
    maxDeg: gammaDeg,
    progress: 0,
    neutralDeg: null,
  };
}

export function updateCalibration(
  state: CalibrationState,
  gammaDeg: number | null,
  timeMs: number,
  s: CalibrationSettings = DEFAULT_CALIBRATION_SETTINGS,
): CalibrationUpdate {
  if (state.neutralDeg !== null) {
    return { state, status: 'done', progress: 1, neutralDeg: state.neutralDeg };
  }
  // Missing readings must never advance calibration (AC3).
  if (gammaDeg === null || !Number.isFinite(gammaDeg) || !Number.isFinite(timeMs)) {
    return { state, status: 'holding', progress: state.progress, neutralDeg: null };
  }
  if (state.startMs === null) {
    const next = startHold(gammaDeg, timeMs);
    return { state: next, status: 'holding', progress: 0, neutralDeg: null };
  }

  const minDeg = Math.min(state.minDeg, gammaDeg);
  const maxDeg = Math.max(state.maxDeg, gammaDeg);
  if (maxDeg - minDeg > s.stabilityDeg) {
    // The breaking sample starts the new hold so a player who settles into a
    // new grip does not have to wait an extra sample interval.
    const next = startHold(gammaDeg, timeMs);
    return { state: next, status: 'restarted', progress: 0, neutralDeg: null };
  }

  const count = state.count + 1;
  const sumDeg = state.sumDeg + gammaDeg;
  const elapsedMs = timeMs - state.startMs;
  const progress = s.holdMs > 0 ? Math.min(1, Math.max(0, elapsedMs / s.holdMs)) : 1;
  const done = elapsedMs >= s.holdMs && count >= s.minReadings;
  const neutralDeg = done ? sumDeg / count : null;
  const next: CalibrationState = { startMs: state.startMs, count, sumDeg, minDeg, maxDeg, progress, neutralDeg };
  return { state: next, status: done ? 'done' : 'holding', progress, neutralDeg };
}
