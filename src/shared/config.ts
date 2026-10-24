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

// Players and seats (PRD 1): two crews of Pilot + Engineer, exactly four.
export const ACTIVE_PLAYERS = 4;
export const SEAT_COUNT = 4;

// Rooms, names, and tokens (PRD 8). The alphabet drops 0/O, 1/I/L (PRD 7.3).
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
// Grapheme clusters, counted with Intl.Segmenter on the server.
export const DISPLAY_NAME_MAX_GRAPHEMES = 16;
// UTF-8 bytes per text message; checked before parsing.
export const CLIENT_MESSAGE_MAX_BYTES = 1024;
// 16 bytes = 128 bits, the PRD minimum for a seat token.
export const RECONNECT_TOKEN_BYTES = 16;
// M2: largest int32, so seq stays a safe integer and fits any JSON parser.
export const SEQUENCE_MAX = 2147483647;

// Liveness and holds (PRD 8).
export const HEARTBEAT_INTERVAL_MS = 1000;
export const HEARTBEAT_TIMEOUT_MS = 3000;
export const SEAT_HOLD_MS = 15000;
export const ROOM_INACTIVITY_MS = 1800000;

// Server rates (PRD 9); tune from measured behavior.
export const SIMULATION_HZ = 30;
export const BROADCAST_HZ = 18;

// Input and request limits (PRD 8). Client steering stays below the server
// cap so normal jitter never trips the limiter.
export const CLIENT_STEERING_HZ = 20;
export const SERVER_STEERING_PER_SEC = 30;
export const ABILITY_REQUESTS_PER_SEC = 5;
export const SOCKET_MESSAGES_PER_SEC = 40;
// Per source IP, failures included.
export const ROOM_CREATES_PER_MIN_PER_IP = 5;
export const ROOM_JOINS_PER_MIN_PER_IP = 10;

// Arena and rocket (PRD 4). Radius is the collision circle; length is drawn.
export const ARENA_WIDTH = 600;
export const ARENA_HEIGHT = 800;
export const ROCKET_RADIUS = 18;
export const ROCKET_LENGTH = 48;

// Movement (PRD 4).
export const BASE_SPEED = 120;
export const MAX_TURN_DEG_PER_SEC = 120;
export const BOOST_SPEED_MULTIPLIER = 1.5;

// Start lanes (PRD 4). Heading is radians with 0 = +x ("right"); Comet takes
// the upper lane in the first match.
export const START_LANES = {
  comet: { x: 240, y: 78, heading: 0 },
  nova: { x: 240, y: 134, heading: 0 },
} as const;

// M2: about two broadcast intervals, so one late snapshot does not stall
// interpolation.
export const INTERPOLATION_DELAY_MS = 100;

// Latency diagnostics (PRD 2). Window size and pending timeout are M2 values;
// the 150 ms p95 is the PRD target to measure, not a result.
export const LATENCY_SAMPLE_WINDOW = 200;
export const LATENCY_PENDING_TIMEOUT_MS = 5000;
export const LATENCY_TARGET_P95_MS = 150;

// Sensor-test rocket preview, using the PRD 4 arena and movement so pilot
// comfort is judged at the real turn feel.
export const PREVIEW_ARENA_WIDTH = ARENA_WIDTH;
export const PREVIEW_ARENA_HEIGHT = ARENA_HEIGHT;
export const PREVIEW_SPEED_UNITS_PER_S = BASE_SPEED;
export const PREVIEW_MAX_TURN_DEG_PER_S = MAX_TURN_DEG_PER_SEC;
export const PREVIEW_ROCKET_LENGTH = ROCKET_LENGTH;
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
