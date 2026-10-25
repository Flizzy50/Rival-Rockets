import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { RESUME_COUNTDOWN_MS, SEAT_HOLD_MS, START_COUNTDOWN_MS, START_LANES } from '../src/shared/config.js';
import { SEAT_IDS, type MatchSnapshotMessage, type ServerMessage } from '../src/shared/protocol.js';
import { createConnection, dispatch, handleClose, housekeeping, type Connection, type DispatchDeps, type Outbound } from './dispatch.js';
import { createRoomStore } from './rooms.js';
import { createSimulation } from './simulation.js';
import { toRoomState } from './public-view.js';

// Lets one test make the pure match step throw, to prove a fault ends only
// that match. Every other test runs the real step.
const fault = vi.hoisted(() => ({ failing: false }));
vi.mock('../src/shared/rules/match.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/rules/match.js')>();
  return {
    ...actual,
    stepMatch: (...args: Parameters<typeof actual.stepMatch>) => {
      if (fault.failing) { fault.failing = false; throw new TypeError('boom'); }
      return actual.stepMatch(...args);
    },
  };
});

function world() {
  let now = 0, token = 0, requestId = 0, ints = 0;
  const messages: ServerMessage[] = [];
  const logs: string[] = [];
  const rooms = createRoomStore({ nowMs: () => now, randomInt: (max) => ints++ % max, randomToken: () => String(++token).padStart(22, 'a') });
  const sim = createSimulation({ nowMs: () => now, controlTestEnabled: false, log: (e) => logs.push(e), sendTo: (_, m) => messages.push(m), broadcast: (_, m) => messages.push(m), roomChanged: (code) => {
    const room = rooms.get(code);
    if (room) messages.push(toRoomState(room, false, sim.current(code)?.matchId ?? null, sim.roomStatus(code), now));
  } });
  const deps: DispatchDeps = { rooms, simulation: sim, controlTestEnabled: false, createLimiters: new Map(), joinLimiters: new Map(), seatLimiters: new Map(), log: (e) => logs.push(e) };
  let nextConn = 0;
  const send = (conn: Connection, message: object): Outbound[] => dispatch(deps, conn, JSON.stringify({ requestId: ++requestId, ...message }), false, now);
  const raw = (conn: Connection, message: object): Outbound[] => dispatch(deps, conn, JSON.stringify(message), false, now);
  function fullRoom(): { code: string; players: Connection[] } {
    const players = SEAT_IDS.map(() => createConnection(`c${nextConn++}`, `ip${nextConn}`, now));
    const [host] = players;
    if (!host) throw new Error('no host');
    send(host, { type: 'room.create', name: 'Host' });
    const code = host.code ?? '';
    players.forEach((p, i) => {
      if (i > 0) send(p, { type: 'room.join', code, name: `Player ${i}`, intent: 'play' });
      send(p, { type: 'seat.claim', seat: SEAT_IDS[i] });
      send(p, { type: 'setup.update', status: 'calibrated' });
      send(p, { type: 'ready.set', ready: true });
    });
    return { code, players };
  }
  return {
    rooms, sim, deps, messages, logs, send, raw, fullRoom,
    get now() { return now; },
    advance(ms: number) { now += ms; sim.tick(); },
    sweep() { return housekeeping(deps, now); },
    // Re-bind a dropped seat with its live token, as a reloaded tab does.
    reconnect(conn: Connection, code: string, seat: (typeof SEAT_IDS)[number]) {
      return send(conn, { type: 'seat.reconnect', code, seat, token: rooms.get(code)?.tokens[seat] });
    },
  };
}
function lastSnapshot(messages: readonly ServerMessage[]): MatchSnapshotMessage {
  const snap = messages.findLast((m): m is MatchSnapshotMessage => m.type === 'match.state' && m.mode === 'match');
  if (!snap) throw new Error('no snapshot');
  return snap;
}
function at(players: Connection[], i: number): Connection {
  const p = players[i];
  if (!p) throw new Error(`no player ${i}`);
  return p;
}
function playToResults(w: ReturnType<typeof world>, code: string): void {
  // 100 ms passes stay under the catch-up cap, so no match time is dropped.
  for (let i = 0; i < 1000 && w.sim.roomStatus(code).phase !== 'results'; i += 1) w.advance(100);
}

describe('M4 pause, resume, and interruption (PRD 8)', () => {
  it('freezes everything while paused and resumes only after a full 3-second countdown', () => {
    const w = world();
    const { code, players } = w.fullRoom();
    w.send(at(players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS);
    w.advance(500);
    handleClose(w.deps, at(players, 1));
    const paused = lastSnapshot(w.messages);
    expect(paused).toMatchObject({ frozen: true, resumeRemainingMs: 0 });
    w.advance(10000);
    expect(lastSnapshot(w.messages).matchMs).toBe(paused.matchMs);

    w.reconnect(at(players, 1), code, 'comet-engineer');
    // Reconnected but not yet recalibrated: still paused, no countdown.
    expect(w.sim.current(code)?.frozen).toBe(true);
    expect(lastSnapshot(w.messages).resumeRemainingMs).toBe(0);
    w.send(at(players, 1), { type: 'setup.update', status: 'calibrated' });
    expect(lastSnapshot(w.messages)).toMatchObject({ frozen: true, resumeRemainingMs: RESUME_COUNTDOWN_MS });
    const matchId = w.sim.current(code)?.matchId ?? 0;
    expect(w.raw(at(players, 0), { type: 'input.steer', matchId, seq: 1, steering: 1 })).toMatchObject([{ message: { reason: 'not-running' } }]);

    w.advance(RESUME_COUNTDOWN_MS - 1);
    expect(w.sim.current(code)?.frozen).toBe(true);
    w.advance(1);
    expect(w.sim.current(code)).toMatchObject({ frozen: false, matchId });
    expect(lastSnapshot(w.messages)).toMatchObject({ frozen: false, matchMs: paused.matchMs });
    w.advance(100);
    expect(lastSnapshot(w.messages).matchMs).toBeGreaterThan(paused.matchMs);
  });

  it('a disconnect during the resume countdown returns to Paused; the next resume restarts in full', () => {
    const w = world();
    const { code, players } = w.fullRoom();
    w.send(at(players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS + 100);
    handleClose(w.deps, at(players, 1));
    w.reconnect(at(players, 1), code, 'comet-engineer');
    w.send(at(players, 1), { type: 'setup.update', status: 'calibrated' });
    w.advance(2000);
    handleClose(w.deps, at(players, 2));
    expect(lastSnapshot(w.messages)).toMatchObject({ frozen: true, resumeRemainingMs: 0 });
    w.advance(2000);
    expect(w.sim.current(code)?.frozen).toBe(true);
    w.reconnect(at(players, 2), code, 'nova-pilot');
    w.send(at(players, 2), { type: 'setup.update', status: 'calibrated' });
    expect(lastSnapshot(w.messages).resumeRemainingMs).toBe(RESUME_COUNTDOWN_MS);
    w.advance(RESUME_COUNTDOWN_MS - 1);
    expect(w.sim.current(code)?.frozen).toBe(true);
    w.advance(1);
    expect(w.sim.current(code)?.frozen).toBe(false);
  });

  it('gives a second disconnect its own deadline and ends Interrupted at the earliest expiry', () => {
    const w = world();
    const { code, players } = w.fullRoom();
    w.send(at(players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS + 100);
    handleClose(w.deps, at(players, 0));
    w.advance(5000);
    handleClose(w.deps, at(players, 3));
    w.advance(SEAT_HOLD_MS - 5000 - 1);
    w.sweep();
    expect(w.sim.roomStatus(code).phase).toBe('running');
    const room = w.rooms.get(code);
    if (!room) throw new Error('no room');
    const view = toRoomState(room, false, null, w.sim.roomStatus(code), w.now);
    expect(view.seats.find((s) => s.seat === 'comet-pilot')?.holdRemainingMs).toBe(1);
    expect(view.seats.find((s) => s.seat === 'nova-engineer')?.holdRemainingMs).toBe(5001);
    w.advance(1);
    w.sweep();
    expect(w.sim.roomStatus(code)).toEqual({ phase: 'lobby', result: null, returnReason: 'interrupted' });
    expect(w.rooms.get(code)?.seats.seats['comet-pilot'].occupantId).toBeNull();
    // The lobby is usable again for the connected players.
    expect(w.send(at(players, 1), { type: 'ready.set', ready: true })).toMatchObject([{ message: { type: 'request.accepted' } }, { kind: 'room' }]);
  });

  it('ends a faulting match with no winner and keeps other rooms running', () => {
    const w = world();
    const a = w.fullRoom();
    const b = w.fullRoom();
    for (const r of [a, b]) w.send(at(r.players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS);
    fault.failing = true;
    w.advance(100);
    const statuses = [a, b].map((r) => w.sim.roomStatus(r.code));
    expect(statuses.filter((s) => s.returnReason === 'match-error')).toHaveLength(1);
    expect(statuses.filter((s) => s.phase === 'running')).toHaveLength(1);
    expect(w.logs).toContain('match step error: TypeError');
    for (const line of w.logs) for (const r of [a, b]) expect(line).not.toContain(r.code);
  });
});

describe('M4 rematch and role swap (PRD 7.7, 8)', () => {
  it('lets only the host rematch from Results, keeps setup, clears Ready, and alternates lanes', () => {
    const w = world();
    const { code, players } = w.fullRoom();
    w.send(at(players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS);
    expect(lastSnapshot(w.messages).rockets.comet.y).toBe(START_LANES.comet.y);
    expect(w.send(at(players, 0), { type: 'match.rematch' })).toMatchObject([{ message: { reason: 'wrong-phase' } }]);
    playToResults(w, code);
    const result = w.sim.roomStatus(code).result;
    expect(result).not.toBeNull();
    expect(w.send(at(players, 1), { type: 'match.rematch' })).toMatchObject([{ message: { reason: 'not-host' } }]);
    expect(w.sim.roomStatus(code).result).toEqual(result);

    w.send(at(players, 0), { type: 'match.rematch' });
    expect(w.sim.roomStatus(code)).toEqual({ phase: 'lobby', result: null, returnReason: null });
    const seats = w.rooms.get(code)?.seats.seats;
    for (const seat of SEAT_IDS) expect(seats?.[seat]).toMatchObject({ ready: false, setup: 'calibrated', swapRequested: false });
    expect(w.send(at(players, 0), { type: 'match.rematch' })).toMatchObject([{ message: { reason: 'wrong-phase' } }]);

    for (const p of players) w.send(p, { type: 'ready.set', ready: true });
    w.send(at(players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS);
    const snap = lastSnapshot(w.messages);
    expect(snap.rockets.comet.y).toBe(START_LANES.nova.y);
    expect(snap.rockets.nova.y).toBe(START_LANES.comet.y);
    expect(snap.crews.comet).toMatchObject({ energy: 50, selected: 'boost', crossings: 0, carried: 0, score: 0 });
    expect(snap.remainingMs).toBe(90000);
  });

  it('counts an interrupted match toward lane alternation but not a cancelled countdown', () => {
    const w = world();
    const { code, players } = w.fullRoom();
    w.send(at(players, 0), { type: 'match.start' });
    handleClose(w.deps, at(players, 2));
    expect(w.sim.roomStatus(code).returnReason).toBe('countdown-cancelled');
    w.reconnect(at(players, 2), code, 'nova-pilot');
    w.send(at(players, 2), { type: 'setup.update', status: 'calibrated' });
    for (const p of players) w.send(p, { type: 'ready.set', ready: true });
    w.send(at(players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS);
    expect(lastSnapshot(w.messages).rockets.comet.y).toBe(START_LANES.comet.y);
  });

  it('swaps a crew only when both tap, rotating both tokens and keeping the host', () => {
    const w = world();
    const { code, players } = w.fullRoom();
    expect(w.send(at(players, 0), { type: 'match.swap' })).toMatchObject([{ message: { reason: 'wrong-phase' } }]);
    w.send(at(players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS);
    playToResults(w, code);
    const result = w.sim.roomStatus(code).result;
    const before = { ...w.rooms.get(code)?.tokens };
    const [p0, p1] = [at(players, 0), at(players, 1)];

    expect(w.send(p0, { type: 'match.swap' }).filter((o) => o.kind === 'participant')).toHaveLength(0);
    expect(w.rooms.get(code)?.seats.seats['comet-pilot'].swapRequested).toBe(true);
    w.send(p0, { type: 'match.swap' });
    expect(w.rooms.get(code)?.seats.seats['comet-pilot'].swapRequested).toBe(false);
    w.send(p0, { type: 'match.swap' });
    const out = w.send(p1, { type: 'match.swap' });

    const room = w.rooms.get(code);
    expect(room?.seats.seats['comet-pilot']).toMatchObject({ occupantId: p1.participantId, setup: 'unverified', ready: false, swapRequested: false });
    expect(room?.seats.seats['comet-engineer']).toMatchObject({ occupantId: p0.participantId, setup: 'unverified' });
    expect(room?.seats.seats['nova-pilot'].setup).toBe('calibrated');
    expect(room?.seats.hostId).toBe(p0.participantId);
    expect(room?.tokens['comet-pilot']).not.toBe(before['comet-pilot']);
    expect(room?.tokens['comet-engineer']).not.toBe(before['comet-engineer']);
    expect(w.sim.roomStatus(code).result).toEqual(result);

    // Each new token goes only to its owner; the room broadcast carries none.
    const privates = out.filter((o) => o.kind === 'participant');
    expect(privates).toEqual(expect.arrayContaining([
      { kind: 'participant', code, participantId: p1.participantId, message: { type: 'seat.swapped', code, seat: 'comet-pilot', token: room?.tokens['comet-pilot'] } },
      { kind: 'participant', code, participantId: p0.participantId, message: { type: 'seat.swapped', code, seat: 'comet-engineer', token: room?.tokens['comet-engineer'] } },
    ]));
    const publicText = JSON.stringify(out.filter((o) => o.kind !== 'participant'));
    for (const t of Object.values(room?.tokens ?? {})) if (t) expect(publicText).not.toContain(t);

    // The old token is dead.
    const stranger = createConnection('stranger', 'ipx', w.now);
    expect(w.send(stranger, { type: 'seat.reconnect', code, seat: 'comet-pilot', token: before['comet-pilot'] })).toMatchObject([{ message: { reason: 'reconnect-denied' } }]);

    // Swapped players must set up again before the next start.
    w.send(p0, { type: 'match.rematch' });
    expect(w.send(p1, { type: 'ready.set', ready: true })).toMatchObject([{ message: { reason: 'not-calibrated' } }]);
    expect(w.send(p0, { type: 'match.start' })).toMatchObject([{ message: { reason: 'start-blocked' } }]);
  });

  it('a disconnect withdraws a pending swap', () => {
    const w = world();
    const { code, players } = w.fullRoom();
    w.send(at(players, 0), { type: 'match.start' });
    w.advance(START_COUNTDOWN_MS);
    playToResults(w, code);
    w.send(at(players, 2), { type: 'match.swap' });
    handleClose(w.deps, at(players, 2));
    w.reconnect(at(players, 2), code, 'nova-pilot');
    expect(w.rooms.get(code)?.seats.seats['nova-pilot'].swapRequested).toBe(false);
    w.send(at(players, 3), { type: 'match.swap' });
    expect(w.rooms.get(code)?.seats.seats['nova-engineer'].occupantId).toBe(at(players, 3).participantId);
  });
});

describe('M4 abuse regression (AC11)', () => {
  // Feature: m4-interruptions, Property: Watchers and non-hosts cannot change roles or match state
  it('never lets a watcher or a non-host change seats, the host, the phase, or the result', () => {
    const types = ['match.start', 'match.rematch', 'match.swap', 'seat.claim', 'seat.release', 'ready.set', 'setup.update', 'input.steer', 'input.charge', 'ability.request', 'room.watch'] as const;
    const message = fc.record({
      type: fc.constantFrom(...types),
      seat: fc.constantFrom(...SEAT_IDS),
      ready: fc.boolean(),
      status: fc.constantFrom('readings', 'calibrated'),
      steering: fc.double({ min: -5, max: 5, noNaN: true }),
      intent: fc.constantFrom('select', 'activate'),
      ability: fc.constantFrom('boost', 'shield'),
      matchId: fc.integer({ min: 1, max: 5 }),
      seq: fc.integer({ min: 1, max: 1000 }),
    });
    fc.assert(fc.property(fc.constantFrom('lobby', 'running', 'results'), fc.array(message, { minLength: 1, maxLength: 12 }), (phase, batch) => {
      const w = world();
      const { code, players } = w.fullRoom();
      const watcher = createConnection('watcher', 'ipw', w.now);
      w.send(watcher, { type: 'room.join', code, name: 'Watcher', intent: 'watch' });
      if (phase !== 'lobby') { w.send(at(players, 0), { type: 'match.start' }); w.advance(START_COUNTDOWN_MS); }
      if (phase === 'results') playToResults(w, code);
      const seatsBefore = JSON.stringify(SEAT_IDS.map((s) => w.rooms.get(code)?.seats.seats[s].occupantId));
      const hostBefore = w.rooms.get(code)?.seats.hostId;
      const statusBefore = w.sim.roomStatus(code);
      const nova = lastSnapshotOrNull(w.messages);
      for (const m of batch) {
        const body = pick(m);
        // Watcher: anything. Nova Pilot: only messages its seat may not use.
        if ('seq' in body) w.raw(watcher, body); else w.send(watcher, body);
        if (body.type === 'match.start' || body.type === 'match.rematch' || body.type === 'input.charge' || body.type === 'ability.request') {
          if ('seq' in body) w.raw(at(players, 2), body); else w.send(at(players, 2), body);
        }
      }
      expect(JSON.stringify(SEAT_IDS.map((s) => w.rooms.get(code)?.seats.seats[s].occupantId))).toBe(seatsBefore);
      expect(w.rooms.get(code)?.seats.hostId).toBe(hostBefore);
      expect(w.sim.roomStatus(code)).toEqual(statusBefore);
      // The Nova Pilot can never charge or pick abilities for its crew.
      if (nova && phase === 'running') {
        w.advance(100);
        expect(lastSnapshot(w.messages).crews.nova.energy).toBe(nova.crews.nova.energy);
      }
    }), { numRuns: 60 });
  });
});

function lastSnapshotOrNull(messages: readonly ServerMessage[]): MatchSnapshotMessage | null {
  return messages.findLast((m): m is MatchSnapshotMessage => m.type === 'match.state' && m.mode === 'match') ?? null;
}

function pick(m: { type: string; seat: string; ready: boolean; status: string; steering: number; intent: string; ability: string; matchId: number; seq: number }): Record<string, unknown> {
  switch (m.type) {
    case 'seat.claim': return { type: m.type, seat: m.seat };
    case 'ready.set': return { type: m.type, ready: m.ready };
    case 'setup.update': return { type: m.type, status: m.status };
    case 'input.steer': return { type: m.type, matchId: m.matchId, seq: m.seq, steering: m.steering };
    case 'input.charge': return { type: m.type, matchId: m.matchId, seq: m.seq };
    case 'ability.request': return m.intent === 'select' ? { type: m.type, matchId: m.matchId, seq: m.seq, intent: 'select', ability: m.ability } : { type: m.type, matchId: m.matchId, seq: m.seq, intent: 'activate' };
    default: return { type: m.type };
  }
}
