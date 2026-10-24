import { LATENCY_PENDING_TIMEOUT_MS, LATENCY_SAMPLE_WINDOW } from '../../shared/config';

// Client latency diagnostics (PRD 2, 10). Send-to-applied-ack intervals are
// kept per input kind and render delay separately, so the debug panel can
// report each against the target. Everything stays in this closure: nothing
// is persisted or sent, and the summary carries numbers only, never names,
// room codes, tokens, ids, or sensor values. Callers pass the clock in.

export type InputKind = 'steer' | 'charge' | 'ability';
export type AckStatus = 'applied' | 'rejected';

export interface LatencyStats {
  readonly count: number;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
}

export type LatencySummary = Record<InputKind | 'render', LatencyStats>;

export interface LatencyMonitor {
  sent(seq: number, kind: InputKind, atMs: number): void;
  // Only an `applied` ack adds a sample: a rejected input never moved the
  // rocket, so its round trip says nothing about control latency.
  acked(seq: number, status: AckStatus, atMs: number): void;
  renderDelay(ms: number): void;
  summary(): LatencySummary;
  reset(): void;
}

const MEDIAN_PERCENT = 50;
const P95_PERCENT = 95;
const PERCENT_SCALE = 100;

interface Pending {
  readonly kind: InputKind;
  readonly atMs: number;
}

// Nearest-rank percentile: the smallest sample with at least p% of samples at
// or below it. It always returns an actual sample, which keeps
// median <= p95 <= max for any data set.
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('percentile needs at least one sample');
  if (!Number.isFinite(p) || p < 0 || p > PERCENT_SCALE) {
    throw new RangeError('percentile p must be between 0 and 100');
  }
  const rank = Math.ceil((p / PERCENT_SCALE) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}

function isValidInterval(ms: number): boolean {
  return Number.isFinite(ms) && ms >= 0;
}

function stats(samples: readonly number[]): LatencyStats {
  if (samples.length === 0) return { count: 0, medianMs: null, p95Ms: null, maxMs: null };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: percentile(sorted, MEDIAN_PERCENT),
    p95Ms: percentile(sorted, P95_PERCENT),
    maxMs: sorted[sorted.length - 1] as number,
  };
}

export function createLatencyMonitor(window = LATENCY_SAMPLE_WINDOW): LatencyMonitor {
  if (!Number.isInteger(window) || window < 1) {
    throw new RangeError('latency window must be a positive integer');
  }

  const pending = new Map<number, Pending>();
  const samples: Record<InputKind | 'render', number[]> = {
    steer: [],
    charge: [],
    ability: [],
    render: [],
  };

  function addSample(key: InputKind | 'render', ms: number): void {
    const list = samples[key];
    list.push(ms);
    if (list.length > window) list.splice(0, list.length - window);
  }

  // Unacked sends (lost, or acked after a reconnect reset the seq) would
  // otherwise accumulate; dropping them on every call bounds the map to
  // roughly send rate × timeout.
  function dropExpired(nowMs: number): void {
    for (const [seq, entry] of pending) {
      if (nowMs - entry.atMs > LATENCY_PENDING_TIMEOUT_MS) pending.delete(seq);
    }
  }

  return {
    sent(seq, kind, atMs) {
      if (!Number.isFinite(seq) || !Number.isFinite(atMs)) return;
      dropExpired(atMs);
      // A reused seq (new connection) replaces the old entry.
      pending.delete(seq);
      pending.set(seq, { kind, atMs });
    },

    acked(seq, status, atMs) {
      if (!Number.isFinite(atMs)) return;
      const entry = pending.get(seq);
      dropExpired(atMs);
      if (entry === undefined) return;
      pending.delete(seq);
      if (status !== 'applied') return;
      const interval = atMs - entry.atMs;
      if (!isValidInterval(interval) || interval > LATENCY_PENDING_TIMEOUT_MS) return;
      addSample(entry.kind, interval);
    },

    renderDelay(ms) {
      if (!isValidInterval(ms)) return;
      addSample('render', ms);
    },

    summary() {
      return {
        steer: stats(samples.steer),
        charge: stats(samples.charge),
        ability: stats(samples.ability),
        render: stats(samples.render),
      };
    },

    reset() {
      pending.clear();
      for (const list of Object.values(samples)) list.length = 0;
    },
  };
}
