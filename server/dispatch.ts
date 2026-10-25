import {
  ABILITY_REQUESTS_PER_SEC,
  HEARTBEAT_TIMEOUT_MS,
  ROOM_CREATES_PER_MIN_PER_IP,
  ROOM_JOINS_PER_MIN_PER_IP,
  SERVER_STEERING_PER_SEC,
  SOCKET_MESSAGES_PER_SEC,
} from '../src/shared/config.js';
import type { ClientMessage, GameplayInput, RejectReason, SeatId, ServerMessage } from '../src/shared/protocol.js';
import type { QueuedInput } from '../src/shared/rules/control-test.js';
import { seatOf, seatReadiness, startBlocker } from '../src/shared/rules/seats.js';
import { IP_RATE_WINDOW_MS, RATE_WINDOW_MS } from './config.js';
import { rejectedAck, toRoomState } from './public-view.js';
import { EMPTY_LIMITER, tryHit, type WindowLimiter } from './rate-limit.js';
import type { RoomStore } from './rooms.js';
import type { Simulation } from './simulation.js';
import { validateMessage, type RawFrame } from './validate.js';

// Socket-free message handling (design: Gateway). Every check runs before any
// mutation, in the Requirement 8-10 order, so a refused message changes
// nothing and gets exactly one rejection. websocket.ts only moves frames.

export interface Connection {
  readonly id: string;
  // Rate-limit bucket only; never sent or logged (Requirement 22.6).
  readonly ip: string;
  code: string | null;
  participantId: string | null;
  lastHeartbeatMs: number;
  // Replay guard for gameplay input; restarts with each connection.
  lastSeq: number;
  limiter: WindowLimiter;
}

export type Outbound =
  | { readonly kind: 'send'; readonly to: string; readonly message: ServerMessage }
  | { readonly kind: 'room'; readonly code: string; readonly message: ServerMessage }
  // Unbind and close every other connection of this participant (Requirement 5.10).
  | { readonly kind: 'supersede'; readonly code: string; readonly participantId: string; readonly keep: string };

export interface DispatchDeps {
  readonly rooms: RoomStore;
  readonly simulation: Simulation;
  readonly controlTestEnabled: boolean;
  readonly createLimiters: Map<string, WindowLimiter>;
  readonly joinLimiters: Map<string, WindowLimiter>;
  // Keyed by `${code}/${seat}`, so a reconnect does not reset a seat's budget.
  readonly seatLimiters: Map<string, WindowLimiter>;
  log(event: string): void;
}

export function createConnection(id: string, ip: string, nowMs: number): Connection {
  return { id, ip, code: null, participantId: null, lastHeartbeatMs: nowMs, lastSeq: 0, limiter: EMPTY_LIMITER };
}

const OUTSIDE_ROOM_TYPES: ReadonlySet<ClientMessage['type']> = new Set([
  'room.create',
  'room.join',
  'seat.reconnect',
  'heartbeat',
]);

// Steering belongs to the Pilot and crew requests to the Engineer of the one
// rocket in the control test (Requirements 10.2, 10.3).
const INPUT_SEAT: Readonly<Record<GameplayInput['type'], SeatId>> = {
  'input.steer': 'comet-pilot',
  'input.charge': 'comet-engineer',
  'ability.request': 'comet-engineer',
};

function send(conn: Connection, message: ServerMessage): Outbound {
  return { kind: 'send', to: conn.id, message };
}

function reject(conn: Connection, requestId: number | null, reason: RejectReason, extra: { offerWatch?: boolean; retryAfterMs?: number } = {}): Outbound[] {
  return [send(conn, { type: 'request.rejected', requestId, reason, ...extra })];
}

function hitMap(map: Map<string, WindowLimiter>, key: string, nowMs: number, limit: number, windowMs: number) {
  const out = tryHit(map.get(key) ?? EMPTY_LIMITER, nowMs, limit, windowMs);
  map.set(key, out.limiter);
  return out;
}

// Seat changes can start, freeze, resume, or end the control test, so the
// lifecycle is settled before the room hears the new state.
function roomChanged(deps: DispatchDeps, code: string): Outbound[] {
  const room = deps.rooms.get(code);
  if (!room) return [];
  deps.simulation.sync(code, room.seats);
  const active = deps.simulation.current(code);
  return [{ kind: 'room', code, message: toRoomState(room, deps.controlTestEnabled, active?.matchId ?? null, deps.simulation.roomStatus(code)) }];
}

function toQueued(message: GameplayInput): QueuedInput {
  switch (message.type) {
    case 'input.steer':
      return { kind: 'steer', seq: message.seq, steering: message.steering };
    case 'input.charge':
      return { kind: 'charge', seq: message.seq };
    case 'ability.request':
      return message.intent === 'select'
        ? { kind: 'select', seq: message.seq, ability: message.ability }
        : { kind: 'activate', seq: message.seq };
  }
}

function handleInput(deps: DispatchDeps, conn: Connection, message: GameplayInput, nowMs: number): Outbound[] {
  const refuse = (reason: RejectReason) => [send(conn, rejectedAck(message.matchId, message.seq, reason))];
  const code = conn.code;
  const room = code === null ? undefined : deps.rooms.get(code);
  if (code === null || !room || conn.participantId === null) return refuse('not-in-room');

  // Authority comes only from the seat bound to this connection (Requirement 10.1).
  const seat = seatOf(room.seats, conn.participantId);
  const active = deps.simulation.current(code);
  const role = message.type === 'input.steer' ? 'pilot' : 'engineer';
  if (seat === null || (active?.mode === 'match' ? !seat.endsWith(role) : seat !== INPUT_SEAT[message.type])) return refuse('not-authorized');

  if (message.type !== 'input.charge') {
    const limit = message.type === 'input.steer' ? SERVER_STEERING_PER_SEC : ABILITY_REQUESTS_PER_SEC;
    if (!hitMap(deps.seatLimiters, `${code}/${seat}`, nowMs, limit, RATE_WINDOW_MS).allowed) return refuse('rate-limited');
  }

  if (!active) return refuse('no-control-test');
  if (active.mode === 'match' && !active.accepting) return refuse('not-running');
  if (message.matchId !== active.matchId) return refuse('stale-match');
  if (message.seq <= conn.lastSeq) return refuse('stale-sequence');

  const input = toQueued(message);
  const refused = deps.simulation.enqueue(code, conn.id, active.mode === 'match' ? { ...input, team: seat.startsWith('comet') ? 'comet' : 'nova' } : input);
  if (refused !== null) return refuse(refused);
  conn.lastSeq = message.seq;
  deps.rooms.touch(code);
  // The applied ack follows from the simulation after the step.
  return [];
}

function bind(conn: Connection, code: string, participantId: string): void {
  conn.code = code;
  conn.participantId = participantId;
}

function handle(deps: DispatchDeps, conn: Connection, message: ClientMessage, nowMs: number): Outbound[] {
  if (message.type === 'heartbeat') {
    conn.lastHeartbeatMs = nowMs;
    return [send(conn, { type: 'heartbeat.ack' })];
  }
  if (message.type === 'input.steer' || message.type === 'input.charge' || message.type === 'ability.request') {
    return handleInput(deps, conn, message, nowMs);
  }

  const inRoom = conn.code !== null && conn.participantId !== null;
  if (!inRoom && !OUTSIDE_ROOM_TYPES.has(message.type)) return reject(conn, message.requestId, 'not-in-room');
  if (inRoom && OUTSIDE_ROOM_TYPES.has(message.type)) return reject(conn, message.requestId, 'already-in-room');

  switch (message.type) {
    case 'room.create': {
      // Failed attempts count too, so probing costs budget (Requirement 2.9).
      const hit = hitMap(deps.createLimiters, conn.ip, nowMs, ROOM_CREATES_PER_MIN_PER_IP, IP_RATE_WINDOW_MS);
      if (!hit.allowed) return reject(conn, message.requestId, 'rate-limited', { retryAfterMs: hit.retryAfterMs });
      const { code, participantId } = deps.rooms.create(message.name);
      bind(conn, code, participantId);
      return [
        send(conn, { type: 'session.accepted', requestId: message.requestId, code, participantId, seat: null, token: null }),
        ...roomChanged(deps, code),
      ];
    }
    case 'room.join': {
      const hit = hitMap(deps.joinLimiters, conn.ip, nowMs, ROOM_JOINS_PER_MIN_PER_IP, IP_RATE_WINDOW_MS);
      if (!hit.allowed) return reject(conn, message.requestId, 'rate-limited', { retryAfterMs: hit.retryAfterMs });
      const out = deps.rooms.join(message.code, message.name, message.intent);
      if (!out.ok) {
        return reject(conn, message.requestId, out.reason, out.offerWatch ? { offerWatch: true } : {});
      }
      bind(conn, message.code, out.participantId);
      return [
        send(conn, {
          type: 'session.accepted',
          requestId: message.requestId,
          code: message.code,
          participantId: out.participantId,
          seat: null,
          token: null,
        }),
        ...roomChanged(deps, message.code),
      ];
    }
    case 'seat.reconnect': {
      const out = deps.rooms.reconnect(message.code, message.seat, message.token);
      if (!out.ok) return reject(conn, message.requestId, out.reason);
      bind(conn, message.code, out.participantId);
      // The phone already holds the token, so it is not sent again.
      return [
        { kind: 'supersede', code: message.code, participantId: out.participantId, keep: conn.id },
        send(conn, {
          type: 'session.accepted',
          requestId: message.requestId,
          code: message.code,
          participantId: out.participantId,
          seat: message.seat,
          token: null,
        }),
        ...roomChanged(deps, message.code),
      ];
    }
    default:
      return handleRoomRequest(deps, conn, message);
  }
}

type InRoomRequest = Extract<ClientMessage, { type: 'room.leave' | 'room.watch' | 'seat.claim' | 'seat.release' | 'setup.update' | 'ready.set' | 'match.start' }>;

function handleRoomRequest(deps: DispatchDeps, conn: Connection, message: InRoomRequest): Outbound[] {
  const code = conn.code ?? '';
  const pid = conn.participantId ?? '';
  const accepted = (): Outbound[] => [send(conn, { type: 'request.accepted', requestId: message.requestId }), ...roomChanged(deps, code)];
  const phase = deps.simulation.roomStatus(code).phase;
  const frozen = deps.simulation.current(code)?.frozen === true;
  if ((message.type === 'seat.claim' || message.type === 'ready.set') && phase !== 'lobby') return reject(conn, message.requestId, 'wrong-phase');
  if (message.type === 'setup.update' && phase !== 'lobby' && !(phase === 'running' && frozen)) return reject(conn, message.requestId, 'wrong-phase');
  if ((message.type === 'seat.release' || message.type === 'room.watch') && (phase === 'countdown' || phase === 'running')) return reject(conn, message.requestId, 'wrong-phase');

  switch (message.type) {
    case 'ready.set': {
      const out = deps.rooms.setReady(code, pid, message.ready);
      return out.ok ? accepted() : reject(conn, message.requestId, out.reason);
    }
    case 'match.start': {
      const room = deps.rooms.get(code);
      if (!room || room.seats.hostId !== pid) return reject(conn, message.requestId, 'not-host');
      if (phase !== 'lobby') return reject(conn, message.requestId, 'wrong-phase');
      if (startBlocker(seatReadiness(room.seats))) return reject(conn, message.requestId, 'start-blocked');
      deps.simulation.startMatch(code, room.seats);
      deps.rooms.clearReady(code);
      deps.rooms.touch(code);
      return accepted();
    }
    case 'seat.claim': {
      const out = deps.rooms.claim(code, pid, message.seat);
      if (!out.ok) return reject(conn, message.requestId, out.reason);
      // The token goes to this connection alone (Requirement 5.2).
      return [
        send(conn, {
          type: 'session.accepted',
          requestId: message.requestId,
          code,
          participantId: pid,
          seat: message.seat,
          token: out.token,
        }),
        ...roomChanged(deps, code),
      ];
    }
    case 'seat.release': {
      const out = deps.rooms.release(code, pid);
      return out.ok ? accepted() : reject(conn, message.requestId, out.reason);
    }
    case 'room.watch': {
      const out = deps.rooms.watch(code, pid);
      return out.ok ? accepted() : reject(conn, message.requestId, out.reason);
    }
    case 'setup.update': {
      const out = deps.rooms.setSetup(code, pid, message.status);
      return out.ok ? accepted() : reject(conn, message.requestId, out.reason);
    }
    case 'room.leave': {
      deps.rooms.leave(code, pid);
      conn.code = null;
      conn.participantId = null;
      conn.lastSeq = 0;
      // The leaver is unbound first, so the room broadcast skips it.
      return [send(conn, { type: 'request.accepted', requestId: message.requestId }), ...roomChanged(deps, code)];
    }
  }
}

export function dispatch(deps: DispatchDeps, conn: Connection, frame: RawFrame, isBinary: boolean, nowMs: number): Outbound[] {
  try {
    // Flood check first, before spending any parsing (Requirement 9.1).
    const hit = tryHit(conn.limiter, nowMs, SOCKET_MESSAGES_PER_SEC, RATE_WINDOW_MS);
    conn.limiter = hit.limiter;
    if (!hit.allowed) return reject(conn, null, 'rate-limited', { retryAfterMs: hit.retryAfterMs });

    const validated = validateMessage(frame, isBinary);
    if (!validated.ok) return reject(conn, validated.requestId, validated.reason);
    return handle(deps, conn, validated.message, nowMs);
  } catch (error) {
    // Logged by kind only; never names, codes, tokens, or addresses.
    deps.log(`dispatch error: ${error instanceof Error ? error.name : 'unknown'}`);
    return [];
  }
}

// Socket closed or heartbeat timed out. A seated player's seat is held; the
// control test freezes through the lifecycle sync (Requirement 11.4).
export function handleClose(deps: DispatchDeps, conn: Connection): Outbound[] {
  const { code, participantId } = conn;
  conn.code = null;
  conn.participantId = null;
  if (code === null || participantId === null) return [];
  deps.rooms.disconnect(code, participantId);
  return roomChanged(deps, code);
}

export function isHeartbeatExpired(conn: Connection, nowMs: number): boolean {
  return nowMs - conn.lastHeartbeatMs >= HEARTBEAT_TIMEOUT_MS;
}

export interface HousekeepingResult {
  readonly outbound: Outbound[];
  readonly expiredRooms: string[];
}

// Seat holds, room expiry, and limiter pruning (Requirements 5.9, 6.3).
export function housekeeping(deps: DispatchDeps, nowMs: number): HousekeepingResult {
  const { expiredRooms, reopenedSeats } = deps.rooms.sweep();
  const outbound: Outbound[] = [];
  for (const code of expiredRooms) {
    deps.simulation.remove(code);
    for (const key of [...deps.seatLimiters.keys()]) if (key.startsWith(`${code}/`)) deps.seatLimiters.delete(key);
  }
  const changed = new Set(reopenedSeats.map((r) => r.code).filter((code) => !expiredRooms.includes(code)));
  for (const code of changed) outbound.push(...roomChanged(deps, code));
  for (const map of [deps.createLimiters, deps.joinLimiters]) pruneLimiters(map, nowMs, IP_RATE_WINDOW_MS);
  return { outbound, expiredRooms };
}

function pruneLimiters(map: Map<string, WindowLimiter>, nowMs: number, windowMs: number): void {
  for (const [key, limiter] of map) {
    if (limiter.hits.every((t) => t <= nowMs - windowMs)) map.delete(key);
  }
}
