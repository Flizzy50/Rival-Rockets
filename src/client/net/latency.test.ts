import { describe, expect, it } from 'vitest';
import { LATENCY_PENDING_TIMEOUT_MS, LATENCY_SAMPLE_WINDOW } from '../../shared/config';
import { createLatencyMonitor, percentile } from './latency';

const EMPTY = { count: 0, medianMs: null, p95Ms: null, maxMs: null };

describe('percentile', () => {
  it('uses nearest rank on known data', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10..200
    expect(percentile(sorted, 50)).toBe(100);
    expect(percentile(sorted, 95)).toBe(190);
    expect(percentile(sorted, 100)).toBe(200);
    expect(percentile(sorted, 0)).toBe(10);
  });

  it('returns the only sample for a single-element set', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it('rejects an empty set and out-of-range p', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
    expect(() => percentile([1], 101)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });
});

describe('createLatencyMonitor', () => {
  it('reports nulls for every kind when empty', () => {
    expect(createLatencyMonitor().summary()).toEqual({
      steer: EMPTY,
      charge: EMPTY,
      ability: EMPTY,
      render: EMPTY,
    });
  });

  it('records send-to-applied-ack intervals per input kind', () => {
    const monitor = createLatencyMonitor();
    monitor.sent(1, 'steer', 1000);
    monitor.sent(2, 'charge', 1010);
    monitor.sent(3, 'ability', 1020);
    monitor.acked(1, 'applied', 1040);
    monitor.acked(2, 'applied', 1070);
    monitor.acked(3, 'applied', 1110);

    const summary = monitor.summary();
    expect(summary.steer).toEqual({ count: 1, medianMs: 40, p95Ms: 40, maxMs: 40 });
    expect(summary.charge).toEqual({ count: 1, medianMs: 60, p95Ms: 60, maxMs: 60 });
    expect(summary.ability).toEqual({ count: 1, medianMs: 90, p95Ms: 90, maxMs: 90 });
    expect(summary.render).toEqual(EMPTY);
  });

  it('adds no sample for a rejected ack, and a later applied ack for that seq is ignored', () => {
    const monitor = createLatencyMonitor();
    monitor.sent(7, 'ability', 0);
    monitor.acked(7, 'rejected', 30);
    monitor.acked(7, 'applied', 40);
    expect(monitor.summary().ability).toEqual(EMPTY);
  });

  it('ignores acks for unknown seqs and duplicate acks', () => {
    const monitor = createLatencyMonitor();
    monitor.acked(99, 'applied', 50);
    monitor.sent(1, 'steer', 0);
    monitor.acked(1, 'applied', 20);
    monitor.acked(1, 'applied', 80);
    expect(monitor.summary().steer).toEqual({ count: 1, medianMs: 20, p95Ms: 20, maxMs: 20 });
  });

  it('drops pending sends older than the timeout', () => {
    const monitor = createLatencyMonitor();
    monitor.sent(1, 'steer', 0);
    monitor.acked(1, 'applied', LATENCY_PENDING_TIMEOUT_MS + 1);

    // Expired entries are also pruned by later sends, before their ack arrives.
    monitor.sent(2, 'charge', 0);
    monitor.sent(3, 'charge', LATENCY_PENDING_TIMEOUT_MS + 10);
    monitor.acked(2, 'applied', LATENCY_PENDING_TIMEOUT_MS + 20);
    monitor.acked(3, 'applied', LATENCY_PENDING_TIMEOUT_MS + 40);

    const summary = monitor.summary();
    expect(summary.steer).toEqual(EMPTY);
    expect(summary.charge).toEqual({ count: 1, medianMs: 30, p95Ms: 30, maxMs: 30 });
  });

  it('ignores negative and non-finite intervals', () => {
    const monitor = createLatencyMonitor();
    monitor.sent(1, 'steer', 100);
    monitor.acked(1, 'applied', 50);
    monitor.sent(2, 'steer', Number.NaN);
    monitor.acked(2, 'applied', 10);
    monitor.renderDelay(-1);
    monitor.renderDelay(Number.POSITIVE_INFINITY);
    monitor.renderDelay(Number.NaN);

    const summary = monitor.summary();
    expect(summary.steer).toEqual(EMPTY);
    expect(summary.render).toEqual(EMPTY);
  });

  it('keeps only the latest window of samples', () => {
    const monitor = createLatencyMonitor(3);
    [10, 20, 30, 40, 50].forEach((delay, seq) => {
      monitor.sent(seq, 'steer', 0);
      monitor.acked(seq, 'applied', delay);
    });
    expect(monitor.summary().steer).toEqual({ count: 3, medianMs: 40, p95Ms: 50, maxMs: 50 });
  });

  it('defaults to the shared window size', () => {
    const monitor = createLatencyMonitor();
    for (let i = 0; i < LATENCY_SAMPLE_WINDOW + 5; i += 1) monitor.renderDelay(i);
    expect(monitor.summary().render.count).toBe(LATENCY_SAMPLE_WINDOW);
  });

  it('reports render delay separately with ordered statistics', () => {
    const monitor = createLatencyMonitor();
    for (let ms = 1; ms <= 20; ms += 1) monitor.renderDelay(ms * 5);
    const render = monitor.summary().render;
    expect(render).toEqual({ count: 20, medianMs: 50, p95Ms: 95, maxMs: 100 });
    expect(monitor.summary().steer).toEqual(EMPTY);
  });

  it('summary holds numbers and nulls only', () => {
    const monitor = createLatencyMonitor();
    monitor.sent(1, 'steer', 0);
    monitor.acked(1, 'applied', 12);
    monitor.renderDelay(30);
    for (const stats of Object.values(monitor.summary())) {
      for (const value of Object.values(stats)) {
        expect(value === null || typeof value === 'number').toBe(true);
      }
    }
  });

  it('reset clears samples and pending sends', () => {
    const monitor = createLatencyMonitor();
    monitor.sent(1, 'steer', 0);
    monitor.acked(1, 'applied', 10);
    monitor.sent(2, 'charge', 0);
    monitor.renderDelay(25);
    monitor.reset();
    monitor.acked(2, 'applied', 15);
    expect(monitor.summary()).toEqual({
      steer: EMPTY,
      charge: EMPTY,
      ability: EMPTY,
      render: EMPTY,
    });
  });

  it('rejects an invalid window size', () => {
    expect(() => createLatencyMonitor(0)).toThrow(RangeError);
    expect(() => createLatencyMonitor(1.5)).toThrow(RangeError);
  });
});
