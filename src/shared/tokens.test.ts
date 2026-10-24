import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS, color, cssVariables, TEAM_COMET } from './tokens.js';

// Exact PRD 7.3 palette; a mismatch here means the PRD and code disagree.
const PRD_COLORS: Record<string, string> = {
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
};

describe('design tokens', () => {
  it('contains exactly the 15 PRD colors with exact hex values', () => {
    expect(COLOR_TOKENS).toEqual(PRD_COLORS);
    for (const hex of Object.values(COLOR_TOKENS)) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('uses Comet orange for the sensor-test team', () => {
    expect(color('team-comet')).toBe('#FF9F1C');
    expect(TEAM_COMET.color).toBe('#FF9F1C');
  });

  it('exposes every CSS variable with a -- prefix and includes all colors', () => {
    const vars = cssVariables();
    for (const key of Object.keys(vars)) {
      expect(key.startsWith('--')).toBe(true);
    }
    for (const [key, hex] of Object.entries(PRD_COLORS)) {
      expect(vars[key]).toBe(hex);
    }
    expect(vars['--touch-min']).toBe('48px');
    expect(vars['--activate-min-h']).toBe('96px');
  });
});
