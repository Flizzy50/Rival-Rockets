import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_INACTIVITY_MS,
  SEAT_HOLD_MS,
} from '../src/shared/config.js';
import { SEAT_IDS, type SeatId } from '../src/shared/protocol.js';
import { createRoomStore, type RoomStore } from './rooms.js';

interface Harness {
  store: RoomStore;
  advance(ms: number): void;
  setNow(ms: number): void;
}

// Deterministic clock, code source, and tokens.
function harness(randomInts: readonly number[] = []): Harness {
  let now = 0;
  let tokenCount = 0;
  let intIndex = 0;
  const store = createRoomStore({
    nowMs: () => now,
    randomInt: (max) => {
      const value = randomInts[intIndex % Math.max(1, randomInts.length)] ?? intIndex;
      intIndex += 1;
      return value % max;
    },
    randomToken: () => {
      tokenCount += 1;
      return `token-${String(tokenCount).padStart(16, '0')}`;
    },
  });
  return {
    store,
    advance(ms) {
      now += ms;
    },
    setNow(ms) {
      now = ms;
    },
  };
}

function claimed(store: RoomStore, code: string, pid: string, seat: SeatId): string {
  const out = store.claim(code, pid, seat);
  if (!out.ok) throw new Error(out.reason);
  return out.token;
}

function serialize(store: RoomStore): string {
  return JSON.stringify(
    store.codes().map((code) => {
      const room = store.get(code);
      return room && { ...room, names: [...room.names], seats: { ...room.seats, participants: [...room.seats.participants] } };
    }),
  );
}

describe('room store', () => {
  it('creates a room with the creator as the play host (Requirement 2.1)', () => {
    const { store } = harness();
    const { code, participantId } = store.create('Ada');
    const room = store.get(code);
    expect(room?.seats.hostId).toBe(participantId);
    expect(room?.seats.participants.get(participantId)?.intent).toBe('play');
    expect(room?.names.get(participantId)).toBe('Ada');
  });

  // Feature: m2-shared-control, Property 3: Room codes are valid and unique
  it('generates valid codes and retries on collision', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 30 }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 8 }), (ints, rooms) => {
        // A short repeating source forces collisions after the first room.
        const { store } = harness([...ints, ...Array.from({ length: 64 }, (_, i) => i)]);
        const codes = new Set<string>();
        for (let i = 0; i < rooms; i += 1) {
          const { code } = store.create('A');
          expect(code).toHaveLength(ROOM_CODE_LENGTH);
          for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
          expect(codes.has(code)).toBe(false);
          codes.add(code);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: m2-shared-control, Property 4: Create and join either add one participant or change nothing
  it('joins add exactly one participant or change nothing', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ known: fc.boolean(), intent: fc.constantFrom('play' as const, 'watch' as const) }), {
          maxLength: 10,
        }),
        (joins) => {
          const { store } = harness();
          const { code } = store.create('Host');
          for (const join of joins) {
            const before = serialize(store);
            const size = store.get(code)?.seats.participants.size ?? 0;
            const out = store.join(join.known ? code : 'ZZZZZZ', 'P', join.intent);
            if (out.ok) {
              expect(store.get(code)?.seats.participants.get(out.participantId)?.intent).toBe(join.intent);
              expect(store.get(code)?.seats.participants.size).toBe(size + 1);
            } else {
              expect(['room-not-found', 'room-full']).toContain(out.reason);
              if (out.reason === 'room-full') expect(out.offerWatch).toBe(true);
              expect(serialize(store)).toBe(before);
            }
          }
          const plays = [...(store.get(code)?.seats.participants.values() ?? [])].filter((p) => p.intent === 'play');
          expect(plays.length).toBeLessThanOrEqual(ACTIVE_PLAYERS);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('issues a new token on every claim and reopens the seat on release', () => {
    const { store } = harness();
    const { code, participantId } = store.create('Ada');
    const first = claimed(store, code, participantId, 'comet-pilot');
    expect(store.release(code, participantId)).toEqual({ ok: true });
    expect(store.get(code)?.tokens['comet-pilot']).toBeNull();
    const second = claimed(store, code, participantId, 'comet-pilot');
    expect(second).not.toBe(first);
    expect(store.reconnect(code, 'comet-pilot', first)).toEqual({ ok: false, reason: 'reconnect-denied' });
  });

  it('holds a disconnected seat for exactly SEAT_HOLD_MS (Requirements 5.6, 5.9)', () => {
    const h = harness();
    const { code, participantId } = h.store.create('Ada');
    const token = claimed(h.store, code, participantId, 'comet-engineer');
    h.store.disconnect(code, participantId);
    expect(h.store.get(code)?.seats.seats['comet-engineer'].held).toBe(true);

    h.advance(SEAT_HOLD_MS - 1);
    expect(h.store.sweep().reopenedSeats).toEqual([]);
    expect(h.store.reconnect(code, 'comet-engineer', token)).toEqual({ ok: true, participantId });
    expect(h.store.get(code)?.seats.seats['comet-engineer'].held).toBe(false);

    h.store.disconnect(code, participantId);
    h.advance(SEAT_HOLD_MS);
    expect(h.store.reconnect(code, 'comet-engineer', token)).toEqual({ ok: false, reason: 'reconnect-denied' });
    expect(h.store.sweep().reopenedSeats).toEqual([{ code, seat: 'comet-engineer' }]);
    expect(h.store.get(code)?.seats.seats['comet-engineer'].occupantId).toBeNull();
    expect(h.store.get(code)?.tokens['comet-engineer']).toBeNull();
    expect(h.store.reconnect(code, 'comet-engineer', token)).toEqual({ ok: false, reason: 'reconnect-denied' });
  });

  it('removes an unseated participant on disconnect', () => {
    const { store } = harness();
    const { code } = store.create('Ada');
    const join = store.join(code, 'Bo', 'watch');
    if (!join.ok) throw new Error(join.reason);
    store.disconnect(code, join.participantId);
    expect(store.get(code)?.seats.participants.has(join.participantId)).toBe(false);
  });

  // Feature: m2-shared-control, Property 8: Reconnect succeeds only with the live token
  it('reconnects only with the live token before the hold ends', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SEAT_IDS),
        fc.boolean(),
        fc.integer({ min: 0, max: 2 * SEAT_HOLD_MS }),
        (seat, rightToken, delay) => {
          const h = harness();
          const { code, participantId } = h.store.create('Ada');
          const token = claimed(h.store, code, participantId, seat);
          h.store.disconnect(code, participantId);
          h.advance(delay);
          const before = serialize(h.store);
          const out = h.store.reconnect(code, seat, rightToken ? token : 'token-9999999999999999');
          const shouldSucceed = rightToken && delay < SEAT_HOLD_MS;
          expect(out.ok).toBe(shouldSucceed);
          if (!shouldSucceed) expect(serialize(h.store)).toBe(before);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('expires a room exactly at the inactivity limit and frees its code (Requirements 6.3, 6.4)', () => {
    const h = harness([0]);
    const { code } = h.store.create('Ada');
    h.advance(ROOM_INACTIVITY_MS - 1);
    expect(h.store.sweep().expiredRooms).toEqual([]);
    h.advance(1);
    expect(h.store.sweep().expiredRooms).toEqual([code]);
    expect(h.store.get(code)).toBeUndefined();
    // The same random source gives the same code again once it is free.
    expect(h.store.create('Bo').code).toBe(code);
  });

  it('refreshes activity on accepted actions only (Requirements 6.1, 6.2)', () => {
    const h = harness();
    const { code, participantId } = h.store.create('Ada');
    const at = (ms: number) => {
      h.setNow(ms);
    };
    at(10);
    h.store.join(code, 'Bo', 'play');
    expect(h.store.get(code)?.lastActivityMs).toBe(10);
    at(20);
    claimed(h.store, code, participantId, 'nova-pilot');
    expect(h.store.get(code)?.lastActivityMs).toBe(20);
    at(30);
    h.store.setSetup(code, participantId, 'readings');
    expect(h.store.get(code)?.lastActivityMs).toBe(30);
    at(40);
    expect(h.store.claim(code, participantId, 'comet-pilot').ok).toBe(false);
    expect(h.store.get(code)?.lastActivityMs).toBe(30);
    h.store.release(code, participantId);
    expect(h.store.get(code)?.lastActivityMs).toBe(40);
    at(50);
    h.store.watch(code, participantId);
    expect(h.store.get(code)?.lastActivityMs).toBe(50);
    at(60);
    h.store.touch(code);
    expect(h.store.get(code)?.lastActivityMs).toBe(60);
  });

  it('transfers the host when the host hold expires (Requirement 4.8)', () => {
    const h = harness();
    const { code, participantId: host } = h.store.create('Ada');
    const join = h.store.join(code, 'Bo', 'play');
    if (!join.ok) throw new Error(join.reason);
    claimed(h.store, code, host, 'comet-pilot');
    claimed(h.store, code, join.participantId, 'comet-engineer');
    h.store.disconnect(code, host);
    expect(h.store.get(code)?.seats.hostId).toBe(host);
    h.advance(SEAT_HOLD_MS);
    h.store.sweep();
    expect(h.store.get(code)?.seats.hostId).toBe(join.participantId);
  });
});
