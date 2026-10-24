// Pure sliding-window limiter (Requirement 9, PRD 8). The caller passes the
// server clock, so tests and the gateway share one time source.

export interface WindowLimiter {
  readonly hits: readonly number[];
}

export interface HitResult {
  limiter: WindowLimiter;
  allowed: boolean;
  // Time until a slot frees up; 0 when the hit was allowed. Lets dispatch fill
  // `retryAfterMs` without re-deriving the window.
  retryAfterMs: number;
}

export const EMPTY_LIMITER: WindowLimiter = { hits: [] };

// A hit at time t counts for the half-open window (t - windowMs, t]. Denied
// hits are not recorded: recording them would let a flood lock a client out
// forever, and they were never applied.
export function tryHit(l: WindowLimiter, nowMs: number, limit: number, windowMs: number): HitResult {
  if (!Number.isFinite(nowMs) || !Number.isFinite(windowMs) || windowMs <= 0) {
    return { limiter: l, allowed: false, retryAfterMs: 0 };
  }
  const windowStart = nowMs - windowMs;
  // Hits from a later time than `nowMs` are kept, so a clock step backwards
  // cannot open extra slots.
  const live = l.hits.filter((t) => t > windowStart);
  if (live.length < limit) {
    return { limiter: { hits: [...live, nowMs] }, allowed: true, retryAfterMs: 0 };
  }
  return { limiter: { hits: live }, allowed: false, retryAfterMs: retryAfter(live, nowMs, limit, windowMs) };
}

function retryAfter(live: readonly number[], nowMs: number, limit: number, windowMs: number): number {
  if (limit <= 0 || live.length === 0) return windowMs;
  const sorted = [...live].sort((a, b) => a - b);
  // A slot opens once enough of the oldest hits leave the window that fewer
  // than `limit` remain.
  const freeing = sorted[sorted.length - limit] ?? sorted[0] ?? nowMs;
  return Math.max(0, freeing + windowMs - nowMs);
}
