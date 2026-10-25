import { CORE_DIAMETER, CORE_SPAWNS, DROPPED_CORE_LIFETIME_MS, INNER_WALL, OUTER_WALL, PRACTICE_RINGS, PRACTICE_RING_RADIUS, PREVIEW_ARENA_HEIGHT, PREVIEW_ARENA_WIDTH, PREVIEW_ROCKET_LENGTH, ROCKET_RADIUS, START_LANES } from '../../shared/config';
import { GATES } from '../../shared/course';
import type { MatchSnapshotMessage, TeamId } from '../../shared/protocol';
import type { Ability } from '../../shared/rules/abilities';
import type { RocketPose } from '../../shared/rules/physics';
import { CAMERA_ANCHOR_Y, CANVAS_MAX_DPR, color, MIN_ROCKET_CSS_PX, STAR_COUNT, MIN_CORE_CSS_PX, YOU_TAG_MS, OWN_HALO_PX, EDGE_MARKER_SIZE_PX, EDGE_MARKER_INSET_PX, FONT_BODY } from '../../shared/tokens';
import type { PreviewRocket } from '../preview/rocket-preview';
import {
  arrowheadPoints,
  chaseArena,
  chevronPoints,
  effectAlpha,
  fitArena,
  hexagonPoints,
  shieldRadius,
  speedLines,
  TRAIL_CHEVRON_COUNT,
  trailChevrons,
  type Point,
  type ViewFit,
  NOVA_BODY_HEIGHT, NOVA_FIN_SPAN, NOVA_FIN_LENGTH, NOVA_DOT_RADIUS, CORE_RING_RATIO, OWN_HALO_RATIO, LABEL_OFFSET_RATIO, GATE_LINE_PX, GATE_DASH_PX, edgeMarkers, type MarkerObject,
} from './arena-geometry';

// Arena (PRD 7.2, 7.4, 7.6, 7.8, 7.11). Two cameras:
// - fixed: the 600x800 logical arena letterboxed into its box, never cropped
//   (Watch view, sensor test, and reduced motion);
// - chase: the arena width fills the box and the arena slides vertically so
//   the followed rocket stays at CAMERA_ANCHOR_Y; flying up or down moves the
//   starfield past a rocket that holds its height on screen.
// The arena and its stars are rendered once into an offscreen layer, and the
// rocket glow into a sprite, so a frame is a fill and a few drawImage calls
// and no frame uses shadowBlur.

export type CameraMode = 'fixed' | 'chase';

export interface ArenaCanvasOptions {
  readonly camera?: CameraMode;
}

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
// Chase only: the arena edge scrolls with the stars, so it is drawn as a wall
// line to keep the playable area obvious (PRD 7.2).
const EDGE_LINE_PX = 2;

// Field names match PublicCrewState, so a match.state crew can be passed as is.
export interface RocketEffects {
  readonly active: Ability | null;
  // When supplied, the effect flickers during its final EFFECT_FLICKER_MS.
  readonly effectRemainingMs?: number;
}

export interface ArenaCanvas {
  drawMatch(snapshot: MatchSnapshotMessage, poses: Readonly<Record<TeamId, RocketPose>>, ownTeam: TeamId | null): void;
  drawPractice(pose: RocketPose, ringsDone: number): void;
  // M1 sensor test preview: the rocket alone, as before.
  draw(rocket: PreviewRocket): void;
  // M2: a server pose with its Comet chevron trail and optional ability effect.
  drawPose(pose: RocketPose, effects?: RocketEffects): void;
  // Empty arena while no control test runs; the chase camera holds its last height.
  drawEmpty(): void;
  destroy(): void;
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

export function createArenaCanvas(container: HTMLElement, options: ArenaCanvasOptions = {}): ArenaCanvas {
  const canvas = document.createElement('canvas');
  canvas.className = 'arena-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  const context = canvas.getContext('2d');
  const reducedMotion = prefersReducedMotion();

  let boxW = 0;
  let boxH = 0;
  let dpr = 1;
  let fixedFit: ViewFit = { scale: 1, offsetX: 0, offsetY: 0 };
  let arenaLayer: HTMLCanvasElement | null = null;
  let sprite: HTMLCanvasElement | null = null;
  let novaSprite: HTMLCanvasElement | null = null;
  let spriteSize = 0;
  let rocketLengthPx = 0;
  // Where the chase camera looks while nothing is flying: the start lane.
  let focusY: number = START_LANES.comet.y;

  // A scrolling view is the kind of motion reduced-motion users opt out of,
  // so they get the full fixed course instead (PRD 7.8). Gameplay is the same.
  function chasing(): boolean {
    return options.camera === 'chase' && !(reducedMotion?.matches ?? false);
  }

  function viewScale(): number {
    return chasing() ? chaseArena(boxW, boxH, PREVIEW_ARENA_WIDTH, 0, CAMERA_ANCHOR_Y).scale : fixedFit.scale;
  }

  function currentFit(): ViewFit {
    return chasing() ? chaseArena(boxW, boxH, PREVIEW_ARENA_WIDTH, focusY, CAMERA_ANCHOR_Y) : fixedFit;
  }

  function renderArenaLayer(scale: number): void {
    const arenaW = PREVIEW_ARENA_WIDTH * scale * dpr;
    const arenaH = PREVIEW_ARENA_HEIGHT * scale * dpr;
    const layer = createLayer(arenaW, arenaH);
    if (!layer) return;
    const [bg, g] = layer;
    g.fillStyle = color('bg-space');
    g.fillRect(0, 0, arenaW, arenaH);
    g.fillStyle = color('text-secondary');
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const x = fract(R2_OFFSET + R2_STEP_X * (i + 1)) * arenaW;
      const y = fract(R2_OFFSET + R2_STEP_Y * (i + 1)) * arenaH;
      const sizeT = fract(R2_STEP_X * (i + 1) * (i + 1));
      g.globalAlpha = STAR_MIN_ALPHA + STAR_ALPHA_RANGE * fract(R2_STEP_Y * (i + 1) * (i + 1));
      g.beginPath();
      g.arc(x, y, (STAR_MIN_RADIUS_PX + STAR_RADIUS_RANGE_PX * sizeT) * dpr, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    const k = scale * dpr;
    for (const [r, fill] of [[OUTER_WALL, 'bg-track'], [INNER_WALL, 'bg-space']] as const) {
      g.beginPath();
      g.roundRect(r.minX * k, r.minY * k, (r.maxX - r.minX) * k, (r.maxY - r.minY) * k, r.radius * k);
      g.fillStyle = color(fill);
      g.fill();
      g.strokeStyle = color('line-wall');
      g.lineWidth = EDGE_LINE_PX * dpr;
      g.stroke();
    }
    arenaLayer = bg;
  }

  function renderSprite(scale: number): void {
    rocketLengthPx = Math.max(PREVIEW_ROCKET_LENGTH * scale, MIN_ROCKET_CSS_PX) * dpr;
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
    const nova = createLayer(spriteSize, spriteSize);
    if (nova) {
      const [ns, ng] = nova;
      const len = rocketLengthPx, height = len * NOVA_BODY_HEIGHT;
      ng.translate(spriteSize / 2, spriteSize / 2);
      ng.fillStyle = color('team-nova');
      ng.shadowColor = color('team-nova');
      ng.shadowBlur = glow;
      ng.beginPath();
      ng.roundRect(-len / 2, -height / 2, len, height, height / 2);
      ng.fill();
      for (const sign of [-1, 1]) {
        tracePolyline(ng, [{ x: -len / 2, y: 0 }, { x: -len / 2, y: sign * len * NOVA_FIN_SPAN / 2 }, { x: -len / 2 + len * NOVA_FIN_LENGTH, y: sign * height / 2 }], true);
        ng.fill();
      }
      novaSprite = ns;
    }
  }

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    dpr = Math.min(window.devicePixelRatio || 1, CANVAS_MAX_DPR);
    boxW = width;
    boxH = height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    fixedFit = fitArena(width, height, PREVIEW_ARENA_WIDTH, PREVIEW_ARENA_HEIGHT);
    const scale = viewScale();
    renderArenaLayer(scale);
    renderSprite(scale);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  // Switching reduced motion swaps cameras, which changes the scale.
  reducedMotion?.addEventListener('change', resize);
  resize();

  // Context is translated to the rocket center and rotated to its heading.
  // boostAlpha scales only the boost additions (extra chevrons, speed lines),
  // so the base trail stays steady: it is team identity, not an effect.
  function drawTrail(g: CanvasRenderingContext2D, boostAlpha: number, team: TeamId = 'comet'): void {
    const boosted = boostAlpha > 0;
    g.strokeStyle = color(team === 'comet' ? 'team-comet' : 'team-nova');
    g.fillStyle = g.strokeStyle;
    g.lineWidth = TRAIL_LINE_PX * dpr;
    g.lineJoin = 'miter';
    trailChevrons(rocketLengthPx, boosted).forEach((chevron, i) => {
      g.globalAlpha = chevron.alpha * (i < TRAIL_CHEVRON_COUNT ? 1 : boostAlpha);
      if (team === 'comet') { tracePolyline(g, chevronPoints(chevron), false); g.stroke(); }
      else { g.beginPath(); g.arc(chevron.tipX, 0, rocketLengthPx * NOVA_DOT_RADIUS, 0, Math.PI * 2); g.fill(); }
    });
    if (boosted) {
      g.globalAlpha = SPEED_LINE_ALPHA * boostAlpha;
      g.strokeStyle = color('text-primary');
      g.lineWidth = SPEED_LINE_PX * dpr;
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
    g.lineWidth = SHIELD_HALO_PX * dpr;
    g.stroke();
    g.globalAlpha = alpha;
    g.lineWidth = SHIELD_LINE_PX * dpr;
    g.stroke();
    g.globalAlpha = 1;
  }

  // Letterbox or off-arena space, then the arena layer where the camera puts it.
  function drawArena(fit: ViewFit): void {
    if (!context || !arenaLayer) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = color('bg-surface');
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(arenaLayer, fit.offsetX * dpr, fit.offsetY * dpr);
  }

  // Shared by both draw paths so the M1 preview keeps its output: with no
  // trail requested, only the arena and the sprite are drawn.
  function render(x: number, y: number, heading: number, withTrail: boolean, effects?: RocketEffects): void {
    if (!context || !sprite) return;
    if (Number.isFinite(y)) focusY = y;
    const fit = currentFit();
    drawArena(fit);
    drawRocket({ x, y, heading }, fit, withTrail, effects, 'comet');
  }

  function drawRocket(pose: RocketPose, fit: ViewFit, withTrail: boolean, effects: RocketEffects | undefined, team: TeamId): void {
    if (!context || !sprite) return;
    const left = fit.offsetX * dpr;
    const top = fit.offsetY * dpr;
    const k = fit.scale * dpr;
    context.save();
    // Clip to the arena so a rocket, trail, or shield past an edge never
    // draws outside the playable area.
    context.beginPath();
    context.rect(left, top, PREVIEW_ARENA_WIDTH * k, PREVIEW_ARENA_HEIGHT * k);
    context.clip();
    context.translate(left + pose.x * k, top + pose.y * k);
    context.rotate(pose.heading);

    const active = effects?.active ?? null;
    const alpha = active ? effectAlpha(effects?.effectRemainingMs, reducedMotion?.matches ?? false) : 0;
    if (withTrail) drawTrail(context, active === 'boost' ? alpha : 0, team);
    context.drawImage(team === 'nova' && novaSprite ? novaSprite : sprite, -spriteSize / 2, -spriteSize / 2);
    if (active === 'shield' && alpha > 0) drawShield(context, alpha);
    context.restore();
  }

  return {
    drawMatch(snapshot, poses, ownTeam) {
      if (!context) return;
      const g = context;
      focusY = poses[ownTeam ?? 'comet'].y;
      const fit = currentFit(), k = fit.scale * dpr;
      const x = (v: number) => (fit.offsetX + v * fit.scale) * dpr;
      const y = (v: number) => (fit.offsetY + v * fit.scale) * dpr;
      drawArena(fit);
      g.save();
      g.beginPath(); g.rect(x(0), y(0), PREVIEW_ARENA_WIDTH * k, PREVIEW_ARENA_HEIGHT * k); g.clip();
      g.lineWidth = GATE_LINE_PX * dpr;
      g.font = `${EDGE_MARKER_SIZE_PX * dpr}px ${FONT_BODY}`;
      const markers: MarkerObject[] = [];
      GATES.forEach((gate, index) => {
        const teams = (['comet', 'nova'] as const).filter((t) => (ownTeam === null || ownTeam === t) && snapshot.crews[t].nextGate === index);
        g.strokeStyle = color(teams.length ? 'gate-next' : 'gate-idle');
        g.setLineDash(teams.length ? [] : [GATE_DASH_PX * dpr]);
        g.beginPath(); g.moveTo(x(gate.a.x), y(gate.a.y)); g.lineTo(x(gate.b.x), y(gate.b.y)); g.stroke();
        g.setLineDash([]);
        g.fillStyle = color('text-primary');
        if (teams.length) g.fillText(teams.map((t) => t === 'comet' ? '▲' : '●').join(' '), x((gate.a.x + gate.b.x) / 2), y((gate.a.y + gate.b.y) / 2));
        if (ownTeam && teams.length) markers.push({ kind: 'gate', x: (gate.a.x + gate.b.x) / 2, minY: Math.min(gate.a.y, gate.b.y), maxY: Math.max(gate.a.y, gate.b.y) });
      });
      function core(cx: number, cy: number, life?: number, owner?: TeamId): void {
        const diameter = Math.max(CORE_DIAMETER * fit.scale, MIN_CORE_CSS_PX) * dpr;
        g.fillStyle = color('core'); g.strokeStyle = color('core');
        g.beginPath(); g.arc(x(cx), y(cy), diameter / 2, 0, Math.PI * 2); g.fill();
        if (life !== undefined) { g.beginPath(); g.arc(x(cx), y(cy), diameter * CORE_RING_RATIO, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * life / DROPPED_CORE_LIFETIME_MS); g.stroke(); }
        if (owner) { g.fillStyle = color('text-primary'); g.fillText(owner === 'comet' ? '▲' : '●', x(cx), y(cy) - diameter); }
        markers.push({ kind: 'core', x: cx, minY: cy - CORE_DIAMETER / 2, maxY: cy + CORE_DIAMETER / 2 });
      }
      snapshot.courseCores.forEach((c, i) => { const p = CORE_SPAWNS[i]; if (c.available && p) core(p.x, p.y); });
      for (const c of snapshot.droppedCores) core(c.x, c.y, c.lifeRemainingMs, c.lockRemainingMs > 0 ? c.owner : undefined);
      g.restore();
      for (const team of ['comet', 'nova'] as const) {
        const pose = poses[team];
        drawRocket(pose, fit, true, snapshot.crews[team], team);
        if (team === ownTeam) {
          g.strokeStyle = color('text-primary'); g.fillStyle = color('text-primary'); g.lineWidth = OWN_HALO_PX * dpr;
          g.beginPath(); g.arc(x(pose.x), y(pose.y), rocketLengthPx * OWN_HALO_RATIO, 0, Math.PI * 2); g.stroke();
          if (snapshot.matchMs < YOU_TAG_MS) g.fillText('YOU', x(pose.x), y(pose.y) - rocketLengthPx * LABEL_OFFSET_RATIO);
        } else if (ownTeam) markers.push({ kind: 'opponent', x: pose.x, minY: pose.y - ROCKET_RADIUS, maxY: pose.y + ROCKET_RADIUS });
      }
      if (chasing() && ownTeam) for (const marker of edgeMarkers(fit, boxW, boxH, markers)) {
        g.font = `${EDGE_MARKER_SIZE_PX * dpr}px ${FONT_BODY}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = color(marker.kind === 'core' ? 'core' : marker.kind === 'gate' ? 'gate-next' : ownTeam === 'comet' ? 'team-nova' : 'team-comet');
        const label = marker.kind === 'core' ? '○' : marker.kind === 'gate' ? '━' : ownTeam === 'comet' ? '●' : '▲';
        g.fillText(label, marker.x * dpr, (marker.edge === 'top' ? EDGE_MARKER_INSET_PX : boxH - EDGE_MARKER_INSET_PX) * dpr);
      }
      g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    },
    drawPractice(pose, ringsDone) {
      render(pose.x, pose.y, pose.heading, true);
      if (!context) return;
      const fit = currentFit();
      PRACTICE_RINGS.forEach((ring, i) => {
        context.strokeStyle = color(i === ringsDone ? 'gate-next' : 'gate-idle');
        context.lineWidth = GATE_LINE_PX * dpr;
        context.beginPath(); context.arc((ring.x * fit.scale + fit.offsetX) * dpr, (ring.y * fit.scale + fit.offsetY) * dpr, PRACTICE_RING_RADIUS * fit.scale * dpr, 0, Math.PI * 2); context.stroke();
      });
    },
    draw(rocket) {
      render(rocket.x, rocket.y, rocket.headingRad, false);
    },
    drawPose(pose, effects) {
      render(pose.x, pose.y, pose.heading, true, effects);
    },
    drawEmpty() {
      drawArena(currentFit());
    },
    destroy() {
      observer.disconnect();
      reducedMotion?.removeEventListener('change', resize);
      canvas.remove();
    },
  };
}
