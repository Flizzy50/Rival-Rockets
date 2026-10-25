import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ABILITY_REQUESTS_PER_SEC,
  HEARTBEAT_TIMEOUT_MS,
  ROOM_CREATES_PER_MIN_PER_IP,
  SOCKET_MESSAGES_PER_SEC,
} from '../src/shared/config.js';
import type { ServerMessage } from '../src/shared/protocol.js';
import {
  createConnection,
  dispatch,
  handleClose,
  isHeartbeatExpired,
  type Connection,
  type DispatchDeps,
  type Outbound,
} from './dispatch.js';
import { createRoomStore } from './rooms.js';
import { createSimulation } from './simulation.js';

interface World {
  deps: DispatchDeps;
  now: { ms: number };
  simOut: Array<{ to: string; message: ServerMessage }>;
  connect(id: string, ip?: string): Connection;
  send(conn: Connection, message: unknown): Outbound[];
  tick(ms: number): void;
}

function world(controlTestEnabled = true): World {
  const now = { ms: 1000 };
  let tokens = 0;
  let ints = 0;
  const simOut: Array<{ to: string; message: ServerMessage }> = [];
  const rooms = createRoomStore({
    nowMs: () => now.ms,
    randomInt: (max) => (ints++ * 7) % max,
    randomToken: () => `tok${String((tokens += 1)).padStart(19, '0')}`,
  });
  const simulation = createSimulation({
    nowMs: () => now.ms,
    sendTo: (to, message) => simOut.push({ to, message }),
    broadcast: (code, message) => simOut.push({ to: `room:${code}`, message }),
    controlTestEnabled,
  });
  const deps: DispatchDeps = {
    rooms,
    simulation,
    controlTestEnabled,
    createLimiters: new Map(),
    joinLimiters: new Map(),
    seatLimiters: new Map(),
    log: () => undefined,
  };
  return {
    deps,
    now,
    simOut,
    connect: (id, ip = `ip-${id}`) => createConnection(id, ip, now.ms),
    send: (conn, message) => dispatch(deps, conn, JSON.stringify(message), false, now.ms),
    tick(ms) {
      const end = now.ms + ms;
      while (now.ms < end) {
        now.ms += 10;
        simulation.tick();
      }
    },
  };
}

function messagesTo(out: Outbound[], conn: Connection): ServerMessage[] {
  return out.flatMap((o) => (o.kind === 'send' && o.to === conn.id ? [o.message] : []));
}

function only(out: Outbound[], conn: Connection): ServerMessage {
  const list = messagesTo(out, conn);
  expect(list).toHaveLength(1);
  return list[0] as ServerMessage;
}

let requestId = 0;
function rid(): number {
  requestId += 1;
  return requestId;
}

// Pilot and Engineer seated and calibrated, so the control test is running.
function crew(w: World) {
  const pilot = w.connect('pilot');
  const engineer = w.connect('engineer');
  const created = only(w.send(pilot, { type: 'room.create', requestId: rid(), name: 'Pia' }), pilot);
  if (created.type !== 'session.accepted') throw new Error('create failed');
  const code = created.code;
  w.send(engineer, { type: 'room.join', requestId: rid(), code, name: 'Eli', intent: 'play' });
  w.send(pilot, { type: 'seat.claim', requestId: rid(), seat: 'comet-pilot' });
  w.send(engineer, { type: 'seat.claim', requestId: rid(), seat: 'comet-engineer' });
  w.send(pilot, { type: 'setup.update', requestId: rid(), status: 'calibrated' });
  w.send(engineer, { type: 'setup.update', requestId: rid(), status: 'calibrated' });
  const matchId = w.deps.simulation.current(code)?.matchId ?? -1;
  return { pilot, engineer, code, matchId };
}

function snapshot(w: World, code: string): string {
  const room = w.deps.rooms.get(code);
  return JSON.stringify({
    room: room && { ...room, names: [...room.names], seats: { ...room.seats, participants: [...room.seats.participants] } },
    test: w.deps.simulation.current(code),
  });
}

describe('dispatch', () => {
  it('sends the reconnect token only to the claimant (Requirement 5.2)', () => {
    const w = world();
    const a = w.connect('a');
    const b = w.connect('b');
    const created = only(w.send(a, { type: 'room.create', requestId: rid(), name: 'A' }), a);
    if (created.type !== 'session.accepted') throw new Error('create failed');
    w.send(b, { type: 'room.join', requestId: rid(), code: created.code, name: 'B', intent: 'play' });
    const out = w.send(a, { type: 'seat.claim', requestId: rid(), seat: 'nova-pilot' });
    const reply = only(out, a);
    expect(reply).toMatchObject({ type: 'session.accepted', seat: 'nova-pilot' });
    const token = reply.type === 'session.accepted' ? reply.token : null;
    expect(token).toBeTruthy();
    const roomMessages = out.filter((o) => o.kind === 'room');
    expect(roomMessages).toHaveLength(1);
    expect(JSON.stringify(roomMessages)).not.toContain(token);
  });

  it('starts the control test once the Comet crew is calibrated and acks applied inputs', () => {
    const w = world();
    const { pilot, engineer, matchId } = crew(w);
    expect(matchId).toBeGreaterThan(0);
    expect(w.send(pilot, { type: 'input.steer', matchId, seq: 1, steering: 0.5 })).toEqual([]);
    expect(w.send(engineer, { type: 'input.charge', matchId, seq: 1 })).toEqual([]);
    w.tick(40);
    const acks = w.simOut.filter((m) => m.message.type === 'input.ack');
    expect(acks.map((a) => [a.to, a.message])).toEqual([
      ['pilot', expect.objectContaining({ seq: 1, status: 'applied', steering: 0.5 })],
      ['engineer', expect.objectContaining({ seq: 1, status: 'applied', crew: expect.objectContaining({ energy: 75 }) as unknown })],
    ]);
  });

  it('rejects stale matches, replayed sequences, and wrong seats', () => {
    const w = world();
    const { pilot, engineer, matchId } = crew(w);
    expect(only(w.send(pilot, { type: 'input.steer', matchId: matchId + 1, seq: 1, steering: 0 }), pilot)).toMatchObject({
      status: 'rejected',
      reason: 'stale-match',
    });
    w.send(pilot, { type: 'input.steer', matchId, seq: 5, steering: 0 });
    expect(only(w.send(pilot, { type: 'input.steer', matchId, seq: 5, steering: 0 }), pilot)).toMatchObject({
      reason: 'stale-sequence',
    });
    expect(only(w.send(engineer, { type: 'input.steer', matchId, seq: 1, steering: 1 }), engineer)).toMatchObject({
      reason: 'not-authorized',
    });
    expect(only(w.send(pilot, { type: 'input.charge', matchId, seq: 9 }), pilot)).toMatchObject({ reason: 'not-authorized' });
  });

  it('limits ability requests per Engineer seat (Requirement 9.3)', () => {
    const w = world();
    const { engineer, matchId } = crew(w);
    for (let seq = 1; seq <= ABILITY_REQUESTS_PER_SEC; seq += 1) {
      expect(w.send(engineer, { type: 'ability.request', matchId, seq, intent: 'select', ability: 'shield' })).toEqual([]);
    }
    expect(
      only(w.send(engineer, { type: 'ability.request', matchId, seq: 99, intent: 'activate' }), engineer),
    ).toMatchObject({ reason: 'rate-limited' });
  });

  it('limits messages per connection (Requirement 9.1)', () => {
    const w = world();
    const c = w.connect('c');
    for (let i = 0; i < SOCKET_MESSAGES_PER_SEC; i += 1) w.send(c, { type: 'heartbeat' });
    expect(only(w.send(c, { type: 'heartbeat' }), c)).toMatchObject({ type: 'request.rejected', reason: 'rate-limited' });
  });

  it('limits room creation per IP, counting failures (Requirement 2.9)', () => {
    const w = world();
    for (let i = 0; i < ROOM_CREATES_PER_MIN_PER_IP; i += 1) {
      const c = w.connect(`c${i}`, 'same-ip');
      w.send(c, { type: 'room.create', requestId: rid(), name: 'A' });
    }
    const late = w.connect('late', 'same-ip');
    const reply = only(w.send(late, { type: 'room.create', requestId: rid(), name: 'A' }), late);
    expect(reply).toMatchObject({ type: 'request.rejected', reason: 'rate-limited' });
    expect(reply.type === 'request.rejected' && (reply.retryAfterMs ?? 0) > 0).toBe(true);
  });

  it('refuses room requests before joining (Requirement 10.7)', () => {
    const w = world();
    const c = w.connect('c');
    expect(only(w.send(c, { type: 'seat.claim', requestId: 4, seat: 'comet-pilot' }), c)).toEqual({
      type: 'request.rejected',
      requestId: 4,
      reason: 'not-in-room',
    });
  });

  it('offers watching when the room is full', () => {
    const w = world();
    const host = w.connect('h');
    const created = only(w.send(host, { type: 'room.create', requestId: rid(), name: 'H' }), host);
    const code = created.type === 'session.accepted' ? created.code : '';
    for (const id of ['b', 'c', 'd']) w.send(w.connect(id), { type: 'room.join', requestId: rid(), code, name: id, intent: 'play' });
    const e = w.connect('e');
    expect(only(w.send(e, { type: 'room.join', requestId: rid(), code, name: 'E', intent: 'play' }), e)).toMatchObject({
      reason: 'room-full',
      offerWatch: true,
    });
    expect(only(w.send(e, { type: 'room.join', requestId: rid(), code, name: 'E', intent: 'watch' }), e)).toMatchObject({
      type: 'session.accepted',
    });
  });

  it('freezes on a crew disconnect and resumes after reconnect with the token', () => {
    const w = world();
    const { pilot, code } = crew(w);
    const room = w.deps.rooms.get(code);
    const token = room?.tokens['comet-pilot'] ?? '';
    handleClose(w.deps, pilot);
    expect(w.deps.simulation.current(code)?.frozen).toBe(true);
    const fresh = w.connect('pilot-2');
    const out = w.send(fresh, { type: 'seat.reconnect', requestId: rid(), code, seat: 'comet-pilot', token });
    expect(out[0]).toEqual({ kind: 'supersede', code, participantId: 'p0', keep: 'pilot-2' });
    expect(only(out, fresh)).toMatchObject({ type: 'session.accepted', seat: 'comet-pilot', token: null });
    expect(w.deps.simulation.current(code)?.frozen).toBe(false);
  });

  it('detects heartbeat timeouts at exactly HEARTBEAT_TIMEOUT_MS (Requirement 11.3)', () => {
    const w = world();
    const c = w.connect('c');
    expect(isHeartbeatExpired(c, w.now.ms + HEARTBEAT_TIMEOUT_MS - 1)).toBe(false);
    expect(isHeartbeatExpired(c, w.now.ms + HEARTBEAT_TIMEOUT_MS)).toBe(true);
  });

  // Feature: m2-shared-control, Property 11: Rejected messages change nothing
  it('leaves room and control test state unchanged for any rejected message', () => {
    const badMessages = fc.oneof(
      fc.string({ maxLength: 60 }).map((s) => ({ raw: s })),
      fc.jsonValue().map((j) => ({ raw: JSON.stringify(j) })),
      fc.record({
        type: fc.constantFrom('input.steer', 'input.charge', 'ability.request', 'seat.claim', 'setup.update'),
        matchId: fc.integer({ min: -2, max: 5 }),
        seq: fc.integer({ min: -2, max: 3 }),
        steering: fc.double(),
        seat: fc.string(),
        status: fc.string(),
        requestId: fc.integer({ min: -1, max: 5 }),
        extra: fc.boolean(),
      }).map((m) => ({ raw: JSON.stringify(m) })),
    );
    fc.assert(
      fc.property(badMessages, fc.constantFrom('pilot', 'engineer', 'stranger'), ({ raw }, who) => {
        const w = world();
        const c = crew(w);
        const conn = who === 'pilot' ? c.pilot : who === 'engineer' ? c.engineer : w.connect('stranger');
        // Move the replay guard so low seq values are stale.
        conn.lastSeq = 2;
        const before = snapshot(w, c.code);
        const out = dispatch(w.deps, conn, raw, false, w.now.ms);
        const replies = messagesTo(out, conn);
        const rejectedReply = replies.find(
          (m) => m.type === 'request.rejected' || (m.type === 'input.ack' && m.status === 'rejected'),
        );
        if (rejectedReply) {
          expect(replies).toHaveLength(1);
          expect(out.filter((o) => o.kind !== 'send')).toEqual([]);
          expect(snapshot(w, c.code)).toBe(before);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: m2-shared-control, Property 13: Only the bound crew seat controls the rocket
  it('accepts gameplay input only from the matching Comet seat with a fresh seq and the live match', () => {
    const inputs = fc.array(
      fc.record({
        who: fc.constantFrom('pilot', 'engineer', 'watcher', 'nova', 'outsider'),
        type: fc.constantFrom('input.steer' as const, 'input.charge' as const, 'ability.request' as const),
        staleMatch: fc.boolean(),
        seq: fc.integer({ min: 0, max: 6 }),
      }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(inputs, (list) => {
        const w = world();
        const c = crew(w);
        const watcher = w.connect('watcher');
        w.send(watcher, { type: 'room.join', requestId: rid(), code: c.code, name: 'W', intent: 'watch' });
        const nova = w.connect('nova');
        w.send(nova, { type: 'room.join', requestId: rid(), code: c.code, name: 'N', intent: 'play' });
        w.send(nova, { type: 'seat.claim', requestId: rid(), seat: 'nova-pilot' });
        const conns: Record<string, Connection> = { pilot: c.pilot, engineer: c.engineer, watcher, nova, outsider: w.connect('outsider') };
        const accepted: Record<string, number[]> = {};
        for (const item of list) {
          const conn = conns[item.who] as Connection;
          const matchId = item.staleMatch ? c.matchId + 1 : c.matchId;
          const message =
            item.type === 'input.steer'
              ? { type: item.type, matchId, seq: item.seq, steering: 0 }
              : item.type === 'input.charge'
                ? { type: item.type, matchId, seq: item.seq }
                : { type: item.type, matchId, seq: item.seq, intent: 'activate' };
          const before = conn.lastSeq;
          const out = w.send(conn, message);
          const ok = out.length === 0;
          const rightSeat =
            (item.who === 'pilot' && item.type === 'input.steer') ||
            (item.who === 'engineer' && item.type !== 'input.steer');
          if (ok) {
            expect(rightSeat).toBe(true);
            expect(item.staleMatch).toBe(false);
            expect(item.seq).toBeGreaterThan(before);
            (accepted[item.who] ??= []).push(item.seq);
          }
        }
        for (const seqs of Object.values(accepted)) {
          for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
        }
      }),
      { numRuns: 150 },
    );
  });
});
