import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS, color, cssVariables, TEAM_COMET, TEAM_NOVA } from './tokens.js';

// Exact PRD 7.3 palette; a mismatch here means the PRD and code disagree.
const PRD_COLORS: Record<string, string> = {
  '--bg-space': '#08091A',
  '--bg-surface': '#1A1734',
  '--bg-track': '#111022',
  '--line-wall': '#64A5C3',
  '--gate-idle': '#4F7FA0',
  '--gate-next': '#FFFFFF',
  '--text-primary': '#EEE5CD',
  '--text-secondary': '#ADA6C4',
  '--accent': '#E2C75E',
  '--team-comet': '#FF9F1C',
  '--team-nova': '#2EC4F1',
  '--core': '#E86BFF',
  '--shield': '#E6F7FF',
  '--success': '#88D960',
  '--warning': '#F5B90C',
  '--danger': '#FF5C6C',
};

// WCAG 2.2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  it('contains exactly the PRD colors with exact hex values', () => {
    expect(COLOR_TOKENS).toEqual(PRD_COLORS);
    for (const hex of Object.values(COLOR_TOKENS)) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('keeps the team colors from PRD 7.4', () => {
    expect(color('team-comet')).toBe('#FF9F1C');
    expect(TEAM_COMET.color).toBe('#FF9F1C');
    expect(TEAM_NOVA.color).toBe('#2EC4F1');
  });

  // PRD 7.10: 4.5:1 for text, 3:1 for essential graphics. Every surface a
  // token sits on is checked, not only the page background.
  it('meets the contrast targets on every background', () => {
    const backgrounds = [color('bg-space'), color('bg-surface'), color('bg-track')];
    const text = ['text-primary', 'text-secondary', 'team-comet', 'team-nova', 'core', 'accent', 'success', 'warning', 'danger'] as const;
    const graphics = ['line-wall', 'gate-idle', 'gate-next', 'shield'] as const;
    for (const bg of backgrounds) {
      for (const name of text) expect(contrast(color(name), bg), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const name of graphics) expect(contrast(color(name), bg), `${name} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    // Dark text on filled team, accent, and success buttons (PRD 7.3).
    for (const fill of ['team-comet', 'team-nova', 'accent', 'success'] as const) {
      expect(contrast(color('bg-space'), color(fill))).toBeGreaterThanOrEqual(4.5);
    }
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
