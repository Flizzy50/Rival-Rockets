import { RECONNECT_TOKEN_BYTES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/config';
import { SEAT_IDS, type SeatId } from '../../shared/protocol';

// Per-tab seat session and share links (PRD 8, 10). The reconnect token lives
// only in sessionStorage so a reload of the same tab can reclaim its seat; it
// never goes into a URL, QR, log, or diagnostic (Requirement 5.5). Share links
// carry the room code and nothing else (Requirements 3.2, 3.3).

export interface StoredSession {
  readonly code: string;
  readonly seat: SeatId;
  readonly token: string;
}

export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'rival-rockets.session';
const ROOM_PARAM = 'room';
// Unpadded base64url length of the server's random token bytes.
const TOKEN_LENGTH = Math.ceil((RECONNECT_TOKEN_BYTES * 4) / 3);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isRoomCode(value: string): boolean {
  if (value.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of value) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

function isToken(value: string): boolean {
  return value.length === TOKEN_LENGTH && TOKEN_PATTERN.test(value);
}

function isSeatId(value: unknown): value is SeatId {
  return typeof value === 'string' && (SEAT_IDS as readonly string[]).includes(value);
}

export function buildShareLink(origin: string, code: string): string {
  return `${origin}/?${ROOM_PARAM}=${code}`;
}

// Accepts location.search with or without the leading "?". Lowercase codes are
// accepted because people retype links; anything else is ignored.
export function parseRoomParam(search: string): string | null {
  const raw = new URLSearchParams(search).get(ROOM_PARAM);
  if (raw === null) return null;
  const code = raw.toUpperCase();
  return isRoomCode(code) ? code : null;
}

// Reading the sessionStorage property itself throws in some privacy modes and
// sandboxed frames, and it does not exist under Node. Any failure means "no
// storage", so the player simply cannot reclaim the seat after a reload.
function defaultStorage(): SessionStorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveSession(
  session: StoredSession,
  storage: SessionStorageLike | null = defaultStorage(),
): boolean {
  if (storage === null) return false;
  if (!isRoomCode(session.code) || !isSeatId(session.seat) || !isToken(session.token)) return false;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ code: session.code, seat: session.seat, token: session.token }),
    );
    return true;
  } catch {
    // Quota or privacy-mode write failure.
    return false;
  }
}

// Storage is user-editable, so nothing is trusted until it passes the same
// shape checks the server applies.
export function loadSession(storage: SessionStorageLike | null = defaultStorage()): StoredSession | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { code, seat, token } = parsed as Record<string, unknown>;
  if (typeof code !== 'string' || !isRoomCode(code)) return null;
  if (!isSeatId(seat)) return null;
  if (typeof token !== 'string' || !isToken(token)) return null;
  return { code, seat, token };
}

export function clearSession(storage: SessionStorageLike | null = defaultStorage()): void {
  if (storage === null) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to recover; a stale entry fails reconnect and is cleared then.
  }
}
