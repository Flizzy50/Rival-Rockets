import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { SEAT_IDS, type ServerMessage } from '../src/shared/protocol.js';
import { attachGateway, type Gateway } from './websocket.js';

const ORIGIN = 'https://rr.example';

let server: http.Server;
let gateway: Gateway;
let url: string;
const sockets: WebSocket[] = [];
let simulatedNow: number | null = null;

beforeEach(async () => {
  simulatedNow = null;
  server = http.createServer((_req, res) => res.end());
  gateway = attachGateway(server, {
    allowedOrigins: new Set([ORIGIN]),
    devMode: false,
    controlTestEnabled: true,
    trustedProxyHops: 0,
    log: () => undefined,
    nowMs: () => simulatedNow ?? performance.now(),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const s of sockets) s.terminate();
  sockets.length = 0;
  gateway.close('server-closing');
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Client {
  ws: WebSocket;
  send(message: unknown): void;
  next(predicate: (m: ServerMessage) => boolean): Promise<ServerMessage>;
}

function open(path = '/ws', origin = ORIGIN): Promise<Client> {
  const ws = new WebSocket(`${url}${path}`, { origin });
  sockets.push(ws);
  const inbox: ServerMessage[] = [];
  const waiters: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  ws.on('message', (data: Buffer) => {
    const message = JSON.parse(data.toString('utf8')) as ServerMessage;
    const i = waiters.findIndex((w) => w.predicate(message));
    if (i >= 0) waiters.splice(i, 1)[0]?.resolve(message);
    else inbox.push(message);
  });
  const client: Client = {
    ws,
    send: (message) => ws.send(JSON.stringify(message)),
    next: (predicate) => {
      const i = inbox.findIndex(predicate);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0] as ServerMessage);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
  };
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
    ws.once('error', reject);
  });
}

const type = (t: ServerMessage['type']) => (m: ServerMessage) => m.type === t;

describe('gateway', () => {
  it('runs a complete four-client match and sends identical results to a watcher', async () => {
    simulatedNow = 0;
    const clients = await Promise.all(SEAT_IDS.map(() => open()));
    const host = clients[0]!;
    host.send({ type: 'room.create', requestId: 1, name: 'Host' });
    const created = await host.next(type('session.accepted'));
    if (created.type !== 'session.accepted') throw new Error('create failed');
    const code = created.code;
    for (const [i, client] of clients.entries()) {
      if (i > 0) {
        client.send({ type: 'room.join', requestId: 1, code, name: `Crew ${i}`, intent: 'play' });
        await client.next(type('session.accepted'));
      }
      client.send({ type: 'seat.claim', requestId: 2, seat: SEAT_IDS[i] });
      await client.next((m) => m.type === 'session.accepted' && m.requestId === 2);
      client.send({ type: 'setup.update', requestId: 3, status: 'calibrated' });
      await client.next((m) => m.type === 'request.accepted' && m.requestId === 3);
      client.send({ type: 'ready.set', requestId: 4, ready: true });
      await client.next((m) => m.type === 'request.accepted' && m.requestId === 4);
    }
    const watcher = await open();
    watcher.send({ type: 'room.join', requestId: 1, code, name: 'Watcher', intent: 'watch' });
    await watcher.next(type('session.accepted'));
    const everyone = [...clients, watcher];
    clients[1]!.send({ type: 'match.start', requestId: 5 });
    expect(await clients[1]!.next(type('request.rejected'))).toMatchObject({ reason: 'not-host' });
    host.send({ type: 'match.start', requestId: 5 });
    const countdown = await host.next((m) => m.type === 'match.state' && m.mode === 'match');
    if (countdown.type !== 'match.state') throw new Error('no countdown');
    const matchId = countdown.matchId;
    expect(countdown).toMatchObject({ phase: 'countdown', remainingMs: 90000 });
    simulatedNow = 2999;
    for (const c of everyone) c.send({ type: 'heartbeat' });
    await Promise.all(everyone.map((c) => c.next(type('heartbeat.ack'))));
    simulatedNow = 3000;
    await host.next((m) => m.type === 'match.state' && m.mode === 'match' && m.phase === 'running');
    watcher.send({ type: 'input.charge', matchId, seq: 1 });
    expect(await watcher.next(type('input.ack'))).toMatchObject({ status: 'rejected', reason: 'not-authorized' });
    clients[2]!.send({ type: 'input.steer', matchId, seq: 1, steering: 0.5 });
    clients[3]!.send({ type: 'input.charge', matchId, seq: 1 });
    // A heartbeat round-trip ensures the preceding inputs are queued before advancing time.
    for (const c of clients) c.send({ type: 'heartbeat' });
    await Promise.all(clients.map((c) => c.next(type('heartbeat.ack'))));
    simulatedNow += 100;
    expect(await clients[2]!.next(type('input.ack'))).toMatchObject({ status: 'applied', steering: 0.5 });
    expect(await clients[3]!.next(type('input.ack'))).toMatchObject({ status: 'applied', crew: { energy: 75 } });
    let matchMs = 0;
    for (let step = 0; step < 600 && matchMs < 90000; step += 1) {
      for (const c of everyone) c.send({ type: 'heartbeat' });
      await Promise.all(everyone.map((c) => c.next(type('heartbeat.ack'))));
      simulatedNow += 200;
      const snapshot = await host.next((m) => m.type === 'match.state' && m.mode === 'match' && m.matchMs > matchMs);
      if (snapshot.type === 'match.state' && snapshot.mode === 'match') matchMs = snapshot.matchMs;
    }
    expect(matchMs).toBe(90000);
    const results = await Promise.all(everyone.map((c) => c.next((m) => m.type === 'room.state' && m.phase === 'results')));
    const expected = results[0];
    if (expected?.type !== 'room.state') throw new Error('no results');
    expect(expected.result).not.toBeNull();
    for (const m of results) expect(m.type === 'room.state' && m.result).toEqual(expected.result);
  }, 30000);
  it('refuses a bad origin with 403 and another path with 404 (Requirements 7.2, 7.5)', async () => {
    await expect(open('/ws', 'https://evil.example')).rejects.toThrow('403');
    await expect(open('/other')).rejects.toThrow('404');
  });

  it('answers heartbeats (Requirement 11.2)', async () => {
    const c = await open();
    c.send({ type: 'heartbeat' });
    expect(await c.next(type('heartbeat.ack'))).toEqual({ type: 'heartbeat.ack' });
  });

  it('runs a two-phone control test end to end', async () => {
    const pilot = await open();
    const engineer = await open();
    pilot.send({ type: 'room.create', requestId: 1, name: 'Pia' });
    const created = await pilot.next(type('session.accepted'));
    const code = created.type === 'session.accepted' ? created.code : '';
    engineer.send({ type: 'room.join', requestId: 1, code, name: 'Eli', intent: 'play' });
    await engineer.next(type('session.accepted'));

    pilot.send({ type: 'seat.claim', requestId: 2, seat: 'comet-pilot' });
    const claim = await pilot.next((m) => m.type === 'session.accepted' && m.seat === 'comet-pilot');
    const token = claim.type === 'session.accepted' ? claim.token : null;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    engineer.send({ type: 'seat.claim', requestId: 2, seat: 'comet-engineer' });
    await engineer.next(type('session.accepted'));

    pilot.send({ type: 'setup.update', requestId: 3, status: 'calibrated' });
    engineer.send({ type: 'setup.update', requestId: 3, status: 'calibrated' });
    const state = await engineer.next((m) => m.type === 'match.state');
    const matchId = state.type === 'match.state' ? state.matchId : -1;

    pilot.send({ type: 'input.steer', matchId, seq: 1, steering: 0.5 });
    engineer.send({ type: 'input.charge', matchId, seq: 1 });
    expect(await pilot.next(type('input.ack'))).toMatchObject({ seq: 1, status: 'applied', steering: 0.5 });
    expect(await engineer.next(type('input.ack'))).toMatchObject({ seq: 1, status: 'applied', crew: { energy: 75 } });

    // A second socket with the token takes over the seat and closes the old one.
    const replacement = await open();
    const closed = new Promise<void>((resolve) => pilot.ws.once('close', () => resolve()));
    replacement.send({ type: 'seat.reconnect', requestId: 1, code, seat: 'comet-pilot', token });
    expect(await replacement.next(type('session.accepted'))).toMatchObject({ seat: 'comet-pilot', token: null });
    await closed;
  });

  it('never shows the token to other connections (Requirement 5.2)', async () => {
    const a = await open();
    const b = await open();
    const seen: string[] = [];
    b.ws.on('message', (d: Buffer) => seen.push(d.toString('utf8')));
    a.send({ type: 'room.create', requestId: 1, name: 'A' });
    const created = await a.next(type('session.accepted'));
    const code = created.type === 'session.accepted' ? created.code : '';
    b.send({ type: 'room.join', requestId: 1, code, name: 'B', intent: 'watch' });
    await b.next(type('session.accepted'));
    a.send({ type: 'seat.claim', requestId: 2, seat: 'nova-engineer' });
    const claim = await a.next((m) => m.type === 'session.accepted' && m.seat !== null);
    await b.next((m) => m.type === 'room.state' && m.seats.some((s) => s.occupantId !== null));
    const token = claim.type === 'session.accepted' ? (claim.token ?? 'missing') : 'missing';
    expect(seen.join('\n')).not.toContain(token);
  });
});
