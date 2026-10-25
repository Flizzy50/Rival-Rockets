import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CLIENT_MESSAGE_MAX_BYTES, DISPLAY_NAME_MAX_GRAPHEMES, SEQUENCE_MAX } from '../src/shared/config.js';
import { REJECT_REASONS, type ClientMessage } from '../src/shared/protocol.js';
import { normalizeName, validateMessage, type Validated } from './validate.js';

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function v(value: unknown): Validated {
  return validateMessage(JSON.stringify(value), false);
}

function okMessage(value: unknown): ClientMessage {
  const out = v(value);
  if (!out.ok) throw new Error(`expected ok, got ${out.reason}`);
  return out.message;
}

function reason(value: unknown): string {
  const out = v(value);
  if (out.ok) throw new Error('expected a rejection');
  return out.reason;
}

describe('validateMessage', () => {
  it('accepts every M2 message type with exactly its fields', () => {
    const valid: unknown[] = [
      { type: 'room.create', requestId: 1, name: 'Ada' },
      { type: 'room.join', requestId: 2, code: 'ABCDEF', name: 'Bo', intent: 'watch' },
      { type: 'room.leave', requestId: 3 },
      { type: 'room.watch', requestId: 4 },
      { type: 'seat.claim', requestId: 5, seat: 'comet-pilot' },
      { type: 'seat.release', requestId: 6 },
      { type: 'seat.reconnect', requestId: 7, code: 'ABCDEF', seat: 'nova-engineer', token: TOKEN },
      { type: 'setup.update', requestId: 8, status: 'calibrated' },
      { type: 'input.steer', matchId: 1, seq: 1, steering: 0.5 },
      { type: 'input.charge', matchId: 1, seq: 2 },
      { type: 'ability.request', matchId: 1, seq: 3, intent: 'select', ability: 'shield' },
      { type: 'ability.request', matchId: 1, seq: 4, intent: 'activate' },
      { type: 'heartbeat' },
    ];
    for (const message of valid) expect(okMessage(message)).toEqual(message);
  });

  it('uppercases room codes', () => {
    expect(okMessage({ type: 'room.join', requestId: 1, code: 'abcdef', name: 'A', intent: 'play' })).toMatchObject({
      code: 'ABCDEF',
    });
  });

  it('returns one reason per failed check (Requirement 8.1)', () => {
    expect(validateMessage(Buffer.from('{}'), true)).toMatchObject({ ok: false, reason: 'invalid-message' });
    expect(validateMessage('x'.repeat(CLIENT_MESSAGE_MAX_BYTES + 1), false)).toMatchObject({ reason: 'too-large' });
    expect(validateMessage('{not json', false)).toMatchObject({ reason: 'invalid-message' });
    expect(validateMessage(Buffer.from([0xff, 0xfe]), false)).toMatchObject({ reason: 'invalid-message' });
    expect(reason([1, 2])).toBe('invalid-message');
    expect(reason(null)).toBe('invalid-message');
    expect(reason({ requestId: 1 })).toBe('invalid-message');
    expect(reason({ type: 'nope' })).toBe('unknown-type');
    expect(reason({ type: 'room.leave', requestId: 1, extra: true })).toBe('invalid-field');
    expect(reason({ type: 'room.leave' })).toBe('invalid-field');
    expect(reason({ type: 'room.leave', requestId: -1 })).toBe('invalid-value');
    expect(reason({ type: 'room.leave', requestId: 1.5 })).toBe('invalid-value');
    expect(reason({ type: 'room.leave', requestId: SEQUENCE_MAX + 1 })).toBe('invalid-value');
    expect(reason({ type: 'room.leave', requestId: '1' })).toBe('invalid-value');
    expect(reason({ type: 'room.create', requestId: 1, name: '   ' })).toBe('invalid-name');
    expect(reason({ type: 'room.join', requestId: 1, code: 'ABCDE0', name: 'A', intent: 'play' })).toBe('invalid-value');
    expect(reason({ type: 'room.join', requestId: 1, code: 'ABCDEF', name: 'A', intent: 'spy' })).toBe('invalid-value');
    expect(reason({ type: 'seat.claim', requestId: 1, seat: 'comet-gunner' })).toBe('invalid-value');
    expect(
      reason({ type: 'seat.reconnect', requestId: 1, code: 'ABCDEF', seat: 'comet-pilot', token: 'short' }),
    ).toBe('reconnect-denied');
    expect(reason({ type: 'ability.request', matchId: 1, seq: 1, intent: 'select', ability: 'laser' })).toBe(
      'invalid-value',
    );
    expect(reason({ type: 'ability.request', matchId: 1, seq: 1, intent: 'select' })).toBe('invalid-field');
  });

  it('rejects an activate that names an ability (Requirement 14.9)', () => {
    expect(reason({ type: 'ability.request', matchId: 1, seq: 1, intent: 'activate', ability: 'boost' })).toBe(
      'invalid-field',
    );
  });

  it('accepts rematch and swap with only a requestId', () => {
    for (const type of ['match.rematch', 'match.swap']) {
      expect(validateMessage(JSON.stringify({ type, requestId: 1 }), false).ok).toBe(true);
      expect(reason({ type, requestId: 1, seat: 'nova-pilot' })).toBe('invalid-field');
      expect(reason({ type })).not.toBeNull();
    }
    expect(reason({ type: 'match.forfeit', requestId: 1 })).toBe('unknown-type');
  });

  it('accepts only reported setup statuses with no extra fields (Requirement 18.2)', () => {
    expect(reason({ type: 'setup.update', requestId: 1, status: 'unverified' })).toBe('invalid-value');
    expect(reason({ type: 'setup.update', requestId: 1, status: 'calibrated', neutral: 3 })).toBe('invalid-field');
  });

  it('rejects non-finite numbers that JSON can still express', () => {
    expect(validateMessage('{"type":"input.steer","matchId":1,"seq":1,"steering":1e999}', false)).toMatchObject({
      reason: 'invalid-value',
    });
  });

  it('refuses prototype keys as extra fields', () => {
    expect(validateMessage('{"type":"room.leave","requestId":1,"__proto__":{"x":1}}', false)).toMatchObject({
      reason: 'invalid-field',
    });
  });

  it('recovers the requestId of a rejected request when it can', () => {
    expect(v({ type: 'room.create', requestId: 9, name: '' })).toEqual({ ok: false, reason: 'invalid-name', requestId: 9 });
  });

  // Feature: m2-shared-control, Property 9: The validator is total
  it('never throws and returns a typed message or a known reason', () => {
    const frames = fc.oneof(
      fc.uint8Array({ maxLength: 1100 }).map((a) => Buffer.from(a)),
      fc.string({ maxLength: 1100 }),
      fc.jsonValue().map((j) => JSON.stringify(j)),
      fc
        .record({
          type: fc.constantFrom('room.create', 'input.steer', 'ability.request', 'heartbeat', 'seat.reconnect', 'x'),
          requestId: fc.oneof(fc.integer(), fc.double(), fc.string()),
          matchId: fc.integer(),
          seq: fc.integer(),
          steering: fc.double(),
          name: fc.string(),
          intent: fc.string(),
        }, { requiredKeys: ['type'] })
        .map((o) => JSON.stringify(o)),
    );
    fc.assert(
      fc.property(frames, fc.boolean(), (frame, isBinary) => {
        const out = validateMessage(frame, isBinary);
        if (isBinary) expect(out).toMatchObject({ ok: false, reason: 'invalid-message' });
        if (Buffer.byteLength(typeof frame === 'string' ? frame : frame) > CLIENT_MESSAGE_MAX_BYTES && !isBinary) {
          expect(out).toMatchObject({ ok: false, reason: 'too-large' });
        }
        if (!out.ok) expect(REJECT_REASONS).toContain(out.reason);
        else if (out.message.type === 'input.steer') expect(Math.abs(out.message.steering)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  // Feature: m2-shared-control, Property 10: Steering is clamped
  it('clamps any finite steering into [-1, 1]', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (s) => {
        const message = okMessage({ type: 'input.steer', matchId: 1, seq: 1, steering: s });
        expect(message).toMatchObject({ steering: Math.min(1, Math.max(-1, s)) + 0 });
      }),
      { numRuns: 200 },
    );
  });
});

describe('normalizeName', () => {
  it('trims, applies NFC, and counts graphemes', () => {
    expect(normalizeName('  Zoe\u0301  ')).toEqual({ ok: true, name: 'Zoé' });
    // One family emoji is one grapheme.
    expect(normalizeName('👨‍👩‍👧'.repeat(DISPLAY_NAME_MAX_GRAPHEMES)).ok).toBe(true);
    expect(normalizeName('a'.repeat(DISPLAY_NAME_MAX_GRAPHEMES + 1)).ok).toBe(false);
    expect(normalizeName('Ada\n').ok).toBe(false);
    expect(normalizeName('A\u2028B').ok).toBe(false);
    expect(normalizeName('\t').ok).toBe(false);
  });

  // Feature: m2-shared-control, Property 5: Display name normalization
  it('accepts only clean 1-16 grapheme names and is idempotent', () => {
    const names = fc.oneof(
      fc.string({ maxLength: 30 }),
      fc.string({ unit: 'grapheme', maxLength: 20 }),
      fc.string({ unit: 'binary', maxLength: 20 }),
    );
    fc.assert(
      fc.property(names, (raw) => {
        const out = normalizeName(raw);
        const trimmed = raw.trim();
        const forbidden = /[\p{Cc}\u2028\u2029]/u.test(raw);
        if (forbidden || trimmed === '') expect(out.ok).toBe(false);
        if (!out.ok) return;
        expect(out.name).toBe(out.name.trim());
        expect(out.name).toBe(out.name.normalize('NFC'));
        const count = Array.from(segmenter.segment(out.name)).length;
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(DISPLAY_NAME_MAX_GRAPHEMES);
        expect(normalizeName(out.name)).toEqual(out);
      }),
      { numRuns: 300 },
    );
  });
});
