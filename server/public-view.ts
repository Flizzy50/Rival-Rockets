import {
  SEAT_IDS,
  type InputAck,
  type MatchStateMessage,
  type PublicCrewState,
  type PublicPose,
  type RejectReason,
  type RoomStateMessage,
} from '../src/shared/protocol.js';
import { getAbilityStatus, type CrewAbilityState } from '../src/shared/rules/abilities.js';
import type { ControlTestState, InputResult } from '../src/shared/rules/control-test.js';
import type { Room } from './rooms.js';

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

export function toRoomState(room: Room, controlTestEnabled: boolean, activeMatchId: number | null): RoomStateMessage {
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
    };
  });
  return {
    type: 'room.state',
    code: room.code,
    hostId: room.seats.hostId,
    controlTestEnabled,
    activeMatchId,
    participants,
    seats,
  };
}

export function toMatchState(test: ControlTestState, frozen: boolean): MatchStateMessage {
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
