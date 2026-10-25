import { randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { RECONNECT_TOKEN_BYTES } from '../src/shared/config.js';
import type { RoomErrorReason, ServerMessage } from '../src/shared/protocol.js';
import { clientIp } from './client-ip.js';
import { HOUSEKEEPING_INTERVAL_MS, SIMULATION_LOOP_INTERVAL_MS, WS_MAX_FRAME_BYTES, WS_PATH } from './config.js';
import {
  createConnection,
  dispatch,
  handleClose,
  housekeeping,
  isHeartbeatExpired,
  type Connection,
  type DispatchDeps,
  type Outbound,
} from './dispatch.js';
import { isOriginAllowed } from './origin.js';
import { createRoomStore } from './rooms.js';
import { createSimulation } from './simulation.js';
import { toRoomState } from './public-view.js';

// Gateway (Requirements 5, 7, 11): upgrade checks, socket bookkeeping, and the
// two loops. All decisions live in dispatch.ts; this file moves frames.

export interface GatewayOptions {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly devMode: boolean;
  readonly controlTestEnabled: boolean;
  readonly trustedProxyHops: number;
  readonly nowMs?: () => number;
  readonly log?: (event: string) => void;
}

export interface Gateway {
  // Sends room.error to everyone, then closes every socket.
  close(reason: RoomErrorReason): void;
  connectionCount(): number;
}

interface Live {
  readonly socket: WebSocket;
  readonly conn: Connection;
}

const CLOSE_NORMAL = 1000;
const CLOSE_GOING_AWAY = 1001;

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function refuse(socket: Duplex, status: '403 Forbidden' | '404 Not Found'): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

export function attachGateway(server: Server, options: GatewayOptions): Gateway {
  const nowMs = options.nowMs ?? (() => performance.now());
  const log = options.log ?? ((event: string) => console.log(event));
  const live = new Map<string, Live>();
  let nextConnectionId = 1;

  function deliver(out: readonly Outbound[]): void {
    for (const item of out) {
      if (item.kind === 'send') sendTo(item.to, item.message);
      else if (item.kind === 'room') broadcast(item.code, item.message);
      else if (item.kind === 'participant') sendToParticipant(item.code, item.participantId, item.message);
      else supersede(item.code, item.participantId, item.keep);
    }
  }

  function sendTo(id: string, message: ServerMessage): void {
    const entry = live.get(id);
    if (entry && entry.socket.readyState === WebSocket.OPEN) entry.socket.send(JSON.stringify(message));
  }

  function sendToParticipant(code: string, participantId: string, message: ServerMessage): void {
    const text = JSON.stringify(message);
    for (const { socket, conn } of live.values()) {
      if (conn.code === code && conn.participantId === participantId && socket.readyState === WebSocket.OPEN) socket.send(text);
    }
  }

  function broadcast(code: string, message: ServerMessage): void {
    const text = JSON.stringify(message);
    for (const { socket, conn } of live.values()) {
      if (conn.code === code && socket.readyState === WebSocket.OPEN) socket.send(text);
    }
  }

  // One active connection per seat (Requirement 5.10): the old socket is
  // unbound first, so its close event cannot put the seat back on hold.
  function supersede(code: string, participantId: string, keep: string): void {
    for (const { socket, conn } of live.values()) {
      if (conn.id === keep || conn.code !== code || conn.participantId !== participantId) continue;
      conn.code = null;
      conn.participantId = null;
      socket.close(CLOSE_NORMAL);
    }
  }

  const rooms = createRoomStore({
    nowMs,
    randomInt: (max) => randomInt(max),
    randomToken: () => randomBytes(RECONNECT_TOKEN_BYTES).toString('base64url'),
  });
  const simulation = createSimulation({ nowMs, sendTo, broadcast, log, controlTestEnabled: options.controlTestEnabled,
    roomChanged(code) {
      const room = rooms.get(code);
      if (room) broadcast(code, toRoomState(room, options.controlTestEnabled, simulation.current(code)?.matchId ?? null, simulation.roomStatus(code), nowMs()));
    },
  });
  const deps: DispatchDeps = {
    rooms,
    simulation,
    controlTestEnabled: options.controlTestEnabled,
    createLimiters: new Map(),
    joinLimiters: new Map(),
    seatLimiters: new Map(),
    log,
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_FRAME_BYTES });

  if (options.allowedOrigins.size === 0 && !options.devMode) {
    log('config error: no allowed WebSocket origins; set RENDER_EXTERNAL_URL or ALLOWED_ORIGINS');
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (requestPath(req) !== WS_PATH) {
      refuse(socket, '404 Not Found');
      return;
    }
    if (!isOriginAllowed(header(req.headers.origin), header(req.headers.host), options.allowedOrigins, options.devMode)) {
      refuse(socket, '403 Forbidden');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const ip = clientIp(req.socket.remoteAddress, header(req.headers['x-forwarded-for']), options.trustedProxyHops);
      const conn = createConnection(`c${nextConnectionId}`, ip, nowMs());
      nextConnectionId += 1;
      live.set(conn.id, { socket: ws, conn });

      ws.on('message', (data: RawData, isBinary: boolean) => {
        deliver(dispatch(deps, conn, data, isBinary, nowMs()));
      });
      ws.on('close', () => {
        live.delete(conn.id);
        deliver(handleClose(deps, conn));
      });
      ws.on('error', () => {
        // Close follows; nothing identifying is logged.
      });
    });
  });

  const simTimer = setInterval(() => {
    // A timeout wins a tie with countdown or match completion (PRD 8).
    for (const { socket, conn } of live.values()) {
      if (isHeartbeatExpired(conn, nowMs())) { deliver(handleClose(deps, conn)); socket.terminate(); }
    }
    // The simulation already contains per-room faults; this guard keeps the
    // timer alive if anything else in the pass throws.
    try {
      simulation.tick();
    } catch (error) {
      log(`simulation loop error: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }, SIMULATION_LOOP_INTERVAL_MS);
  const houseTimer = setInterval(() => {
    const now = nowMs();
    // Silent phones are treated as gone (Requirement 11.3).
    for (const { socket, conn } of live.values()) {
      if (isHeartbeatExpired(conn, now)) socket.terminate();
    }
    const result = housekeeping(deps, now);
    for (const code of result.expiredRooms) {
      broadcast(code, { type: 'room.error', reason: 'room-expired' });
      for (const { socket, conn } of live.values()) {
        if (conn.code !== code) continue;
        conn.code = null;
        conn.participantId = null;
        socket.close(CLOSE_NORMAL);
      }
    }
    deliver(result.outbound);
  }, HOUSEKEEPING_INTERVAL_MS);
  simTimer.unref();
  houseTimer.unref();

  return {
    close(reason) {
      clearInterval(simTimer);
      clearInterval(houseTimer);
      const text = JSON.stringify({ type: 'room.error', reason } satisfies ServerMessage);
      for (const { socket } of live.values()) {
        if (socket.readyState === WebSocket.OPEN) socket.send(text);
        socket.close(CLOSE_GOING_AWAY);
      }
      wss.close();
    },
    connectionCount() {
      return live.size;
    },
  };
}
