import { timingSafeEqual } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_INACTIVITY_MS, SEAT_HOLD_MS } from '../src/shared/config.js';
import { SEAT_IDS, type Intent, type RejectReason, type SeatId, type SetupStatus } from '../src/shared/protocol.js';
import {
  addParticipant,
  claimSeat,
  createSeatsState,
  releaseSeat,
  removeParticipant,
  seatOf,
  setConnected,
  setSeatSetup,
  switchToWatch,
  type SeatsState,
} from '../src/shared/rules/seats.js';

// Room_Store (PRD 8): rooms, participants, seats, reconnect tokens, holds, and
// expiry, in this process's memory only. Seat decisions come from the pure
// seat rules; this module adds names, secrets, and time. Clock and randomness
// are injected so tests control both.

export interface RoomStoreDeps {
  nowMs(): number;
  // Uniform integer in [0, max).
  randomInt(max: number): number;
  // Fresh base64url token of RECONNECT_TOKEN_BYTES random bytes.
  randomToken(): string;
}

export interface Room {
  readonly code: string;
  readonly seats: SeatsState;
  readonly names: ReadonlyMap<string, string>;
  // Private: never copied into a public message (public-view.ts).
  readonly tokens: Readonly<Record<SeatId, string | null>>;
  readonly holdUntilMs: Readonly<Record<SeatId, number | null>>;
  readonly lastActivityMs: number;
  readonly nextJoinOrder: number;
}

export type StoreResult = { readonly ok: true } | { readonly ok: false; readonly reason: RejectReason };

export interface SweepResult {
  readonly expiredRooms: string[];
  readonly reopenedSeats: Array<{ readonly code: string; readonly seat: SeatId }>;
}

export interface RoomStore {
  create(name: string): { code: string; participantId: string };
  join(
    code: string,
    name: string,
    intent: Intent,
  ): { ok: true; participantId: string } | { ok: false; reason: RejectReason; offerWatch?: boolean };
  claim(code: string, participantId: string, seat: SeatId): { ok: true; token: string } | { ok: false; reason: RejectReason };
  release(code: string, participantId: string): StoreResult;
  watch(code: string, participantId: string): StoreResult;
  leave(code: string, participantId: string): void;
  setSetup(code: string, participantId: string, status: SetupStatus): StoreResult;
  disconnect(code: string, participantId: string): void;
  reconnect(
    code: string,
    seat: SeatId,
    token: string,
  ): { ok: true; participantId: string } | { ok: false; reason: 'reconnect-denied' };
  sweep(): SweepResult;
  touch(code: string): void;
  get(code: string): Room | undefined;
  codes(): string[];
}

function emptySeatRecord<T>(value: T): Record<SeatId, T> {
  const record = {} as Record<SeatId, T>;
  for (const seat of SEAT_IDS) record[seat] = value;
  return record;
}

function tokensMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  // timingSafeEqual needs equal lengths; the length itself is not secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createRoomStore(deps: RoomStoreDeps): RoomStore {
  const rooms = new Map<string, Room>();

  function newCode(): string {
    // Retry on collision; 31^6 codes make a second try rare.
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        code += ROOM_CODE_ALPHABET[deps.randomInt(ROOM_CODE_ALPHABET.length)] ?? '';
      }
      if (code.length === ROOM_CODE_LENGTH && !rooms.has(code)) return code;
    }
  }

  function update(room: Room, patch: Partial<Room>): Room {
    const next = { ...room, ...patch };
    rooms.set(room.code, next);
    return next;
  }

  // Reopening a seat always drops its secret, so an old token can never
  // reclaim it (Requirement 5.9).
  function withSecretsCleared(room: Room, seat: SeatId | null): Partial<Room> {
    if (seat === null) return {};
    return {
      tokens: { ...room.tokens, [seat]: null },
      holdUntilMs: { ...room.holdUntilMs, [seat]: null },
    };
  }

  function removeFromRoom(room: Room, participantId: string): Room {
    const seat = seatOf(room.seats, participantId);
    const names = new Map(room.names);
    names.delete(participantId);
    return update(room, {
      seats: removeParticipant(room.seats, participantId),
      names,
      ...withSecretsCleared(room, seat),
    });
  }

  function participantFields(room: Room, intent: Intent) {
    const now = deps.nowMs();
    return {
      id: `p${room.nextJoinOrder}`,
      intent,
      connected: true,
      joinOrder: room.nextJoinOrder,
      connectedSince: now,
    };
  }

  return {
    create(name) {
      const now = deps.nowMs();
      const code = newCode();
      const creator = { id: 'p0', intent: 'play' as const, connected: true, joinOrder: 0, connectedSince: now };
      rooms.set(code, {
        code,
        seats: createSeatsState(creator),
        names: new Map([[creator.id, name]]),
        tokens: emptySeatRecord<string | null>(null),
        holdUntilMs: emptySeatRecord<number | null>(null),
        lastActivityMs: now,
        nextJoinOrder: 1,
      });
      return { code, participantId: creator.id };
    },

    join(code, name, intent) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: 'room-not-found' };
      const participant = participantFields(room, intent);
      const out = addParticipant(room.seats, participant);
      if (!out.ok) return out.reason === 'room-full' ? { ok: false, reason: 'room-full', offerWatch: true } : out;
      const names = new Map(room.names);
      names.set(participant.id, name);
      update(room, { seats: out.state, names, nextJoinOrder: room.nextJoinOrder + 1, lastActivityMs: deps.nowMs() });
      return { ok: true, participantId: participant.id };
    },

    claim(code, participantId, seat) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: 'room-not-found' };
      const out = claimSeat(room.seats, participantId, seat);
      if (!out.ok) return out;
      // A fresh token per claim, so a token from an earlier claim is dead.
      const token = deps.randomToken();
      update(room, {
        seats: out.state,
        tokens: { ...room.tokens, [seat]: token },
        holdUntilMs: { ...room.holdUntilMs, [seat]: null },
        lastActivityMs: deps.nowMs(),
      });
      return { ok: true, token };
    },

    release(code, participantId) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: 'room-not-found' };
      const seat = seatOf(room.seats, participantId);
      const out = releaseSeat(room.seats, participantId);
      if (!out.ok) return out;
      update(room, { seats: out.state, ...withSecretsCleared(room, seat), lastActivityMs: deps.nowMs() });
      return { ok: true };
    },

    watch(code, participantId) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: 'room-not-found' };
      const seat = seatOf(room.seats, participantId);
      const out = switchToWatch(room.seats, participantId);
      if (!out.ok) return out;
      update(room, { seats: out.state, ...withSecretsCleared(room, seat), lastActivityMs: deps.nowMs() });
      return { ok: true };
    },

    leave(code, participantId) {
      const room = rooms.get(code);
      if (room) removeFromRoom(room, participantId);
    },

    setSetup(code, participantId, status) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: 'room-not-found' };
      const out = setSeatSetup(room.seats, participantId, status);
      if (!out.ok) return out;
      update(room, { seats: out.state, lastActivityMs: deps.nowMs() });
      return { ok: true };
    },

    disconnect(code, participantId) {
      const room = rooms.get(code);
      if (!room || !room.seats.participants.has(participantId)) return;
      const seat = seatOf(room.seats, participantId);
      // Without a seat there is nothing to hold, and no token to come back with.
      if (seat === null) {
        removeFromRoom(room, participantId);
        return;
      }
      update(room, {
        seats: setConnected(room.seats, participantId, false, deps.nowMs()),
        holdUntilMs: { ...room.holdUntilMs, [seat]: deps.nowMs() + SEAT_HOLD_MS },
      });
    },

    reconnect(code, seat, token) {
      const room = rooms.get(code);
      const denied = { ok: false, reason: 'reconnect-denied' } as const;
      if (!room) return denied;
      const expected = room.tokens[seat];
      const occupantId = room.seats.seats[seat].occupantId;
      if (expected === null || occupantId === null || !tokensMatch(expected, token)) return denied;
      const holdUntil = room.holdUntilMs[seat];
      // A live seat may also be reclaimed: a reload can arrive before the
      // server notices the old socket is gone (Requirement 5.7).
      if (holdUntil !== null && deps.nowMs() >= holdUntil) return denied;
      update(room, {
        seats: setConnected(room.seats, occupantId, true, deps.nowMs()),
        holdUntilMs: { ...room.holdUntilMs, [seat]: null },
      });
      return { ok: true, participantId: occupantId };
    },

    sweep() {
      const now = deps.nowMs();
      const result: SweepResult = { expiredRooms: [], reopenedSeats: [] };
      for (const code of [...rooms.keys()]) {
        let room = rooms.get(code);
        if (!room) continue;
        for (const seat of SEAT_IDS) {
          const holdUntil = room.holdUntilMs[seat];
          const occupantId = room.seats.seats[seat].occupantId;
          if (holdUntil === null || now < holdUntil || occupantId === null) continue;
          room = removeFromRoom(room, occupantId);
          result.reopenedSeats.push({ code, seat });
        }
        if (now - room.lastActivityMs >= ROOM_INACTIVITY_MS) {
          rooms.delete(code);
          result.expiredRooms.push(code);
        }
      }
      return result;
    },

    touch(code) {
      const room = rooms.get(code);
      if (room) update(room, { lastActivityMs: deps.nowMs() });
    },

    get(code) {
      return rooms.get(code);
    },

    codes() {
      return [...rooms.keys()];
    },
  };
}
