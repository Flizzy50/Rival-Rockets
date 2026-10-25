// The single design-token source for DOM (as CSS custom properties) and the
// canvas renderer, so the two can never drift apart (PRD 7.3, 7.11).

export const COLOR_TOKENS = {
  '--bg-space': '#0B0E1A',
  '--bg-surface': '#161B2E',
  '--bg-track': '#141A30',
  '--line-wall': '#6B76C2',
  '--gate-idle': '#5A64A0',
  '--gate-next': '#FFFFFF',
  '--text-primary': '#F2F4FF',
  '--text-secondary': '#A9B1D6',
  '--team-comet': '#FF9F1C',
  '--team-nova': '#2EC4F1',
  '--core': '#E86BFF',
  '--shield': '#E6F7FF',
  '--success': '#5BE38F',
  '--warning': '#FFC857',
  '--danger': '#FF5C6C',
} as const;

type ColorVariable = keyof typeof COLOR_TOKENS;
export type ColorName = ColorVariable extends `--${infer Name}` ? Name : never;

// Canvas cannot read CSS variables cheaply per frame, so it reads the same values here.
export function color(name: ColorName): string {
  return COLOR_TOKENS[`--${name}`];
}

export const TEAM_COMET = {
  color: COLOR_TOKENS['--team-comet'],
  glyph: '▲',
  label: 'COMET',
} as const;

export const TEAM_NOVA = {
  color: COLOR_TOKENS['--team-nova'],
  glyph: '●',
  label: 'NOVA',
} as const;

export const FONT_DISPLAY = "'Space Grotesk', system-ui, sans-serif";
export const FONT_BODY = "'Inter', system-ui, sans-serif";

// PRD 7.5 phone type scale (CSS px).
export const TYPE_SCALE = {
  title: { sizePx: 28, weight: 700 },
  button: { sizePx: 20, weight: 600 },
  body: { sizePx: 17, weight: 400 },
  caption: { sizePx: 14, weight: 400 },
} as const;

// Sizes (PRD 7.4, 7.6, 7.10, 7.11).
export const MIN_TOUCH_PX = 48;
export const TOUCH_GAP_PX = 8;
export const ACTIVATE_MIN_HEIGHT_PX = 96;
export const MIN_ROCKET_CSS_PX = 28;
export const CANVAS_MAX_DPR = 2;
// Portrait match layout: HUD bar, arena, role panel.
export const LAYOUT_FRACTIONS = { hud: 0.12, arena: 0.58, panel: 0.3 } as const;

// Feedback timings (PRD 7.7, 7.8).
export const TRANSITION_MS = 200;
export const EVENT_BURST_MAX_MS = 600;
export const SELECT_BUMP_MS = 100;
export const FAIL_NUDGE_MS = 200;
export const FAIL_REASON_MS = 1500;
export const EFFECT_FLICKER_MS = 500;
export const HINT_DURATION_MS = 5000;
export const HAPTIC_SHAKE_MS = 30;
export const STAR_COUNT = 60;

// Browser default root font size. Menu screens use rem so they follow the
// player's text-size setting (PRD 7.5, 7.10).
const REM_BASE_PX = 16;

function rem(px: number): string {
  return `${px / REM_BASE_PX}rem`;
}

export function cssVariables(): Record<string, string> {
  return {
    ...COLOR_TOKENS,
    '--font-display': FONT_DISPLAY,
    '--font-body': FONT_BODY,
    '--size-title': `${TYPE_SCALE.title.sizePx}px`,
    '--size-button': `${TYPE_SCALE.button.sizePx}px`,
    '--size-body': `${TYPE_SCALE.body.sizePx}px`,
    '--size-caption': `${TYPE_SCALE.caption.sizePx}px`,
    '--size-title-rem': rem(TYPE_SCALE.title.sizePx),
    '--size-button-rem': rem(TYPE_SCALE.button.sizePx),
    '--size-body-rem': rem(TYPE_SCALE.body.sizePx),
    '--size-caption-rem': rem(TYPE_SCALE.caption.sizePx),
    '--weight-title': String(TYPE_SCALE.title.weight),
    '--weight-button': String(TYPE_SCALE.button.weight),
    '--weight-body': String(TYPE_SCALE.body.weight),
    '--weight-caption': String(TYPE_SCALE.caption.weight),
    '--touch-min': `${MIN_TOUCH_PX}px`,
    '--touch-gap': `${TOUCH_GAP_PX}px`,
    '--activate-min-h': `${ACTIVATE_MIN_HEIGHT_PX}px`,
    '--layout-hud': String(LAYOUT_FRACTIONS.hud),
    '--layout-arena': String(LAYOUT_FRACTIONS.arena),
    '--layout-panel': String(LAYOUT_FRACTIONS.panel),
    '--transition': `${TRANSITION_MS}ms`,
    '--event-burst-max': `${EVENT_BURST_MAX_MS}ms`,
    '--select-bump': `${SELECT_BUMP_MS}ms`,
    '--fail-nudge': `${FAIL_NUDGE_MS}ms`,
    '--effect-flicker': `${EFFECT_FLICKER_MS}ms`,
  };
}
