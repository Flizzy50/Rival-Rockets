import { describe, expect, it } from 'vitest';
import { qrMatrix } from './qr';

describe('qr', () => {
  it('builds a square module matrix for a room link', () => {
    const m = qrMatrix('https://rr.example/?room=ABCDEF');
    expect(m.length).toBeGreaterThanOrEqual(21);
    for (const row of m) expect(row).toHaveLength(m.length);
    // Finder pattern corner is dark.
    expect(m[0]?.[0]).toBe(true);
  });
});
