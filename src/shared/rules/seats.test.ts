import { describe, expect, it } from 'vitest';
import { ACTIVE_PLAYERS, SEAT_COUNT } from '../config.js';
import { SEAT_IDS, type Intent, type SeatId, type SetupStatus } from '../protocol.js';
import {
  addParticipant,
  canJoinAsPlayer,
  claimSeat,
  cometCrewReady,
  createSeatsState,
  nextHost,
  releaseSeat,
  removeParticipant,
  seatOf,
  switchToWatch,
  type SeatParticipant,
  type SeatResult,
  type SeatsState,
} from './seats.js';

function person(id: string, joinOrder: number, intent: Intent = 'play'): SeatParticipant {
  return { id, intent, connected: true, joinOrder, connectedSince: joinOrder };
}

function ok(result: SeatResult): SeatsState {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.state;
}

// Room created by "a", then b, c, d join to play.
function fullRoom(): SeatsState {
  let s = createSeatsState(person('a', 0));
  for (const [i, id] of ['b', 'c', 'd'].entries()) s = ok(addParticipant(s, person(id, i + 1)));
  return s;
}

function withSeat(s: SeatsState, seat: SeatId, patch: { setup?: SetupStatus; held?: boolean }): SeatsState {
  return { ...s, seats: { ...s.seats, [seat]: { ...s.seats[seat], ...patch } } };
}

function withParticipant(s: SeatsState, id: string, patch: Partial<SeatParticipant>): SeatsState {
  const participants = new Map(s.participants);
  const p = participants.get(id);
  if (!p) throw new Error(`no participant ${id}`);
  participants.set(id, { ...p, ...patch });
  return { ...s, participants };
}

describe('seats', () => {
  it('models exactly four seats, all open, with the creator as host', () => {
    const s = createSeatsState(person('a', 0));
    expect(SEAT_IDS).toHaveLength(SEAT_COUNT);
    expect(Object.keys(s.seats).sort()).toEqual([...SEAT_IDS].sort());
    for (const seat of SEAT_IDS) expect(s.seats[seat]).toEqual({ occupantId: null, setup: 'unverified', held: false, ready: false, swapRequested: false });
    expect(s.hostId).toBe('a');
  });

  it('assigns an open seat to an unseated play participant without mutating the input', () => {
    const s = fullRoom();
    const next = ok(claimSeat(s, 'b', 'nova-pilot'));
    expect(next.seats['nova-pilot'].occupantId).toBe('b');
    expect(seatOf(next, 'b')).toBe('nova-pilot');
    expect(s.seats['nova-pilot'].occupantId).toBeNull();
  });

  it('rejects an occupied seat as seat-taken', () => {
    const s = ok(claimSeat(fullRoom(), 'a', 'comet-pilot'));
    expect(claimSeat(s, 'b', 'comet-pilot')).toEqual({ ok: false, reason: 'seat-taken' });
  });

  it('rejects a held seat as seat-taken', () => {
    const s = withSeat(fullRoom(), 'comet-engineer', { held: true });
    expect(claimSeat(s, 'b', 'comet-engineer')).toEqual({ ok: false, reason: 'seat-taken' });
  });

  it('rejects a second seat for a seated participant as already-seated', () => {
    const s = ok(claimSeat(fullRoom(), 'a', 'comet-pilot'));
    expect(claimSeat(s, 'a', 'nova-engineer')).toEqual({ ok: false, reason: 'already-seated' });
  });

  it('rejects a claim from a watcher as watching', () => {
    const s = ok(addParticipant(fullRoom(), person('w', 4, 'watch')));
    expect(claimSeat(s, 'w', 'nova-engineer')).toEqual({ ok: false, reason: 'watching' });
  });

  it('rejects unknown participants and unseated releases', () => {
    const s = fullRoom();
    expect(claimSeat(s, 'zz', 'comet-pilot')).toEqual({ ok: false, reason: 'not-in-room' });
    expect(releaseSeat(s, 'b')).toEqual({ ok: false, reason: 'not-seated' });
  });

  it('release reopens the seat and clears its setup status, keeping the host', () => {
    let s = ok(claimSeat(fullRoom(), 'a', 'comet-pilot'));
    s = withSeat(s, 'comet-pilot', { setup: 'calibrated' });
    const next = ok(releaseSeat(s, 'a'));
    expect(next.seats['comet-pilot']).toEqual({ occupantId: null, setup: 'unverified', held: false, ready: false, swapRequested: false });
    expect(next.hostId).toBe('a');
  });

  it('switchToWatch releases the seat, changes intent, and moves the host', () => {
    let s = ok(claimSeat(fullRoom(), 'a', 'comet-pilot'));
    s = ok(claimSeat(s, 'c', 'nova-pilot'));
    const next = ok(switchToWatch(s, 'a'));
    expect(next.seats['comet-pilot'].occupantId).toBeNull();
    expect(next.participants.get('a')?.intent).toBe('watch');
    expect(next.hostId).toBe('c');
    expect(canJoinAsPlayer(next)).toBe(true);
  });

  it('transfers the host to the longest-connected seated play participant', () => {
    let s = fullRoom();
    s = ok(claimSeat(s, 'a', 'comet-pilot'));
    s = ok(claimSeat(s, 'b', 'comet-engineer'));
    s = ok(claimSeat(s, 'c', 'nova-pilot'));
    // b reconnected recently, so c has the longer current connection.
    s = withParticipant(s, 'b', { connectedSince: 100 });
    const next = removeParticipant(s, 'a');
    expect(next.participants.has('a')).toBe(false);
    expect(next.seats['comet-pilot'].occupantId).toBeNull();
    expect(next.hostId).toBe('c');
    expect(nextHost(next)).toBe('c');
  });

  it('prefers a connected seated player over a held one', () => {
    let s = fullRoom();
    s = ok(claimSeat(s, 'b', 'comet-engineer'));
    s = ok(claimSeat(s, 'c', 'nova-pilot'));
    s = withParticipant(s, 'b', { connected: false });
    s = withSeat(s, 'comet-engineer', { held: true });
    expect(nextHost(s)).toBe('c');
  });

  it('leaves the room hostless when nobody is seated, then the next claimer becomes host', () => {
    const s = ok(claimSeat(fullRoom(), 'b', 'comet-pilot'));
    const hostless = removeParticipant(removeParticipant(s, 'b'), 'a');
    expect(hostless.hostId).toBeNull();
    // Joining alone does not make a host.
    const joined = ok(addParticipant(hostless, person('e', 5)));
    expect(joined.hostId).toBeNull();
    const claimed = ok(claimSeat(joined, 'd', 'nova-engineer'));
    expect(claimed.hostId).toBe('d');
  });

  it('removing an unknown participant returns the same state', () => {
    const s = fullRoom();
    expect(removeParticipant(s, 'zz')).toBe(s);
  });

  it('allows a play join only below four play participants', () => {
    const s = fullRoom();
    expect(s.participants.size).toBe(ACTIVE_PLAYERS);
    expect(canJoinAsPlayer(s)).toBe(false);
    expect(addParticipant(s, person('e', 4))).toEqual({ ok: false, reason: 'room-full' });
    const watched = ok(addParticipant(s, person('w', 4, 'watch')));
    expect(watched.participants.size).toBe(ACTIVE_PLAYERS + 1);
    expect(addParticipant(s, person('a', 9))).toEqual({ ok: false, reason: 'already-in-room' });
  });

  it('reports the Comet crew ready only when both seats are occupied, connected, and calibrated', () => {
    let s = fullRoom();
    s = ok(claimSeat(s, 'a', 'comet-pilot'));
    expect(cometCrewReady(s)).toBe(false);
    s = ok(claimSeat(s, 'b', 'comet-engineer'));
    s = withSeat(s, 'comet-pilot', { setup: 'calibrated' });
    expect(cometCrewReady(s)).toBe(false);
    s = withSeat(s, 'comet-engineer', { setup: 'readings' });
    expect(cometCrewReady(s)).toBe(false);
    s = withSeat(s, 'comet-engineer', { setup: 'calibrated' });
    expect(cometCrewReady(s)).toBe(true);
    expect(cometCrewReady(withParticipant(s, 'b', { connected: false }))).toBe(false);
    expect(cometCrewReady(withSeat(s, 'comet-pilot', { held: true }))).toBe(false);
  });
});
