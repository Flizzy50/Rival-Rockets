import { describe, expect, it } from 'vitest';
import { buildAllowedOrigins, isOriginAllowed } from './origin.js';

const RENDER_URL = 'https://rival-rockets.onrender.com';

describe('buildAllowedOrigins', () => {
  it('serializes RENDER_EXTERNAL_URL and comma-separated ALLOWED_ORIGINS', () => {
    const allowed = buildAllowedOrigins({
      RENDER_EXTERNAL_URL: `${RENDER_URL}/`,
      ALLOWED_ORIGINS: ' https://Play.Example.com:8443/path , http://localhost:5173,,',
    });
    expect([...allowed].sort()).toEqual(['http://localhost:5173', 'https://play.example.com:8443', RENDER_URL]);
  });

  it('ignores malformed and non-web entries', () => {
    const allowed = buildAllowedOrigins({ ALLOWED_ORIGINS: 'not a url,file:///tmp/x,data:text/plain,example.com' });
    expect(allowed.size).toBe(0);
  });

  it('is empty when nothing is configured', () => {
    expect(buildAllowedOrigins({}).size).toBe(0);
  });
});

describe('isOriginAllowed', () => {
  const allowed = buildAllowedOrigins({ RENDER_EXTERNAL_URL: RENDER_URL });

  it('allows a listed origin', () => {
    expect(isOriginAllowed(RENDER_URL, 'rival-rockets.onrender.com', allowed, false)).toBe(true);
  });

  it('denies unlisted, missing, and malformed origins', () => {
    expect(isOriginAllowed('https://evil.example', 'rival-rockets.onrender.com', allowed, false)).toBe(false);
    expect(isOriginAllowed(undefined, 'rival-rockets.onrender.com', allowed, false)).toBe(false);
    expect(isOriginAllowed('', 'rival-rockets.onrender.com', allowed, false)).toBe(false);
    expect(isOriginAllowed('null', 'rival-rockets.onrender.com', allowed, true)).toBe(false);
    expect(isOriginAllowed('garbage', 'rival-rockets.onrender.com', allowed, false)).toBe(false);
    // Not a serialized origin, even though it parses to an allowed one.
    expect(isOriginAllowed(`${RENDER_URL}/path`, 'rival-rockets.onrender.com', allowed, false)).toBe(false);
  });

  it('rejects everything outside dev mode when the allowlist is empty', () => {
    expect(isOriginAllowed('https://192.168.1.20:5173', '192.168.1.20:5173', new Set(), false)).toBe(false);
  });

  it('in dev mode allows only an origin whose host equals the Host header', () => {
    const empty = new Set<string>();
    expect(isOriginAllowed('https://192.168.1.20:5173', '192.168.1.20:5173', empty, true)).toBe(true);
    expect(isOriginAllowed('https://192.168.1.20:5173', '192.168.1.20:3000', empty, true)).toBe(false);
    expect(isOriginAllowed('https://evil.example', '192.168.1.20:5173', empty, true)).toBe(false);
    expect(isOriginAllowed('https://192.168.1.20:5173', undefined, empty, true)).toBe(false);
  });
});
