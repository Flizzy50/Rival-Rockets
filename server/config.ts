export const DEFAULT_PORT = 3000;
// All interfaces, so Render's router and LAN phones can reach the process.
export const HOST = '0.0.0.0';
// Vite fingerprints /assets/* file names, so they can be cached for a year.
export const ASSET_MAX_AGE_S = 31536000;
export const HSTS_MAX_AGE_S = 15552000;
export const SHUTDOWN_TIMEOUT_MS = 10000;

// WebSocket gateway (M2). Same origin as the client, one path.
export const WS_PATH = '/ws';
// Frame cap at the ws layer, above CLIENT_MESSAGE_MAX_BYTES so the validator
// can still answer an oversized message with a reason instead of a dropped socket.
export const WS_MAX_FRAME_BYTES = 4096;

// Simulation loop (M2). Ticks faster than SIMULATION_HZ and steps on a fixed
// accumulator, so timer jitter does not change the step size.
export const SIMULATION_LOOP_INTERVAL_MS = 10;
// Caps catch-up after an event-loop stall instead of fast-forwarding the rocket.
export const MAX_CATCH_UP_STEPS = 5;
// Heartbeat timeouts, seat holds, and room expiry are checked at this cadence.
export const HOUSEKEEPING_INTERVAL_MS = 250;

// Rate-limit windows: per-second limits for sockets and seats, per-minute for
// room creation and joining by source IP (PRD 8).
export const RATE_WINDOW_MS = 1000;
export const IP_RATE_WINDOW_MS = 60000;
