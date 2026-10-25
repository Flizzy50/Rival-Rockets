import { PREVIEW_ARENA_HEIGHT, PREVIEW_ARENA_WIDTH, PREVIEW_ROCKET_LENGTH } from '../../shared/config';
import type { Ability } from '../../shared/rules/abilities';
import type { RocketPose } from '../../shared/rules/physics';
import { CANVAS_MAX_DPR, color, MIN_ROCKET_CSS_PX, STAR_COUNT } from '../../shared/tokens';
import type { PreviewRocket } from '../preview/rocket-preview';
import {
  arrowheadPoints,
  chevronPoints,
  effectAlpha,
  hexagonPoints,
  shieldRadius,
  speedLines,
  TRAIL_CHEVRON_COUNT,
  trailChevrons,
  type Point,
} from './arena-geometry';

// Arena (PRD 7.2, 7.4, 7.8, 7.11): the 600x800 logical arena is letterboxed
// into its box, never cropped. Stars and the rocket glow are rendered once
// into offscreen layers, so the rocket itself is a drawImage call and no frame
// uses shadowBlur. Trails and effects are plain strokes drawn per frame.

// Glow margin around the sprite, relative to rocket length.
const GLOW_RATIO = 0.35;
// Star look in CSS px and alpha; positions come from the R2 low-discrepancy
// sequence so the field is sparse, even, and identical on every load.
const STAR_MIN_RADIUS_PX = 0.6;
const STAR_RADIUS_RANGE_PX = 0.8;
const STAR_MIN_ALPHA = 0.3;
const STAR_ALPHA_RANGE = 0.5;
const PLASTIC_NUMBER = 1.324717957244746;
const R2_STEP_X = 1 / PLASTIC_NUMBER;
const R2_STEP_Y = 1 / (PLASTIC_NUMBER * PLASTIC_NUMBER);
const R2_OFFSET = 0.5;
// Stroke widths in CSS px. The shield halo is one wide, faint duplicate
// stroke under the outline: the PRD 7.2 cheap glow instead of shadowBlur.
const TRAIL_LINE_PX = 2;
const SPEED_LINE_PX = 1.5;
const SPEED_LINE_ALPHA = 0.7;
const SHIELD_LINE_PX = 2;
const SHIELD_HALO_PX = 6;
const SHIELD_HALO_ALPHA = 0.25;
const SHIELD_FILL_ALPHA = 0.08;

// Field names match PublicCrewState, so a match.state crew can be passed as is.
export interface RocketEffects {
  readonly active: Ability | null;
  // When supplied, the effect flickers during its final EFFECT_FLICKER_MS.
  readonly effectRemainingMs?: number;
}

export interface ArenaCanvas {
  // M1 sensor test preview: the rocket alone, as before.
  draw(rocket: PreviewRocket): void;
  // M2: a server pose with its Comet chevron trail and optional ability effect.
  drawPose(pose: RocketPose, effects?: RocketEffects): void;
  // Empty arena while no control test runs.
  drawEmpty(): void;
  destroy(): void;
}

interface Fit {
  readonly dpr: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function createLayer(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.ceil(width));
  layer.height = Math.max(1, Math.ceil(height));
  const context = layer.getContext('2d');
  return context ? [layer, context] : null;
}

function tracePolyline(context: CanvasRenderingContext2D, points: readonly Point[], close: boolean): void {
  context.beginPath();
  points.forEach((p, i) => {
    if (i === 0) context.moveTo(p.x, p.y);
    else context.lineTo(p.x, p.y);
  });
  if (close) context.closePath();
}

function prefersReducedMotion(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
}

export function createArenaCanvas(container: HTMLElement): ArenaCanvas {
  const canvas = document.createElement('canvas');
  canvas.className = 'arena-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  const context = canvas.getContext('2d');
  const reducedMotion = prefersReducedMotion();

  let fit: Fit = { dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };
  let background: HTMLCanvasElement | null = null;
  let sprite: HTMLCanvasElement | null = null;
  let spriteSize = 0;
  let rocketLengthPx = 0;

  function renderBackground(): void {
    const layer = createLayer(canvas.width, canvas.height);
    if (!layer) return;
    const [bg, g] = layer;
    const arenaW = PREVIEW_ARENA_WIDTH * fit.scale * fit.dpr;
    const arenaH = PREVIEW_ARENA_HEIGHT * fit.scale * fit.dpr;
    const left = fit.offsetX * fit.dpr;
    const top = fit.offsetY * fit.dpr;
    // Letterbox bars use the panel color so the uncropped arena edge is visible.
    g.fillStyle = color('bg-surface');
    g.fillRect(0, 0, bg.width, bg.height);
    g.fillStyle = color('bg-space');
    g.fillRect(left, top, arenaW, arenaH);
    g.fillStyle = color('text-secondary');
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const x = left + fract(R2_OFFSET + R2_STEP_X * (i + 1)) * arenaW;
      const y = top + fract(R2_OFFSET + R2_STEP_Y * (i + 1)) * arenaH;
      const sizeT = fract(R2_STEP_X * (i + 1) * (i + 1));
      g.globalAlpha = STAR_MIN_ALPHA + STAR_ALPHA_RANGE * fract(R2_STEP_Y * (i + 1) * (i + 1));
      g.beginPath();
      g.arc(x, y, (STAR_MIN_RADIUS_PX + STAR_RADIUS_RANGE_PX * sizeT) * fit.dpr, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    background = bg;
  }

  function renderSprite(): void {
    rocketLengthPx = Math.max(PREVIEW_ROCKET_LENGTH * fit.scale, MIN_ROCKET_CSS_PX) * fit.dpr;
    const glow = rocketLengthPx * GLOW_RATIO;
    spriteSize = Math.ceil(rocketLengthPx + glow * 2);
    const layer = createLayer(spriteSize, spriteSize);
    if (!layer) return;
    const [sp, g] = layer;
    g.translate(spriteSize / 2, spriteSize / 2);
    // shadowBlur runs once here, when the sprite is built, not every frame.
    g.shadowColor = color('team-comet');
    g.shadowBlur = glow;
    g.fillStyle = color('team-comet');
    tracePolyline(g, arrowheadPoints(rocketLengthPx), true);
    g.fill();
    sprite = sp;
  }

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, CANVAS_MAX_DPR);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const scale = Math.min(width / PREVIEW_ARENA_WIDTH, height / PREVIEW_ARENA_HEIGHT);
    fit = {
      dpr,
      scale,
      offsetX: (width - PREVIEW_ARENA_WIDTH * scale) / 2,
      offsetY: (height - PREVIEW_ARENA_HEIGHT * scale) / 2,
    };
    renderBackground();
    renderSprite();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // Context is translated to the rocket center and rotated to its heading.
  // boostAlpha scales only the boost additions (extra chevrons, speed lines),
  // so the base trail stays steady: it is team identity, not an effect.
  function drawTrail(g: CanvasRenderingContext2D, boostAlpha: number): void {
    const boosted = boostAlpha > 0;
    g.strokeStyle = color('team-comet');
    g.lineWidth = TRAIL_LINE_PX * fit.dpr;
    g.lineJoin = 'miter';
    trailChevrons(rocketLengthPx, boosted).forEach((chevron, i) => {
      g.globalAlpha = chevron.alpha * (i < TRAIL_CHEVRON_COUNT ? 1 : boostAlpha);
      tracePolyline(g, chevronPoints(chevron), false);
      g.stroke();
    });
    if (boosted) {
      g.globalAlpha = SPEED_LINE_ALPHA * boostAlpha;
      g.strokeStyle = color('text-primary');
      g.lineWidth = SPEED_LINE_PX * fit.dpr;
      for (const line of speedLines(rocketLengthPx)) {
        g.beginPath();
        g.moveTo(line.from.x, line.from.y);
        g.lineTo(line.to.x, line.to.y);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  function drawShield(g: CanvasRenderingContext2D, alpha: number): void {
    const hexagon = hexagonPoints(shieldRadius(rocketLengthPx));
    g.strokeStyle = color('shield');
    g.fillStyle = color('shield');
    g.lineJoin = 'round';
    tracePolyline(g, hexagon, true);
    g.globalAlpha = alpha * SHIELD_FILL_ALPHA;
    g.fill();
    g.globalAlpha = alpha * SHIELD_HALO_ALPHA;
    g.lineWidth = SHIELD_HALO_PX * fit.dpr;
    g.stroke();
    g.globalAlpha = alpha;
    g.lineWidth = SHIELD_LINE_PX * fit.dpr;
    g.stroke();
    g.globalAlpha = 1;
  }

  // Shared by both draw paths so the M1 preview keeps its exact output: with
  // no trail requested, only the background and the sprite are drawn.
  function render(x: number, y: number, heading: number, withTrail: boolean, effects?: RocketEffects): void {
    if (!context || !background || !sprite) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(background, 0, 0);
    const left = fit.offsetX * fit.dpr;
    const top = fit.offsetY * fit.dpr;
    const k = fit.scale * fit.dpr;
    context.save();
    // Clip to the arena so a rocket, trail, or shield past an edge never
    // draws in the letterbox bars.
    context.beginPath();
    context.rect(left, top, PREVIEW_ARENA_WIDTH * k, PREVIEW_ARENA_HEIGHT * k);
    context.clip();
    context.translate(left + x * k, top + y * k);
    context.rotate(heading);

    const active = effects?.active ?? null;
    const alpha = active ? effectAlpha(effects?.effectRemainingMs, reducedMotion?.matches ?? false) : 0;
    if (withTrail) drawTrail(context, active === 'boost' ? alpha : 0);
    context.drawImage(sprite, -spriteSize / 2, -spriteSize / 2);
    if (active === 'shield' && alpha > 0) drawShield(context, alpha);
    context.restore();
  }

  return {
    draw(rocket) {
      render(rocket.x, rocket.y, rocket.headingRad, false);
    },
    drawPose(pose, effects) {
      render(pose.x, pose.y, pose.heading, true, effects);
    },
    drawEmpty() {
      if (!context || !background) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(background, 0, 0);
    },
    destroy() {
      observer.disconnect();
      canvas.remove();
    },
  };
}
