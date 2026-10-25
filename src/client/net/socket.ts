import {
  CLIENT_STEERING_HZ,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  RECONNECT_RETRY_MS,
  REQUEST_TIMEOUT_MS,
  SEAT_HOLD_MS,
} from '../../shared/config';
import type {
  GameplayInputWithoutSeq,
  RequestAccepted,
  RequestRejected,
  RoomRequestWithoutId,
  ServerMessage,
  ServerMessageType,
  SessionAccepted,
} from '../../shared/protocol';
import type { InputKind, LatencyMonitor } from './latency';
import type { StoredSession } from './session';

// Net client (PRD 8, Requirements 9.6, 11, 12): one same-origin socket with
// request ids, per-connection input seq, heartbeat, silence detection, and
// reconnect with the private seat token. Socket factory and clock are
// injected so tests run with fake timers and a mock socket.

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
export type RequestReply = SessionAccepted | RequestAccepted | RequestRejected;

// The subset of the browser WebSocket this client uses.
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export interface NetDeps {
  now(): number;
  latency: LatencyMonitor;
  createSocket(url: string): SocketLike;
  // The seat to reclaim after a drop; null when there is nothing to reclaim.
  resumeSession(): StoredSession | null;
}

type Handler<T extends ServerMessageType> = (message: Extract<ServerMessage, { type: T }>) => void;

export interface NetClient {
  readonly status: NetStatus;
  request(message: RoomRequestWithoutId): Promise<RequestReply>;
  // Returns the seq, or null when the socket is not open.
  sendInput(message: GameplayInputWithoutSeq): number | null;
  // Throttled to CLIENT_STEERING_HZ; call every frame.
  steer(matchId: number, steering: number): void;
  on<T extends ServerMessageType>(type: T, handler: Handler<T>): () => void;
  onStatus(handler: (status: NetStatus) => void): () => void;
  close(): void;
}

const OPEN = 1;
const STEER_INTERVAL_MS = 1000 / CLIENT_STEERING_HZ;

export function socketUrl(location: { protocol: string; host: string }, path = '/ws'): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
}

function inputKind(message: GameplayInputWithoutSeq): InputKind {
  if (message.type === 'input.steer') return 'steer';
  if (message.type === 'input.charge') return 'charge';
  return 'ability';
}

function isReply(message: ServerMessage): message is RequestReply {
  return message.type === 'session.accepted' || message.type === 'request.accepted' || message.type === 'request.rejected';
}

export function connectNet(url: string, deps: NetDeps): NetClient {
  let status: NetStatus = 'connecting';
  let socket: SocketLike | null = null;
  let seq = 0;
  let requestId = 0;
  let lastHeardMs = deps.now();
  let lostAtMs: number | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSteerMs = Number.NEGATIVE_INFINITY;
  let lastSteerValue: number | null = null;
  let lastSteerMatch: number | null = null;
  let closedByUser = false;

  const handlers = new Map<ServerMessageType, Set<(m: ServerMessage) => void>>();
  const statusHandlers = new Set<(s: NetStatus) => void>();
  const pending = new Map<number, { resolve: (m: RequestReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  function setStatus(next: NetStatus): void {
    if (status === next) return;
    status = next;
    for (const h of statusHandlers) h(next);
  }

  function emit(message: ServerMessage): void {
    for (const h of handlers.get(message.type) ?? []) h(message);
  }

  function rawSend(data: unknown): boolean {
    if (!socket || socket.readyState !== OPEN) return false;
    socket.send(JSON.stringify(data));
    return true;
  }

  function failPending(reason: string): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      pending.delete(id);
    }
  }

  function stopTimers(): void {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    heartbeatTimer = null;
    retryTimer = null;
  }

  function finish(): void {
    stopTimers();
    failPending('closed');
    detach();
    setStatus('closed');
  }

  function detach(): void {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }

  // Connection lost: keep trying while the server would still hold the seat.
  function lost(): void {
    if (closedByUser || status === 'closed') return;
    detach();
    failPending('connection lost');
    const resume = deps.resumeSession();
    if (resume === null) {
      finish();
      return;
    }
    // The first retry is immediate; later ones are spaced out.
    const firstAttempt = lostAtMs === null;
    lostAtMs ??= deps.now();
    if (deps.now() - lostAtMs >= SEAT_HOLD_MS) {
      finish();
      return;
    }
    setStatus('reconnecting');
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = setTimeout(
      () => {
        retryTimer = null;
        open();
      },
      firstAttempt ? 0 : RECONNECT_RETRY_MS,
    );
  }

  function resume(): void {
    const session = deps.resumeSession();
    if (session === null) {
      finish();
      return;
    }
    request({ type: 'seat.reconnect', code: session.code, seat: session.seat, token: session.token }).then(
      (reply) => {
        if (reply.type === 'session.accepted') {
          lostAtMs = null;
          setStatus('open');
        } else {
          // The seat was released or the hold ran out (Requirement 5.8).
          finish();
        }
      },
      () => lost(),
    );
  }

  function open(): void {
    const reconnecting = status === 'reconnecting';
    seq = 0;
    lastSteerValue = null;
    lastHeardMs = deps.now();
    const ws = deps.createSocket(url);
    socket = ws;
    ws.onopen = () => {
      lastHeardMs = deps.now();
      if (reconnecting) resume();
      else setStatus('open');
    };
    ws.onmessage = (event) => {
      lastHeardMs = deps.now();
      const data: unknown = event.data;
      if (typeof data !== 'string') return;
      let message: ServerMessage;
      try {
        message = JSON.parse(data) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === 'input.ack') deps.latency.acked(message.seq, message.status, deps.now());
      if (isReply(message) && message.requestId !== null) {
        const p = pending.get(message.requestId);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(message.requestId);
          p.resolve(message);
        }
      }
      emit(message);
    };
    ws.onclose = () => lost();
    ws.onerror = () => undefined;
    if (heartbeatTimer === null) {
      heartbeatTimer = setInterval(() => {
        if (socket && socket.readyState === OPEN) rawSend({ type: 'heartbeat' });
        // Silence for the timeout means the link is gone even if the socket
        // has not noticed yet (Requirement 11.5).
        if (socket !== null && deps.now() - lastHeardMs >= HEARTBEAT_TIMEOUT_MS) lost();
      }, HEARTBEAT_INTERVAL_MS);
    }
  }

  function request(message: RoomRequestWithoutId): Promise<RequestReply> {
    requestId += 1;
    const id = requestId;
    return new Promise((resolve, reject) => {
      if (!rawSend({ ...message, requestId: id })) {
        reject(new Error('not connected'));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('timeout'));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });
  }

  function sendInput(message: GameplayInputWithoutSeq): number | null {
    if (status !== 'open') return null;
    const next = seq + 1;
    if (!rawSend({ ...message, seq: next })) return null;
    seq = next;
    deps.latency.sent(next, inputKind(message), deps.now());
    return next;
  }

  open();

  return {
    get status() {
      return status;
    },
    request,
    sendInput,
    steer(matchId, steering) {
      const now = deps.now();
      if (now - lastSteerMs < STEER_INTERVAL_MS) return;
      // Unchanged steering is already the server's value.
      if (steering === lastSteerValue && matchId === lastSteerMatch) return;
      if (sendInput({ type: 'input.steer', matchId, steering }) === null) return;
      lastSteerMs = now;
      lastSteerValue = steering;
      lastSteerMatch = matchId;
    },
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      const h = handler as (m: ServerMessage) => void;
      set.add(h);
      return () => set.delete(h);
    },
    onStatus(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    close() {
      closedByUser = true;
      finish();
    },
  };
}
