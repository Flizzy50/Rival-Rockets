import { EFFECT_FLICKER_MS } from '../../shared/tokens';

// Pure drawing geometry for the arena canvas, in rocket-local pixels: the
// nose points along +x and the rocket center is the origin. Kept apart from
// the canvas calls so it can be tested in Node (PRD 7.4, 7.8).

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Segment {
  readonly from: Point;
  readonly to: Point;
}

export interface Chevron {
  // Tip of the ">" mark, on the rocket's center line.
  readonly tipX: number;
  readonly depth: number;
  readonly halfHeight: number;
  readonly alpha: number;
}

export interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

// Comet delta-wing proportions relative to rocket length (PRD 7.4).
export const WING_SPAN = 0.75;
export const TAIL_NOTCH = 0.25;

// Comet trail: chevron segments (PRD 7.4). Boost doubles its length (PRD 7.8).
export const TRAIL_LENGTH_RATIO = 1;
export const TRAIL_CHEVRON_COUNT = 4;
export const BOOST_TRAIL_MULTIPLIER = 2;
const CHEVRON_DEPTH_RATIO = 0.5;
const CHEVRON_HALF_HEIGHT_RATIO = 0.6;
// Each chevron further back is fainter, so the trail reads as motion.
const CHEVRON_ALPHA_STEP = 0.1;
const CHEVRON_MIN_ALPHA = 0.25;

// Boost speed lines: two pairs just outside the wings, behind the nose.
const SPEED_LINES = [
  { offset: 0.5, start: 0, end: -1.2 },
  { offset: 0.65, start: -0.3, end: -0.9 },
] as const;

// Shield hexagon, sized so its inner radius clears the whole silhouette.
export const SHIELD_RADIUS_RATIO = 0.75;
const HEXAGON_SIDES = 6;

// Effect flicker in the final EFFECT_FLICKER_MS (PRD 7.8). The low alpha
// matches the Activate button's flicker; reduced motion holds a steady dim
// level instead, like the button does.
export const FLICKER_MIN_ALPHA = 0.5;
export const FLICKER_CYCLES = 4;
export const REDUCED_MOTION_ENDING_ALPHA = 0.7;

export function arrowheadPoints(lengthPx: number): readonly Point[] {
  const half = lengthPx / 2;
  const wing = (lengthPx * WING_SPAN) / 2;
  return [
    { x: half, y: 0 },
    { x: -half, y: -wing },
    { x: -half + lengthPx * TAIL_NOTCH, y: 0 },
    { x: -half, y: wing },
  ];
}

export function trailLength(lengthPx: number, boosted: boolean): number {
  return lengthPx * TRAIL_LENGTH_RATIO * (boosted ? BOOST_TRAIL_MULTIPLIER : 1);
}

// Chevrons from the tail backward. The boosted list starts with the same
// chevrons as the normal one, so a boost only adds marks further back.
export function trailChevrons(lengthPx: number, boosted: boolean): readonly Chevron[] {
  const count = TRAIL_CHEVRON_COUNT * (boosted ? BOOST_TRAIL_MULTIPLIER : 1);
  const spacing = trailLength(lengthPx, boosted) / count;
  const tail = -lengthPx / 2;
  const chevrons: Chevron[] = [];
  for (let i = 0; i < count; i += 1) {
    chevrons.push({
      // The tip sits one spacing behind the previous mark so each chevron,
      // depth included, stays inside its own slot of the trail.
      tipX: tail - spacing * i,
      depth: spacing * CHEVRON_DEPTH_RATIO,
      halfHeight: spacing * CHEVRON_HALF_HEIGHT_RATIO,
      alpha: Math.max(CHEVRON_MIN_ALPHA, 1 - CHEVRON_ALPHA_STEP * i),
    });
  }
  return chevrons;
}

export function speedLines(lengthPx: number): readonly Segment[] {
  const segments: Segment[] = [];
  for (const line of SPEED_LINES) {
    for (const side of [-1, 1]) {
      const y = side * line.offset * lengthPx;
      segments.push({ from: { x: line.start * lengthPx, y }, to: { x: line.end * lengthPx, y } });
    }
  }
  return segments;
}

export function shieldRadius(lengthPx: number): number {
  return lengthPx * SHIELD_RADIUS_RATIO;
}

// Flat sides face the nose and tail, so the bubble is widest across the wings.
export function hexagonPoints(radius: number): readonly Point[] {
  const points: Point[] = [];
  for (let i = 0; i < HEXAGON_SIDES; i += 1) {
    const angle = (i * 2 * Math.PI) / HEXAGON_SIDES + Math.PI / HEXAGON_SIDES;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

export function chevronPoints(chevron: Chevron): readonly Point[] {
  return [
    { x: chevron.tipX - chevron.depth, y: -chevron.halfHeight },
    { x: chevron.tipX, y: 0 },
    { x: chevron.tipX - chevron.depth, y: chevron.halfHeight },
  ];
}

export function boundsOf(points: readonly Point[]): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return points.length === 0 ? { minX: 0, maxX: 0, minY: 0, maxY: 0 } : { minX, maxX, minY, maxY };
}

// Opacity of an active effect. Without a remaining time the effect is shown
// in full; it stays visible (never fully hidden) until the server clears it.
export function effectAlpha(remainingMs: number | undefined, reducedMotion: boolean): number {
  if (remainingMs === undefined) return 1;
  if (!(remainingMs > 0)) return 0;
  if (remainingMs >= EFFECT_FLICKER_MS) return 1;
  if (reducedMotion) return REDUCED_MOTION_ENDING_ALPHA;
  // Triangle wave from 1 down to FLICKER_MIN_ALPHA and back, starting at 1
  // when the final window opens. Driven by the remaining time, not a clock.
  const period = EFFECT_FLICKER_MS / FLICKER_CYCLES;
  const phase = ((EFFECT_FLICKER_MS - remainingMs) % period) / period;
  const dip = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return 1 - (1 - FLICKER_MIN_ALPHA) * dip;
}

// Where the arena sits in its box, in CSS px: world point (x, y) draws at
// (offsetX + x * scale, offsetY + y * scale).
export interface ViewFit {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

// Fixed view: the whole arena, letterboxed and never cropped. Used by the
// Watch view, the sensor test, and the chase camera under reduced motion.
export function fitArena(boxW: number, boxH: number, arenaW: number, arenaH: number): ViewFit {
  const scale = Math.min(boxW / arenaW, boxH / arenaH);
  return { scale, offsetX: (boxW - arenaW * scale) / 2, offsetY: (boxH - arenaH * scale) / 2 };
}

// Chase camera (PRD 7.6): the arena width fills the box, so x is never
// cropped and the rocket moves left and right on screen, while the arena
// slides vertically to keep focusY at `anchor` of the box height.
export function chaseArena(boxW: number, boxH: number, arenaW: number, focusY: number, anchor: number): ViewFit {
  const scale = boxW / arenaW;
  const y = Number.isFinite(focusY) ? focusY : 0;
  return { scale, offsetX: 0, offsetY: boxH * anchor - y * scale };
}