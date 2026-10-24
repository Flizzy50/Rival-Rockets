// Gameplay and sensor values. PRD numbers are playtest starting values (PRD 5),
// so every one lives here and nowhere else.

// Crew energy and abilities (PRD 5).
export const INITIAL_ENERGY = 50;
export const MAX_ENERGY = 100;
// Also the energy meter segment size: MAX_ENERGY / CHARGE_ENERGY segments.
export const CHARGE_ENERGY = 25;
export const CHARGE_INTERVAL_MS = 1000;
export const ABILITY_COST = 50;
export const ABILITY_DURATION_MS = 2000;
// Starts on activation, so it overlaps the effect.
export const SHARED_COOLDOWN_MS = 3000;
export const DEFAULT_ABILITY = 'boost' as const;

// Pilot tilt (PRD 5).
export const TILT_DEAD_ZONE_DEG = 4;
// Tilting beyond this gives no extra turn rate.
export const TILT_FULL_SCALE_DEG = 28;
export const TILT_SMOOTHING_TAU_MS = 80;

// Calibration and sensor checks (PRD 5, 7.7).
export const CALIBRATION_STABILITY_DEG = 4;
export const CALIBRATION_HOLD_MS = 1000;
export const SENSOR_CHECK_MIN_READINGS = 3;
export const SENSOR_CHECK_TILT_SPAN_DEG = 2;
export const SENSOR_READINGS_TIMEOUT_MS = 3000;

// Engineer selection (PRD 5).
export const SELECTION_TILT_DEG = 12;
export const SELECTION_HOLD_MS = 300;

// Shake detection (PRD 5).
// Quiet time that re-arms the detector and releases the selection lock.
export const SHAKE_QUIET_MS = 300;
export const SHAKE_PEAK_ACCEL_MPS2 = 12;
export const SHAKE_MIN_PEAK_GAP_MS = 80;
export const SHAKE_MAX_PEAK_GAP_MS = 450;
// Low-pass estimate of gravity when only accelerationIncludingGravity exists.
export const SHAKE_GRAVITY_TAU_MS = 500;

// M1: a longer sample gap (backgrounding, stalls) resets filters instead of
// smoothing across stale data.
export const SENSOR_GAP_RESET_MS = 500;

// Sensor-test rocket preview, using the PRD 4 arena and movement so pilot
// comfort is judged at the real turn feel.
export const PREVIEW_ARENA_WIDTH = 600;
export const PREVIEW_ARENA_HEIGHT = 800;
export const PREVIEW_SPEED_UNITS_PER_S = 120;
export const PREVIEW_MAX_TURN_DEG_PER_S = 120;
export const PREVIEW_ROCKET_LENGTH = 48;
// M1: caps one frame step after a stall so the rocket never teleports.
export const PREVIEW_MAX_STEP_MS = 100;

// M1: window for the debug panel's event-rate readout.
export const EVENT_RATE_WINDOW_MS = 1000;

// M1: live-tuning slider bounds around the PRD defaults (debug panel only).
export const DEBUG_RANGES = {
  deadZoneDeg: { min: 0, max: 15, step: 0.5 },
  smoothingTauMs: { min: 0, max: 400, step: 10 },
  fullScaleDeg: { min: 10, max: 60, step: 1 },
  shakeThresholdMps2: { min: 5, max: 30, step: 0.5 },
} as const;
