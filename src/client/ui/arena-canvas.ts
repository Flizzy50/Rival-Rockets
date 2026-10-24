import { PREVIEW_ARENA_HEIGHT, PREVIEW_ARENA_WIDTH, PREVIEW_ROCKET_LENGTH } from '../../shared/config';
import { CANVAS_MAX_DPR, color, MIN_ROCKET_CSS_PX, STAR_COUNT } from '../../shared/tokens';
import type { PreviewRocket } from '../preview/rocket-preview';

// Pilot test arena (PRD 7.2, 7.4, 7.11): the 600x800 logical arena is
// letterboxed into its box, never cropped. Stars and the rocket glow are
// rendered once into offscreen layers, so a frame is two drawImage calls and
// never uses per-frame shadowBlur.

// Delta-wing proportions relative to rocket length.
const WING_SPAN = 0.75;
const TAIL_NOTCH = 0.25;
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

export interface ArenaCanvas {
  draw(rocket: PreviewRocket): void;
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

function traceArrowhead(context: CanvasRenderingContext2D, length: number): void {
  const half = length / 2;
  const wing = (length * WING_SPAN) / 2;
  context.beginPath();
  context.moveTo(half, 0);
  context.lineTo(-half, -wing);
  context.lineTo(-half + length * TAIL_NOTCH, 0);
  context.lineTo(-half, wing);
  context.closePath();
}

export function createArenaCanvas(container: HTMLElement): ArenaCanvas {
  const canvas = document.createElement('canvas');
  canvas.className = 'arena-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  const context = canvas.getContext('2d');

  let fit: Fit = { dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };
  let background: HTMLCanvasElement | null = null;
  let sprite: HTMLCanvasElement | null = null;
  let spriteSize = 0;

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
    const lengthPx = Math.max(PREVIEW_ROCKET_LENGTH * fit.scale, MIN_ROCKET_CSS_PX) * fit.dpr;
    const glow = lengthPx * GLOW_RATIO;
    spriteSize = Math.ceil(lengthPx + glow * 2);
    const layer = createLayer(spriteSize, spriteSize);
    if (!layer) return;
    const [sp, g] = layer;
    g.translate(spriteSize / 2, spriteSize / 2);
    // shadowBlur runs once here, when the sprite is built, not every frame.
    g.shadowColor = color('team-comet');
    g.shadowBlur = glow;
    g.fillStyle = color('team-comet');
    traceArrowhead(g, lengthPx);
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

  return {
    draw(rocket) {
      if (!context || !background || !sprite) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(background, 0, 0);
      const left = fit.offsetX * fit.dpr;
      const top = fit.offsetY * fit.dpr;
      const k = fit.scale * fit.dpr;
      context.save();
      // Clip to the arena so a rocket wrapping past an edge never draws in
      // the letterbox bars.
      context.beginPath();
      context.rect(left, top, PREVIEW_ARENA_WIDTH * k, PREVIEW_ARENA_HEIGHT * k);
      context.clip();
      context.translate(left + rocket.x * k, top + rocket.y * k);
      context.rotate(rocket.headingRad);
      context.drawImage(sprite, -spriteSize / 2, -spriteSize / 2);
      context.restore();
    },
    destroy() {
      observer.disconnect();
      canvas.remove();
    },
  };
}
