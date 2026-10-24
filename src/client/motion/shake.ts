import {
  CHARGE_INTERVAL_MS,
  SENSOR_GAP_RESET_MS,
  SHAKE_GRAVITY_TAU_MS,
  SHAKE_MAX_PEAK_GAP_MS,
  SHAKE_MIN_PEAK_GAP_MS,
  SHAKE_PEAK_ACCEL_MPS2,
  SHAKE_QUIET_MS,
} from '../../shared/config';
import { smoothingAlpha } from './tilt';

// Engineer shake-to-charge detection (PRD 5). Only acceleration magnitudes are
// used: iOS and Android report opposite axis signs for devicemotion (MDN), and
// a magnitude is identical under any sign flip, so no per-platform branch is
// needed. A gesture is a burst of two peaks; strength above the threshold and
// continuous shaking earn nothing extra.

export interface Vec3 {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

export interface ShakeSample {
  readonly timeMs: number;
  readonly acceleration: Vec3 | null;
  readonly accelerationIncludingGravity: Vec3 | null;
}

export interface ShakeSettings {
  readonly shakeThresholdMps2: number;
  readonly shakeMinPeakGapMs: number;
  readonly shakeMaxPeakGapMs: number;
  readonly shakeQuietMs: number;
  readonly shakeGravityTauMs: number;
}

export const DEFAULT_SHAKE_SETTINGS: ShakeSettings = {
  shakeThresholdMps2: SHAKE_PEAK_ACCEL_MPS2,
  shakeMinPeakGapMs: SHAKE_MIN_PEAK_GAP_MS,
  shakeMaxPeakGapMs: SHAKE_MAX_PEAK_GAP_MS,
  shakeQuietMs: SHAKE_QUIET_MS,
  shakeGravityTauMs: SHAKE_GRAVITY_TAU_MS,
};

export type ShakeSource = 'linear' | 'gravity-filtered';

interface FiniteVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ShakeState {
  readonly lastTimeMs: number | null;
  readonly gravity: FiniteVec3 | null;
  readonly above: boolean;
  readonly lastAboveMs: number | null;
  readonly candidatePeakMs: number | null;
  // After a gesture, nothing counts until the phone has been quiet, which is
  // what keeps continuous shaking at a single gesture.
  readonly refractory: boolean;
  readonly lastGestureMs: number | null;
}

export interface ShakeUpdate {
  readonly state: ShakeState;
  readonly magnitude: number | null;
  readonly source: ShakeSource | null;
  readonly shakeActive: boolean;
  readonly gesture: boolean;
}

function finiteVec(v: Vec3 | null): FiniteVec3 | null {
  if (v === null) return null;
  const { x, y, z } = v;
  if (x === null || y === null || z === null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function length(v: FiniteVec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function hasUsableAcceleration(sample: ShakeSample): boolean {
  return finiteVec(sample.acceleration) !== null || finiteVec(sample.accelerationIncludingGravity) !== null;
}

export function createShakeDetector(): ShakeState {
  return {
    lastTimeMs: null,
    gravity: null,
    above: false,
    lastAboveMs: null,
    candidatePeakMs: null,
    refractory: false,
    lastGestureMs: null,
  };
}

// Exposed separately so the selection lock can be evaluated on orientation
// samples too, without waiting for the next motion event.
export function isShakeActive(
  state: ShakeState,
  nowMs: number,
  s: ShakeSettings = DEFAULT_SHAKE_SETTINGS,
): boolean {
  return state.lastAboveMs !== null && nowMs - state.lastAboveMs < s.shakeQuietMs;
}

export function updateShake(
  state: ShakeState,
  sample: ShakeSample,
  s: ShakeSettings = DEFAULT_SHAKE_SETTINGS,
): ShakeUpdate {
  const t = sample.timeMs;
  const dtMs = state.lastTimeMs === null ? null : t - state.lastTimeMs;
  // A long gap means the gravity estimate and any pending peak are stale.
  const reset = dtMs !== null && dtMs > SENSOR_GAP_RESET_MS;
  const base: ShakeState = reset ? { ...state, gravity: null, above: false, candidatePeakMs: null } : state;

  const withGravity = finiteVec(sample.accelerationIncludingGravity);
  let gravity = base.gravity;
  if (withGravity !== null) {
    if (gravity === null || dtMs === null) {
      gravity = withGravity;
    } else {
      const a = smoothingAlpha(dtMs, s.shakeGravityTauMs);
      gravity = {
        x: gravity.x + a * (withGravity.x - gravity.x),
        y: gravity.y + a * (withGravity.y - gravity.y),
        z: gravity.z + a * (withGravity.z - gravity.z),
      };
    }
  }

  let magnitude: number | null = null;
  let source: ShakeSource | null = null;
  const linear = finiteVec(sample.acceleration);
  if (linear !== null) {
    magnitude = length(linear);
    source = 'linear';
  } else if (withGravity !== null && gravity !== null) {
    magnitude = length({
      x: withGravity.x - gravity.x,
      y: withGravity.y - gravity.y,
      z: withGravity.z - gravity.z,
    });
    source = 'gravity-filtered';
  }

  if (magnitude === null) {
    const next: ShakeState = { ...base, lastTimeMs: t, gravity };
    return { state: next, magnitude, source, shakeActive: isShakeActive(next, t, s), gesture: false };
  }

  const isAbove = magnitude > s.shakeThresholdMps2;
  let { candidatePeakMs, refractory, lastGestureMs, lastAboveMs } = base;
  let gesture = false;

  if (isAbove) {
    // A rising crossing implies a dip below the threshold since the last peak.
    if (!base.above && !refractory) {
      if (candidatePeakMs === null || t - candidatePeakMs > s.shakeMaxPeakGapMs) {
        candidatePeakMs = t;
      } else if (t - candidatePeakMs >= s.shakeMinPeakGapMs) {
        // Emit on the second peak so feedback lands on the same frame.
        candidatePeakMs = null;
        refractory = true;
        if (lastGestureMs === null || t - lastGestureMs >= CHARGE_INTERVAL_MS) {
          gesture = true;
          lastGestureMs = t;
        }
      }
      // Peaks closer than the minimum gap are one jolt ringing; keep the first.
    }
    lastAboveMs = t;
  } else if (refractory && lastAboveMs !== null && t - lastAboveMs >= s.shakeQuietMs) {
    refractory = false;
  }

  const next: ShakeState = {
    lastTimeMs: t,
    gravity,
    above: isAbove,
    lastAboveMs,
    candidatePeakMs,
    refractory,
    lastGestureMs,
  };
  return { state: next, magnitude, source, shakeActive: isShakeActive(next, t, s), gesture };
}
