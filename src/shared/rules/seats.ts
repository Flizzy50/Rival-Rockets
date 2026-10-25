import { ACTIVE_PLAYERS } from '../config.js';
import { SEAT_IDS, type Intent, type RejectReason, type SeatId, type SetupStatus } from '../protocol.js';

// Seat and host rules (PRD 1, 8). Pure: clocks and ordering arrive as plain
// numbers in the state, and every operation returns a new state, so the
// Room_Store and property tests share one implementation. Tokens, hold
// deadlines, and expiry stay in the Room_Store.

export interface SeatParticipant {
  readonly id: string;
  readonly intent: Intent;
  readonly connected: boolean;
  // Monotonic join counter; breaks host ties deterministically.
  readonly joinOrder: number;
  // Server_Clock time the current connection began.
  readonly connectedSince: number;
}

export interface SeatSlot {
  readonly occupantId: string | null;
  readonly setup: SetupStatus;
  // Held for a disconnected occupant (PRD 8); the occupant keeps the seat.
  readonly held: boolean;
}

export interface SeatsState {
  readonly participants: ReadonlyMap<string, SeatParticipant>;
  readonly seats: Readonly<Record<SeatId, SeatSlot>>;
  readonly hostId: string | null;
}

// Failures carry no state, so a caller cannot apply a half-done change.
export type SeatResult =
  | { readonly ok: true; readonly state: SeatsState }
  | { readonly ok: false; readonly reason: RejectReason };

const COMET_SEATS = ['comet-pilot', 'comet-engineer'] as const satisfies readonly SeatId[];

const OPEN_SEAT: SeatSlot = { occupantId: null, setup: 'unverified', held: false };

function openSeats(): Record<SeatId, SeatSlot> {
  const seats = {} as Record<SeatId, SeatSlot>;
  for (const seat of SEAT_IDS) seats[seat] = OPEN_SEAT;
  return seats;
}

// The room creator is the first participant and, playing, the first host
// (Requirement 2.1). A watching creator leaves the room hostless (4.10).
export function createSeatsState(creator: SeatParticipant): SeatsState {
  return {
    participants: new Map([[creator.id, creator]]),
    seats: openSeats(),
    hostId: creator.intent === 'play' ? creator.id : null,
  };
}

export function seatOf(s: SeatsState, participantId: string): SeatId | null {
  for (const seat of SEAT_IDS) {
    if (s.seats[seat].occupantId === participantId) return seat;
  }
  return null;
}

function playCount(s: SeatsState): number {
  let count = 0;
  for (const p of s.participants.values()) if (p.intent === 'play') count += 1;
  return count;
}

// Held seats keep their participant, so a disconnected player still counts
// toward the four (Requirement 2.5).
export function canJoinAsPlayer(s: SeatsState): boolean {
  return playCount(s) < ACTIVE_PLAYERS;
}

// Joining never assigns the host: a hostless room gets one on the next seat
// claim (Requirement 4.9).
export function addParticipant(s: SeatsState, participant: SeatParticipant): SeatResult {
  if (s.participants.has(participant.id)) return { ok: false, reason: 'already-in-room' };
  if (participant.intent === 'play' && !canJoinAsPlayer(s)) return { ok: false, reason: 'room-full' };
  const participants = new Map(s.participants);
  participants.set(participant.id, participant);
  return { ok: true, state: { ...s, participants } };
}

export function claimSeat(s: SeatsState, participantId: string, seat: SeatId): SeatResult {
  const participant = s.participants.get(participantId);
  if (!participant) return { ok: false, reason: 'not-in-room' };
  if (participant.intent === 'watch') return { ok: false, reason: 'watching' };
  if (seatOf(s, participantId) !== null) return { ok: false, reason: 'already-seated' };
  const slot = s.seats[seat];
  if (slot.occupantId !== null || slot.held) return { ok: false, reason: 'seat-taken' };
  return {
    ok: true,
    state: {
      ...s,
      seats: { ...s.seats, [seat]: { occupantId: participantId, setup: 'unverified', held: false } },
      hostId: s.hostId ?? participantId,
    },
  };
}

function withSeatOpened(s: SeatsState, seat: SeatId): SeatsState {
  return { ...s, seats: { ...s.seats, [seat]: OPEN_SEAT } };
}

// The host keeps the role after releasing a seat: PRD 8 ties the host to the
// person, not the seat.
export function releaseSeat(s: SeatsState, participantId: string): SeatResult {
  if (!s.participants.has(participantId)) return { ok: false, reason: 'not-in-room' };
  const seat = seatOf(s, participantId);
  if (seat === null) return { ok: false, reason: 'not-seated' };
  return { ok: true, state: withSeatOpened(s, seat) };
}

// A watcher can never hold the host role (Requirement 4.10), so a host who
// switches to watch hands it on.
export function switchToWatch(s: SeatsState, participantId: string): SeatResult {
  const participant = s.participants.get(participantId);
  if (!participant) return { ok: false, reason: 'not-in-room' };
  if (participant.intent === 'watch') return { ok: true, state: s };
  const seat = seatOf(s, participantId);
  const opened = seat === null ? s : withSeatOpened(s, seat);
  const participants = new Map(s.participants);
  participants.set(participantId, { ...participant, intent: 'watch' });
  const next: SeatsState = { ...opened, participants };
  return { ok: true, state: next.hostId === participantId ? { ...next, hostId: nextHost(next) } : next };
}

// Only a seated participant has a setup status to report (Requirement 18.3).
export function setSeatSetup(s: SeatsState, participantId: string, status: SetupStatus): SeatResult {
  if (!s.participants.has(participantId)) return { ok: false, reason: 'not-in-room' };
  const seat = seatOf(s, participantId);
  if (seat === null) return { ok: false, reason: 'not-seated' };
  if (s.seats[seat].setup === status) return { ok: true, state: s };
  return { ok: true, state: { ...s, seats: { ...s.seats, [seat]: { ...s.seats[seat], setup: status } } } };
}

// A disconnected occupant keeps the seat, marked held, so nobody else can take
// it during the hold (PRD 8). Reconnecting starts a new connection, so
// connectedSince moves to that time.
export function setConnected(s: SeatsState, participantId: string, connected: boolean, nowMs: number): SeatsState {
  const participant = s.participants.get(participantId);
  if (!participant) return s;
  const participants = new Map(s.participants);
  participants.set(participantId, {
    ...participant,
    connected,
    connectedSince: connected && !participant.connected ? nowMs : participant.connectedSince,
  });
  const seat = seatOf(s, participantId);
  const seats = seat === null ? s.seats : { ...s.seats, [seat]: { ...s.seats[seat], held: !connected } };
  return { ...s, participants, seats };
}

// Used for leave and for an expired seat hold. Unknown ids are a no-op so
// a late sweep or duplicate leave cannot fail.
export function removeParticipant(s: SeatsState, participantId: string): SeatsState {
  if (!s.participants.has(participantId)) return s;
  const seat = seatOf(s, participantId);
  const opened = seat === null ? s : withSeatOpened(s, seat);
  const participants = new Map(s.participants);
  participants.delete(participantId);
  const next: SeatsState = { ...opened, participants };
  return next.hostId === participantId ? { ...next, hostId: nextHost(next) } : next;
}

// Longest-connected seated play participant (PRD 8). Connected occupants come
// first; a held occupant is still seated, so it only wins when nobody seated
// is connected, rather than leaving the room hostless (Requirement 4.9).
export function nextHost(s: SeatsState): string | null {
  let best: SeatParticipant | null = null;
  for (const seat of SEAT_IDS) {
    const id = s.seats[seat].occupantId;
    if (id === null) continue;
    const p = s.participants.get(id);
    if (!p || p.intent !== 'play') continue;
    if (best === null || ranksBefore(p, best)) best = p;
  }
  return best?.id ?? null;
}

function ranksBefore(a: SeatParticipant, b: SeatParticipant): boolean {
  if (a.connected !== b.connected) return a.connected;
  if (a.connectedSince !== b.connectedSince) return a.connectedSince < b.connectedSince;
  return a.joinOrder < b.joinOrder;
}

// Gate for the M2 control test: both Comet seats occupied, live, and
// calibrated. Nova seats are irrelevant until M3.
export function cometCrewReady(s: SeatsState): boolean {
  return COMET_SEATS.every((seat) => {
    const slot = s.seats[seat];
    if (slot.occupantId === null || slot.held || slot.setup !== 'calibrated') return false;
    return s.participants.get(slot.occupantId)?.connected === true;
  });
}
