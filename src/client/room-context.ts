import type {
  GameplayInputWithoutSeq,
  InputAck,
  MatchStateMessage,
  RoomRequestWithoutId,
  RoomStateMessage,
  SeatId,
  TeamId,
} from '../shared/protocol';
import { REQUEST_TIMEOUT_MS } from '../shared/config';
import type { Role } from './motion/controller';
import { createCrewView, reduceCrewView, type CrewEvent, type CrewView } from './crew-view';
import { createBuffer, pushSnapshot, type SnapshotBuffer } from './net/interpolate';
import { createLatencyMonitor, type LatencyMonitor } from './net/latency';
import { clearSession, loadSession, saveSession } from './net/session';
import { connectNet, socketUrl, type NetClient, type NetStatus, type RequestReply, type SocketLike } from './net/socket';

// Room context (design: room-context.ts): the latest server state for this
// phone, its own seat, the snapshot buffer, and the crew view. Screens read
// it and subscribe to changes, so none of them depends on app.ts internals.

export type CrewKind = 'charge' | 'select' | 'activate';

export type RoomEvent =
  | { readonly type: 'room' }
  | { readonly type: 'match' }
  | { readonly type: 'ack'; readonly ack: InputAck; readonly kind: CrewKind | 'steer' }
  | { readonly type: 'status'; readonly status: NetStatus }
  | { readonly type: 'room-error'; readonly reason: 'room-expired' | 'server-closing' };

export interface RoomContext {
  readonly net: NetClient;
  readonly latency: LatencyMonitor;
  readonly participantId: string | null;
  readonly roomState: RoomStateMessage | null;
  readonly matchState: MatchStateMessage | null;
  readonly buffer: SnapshotBuffer;
  readonly crew: CrewView;
  // Derived from room.state, which is authoritative for seats.
  readonly seat: SeatId | null;
  readonly code: string | null;
  // Running, unfrozen control test id, or null.
  readonly liveMatchId: number | null;
  whenOpen(): Promise<void>;
  // Like net.request, but an accepted request resolves only after the
  // room.state the server sends right after it, so seat and room reads are
  // current when the caller navigates.
  request(message: RoomRequestWithoutId): Promise<RequestReply>;
  sendCrewInput(kind: CrewKind, message: GameplayInputWithoutSeq): number | null;
  crewEvent(event: CrewEvent): void;
  // Render delay (Requirement 22.4): call once per frame with the session
  // time the frame displays.
  recordRender(renderSessionMs: number, nowMs: number): void;
  subscribe(listener: (event: RoomEvent) => void): () => void;
  dispose(): void;
}

export function seatRole(seat: SeatId): Role {
  return seat.endsWith('pilot') ? 'pilot' : 'engineer';
}

export function seatTeam(seat: SeatId): TeamId {
  return seat.startsWith('comet') ? 'comet' : 'nova';
}

export function createRoomContext(
  location: { protocol: string; host: string },
  createSocket: (url: string) => SocketLike = (url) => new WebSocket(url),
): RoomContext {
  const latency = createLatencyMonitor();
  const listeners = new Set<(event: RoomEvent) => void>();
  const crewKinds = new Map<number, CrewKind | 'steer'>();
  let participantId: string | null = null;
  let roomState: RoomStateMessage | null = null;
  let matchState: MatchStateMessage | null = null;
  let buffer = createBuffer();
  let crew = createCrewView();
  let lastRenderedSessionMs = Number.NEGATIVE_INFINITY;
  let disposed = false;
  let roomVersion = 0;
  const roomWaiters = new Set<() => void>();

  function nextRoomState(after: number): Promise<void> {
    if (roomVersion > after) return Promise.resolve();
    return new Promise((resolve) => {
      // Fallback so a lost broadcast can never hang a screen.
      const timer = setTimeout(done, REQUEST_TIMEOUT_MS);
      function done(): void {
        clearTimeout(timer);
        roomWaiters.delete(check);
        resolve();
      }
      function check(): void {
        if (roomVersion > after) done();
      }
      roomWaiters.add(check);
    });
  }

  const net = connectNet(socketUrl(location), {
    now: () => performance.now(),
    latency,
    createSocket,
    resumeSession: () => loadSession(),
  });

  function emit(event: RoomEvent): void {
    for (const listener of listeners) listener(event);
  }

  function ownSeat(): SeatId | null {
    if (!roomState || participantId === null) return null;
    return roomState.seats.find((s) => s.occupantId === participantId)?.seat ?? null;
  }

  const offs = [
    net.on('session.accepted', (m) => {
      participantId = m.participantId;
      if (m.seat !== null && m.token !== null) saveSession({ code: m.code, seat: m.seat, token: m.token });
    }),
    net.on('room.state', (m) => {
      const hadSeat = ownSeat();
      roomState = m;
      // A seat that is gone cannot be reclaimed, so its token is useless.
      if (hadSeat !== null && ownSeat() === null) clearSession();
      if (m.activeMatchId === null) {
        matchState = null;
        buffer = createBuffer();
      }
      roomVersion += 1;
      for (const check of [...roomWaiters]) check();
      emit({ type: 'room' });
    }),
    net.on('match.state', (m) => {
      const previous = matchState;
      // Session time jumps against local time on a new test or a freeze
      // change, so the clock estimate starts over (design: interpolate.ts).
      if (!previous || previous.matchId !== m.matchId || previous.frozen !== m.frozen) {
        buffer = createBuffer();
        lastRenderedSessionMs = Number.NEGATIVE_INFINITY;
      }
      if (!previous || previous.matchId !== m.matchId) crew = createCrewView();
      matchState = m;
      const now = performance.now();
      buffer = pushSnapshot(buffer, { matchId: m.matchId, sessionMs: m.sessionMs, pose: m.pose, receivedAtMs: now });
      crew = reduceCrewView(crew, { type: 'snapshot', crew: m.crew, nowMs: now });
      emit({ type: 'match' });
    }),
    net.on('input.ack', (m) => {
      const kind = crewKinds.get(m.seq) ?? 'steer';
      crewKinds.delete(m.seq);
      if (kind !== 'steer') {
        const ackCrew = 'crew' in m && m.crew !== undefined ? m.crew : null;
        crew = reduceCrewView(crew, { type: 'ack', kind, crew: ackCrew, nowMs: performance.now() });
      }
      emit({ type: 'ack', ack: m, kind });
    }),
    net.on('room.error', (m) => emit({ type: 'room-error', reason: m.reason })),
    net.onStatus((status) => {
      // A new connection restarts seq, so old seq-to-kind entries are stale.
      if (status === 'reconnecting') crewKinds.clear();
      emit({ type: 'status', status });
    }),
  ];

  return {
    net,
    latency,
    get participantId() {
      return participantId;
    },
    get roomState() {
      return roomState;
    },
    get matchState() {
      return matchState;
    },
    get buffer() {
      return buffer;
    },
    get crew() {
      return crew;
    },
    get seat() {
      return ownSeat();
    },
    get code() {
      return roomState?.code ?? null;
    },
    get liveMatchId() {
      if (!roomState || roomState.activeMatchId === null || !matchState || matchState.frozen) return null;
      return matchState.matchId === roomState.activeMatchId ? matchState.matchId : null;
    },
    whenOpen() {
      if (net.status === 'open') return Promise.resolve();
      return new Promise((resolve, reject) => {
        const off = net.onStatus((status) => {
          if (status === 'open') {
            off();
            resolve();
          } else if (status === 'closed') {
            off();
            reject(new Error('closed'));
          }
        });
      });
    },
    async request(message) {
      const before = roomVersion;
      const reply = await net.request(message);
      // Leaving unbinds this connection, so no room.state follows.
      if (reply.type !== 'request.rejected' && message.type !== 'room.leave') await nextRoomState(before);
      return reply;
    },
    sendCrewInput(kind, message) {
      const seq = net.sendInput(message);
      if (seq !== null) crewKinds.set(seq, kind);
      return seq;
    },
    crewEvent(event) {
      crew = reduceCrewView(crew, event);
    },
    recordRender(renderSessionMs, nowMs) {
      for (const s of buffer.snapshots) {
        if (s.sessionMs <= lastRenderedSessionMs || s.sessionMs > renderSessionMs) continue;
        latency.renderDelay(nowMs - s.receivedAtMs);
      }
      lastRenderedSessionMs = Math.max(lastRenderedSessionMs, renderSessionMs);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      listeners.clear();
      net.close();
    },
  };
}
