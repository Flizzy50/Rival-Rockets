import {
  CLIENT_MESSAGE_MAX_BYTES,
  DISPLAY_NAME_MAX_GRAPHEMES,
  RECONNECT_TOKEN_BYTES,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SEQUENCE_MAX,
} from '../src/shared/config.js';
import {
  ABILITIES,
  INTENTS,
  REPORTED_SETUP_STATUSES,
  SEAT_IDS,
  type ClientMessage,
  type ClientMessageType,
  type RejectReason,
} from '../src/shared/protocol.js';

// Message_Validator (Requirement 8, PRD 10). Pure and total: every frame
// becomes a typed message or a reason, and nothing here throws or mutates.
// Checks run in the Requirement 8.1 order, so the cheapest refusal wins.

export type RawFrame = Buffer | ArrayBuffer | Buffer[] | string;

export type Validated =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly reason: RejectReason; readonly requestId: number | null };

type FieldCheck = (value: unknown) => { ok: true; value: unknown } | { ok: false; reason: RejectReason };

const decoder = new TextDecoder('utf-8', { fatal: true });
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Control characters and the two Unicode line/paragraph separators (which are
// not in \p{Cc}) are line breaks for a one-line name (Requirement 2.7).
const FORBIDDEN_NAME_CHARS = /[\p{Cc}\u2028\u2029]/u;
const CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
// Unpadded base64url of exactly RECONNECT_TOKEN_BYTES.
const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((RECONNECT_TOKEN_BYTES * 4) / 3)}}$`);

export function normalizeName(raw: string): { ok: true; name: string } | { ok: false } {
  // Checked before trimming, so a trailing line break is refused rather than
  // silently trimmed away.
  if (FORBIDDEN_NAME_CHARS.test(raw)) return { ok: false };
  const name = raw.trim().normalize('NFC').trim();
  // The frame cap bounds the input, so counting every segment is cheap.
  const count = Array.from(segmenter.segment(name)).length;
  return count === 0 || count > DISPLAY_NAME_MAX_GRAPHEMES ? { ok: false } : { ok: true, name };
}

function fail(reason: RejectReason): { ok: false; reason: RejectReason } {
  return { ok: false, reason };
}

function pass(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value };
}

function isSafeCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= SEQUENCE_MAX;
}

const counter: FieldCheck = (v) => (isSafeCounter(v) ? pass(v) : fail('invalid-value'));

function oneOf(values: readonly string[]): FieldCheck {
  return (v) => (typeof v === 'string' && values.includes(v) ? pass(v) : fail('invalid-value'));
}

const name: FieldCheck = (v) => {
  if (typeof v !== 'string') return fail('invalid-name');
  const out = normalizeName(v);
  return out.ok ? pass(out.name) : fail('invalid-name');
};

// Codes are accepted in any case because people type them; the canonical
// form is uppercase.
const code: FieldCheck = (v) => {
  if (typeof v !== 'string') return fail('invalid-value');
  const upper = v.toUpperCase();
  return CODE_PATTERN.test(upper) ? pass(upper) : fail('invalid-value');
};

// A token that cannot be a live token is a denied reconnect, not a protocol
// error, so the client shows the same copy for every bad token (Requirement 5.8).
const token: FieldCheck = (v) => (typeof v === 'string' && TOKEN_PATTERN.test(v) ? pass(v) : fail('reconnect-denied'));

const steering: FieldCheck = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail('invalid-value');
  // Clamp rather than reject: a phone at full lean can overshoot by rounding
  // (Requirement 8.4). Adding 0 turns -0 into 0.
  return pass(Math.min(1, Math.max(-1, v)) + 0);
};

const SCHEMAS: Readonly<Record<ClientMessageType, Readonly<Record<string, FieldCheck>>>> = {
  'room.create': { requestId: counter, name },
  'room.join': { requestId: counter, code, name, intent: oneOf(INTENTS) },
  'room.leave': { requestId: counter },
  'room.watch': { requestId: counter },
  'seat.claim': { requestId: counter, seat: oneOf(SEAT_IDS) },
  'seat.release': { requestId: counter },
  'seat.reconnect': { requestId: counter, code, seat: oneOf(SEAT_IDS), token },
  'setup.update': { requestId: counter, status: oneOf(REPORTED_SETUP_STATUSES) },
  'ready.set': { requestId: counter, ready: (v) => typeof v === 'boolean' ? pass(v) : fail('invalid-value') },
  'match.start': { requestId: counter },
  'input.steer': { matchId: counter, seq: counter, steering },
  'input.charge': { matchId: counter, seq: counter },
  // The ability field is handled per intent below.
  'ability.request': { matchId: counter, seq: counter, intent: oneOf(['select', 'activate']) },
  heartbeat: {},
};

function isKnownType(value: unknown): value is ClientMessageType {
  return typeof value === 'string' && Object.hasOwn(SCHEMAS, value);
}

function toBuffer(data: RawFrame): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function rejection(reason: RejectReason, requestId: number | null): Validated {
  return { ok: false, reason, requestId };
}

export function validateMessage(data: RawFrame, isBinary: boolean): Validated {
  try {
    return validate(data, isBinary);
  } catch {
    // Unreachable by design; kept so a future check can never crash the gateway.
    return rejection('invalid-message', null);
  }
}

function validate(data: RawFrame, isBinary: boolean): Validated {
  if (isBinary) return rejection('invalid-message', null);
  const bytes = toBuffer(data);
  if (bytes.byteLength > CLIENT_MESSAGE_MAX_BYTES) return rejection('too-large', null);

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return rejection('invalid-message', null);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return rejection('invalid-message', null);
  }
  const obj = parsed as Record<string, unknown>;
  // Best effort, so a rejection can still be matched to its request.
  const requestId = Object.hasOwn(obj, 'requestId') && isSafeCounter(obj.requestId) ? obj.requestId : null;

  if (!Object.hasOwn(obj, 'type')) return rejection('invalid-message', requestId);
  const type = obj.type;
  if (!isKnownType(type)) return rejection('unknown-type', requestId);

  const schema: Record<string, FieldCheck> = { ...SCHEMAS[type] };
  if (type === 'ability.request' && obj.intent === 'select') schema.ability = oneOf(ABILITIES);

  // Exact field set: nothing extra (including __proto__ and friends), nothing missing.
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (key !== 'type' && !Object.hasOwn(schema, key)) return rejection('invalid-field', requestId);
  }
  const out: Record<string, unknown> = { type };
  for (const [key, check] of Object.entries(schema)) {
    if (!Object.hasOwn(obj, key)) return rejection('invalid-field', requestId);
    const result = check(obj[key]);
    if (!result.ok) return rejection(result.reason, requestId);
    out[key] = result.value;
  }
  return { ok: true, message: out as unknown as ClientMessage };
}
