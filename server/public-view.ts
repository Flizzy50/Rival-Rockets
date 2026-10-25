import {
  SEAT_IDS,
  type InputAck,
  type ControlTestStateMessage,
  type MatchSnapshotMessage,
  type PublicMatchResult,
  type ReturnReason,
  type RoomPhase,
  type TeamId,
  type PublicCrewState,
  type PublicPose,
  type RejectReason,
  type RoomStateMessage,
} from '../src/shared/protocol.js';
import { getAbilityStatus, type CrewAbilityState } from '../src/shared/rules/abilities.js';
import type { ControlTestState, InputResult } from '../src/shared/rules/control-test.js';
import type { Room } from './rooms.js';
import { MATCH_DURATION_MS } from '../src/shared/config.js';
import type { MatchState } from '../src/shared/rules/match.js';
import { nextGateIndex, teamScore, type MatchResult, type ScoreBreakdown } from '../src/shared/rules/scoring.js';

// Public_View (Requirements 5.3, 5.4): every outgoing state object is built
// field by field from an allowlist. Server records are never spread, so
// tokens, hold deadlines, connection ids, IPs, and limiter state cannot leak
// even if a record gains a field later.

export function toPose(pose: PublicPose): PublicPose {
  return { x: pose.x, y: pose.y, heading: pose.heading };
}

export function toCrew(crew: CrewAbilityState, sessionMs: number): PublicCrewState {
  const status = getAbilityStatus(crew, sessionMs);
  return {
    energy: crew.energy,
    selected: crew.selectedAbility,
    active: status.activeAbility,
    effectRemainingMs: status.effectRemainingMs,
    cooldownRemainingMs: status.cooldownRemainingMs,
  };
}

export function toRoomState(room: Room, controlTestEnabled: boolean, activeMatchId: number | null, status: { phase: RoomPhase; result: PublicMatchResult | null; returnReason: ReturnReason | null } = { phase: 'lobby', result: null, returnReason: null }, nowMs = 0): RoomStateMessage {
  const participants = [...room.seats.participants.values()]
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((p) => ({
      id: p.id,
      name: room.names.get(p.id) ?? '',
      intent: p.intent,
      connected: p.connected,
    }));
  const seats = SEAT_IDS.map((seat) => {
    const slot = room.seats.seats[seat];
    const occupant = slot.occupantId === null ? undefined : room.seats.participants.get(slot.occupantId);
    return {
      seat,
      occupantId: slot.occupantId,
      setup: slot.setup,
      connected: occupant?.connected ?? false,
      held: slot.held,
      ready: slot.ready,
      swapRequested: slot.swapRequested,
      // A remaining duration, not the deadline, so phone clocks need not agree.
      holdRemainingMs: (() => { const until = room.holdUntilMs[seat]; return until === null ? null : Math.max(0, until - nowMs); })(),
    };
  });
  return {
    type: 'room.state',
    code: room.code,
    hostId: room.seats.hostId,
    controlTestEnabled,
    activeMatchId,
    phase: status.phase,
    result: status.result,
    returnReason: status.returnReason,
    participants,
    seats,
  };
}

export function toMatchState(test: ControlTestState, frozen: boolean): ControlTestStateMessage {
  return {
    type: 'match.state',
    matchId: test.matchId,
    mode: 'control-test',
    tick: test.tick,
    sessionMs: test.sessionMs,
    frozen,
    pose: toPose(test.pose),
    steering: test.steering,
    crew: toCrew(test.crew, test.sessionMs),
  };
}

// Built after the step that handled the input, so it reports applied state
// (design M2-5). Steer acks carry the pose; crew acks carry the crew.
export function toAck(test: ControlTestState, result: InputResult): InputAck {
  const base = { type: 'input.ack', matchId: test.matchId, seq: result.seq } as const;
  if (result.status === 'rejected') {
    return { ...base, status: 'rejected', reason: result.reason, tick: test.tick, crew: toCrew(test.crew, test.sessionMs) };
  }
  if (result.kind === 'steer') {
    return { ...base, status: 'applied', tick: test.tick, steering: test.steering, pose: toPose(test.pose) };
  }
  return { ...base, status: 'applied', tick: test.tick, crew: toCrew(test.crew, test.sessionMs) };
}

// Gateway refusals happen before any step, so they carry no state.
export function rejectedAck(matchId: number, seq: number, reason: RejectReason): InputAck {
  return { type: 'input.ack', matchId, seq, status: 'rejected', reason };
}

export function toPublicResult(result: MatchResult, matchId: number): PublicMatchResult {
  const score = (b: ScoreBreakdown) => ({ crossings: b.crossings, checkpointPoints: b.checkpointPoints, carried: b.carried, corePoints: b.corePoints, total: b.total });
  return { matchId, outcome: result.outcome, winner: result.winner, teams: { comet: score(result.teams.comet), nova: score(result.teams.nova) } };
}
export function toMatchSnapshot(state: MatchState, phase: MatchSnapshotMessage['phase'], frozen: boolean, countdownRemainingMs: number, resumeRemainingMs = 0): MatchSnapshotMessage {
  const crew = (team: TeamId) => {
    const c = state.crews[team];
    return { ...toCrew(c.abilities, state.matchMs), crossings: c.crossings, nextGate: nextGateIndex(c.crossings), carried: c.carried, score: teamScore(c.crossings, c.carried) };
  };
  return {
    type: 'match.state', mode: 'match', matchId: state.matchId, phase, tick: state.tick, matchMs: state.matchMs,
    remainingMs: Math.max(0, MATCH_DURATION_MS - state.matchMs), countdownRemainingMs, frozen, resumeRemainingMs,
    rockets: { comet: toPose(state.crews.comet.rocket.pose), nova: toPose(state.crews.nova.rocket.pose) },
    crews: { comet: crew('comet'), nova: crew('nova') },
    courseCores: state.course.map((c) => ({ available: c.respawnAtMs === null })),
    droppedCores: state.dropped.map((c) => ({ id: c.id, x: c.x, y: c.y, owner: c.owner, lockRemainingMs: Math.max(0, c.ownerUnlockAtMs - state.matchMs), lifeRemainingMs: Math.max(0, c.expiresAtMs - state.matchMs) })),
  };
}
export function toMatchAck(state: MatchState, team: TeamId, result: InputResult): InputAck {
  const c = state.crews[team];
  const base = { type: 'input.ack', matchId: state.matchId, seq: result.seq, tick: state.tick } as const;
  if (result.status === 'rejected') return { ...base, status: 'rejected', reason: result.reason, crew: toCrew(c.abilities, state.matchMs) };
  if (result.kind === 'steer') return { ...base, status: 'applied', steering: c.rocket.steering, pose: toPose(c.rocket.pose) };
  return { ...base, status: 'applied', crew: toCrew(c.abilities, state.matchMs) };
}
