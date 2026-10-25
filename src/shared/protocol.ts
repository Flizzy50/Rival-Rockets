import type { Ability } from './rules/abilities.js';

// M2 wire contract (PRD 8), imported by both client and server so message
// shapes cannot drift. Types and small value lists only: the server validator
// (server/validate.ts) does the runtime checks.
//
// Client messages carry only normalized steering, charge events, ability
// requests, and room/seat actions. No raw sensor data, positions, energy, or
// scores ever travel from a phone (PRD 8, Requirement 8.7).
//
// Unknown messages are rejected.

export type { Ability };

export type TeamId = 'comet' | 'nova';
export type Role = 'pilot' | 'engineer';
export type SeatId = `${TeamId}-${Role}`;
export type RoomPhase = 'lobby' | 'countdown' | 'running' | 'results';
// Why the room went back to the lobby without a result. "interrupted" is a
// seat that never came back (PRD 8); "match-error" is a server fault.
export type ReturnReason = 'countdown-cancelled' | 'interrupted' | 'match-error';
export type StartStep = 'join' | 'reconnect' | 'calibrate' | 'ready';
export interface StartBlocker { readonly seat: SeatId; readonly step: StartStep }

// Fixed seat order for lobby columns and public room state.
export const SEAT_IDS = [
  'comet-pilot',
  'comet-engineer',
  'nova-pilot',
  'nova-engineer',
] as const satisfies readonly SeatId[];

export const INTENTS = ['play', 'watch'] as const;
export type Intent = (typeof INTENTS)[number];

export type SetupStatus = 'unverified' | 'readings' | 'calibrated';
// A phone may only report progress; "unverified" is the server's reset state,
// so a client can never claim it back or skip to it (Requirement 18.2).
export const REPORTED_SETUP_STATUSES = ['readings', 'calibrated'] as const satisfies readonly SetupStatus[];
export type ReportedSetupStatus = (typeof REPORTED_SETUP_STATUSES)[number];

export const ABILITIES = ['boost', 'shield'] as const satisfies readonly Ability[];

export const REJECT_REASONS = [
  // Validator (developer-facing).
  'invalid-message',
  'too-large',
  'unknown-type',
  'invalid-field',
  'invalid-value',
  'invalid-name',
  // Rate limits.
  'rate-limited',
  // Rooms and seats.
  'room-not-found',
  'room-full',
  'not-in-room',
  'already-in-room',
  'seat-taken',
  'already-seated',
  'watching',
  'not-seated',
  'reconnect-denied',
  // Gameplay input authorization and ordering.
  'not-authorized',
  'stale-match',
  'stale-sequence',
  'no-control-test',
  'wrong-phase',
  'not-host',
  'start-blocked',
  'not-calibrated',
  'not-running',
  // Ability rules.
  'full',
  'cooldown',
  'not-enough-energy',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const ROOM_ERROR_REASONS = ['room-expired', 'server-closing'] as const;
export type RoomErrorReason = (typeof ROOM_ERROR_REASONS)[number];

// ---------------------------------------------------------------------------
// Client -> server

// Room, seat, and setup requests carry a requestId so the reply can be matched;
// gameplay inputs carry matchId and seq for staleness and replay checks.
export type ClientMessage =
  | { readonly type: 'room.create'; readonly requestId: number; readonly name: string }
  | {
      readonly type: 'room.join';
      readonly requestId: number;
      readonly code: string;
      readonly name: string;
      readonly intent: Intent;
    }
  | { readonly type: 'room.leave'; readonly requestId: number }
  | { readonly type: 'room.watch'; readonly requestId: number }
  | { readonly type: 'seat.claim'; readonly requestId: number; readonly seat: SeatId }
  | { readonly type: 'seat.release'; readonly requestId: number }
  | {
      readonly type: 'seat.reconnect';
      readonly requestId: number;
      readonly code: string;
      readonly seat: SeatId;
      readonly token: string;
    }
  | { readonly type: 'setup.update'; readonly requestId: number; readonly status: ReportedSetupStatus }
  | { readonly type: 'ready.set'; readonly requestId: number; readonly ready: boolean }
  | { readonly type: 'match.start'; readonly requestId: number }
  // Host on Results: back to the lobby for a fresh match.
  | { readonly type: 'match.rematch'; readonly requestId: number }
  // On Results: toggles this player's consent to swap with the crewmate.
  | { readonly type: 'match.swap'; readonly requestId: number }
  | { readonly type: 'input.steer'; readonly matchId: number; readonly seq: number; readonly steering: number }
  | { readonly type: 'input.charge'; readonly matchId: number; readonly seq: number }
  // Select carries the ability; activate never does, because the server
  // activates its own selected ability (Requirement 14.9).
  | {
      readonly type: 'ability.request';
      readonly matchId: number;
      readonly seq: number;
      readonly intent: 'select';
      readonly ability: Ability;
    }
  | { readonly type: 'ability.request'; readonly matchId: number; readonly seq: number; readonly intent: 'activate' }
  | { readonly type: 'heartbeat' };

export type ClientMessageType = ClientMessage['type'];
export type RoomRequest = Extract<ClientMessage, { readonly requestId: number }>;
export type GameplayInput = Extract<ClientMessage, { readonly seq: number }>;

// Omit that keeps each union member separate, so the net client can take a
// message without the id it assigns itself.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RoomRequestWithoutId = DistributiveOmit<RoomRequest, 'requestId'>;
export type GameplayInputWithoutSeq = DistributiveOmit<GameplayInput, 'seq'>;

// ---------------------------------------------------------------------------
// Public state shapes. Built field by field by server/public-view.ts, so tokens,
// connection ids, IPs, limiter state, and hold deadlines never appear here.

export interface PublicParticipant {
  readonly id: string;
  readonly name: string;
  readonly intent: Intent;
  readonly connected: boolean;
}

export interface PublicSeat {
  readonly ready: boolean;
  readonly seat: SeatId;
  readonly occupantId: string | null;
  readonly setup: SetupStatus;
  readonly connected: boolean;
  readonly held: boolean;
  // Time left to come back with usable controls, or null with no hold.
  readonly holdRemainingMs: number | null;
  readonly swapRequested: boolean;
}

// Wire form of the rocket pose: radians, 0 = +x, clockwise positive (y down).
// Structurally matches the physics pose so the server can copy it field by field.
export interface PublicPose {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

// Deadlines travel as remaining durations so device clocks need not agree.
export interface PublicCrewState {
  readonly energy: number;
  readonly selected: Ability;
  readonly active: Ability | null;
  readonly effectRemainingMs: number;
  readonly cooldownRemainingMs: number;
}

// ---------------------------------------------------------------------------
// Server -> client

// Private: sent only to the requesting connection, because it can carry the
// seat's reconnect token (Requirement 5.2).
export interface SessionAccepted {
  readonly type: 'session.accepted';
  readonly requestId: number;
  readonly code: string;
  readonly participantId: string;
  readonly seat: SeatId | null;
  readonly token: string | null;
}

// Reply to leave, release, watch, and setup requests, which change no private
// data. Create, join, claim, and reconnect answer with session.accepted.
export interface RequestAccepted {
  readonly type: 'request.accepted';
  readonly requestId: number;
}

export interface RoomStateMessage {
  readonly phase: RoomPhase;
  readonly result: PublicMatchResult | null;
  readonly returnReason: ReturnReason | null;
  readonly type: 'room.state';
  readonly code: string;
  // Null while no seated play participant can take the host role (Requirement 4.9).
  readonly hostId: string | null;
  readonly controlTestEnabled: boolean;
  // Running control test, or null. Lets every screen tell "waiting" from
  // "ended" without waiting for a snapshot that will never come.
  readonly activeMatchId: number | null;
  readonly participants: readonly PublicParticipant[];
  readonly seats: readonly PublicSeat[];
}

// Control test snapshot. No score, timer, checkpoint, core, or result fields:
// those arrive with the M3 match (Requirement 17.4).
export interface ControlTestStateMessage {
  readonly type: 'match.state';
  readonly matchId: number;
  readonly mode: 'control-test';
  readonly tick: number;
  readonly sessionMs: number;
  readonly frozen: boolean;
  readonly pose: PublicPose;
  readonly steering: number;
  readonly crew: PublicCrewState;
}

export interface PublicScoreBreakdown { readonly crossings: number; readonly checkpointPoints: number; readonly carried: number; readonly corePoints: number; readonly total: number }
export interface PublicMatchResult { readonly matchId: number; readonly outcome: 'win' | 'draw'; readonly winner: TeamId | null; readonly teams: Readonly<Record<TeamId, PublicScoreBreakdown>> }
export interface PublicMatchCrew extends PublicCrewState { readonly crossings: number; readonly nextGate: number; readonly carried: number; readonly score: number }
export interface PublicDroppedCore { readonly id: number; readonly x: number; readonly y: number; readonly owner: TeamId; readonly lockRemainingMs: number; readonly lifeRemainingMs: number }
export interface MatchSnapshotMessage {
  readonly type: 'match.state'; readonly mode: 'match'; readonly matchId: number;
  readonly phase: 'countdown' | 'running' | 'complete'; readonly tick: number; readonly matchMs: number;
  readonly remainingMs: number; readonly countdownRemainingMs: number; readonly frozen: boolean;
  // Above 0 while a paused match counts down to resume (still frozen).
  readonly resumeRemainingMs: number;
  readonly rockets: Readonly<Record<TeamId, PublicPose>>;
  readonly crews: Readonly<Record<TeamId, PublicMatchCrew>>;
  readonly courseCores: readonly { readonly available: boolean }[];
  readonly droppedCores: readonly PublicDroppedCore[];
}
export type MatchStateMessage = ControlTestStateMessage | MatchSnapshotMessage;

interface InputAckBase {
  readonly type: 'input.ack';
  readonly matchId: number;
  readonly seq: number;
}

// Applied acks report the state after the step that applied the input
// (Requirements 12.2, 12.4, 12.5).
export interface AppliedSteerAck extends InputAckBase {
  readonly status: 'applied';
  readonly tick: number;
  readonly steering: number;
  readonly pose: PublicPose;
}

export interface AppliedCrewAck extends InputAckBase {
  readonly status: 'applied';
  readonly tick: number;
  readonly crew: PublicCrewState;
}

// Gateway rejections happen before any step, so tick and crew are present only
// when the step itself rejected the input (e.g. cooldown, not-enough-energy).
export interface RejectedInputAck extends InputAckBase {
  readonly status: 'rejected';
  readonly reason: RejectReason;
  readonly tick?: number;
  readonly crew?: PublicCrewState;
}

export type InputAck = AppliedSteerAck | AppliedCrewAck | RejectedInputAck;

export interface RequestRejected {
  readonly type: 'request.rejected';
  // Null when the frame was too broken to recover a requestId.
  readonly requestId: number | null;
  readonly reason: RejectReason;
  // Set with room-full so the client can offer Watch instead.
  readonly offerWatch?: boolean;
  // Set with rate-limited on create/join.
  readonly retryAfterMs?: number;
}

export interface RoomError {
  readonly type: 'room.error';
  readonly reason: RoomErrorReason;
}

export interface HeartbeatAck {
  readonly type: 'heartbeat.ack';
}

// Private, to each swapped player: the new seat and its fresh token.
export interface SeatSwapped {
  readonly type: 'seat.swapped';
  readonly code: string;
  readonly seat: SeatId;
  readonly token: string;
}

export type ServerMessage =
  | SessionAccepted
  | RequestAccepted
  | RoomStateMessage
  | MatchStateMessage
  | InputAck
  | RequestRejected
  | RoomError
  | HeartbeatAck
  | SeatSwapped;

export type ServerMessageType = ServerMessage['type'];
