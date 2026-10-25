import { describe, expect, it } from 'vitest';
import { EFFECT_FLICKER_MS, GATE_PULSE_PERIOD_MS } from '../../shared/tokens';
import {
  burstRays,
  effectProgress,
  GATE_PULSE_MAX_ALPHA,
  GATE_PULSE_MIN_ALPHA,
  gatePulseAlpha,
  wallContact,
  chaseArena,
  fitArena,
  arrowheadPoints,
  BOOST_TRAIL_MULTIPLIER,
  boundsOf,
  chevronPoints,
  effectAlpha,
  FLICKER_MIN_ALPHA,
  hexagonPoints,
  shieldRadius,
  speedLines,
  TRAIL_CHEVRON_COUNT,
  trailChevrons,
  trailLength,
} from './arena-geometry';

const LENGTH = 48;

describe('arrowheadPoints', () => {
  it('keeps the M1 delta-wing shape: nose at +x, notched tail', () => {
    expect(arrowheadPoints(LENGTH)).toEqual([
      { x: 24, y: 0 },
      { x: -24, y: -18 },
      { x: -12, y: 0 },
      { x: -24, y: 18 },
    ]);
  });
});

describe('trail', () => {
  it('doubles the trail length when boosted', () => {
    expect(trailLength(LENGTH, true)).toBe(trailLength(LENGTH, false) * BOOST_TRAIL_MULTIPLIER);
  });

  it('adds chevrons behind the normal trail without moving the normal ones', () => {
    const normal = trailChevrons(LENGTH, false);
    const boosted = trailChevrons(LENGTH, true);
    expect(normal).toHaveLength(TRAIL_CHEVRON_COUNT);
    expect(boosted).toHaveLength(TRAIL_CHEVRON_COUNT * BOOST_TRAIL_MULTIPLIER);
    expect(boosted.slice(0, normal.length)).toEqual(normal);
  });

  it('keeps every chevron behind the tail and within the trail length', () => {
    for (const boosted of [false, true]) {
      const tail = -LENGTH / 2;
      const bounds = boundsOf(trailChevrons(LENGTH, boosted).flatMap(chevronPoints));
      expect(bounds.maxX).toBeLessThanOrEqual(tail);
      expect(bounds.minX).toBeGreaterThanOrEqual(tail - trailLength(LENGTH, boosted) - 1e-9);
    }
  });

  it('fades chevrons further back but never hides them', () => {
    const alphas = trailChevrons(LENGTH, true).map((c) => c.alpha);
    alphas.slice(1).forEach((alpha, i) => expect(alpha).toBeLessThanOrEqual(alphas[i] ?? 1));
    expect(Math.min(...alphas)).toBeGreaterThan(0);
  });

  it('places speed lines in mirrored pairs outside the wings', () => {
    const lines = speedLines(LENGTH);
    const wing = Math.max(...arrowheadPoints(LENGTH).map((p) => Math.abs(p.y)));
    expect(lines.length % 2).toBe(0);
    for (const line of lines) {
      expect(line.from.y).toBe(line.to.y);
      expect(Math.abs(line.from.y)).toBeGreaterThan(wing);
      expect(lines.some((other) => other.from.y === -line.from.y && other.from.x === line.from.x)).toBe(true);
    }
  });
});

describe('shield hexagon', () => {
  it('has six vertices on the shield radius', () => {
    const radius = shieldRadius(LENGTH);
    const points = hexagonPoints(radius);
    expect(points).toHaveLength(6);
    for (const p of points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(radius, 9);
  });

  it('clears the whole rocket silhouette', () => {
    // A regular hexagon's inner radius is cos(30 deg) of its outer radius.
    const inner = shieldRadius(LENGTH) * Math.cos(Math.PI / 6);
    for (const p of arrowheadPoints(LENGTH)) expect(Math.hypot(p.x, p.y)).toBeLessThan(inner);
  });
});

describe('effectAlpha', () => {
  it('shows the effect in full when no remaining time is supplied', () => {
    expect(effectAlpha(undefined)).toBe(1);
  });

  it('is fully visible at the start and until the final window', () => {
    expect(effectAlpha(2000)).toBe(1);
    expect(effectAlpha(EFFECT_FLICKER_MS)).toBe(1);
  });

  it('flickers between the minimum and full opacity in the final window', () => {
    const samples = Array.from({ length: EFFECT_FLICKER_MS - 1 }, (_, i) => effectAlpha(i + 1));
    expect(Math.min(...samples)).toBeCloseTo(FLICKER_MIN_ALPHA, 2);
    expect(Math.max(...samples)).toBeCloseTo(1, 2);
    for (const a of samples) {
      expect(a).toBeGreaterThanOrEqual(FLICKER_MIN_ALPHA);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('hides an effect that has ended or has a bad remaining time', () => {
    expect(effectAlpha(0)).toBe(0);
    expect(effectAlpha(-5)).toBe(0);
    expect(effectAlpha(Number.NaN)).toBe(0);
  });
});

describe('camera fits', () => {
  it('letterboxes the whole arena inside the box', () => {
    for (const [w, h] of [
      [358, 430],
      [300, 800],
      [1000, 500],
    ] as const) {
      const f = fitArena(w, h, 600, 800);
      expect(f.offsetX).toBeGreaterThanOrEqual(0);
      expect(f.offsetY).toBeGreaterThanOrEqual(0);
      expect(f.offsetX * 2 + 600 * f.scale).toBeCloseTo(w);
      expect(f.offsetY * 2 + 800 * f.scale).toBeCloseTo(h);
    }
  });

  it('keeps the followed height at the anchor and fills the width', () => {
    for (const y of [18, 78, 400, 782]) {
      const f = chaseArena(358, 430, 600, y, 0.5);
      expect(f.offsetX).toBe(0);
      expect(600 * f.scale).toBeCloseTo(358);
      expect(f.offsetY + y * f.scale).toBeCloseTo(215);
    }
  });

  it('holds the anchor for a non-finite height', () => {
    expect(chaseArena(358, 430, 600, Number.NaN, 0.5).offsetY).toBe(215);
  });
});

describe('event effect geometry', () => {
  it('spreads burst rays evenly between the two radii', () => {
    const rays = burstRays(8, 10, 40);
    expect(rays).toHaveLength(8);
    for (const ray of rays) {
      expect(Math.hypot(ray.from.x, ray.from.y)).toBeCloseTo(10, 9);
      expect(Math.hypot(ray.to.x, ray.to.y)).toBeCloseTo(40, 9);
    }
    const angles = rays.map((r) => Math.atan2(r.to.y, r.to.x));
    expect(Math.abs(angles[1]! - angles[0]!)).toBeCloseTo(Math.PI / 4, 9);
  });

  it('finds the wall a rocket touches on the outer and inner walls', () => {
    // Top straight of the outer wall (y = 24): the rocket center sits 18 below it.
    const top = wallContact({ x: 300, y: 42 });
    expect(top.point.x).toBeCloseTo(300, 9);
    expect(top.point.y).toBeCloseTo(24, 9);
    expect(Math.abs(top.tangent.x)).toBeCloseTo(1, 9);
    // Left straight of the inner wall (x = 180): the rocket center sits 18 left of it.
    const inner = wallContact({ x: 162, y: 400 });
    expect(inner.point.x).toBeCloseTo(180, 9);
    expect(inner.point.y).toBeCloseTo(400, 9);
    expect(Math.abs(inner.tangent.y)).toBeCloseTo(1, 9);
  });

  it('clamps effect progress to 0..1', () => {
    expect(effectProgress(100, 50, 600)).toBe(0);
    expect(effectProgress(100, 400, 600)).toBeCloseTo(0.5);
    expect(effectProgress(100, 5000, 600)).toBe(1);
    expect(effectProgress(100, 200, 0)).toBe(1);
  });

  it('pulses the next gate within its alpha range, once per period', () => {
    const samples = Array.from({ length: GATE_PULSE_PERIOD_MS }, (_, ms) => gatePulseAlpha(ms));
    expect(Math.max(...samples)).toBeCloseTo(GATE_PULSE_MAX_ALPHA, 6);
    expect(Math.min(...samples)).toBeCloseTo(GATE_PULSE_MIN_ALPHA, 4);
    expect(gatePulseAlpha(0)).toBeCloseTo(gatePulseAlpha(GATE_PULSE_PERIOD_MS), 9);
  });
});
