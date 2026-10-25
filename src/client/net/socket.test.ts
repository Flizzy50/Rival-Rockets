import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_STEERING_HZ, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from '../../shared/config';
import { createLatencyMonitor } from './latency';
import { connectNet, socketUrl, type NetClient, type SocketLike } from './socket';
import type { StoredSession } from './session';

class MockSocket implements SocketLike {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  receive(message: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
  drop(): void {
    this.readyState = 3;
    // Node has no CloseEvent global; the client never reads its fields.
    this.onclose?.(new Event('close') as CloseEvent);
  }
  ofType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

const SESSION: StoredSession = { code: 'ABCDEF', seat: 'comet-pilot', token: 'AAAAAAAAAAAAAAAAAAAAAA' };

let sockets: MockSocket[];
let session: StoredSession | null;
let net: NetClient;

function latest(): MockSocket {
  return sockets[sockets.length - 1] as MockSocket;
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  session = SESSION;
  net = connectNet('wss://x/ws', {
    now: () => Date.now(),
    latency: createLatencyMonitor(),
    createSocket: () => {
      const s = new MockSocket();
      sockets.push(s);
      return s;
    },
    resumeSession: () => session,
  });
  latest().open();
});

afterEach(() => {
  net.close();
  vi.useRealTimers();
});

describe('net client', () => {
  it('builds a same-origin socket URL', () => {
    expect(socketUrl({ protocol: 'https:', host: 'rr.example' })).toBe('wss://rr.example/ws');
    expect(socketUrl({ protocol: 'http:', host: 'localhost:3000' })).toBe('ws://localhost:3000/ws');
  });

  it('sends a heartbeat every second (Requirement 11.1)', () => {
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    latest().receive({ type: 'heartbeat.ack' });
    expect(latest().ofType('heartbeat')).toHaveLength(2);
  });

  it('matches replies to requests by requestId', async () => {
    const reply = net.request({ type: 'room.create', name: 'Ada' });
    const sent = latest().sent[0];
    latest().receive({ type: 'request.rejected', requestId: sent?.requestId, reason: 'invalid-name' });
    await expect(reply).resolves.toMatchObject({ reason: 'invalid-name' });
  });

  it('throttles steering to CLIENT_STEERING_HZ and skips unchanged values (Requirement 9.6)', () => {
    for (let i = 0; i < 100; i += 1) {
      net.steer(1, i / 100);
      vi.advanceTimersByTime(10);
    }
    // One second of frames.
    expect(latest().ofType('input.steer').length).toBeLessThanOrEqual(CLIENT_STEERING_HZ);
    vi.advanceTimersByTime(1000);
    net.steer(1, 0.42);
    const before = latest().ofType('input.steer').length;
    vi.advanceTimersByTime(1000);
    net.steer(1, 0.42);
    expect(latest().ofType('input.steer').length).toBe(before);
  });

  it('reconnects with the token after silence and restarts seq (Requirement 11.5)', async () => {
    net.sendInput({ type: 'input.charge', matchId: 1 });
    expect(latest().ofType('input.charge')[0]?.seq).toBe(1);
    const statuses: string[] = [];
    net.onStatus((s) => statuses.push(s));
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS);
    expect(statuses).toContain('reconnecting');
    await vi.advanceTimersByTimeAsync(0);
    const fresh = latest();
    expect(sockets.length).toBe(2);
    fresh.open();
    const reconnect = fresh.ofType('seat.reconnect')[0];
    expect(reconnect).toMatchObject({ code: 'ABCDEF', seat: 'comet-pilot', token: SESSION.token });
    fresh.receive({ type: 'session.accepted', requestId: reconnect?.requestId, code: 'ABCDEF', participantId: 'p0', seat: 'comet-pilot', token: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(net.status).toBe('open');
    net.sendInput({ type: 'input.charge', matchId: 1 });
    expect(fresh.ofType('input.charge')[0]?.seq).toBe(1);
  });

  it('closes when the reconnect is denied', async () => {
    latest().drop();
    await vi.advanceTimersByTimeAsync(0);
    const fresh = latest();
    fresh.open();
    const reconnect = fresh.ofType('seat.reconnect')[0];
    fresh.receive({ type: 'request.rejected', requestId: reconnect?.requestId, reason: 'reconnect-denied' });
    await vi.advanceTimersByTimeAsync(0);
    expect(net.status).toBe('closed');
  });

  it('closes at once when there is no seat to reclaim', () => {
    session = null;
    latest().drop();
    expect(net.status).toBe('closed');
  });
});
