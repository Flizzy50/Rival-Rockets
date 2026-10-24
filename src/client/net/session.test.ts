import { describe, expect, it } from 'vitest';
import {
  buildShareLink,
  clearSession,
  loadSession,
  parseRoomParam,
  saveSession,
  type SessionStorageLike,
  type StoredSession,
} from './session';

// 22 characters: unpadded base64url of 16 random bytes, as the server issues.
const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const SESSION: StoredSession = { code: 'ABC234', seat: 'comet-pilot', token: TOKEN };

function memoryStorage(): SessionStorageLike & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function throwingStorage(): SessionStorageLike {
  const fail = (): never => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe('buildShareLink', () => {
  it('builds origin + room query', () => {
    expect(buildShareLink('https://rockets.example', 'ABC234')).toBe('https://rockets.example/?room=ABC234');
  });

  it('carries only the room parameter and no token', () => {
    const link = buildShareLink('https://rockets.example', SESSION.code);
    const url = new URL(link);
    expect([...url.searchParams.keys()]).toEqual(['room']);
    expect(link).not.toContain(TOKEN);
    expect(parseRoomParam(url.search)).toBe(SESSION.code);
  });
});

describe('parseRoomParam', () => {
  it('returns a valid code', () => {
    expect(parseRoomParam('?room=ABC234')).toBe('ABC234');
    expect(parseRoomParam('room=XYZ789')).toBe('XYZ789');
  });

  it('uppercases lowercase codes', () => {
    expect(parseRoomParam('?room=abc234')).toBe('ABC234');
  });

  it('rejects wrong length or characters outside the alphabet', () => {
    expect(parseRoomParam('?room=ABC23')).toBeNull();
    expect(parseRoomParam('?room=ABC2345')).toBeNull();
    // 0, O, 1, I, L are excluded from room codes.
    expect(parseRoomParam('?room=ABC230')).toBeNull();
    expect(parseRoomParam('?room=ABCDEO')).toBeNull();
    expect(parseRoomParam('?room=ABCDE1')).toBeNull();
    expect(parseRoomParam('?room=ABCDEL')).toBeNull();
    expect(parseRoomParam('?room=AB%20234')).toBeNull();
  });

  it('returns null when the parameter is missing or empty', () => {
    expect(parseRoomParam('')).toBeNull();
    expect(parseRoomParam('?other=ABC234')).toBeNull();
    expect(parseRoomParam('?room=')).toBeNull();
  });
});

describe('session storage', () => {
  it('round trips a saved session', () => {
    const storage = memoryStorage();
    expect(saveSession(SESSION, storage)).toBe(true);
    expect(loadSession(storage)).toEqual(SESSION);
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(loadSession(memoryStorage())).toBeNull();
  });

  it('refuses to save an invalid session', () => {
    const storage = memoryStorage();
    expect(saveSession({ ...SESSION, code: 'abc234' }, storage)).toBe(false);
    expect(saveSession({ ...SESSION, token: 'short' }, storage)).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it('returns null for corrupted or tampered storage', () => {
    const storage = memoryStorage();
    expect(saveSession(SESSION, storage)).toBe(true);
    const [key] = [...storage.items.keys()];
    if (key === undefined) throw new Error('no key stored');
    const bad = [
      'not json',
      'null',
      '"ABC234"',
      JSON.stringify({ ...SESSION, code: 'ABC23O' }),
      JSON.stringify({ ...SESSION, seat: 'comet-gunner' }),
      JSON.stringify({ ...SESSION, token: 'x'.repeat(22) + '=' }),
      JSON.stringify({ ...SESSION, token: 42 }),
      JSON.stringify({ code: SESSION.code, seat: SESSION.seat }),
    ];
    for (const value of bad) {
      storage.items.set(key, value);
      expect(loadSession(storage)).toBeNull();
    }
  });

  it('fails safe when storage throws or is unavailable', () => {
    const storage = throwingStorage();
    expect(saveSession(SESSION, storage)).toBe(false);
    expect(loadSession(storage)).toBeNull();
    expect(() => clearSession(storage)).not.toThrow();
    expect(saveSession(SESSION, null)).toBe(false);
    expect(loadSession(null)).toBeNull();
  });

  it('uses no storage under Node, where sessionStorage does not exist', () => {
    expect(saveSession(SESSION)).toBe(false);
    expect(loadSession()).toBeNull();
  });
});
