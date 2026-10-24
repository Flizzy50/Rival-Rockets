import {
  SENSOR_GAP_RESET_MS,
  TILT_DEAD_ZONE_DEG,
  TILT_FULL_SCALE_DEG,
  TILT_SMOOTHING_TAU_MS,
} from '../../shared/config';

// Pilot steering from deviceorientation gamma (PRD 5). Only relative gamma is
// used, never compass alpha, so play does not depend on which way a player
// faces. Gamma becomes ill-conditioned as beta approaches 90 degrees (phone
// held upright), so the comfortable grip must be verified on real devices.

export interface TiltSettings {
  readonly deadZoneDeg: number;
  readonly fullScaleDeg: number;
  readonly smoothingTauMs: number;
}

export const DEFAULT_TILT_SETTINGS: TiltSettings = {
  deadZoneDeg: TILT_DEAD_ZONE_DEG,
  fullScaleDeg: TILT_FULL_SCALE_DEG,
  smoothingTauMs: TILT_SMOOTHING_TAU_MS,
};

export interface TiltState {
  readonly smoothedRelDeg: number | null;
  readonly lastTimeMs: number | null;
  readonly steering: number;
}

export interface TiltUpdate {
  readonly state: TiltState;
  readonly smoothedRelDeg: number;
  readonly steering: number;
}

export function relativeGamma(gammaDeg: number, neutralDeg: number): number {
  return gammaDeg - neutralDeg;
}

// Based on the actual sample interval so phones with different event rates
// get the same smoothing feel.
export function smoothingAlpha(dtMs: number, tauMs: number): number {
  if (!(tauMs > 0)) return 1;
  return 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
}

export function steeringFromRelative(relDeg: number, s: TiltSettings = DEFAULT_TILT_SETTINGS): number {
  if (!Number.isFinite(relDeg)) return 0;
  const magnitude = Math.abs(relDeg);
  if (magnitude <= s.deadZoneDeg) return 0;
  const span = s.fullScaleDeg - s.deadZoneDeg;
  // Debug sliders can set the dead zone past full scale; treat that as an
  // immediate full turn instead of dividing by zero or flipping the sign.
  const amount = span > 0 ? Math.min(1, (magnitude - s.deadZoneDeg) / span) : 1;
  return Math.sign(relDeg) * amount;
}

export function createTiltState(): TiltState {
  return { smoothedRelDeg: null, lastTimeMs: null, steering: 0 };
}

// Smooths relative gamma first, then maps it, so the Engineer selection reads
// the same smoothed value the steering uses (PRD 5).
export function updateTilt(
  state: TiltState,
  gammaDeg: number | null,
  neutralDeg: number,
  timeMs: number,
  s: TiltSettings = DEFAULT_TILT_SETTINGS,
): TiltUpdate {
  if (gammaDeg === null || !Number.isFinite(gammaDeg) || !Number.isFinite(neutralDeg) || !Number.isFinite(timeMs)) {
    return { state, smoothedRelDeg: state.smoothedRelDeg ?? 0, steering: state.steering };
  }
  const rel = relativeGamma(gammaDeg, neutralDeg);
  let smoothed = rel;
  if (state.smoothedRelDeg !== null && state.lastTimeMs !== null) {
    const dtMs = timeMs - state.lastTimeMs;
    // After a stall or backgrounding the old value is stale; snap instead of
    // easing toward it.
    if (dtMs >= 0 && dtMs <= SENSOR_GAP_RESET_MS) {
      smoothed = state.smoothedRelDeg + smoothingAlpha(dtMs, s.smoothingTauMs) * (rel - state.smoothedRelDeg);
    }
  }
  const steering = steeringFromRelative(smoothed, s);
  return {
    state: { smoothedRelDeg: smoothed, lastTimeMs: timeMs, steering },
    smoothedRelDeg: smoothed,
    steering,
  };
}
