import { describe, expect, it } from 'vitest';
import { SOCKET_MESSAGES_PER_SEC } from '../src/shared/config.js';
import { RATE_WINDOW_MS } from './config.js';
import { EMPTY_LIMITER, tryHit, type WindowLimiter } from './rate-limit.js';

function hitTimes(times: readonly number[], limit: number, windowMs: number) {
  let limiter: WindowLimiter = EMPTY_LIMITER;
  const allowed: boolean[] = [];
  for (const t of times) {
    const result = tryHit(limiter, t, limit, windowMs);
    limiter = result.limiter;
    allowed.push(result.allowed);
  }
  return { limiter, allowed };
}

describe('tryHit', () => {
  it('allows exactly the limit within one window and rejects the next hit', () => {
    const times = Array.from({ length: SOCKET_MESSAGES_PER_SEC + 1 }, (_, i) => i);
    const { allowed, limiter } = hitTimes(times, SOCKET_MESSAGES_PER_SEC, RATE_WINDOW_MS);
    expect(allowed.slice(0, SOCKET_MESSAGES_PER_SEC).every(Boolean)).toBe(true);
    expect(allowed.at(-1)).toBe(false);
    // Rejected hits are not recorded.
    expect(limiter.hits).toHaveLength(SOCKET_MESSAGES_PER_SEC);
  });

  it('frees a slot once the oldest hit leaves the window', () => {
    const { limiter } = hitTimes([0, 100, 200], 3, RATE_WINDOW_MS);
    const blocked = tryHit(limiter, RATE_WINDOW_MS - 1, 3, RATE_WINDOW_MS);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1);
    const freed = tryHit(limiter, RATE_WINDOW_MS, 3, RATE_WINDOW_MS);
    expect(freed.allowed).toBe(true);
    expect(freed.limiter.hits).toEqual([100, 200, RATE_WINDOW_MS]);
  });

  it('prunes old hits and does not mutate its input', () => {
    const input: WindowLimiter = { hits: [0, 10] };
    const result = tryHit(input, RATE_WINDOW_MS * 5, 2, RATE_WINDOW_MS);
    expect(result.allowed).toBe(true);
    expect(result.limiter.hits).toEqual([RATE_WINDOW_MS * 5]);
    expect(input.hits).toEqual([0, 10]);
  });

  it('never lets more than the limit through in any window of a burst', () => {
    const limit = 5;
    const times = Array.from({ length: 200 }, (_, i) => i * 37);
    const { allowed } = hitTimes(times, limit, RATE_WINDOW_MS);
    const accepted = times.filter((_, i) => allowed[i]);
    for (const start of accepted) {
      expect(accepted.filter((t) => t >= start && t < start + RATE_WINDOW_MS).length).toBeLessThanOrEqual(limit);
    }
  });

  it('rejects a non-finite clock reading', () => {
    expect(tryHit(EMPTY_LIMITER, Number.NaN, 1, RATE_WINDOW_MS).allowed).toBe(false);
  });
});
