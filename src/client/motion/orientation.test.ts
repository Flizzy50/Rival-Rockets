import { describe, expect, it } from 'vitest';
import { isPortrait, shouldShowRotateOverlay } from './orientation';

describe('isPortrait', () => {
  it('trusts a portrait orientation type over the viewport size', () => {
    expect(isPortrait({ type: 'portrait-primary', width: 800, height: 400 })).toBe(true);
    expect(isPortrait({ type: 'portrait-secondary', width: 800, height: 400 })).toBe(true);
  });

  it('trusts a landscape orientation type over the viewport size', () => {
    expect(isPortrait({ type: 'landscape-primary', width: 400, height: 800 })).toBe(false);
    expect(isPortrait({ type: 'landscape-secondary', width: 400, height: 800 })).toBe(false);
  });

  it('falls back to width <= height without a usable type', () => {
    expect(isPortrait({ width: 390, height: 844 })).toBe(true);
    expect(isPortrait({ type: null, width: 844, height: 390 })).toBe(false);
    expect(isPortrait({ type: 'unknown', width: 844, height: 390 })).toBe(false);
    expect(isPortrait({ width: 500, height: 500 })).toBe(true);
  });
});

describe('shouldShowRotateOverlay', () => {
  it('shows only on a coarse-pointer device in landscape', () => {
    expect(shouldShowRotateOverlay(false, true)).toBe(true);
    expect(shouldShowRotateOverlay(true, true)).toBe(false);
    expect(shouldShowRotateOverlay(false, false)).toBe(false);
    expect(shouldShowRotateOverlay(true, false)).toBe(false);
  });
});
