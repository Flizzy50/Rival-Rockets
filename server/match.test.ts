import { describe, expect, it } from 'vitest';
import { SEAT_IDS, type ServerMessage } from '../src/shared/protocol.js';
import { createConnection, dispatch, handleClose, housekeeping, type DispatchDeps } from './dispatch.js';
import { createRoomStore } from './rooms.js';
import { createSimulation } from './simulation.js';
import { toRoomState } from './public-view.js';
import { validateMessage } from './validate.js';

function world() {
  let now = 0, token = 0, requestId = 0, ints = 0;
  const messages: ServerMessage[] = [];
  const rooms = createRoomStore({ nowMs: () => now, randomInt: (max) => ints++ % max, randomToken: () => String(++token).padStart(22, 'a') });
  const sim = createSimulation({ nowMs: () => now, controlTestEnabled: true, sendTo: (_, m) => messages.push(m), broadcast: (_, m) => messages.push(m), roomChanged: (code) => {
    const room = rooms.get(code);
    if (room) messages.push(toRoomState(room, true, sim.current(code)?.matchId ?? null, sim.roomStatus(code)));
  } });
  const deps: DispatchDeps = { rooms, simulation: sim, controlTestEnabled: true, createLimiters: new Map(), joinLimiters: new Map(), seatLimiters: new Map(), log: () => undefined };
  const players = SEAT_IDS.map((_, i) => createConnection(`c${i}`, `ip${i}`, now));
  const send = (i: number, message: object) => {
    const player = players[i]; if (!player) throw new Error('missing player');
    return dispatch(deps, player, JSON.stringify({ requestId: ++requestId, ...message }), false, now);
  };
  send(0, { type: 'room.create', name: 'Pilot' });
  const code = players[0]?.code ?? '';
  for (let i = 0; i < SEAT_IDS.length; i += 1) {
    if (i > 0) send(i, { type: 'room.join', code, name: `Player ${i}`, intent: 'play' });
    send(i, { type: 'seat.claim', seat: SEAT_IDS[i] });
    send(i, { type: 'setup.update', status: 'calibrated' });
    send(i, { type: 'ready.set', ready: true });
  }
  function input(i: number, message: object) {
    const player = players[i]; if (!player) throw new Error('missing player');
    return dispatch(deps, player, JSON.stringify(message), false, now);
  }
  return { sim, rooms, deps, players, messages, code, send, input, advance(ms: number) { now += ms; sim.tick(); }, sweep() { return housekeeping(deps, now); } };
}

describe('M3 server lifecycle and authorization', () => {
  it('validates new message schemas without accepting caller-chosen teams', () => {
    for (const ready of [null, 1, 'true', [], {}]) expect(validateMessage(JSON.stringify({ type: 'ready.set', requestId: 1, ready }), false)).toMatchObject({ ok: false, reason: 'invalid-value' });
    expect(validateMessage(JSON.stringify({ type: 'ready.set', requestId: 1, ready: true }), false).ok).toBe(true);
    expect(validateMessage(JSON.stringify({ type: 'input.charge', matchId: 1, seq: 1, team: 'nova' }), false)).toMatchObject({ ok: false, reason: 'invalid-field' });
  });
  it('requires host and four ready seats, cancels a countdown, and clears Ready on start', () => {
    const w = world();
    expect(w.send(1, { type: 'match.start' })).toMatchObject([{ message: { reason: 'not-host' } }]);
    w.send(2, { type: 'ready.set', ready: false });
    expect(w.send(0, { type: 'match.start' })).toMatchObject([{ message: { reason: 'start-blocked' } }]);
    w.send(2, { type: 'ready.set', ready: true });
    const testId = w.sim.current(w.code)?.matchId;
    w.send(0, { type: 'match.start' });
    expect(w.sim.current(w.code)?.matchId).not.toBe(testId);
    expect(w.sim.roomStatus(w.code).phase).toBe('countdown');
    expect(SEAT_IDS.every((s) => !w.rooms.get(w.code)?.seats.seats[s].ready)).toBe(true);
    expect(w.send(1, { type: 'seat.release' })).toMatchObject([{ message: { reason: 'wrong-phase' } }]);
    w.advance(2999);
    expect(w.sim.roomStatus(w.code).phase).toBe('countdown');
    handleClose(w.deps, w.players[2]!);
    expect(w.sim.roomStatus(w.code)).toMatchObject({ phase: 'lobby', result: null, returnReason: 'countdown-cancelled' });
  });
  it('authorizes each role for its own crew, freezes timers, then abandons an expired hold', () => {
    const w = world();
    w.send(0, { type: 'match.start' });
    const matchId = w.sim.current(w.code)!.matchId;
    expect(w.input(0, { type: 'input.steer', matchId, seq: 1, steering: 1 })).toMatchObject([{ message: { reason: 'not-running' } }]);
    w.advance(3000);
    expect(w.input(1, { type: 'input.steer', matchId, seq: 1, steering: 1 })).toMatchObject([{ message: { reason: 'not-authorized' } }]);
    expect(w.input(2, { type: 'input.charge', matchId, seq: 1 })).toMatchObject([{ message: { reason: 'not-authorized' } }]);
    expect(w.input(2, { type: 'input.steer', matchId, seq: 1, steering: 1 })).toEqual([]);
    expect(w.input(3, { type: 'input.charge', matchId, seq: 1 })).toEqual([]);
    w.advance(100);
    const snapshot = w.messages.findLast((m) => m.type === 'match.state' && m.mode === 'match');
    expect(snapshot).toMatchObject({ crews: { nova: { energy: 75 }, comet: { energy: 50 } } });
    handleClose(w.deps, w.players[0]!);
    const frozen = w.messages.at(-1);
    w.advance(10000);
    expect(w.messages.at(-1)).toEqual(frozen);
    const room = w.rooms.get(w.code)!;
    const fresh = createConnection('rejoined', 'ip0', 13000);
    const rejoin = dispatch(w.deps, fresh, JSON.stringify({ type: 'seat.reconnect', requestId: 1, code: w.code, seat: 'comet-pilot', token: room.tokens['comet-pilot'] }), false, 13000);
    expect(rejoin[0]?.kind).toBe('supersede');
    expect(w.sim.current(w.code)?.frozen).toBe(true);
    w.advance(5000);
    w.sweep();
    expect(w.sim.roomStatus(w.code)).toMatchObject({ phase: 'lobby', result: null, returnReason: 'interrupted' });
  });
  it('sends each presentation event in exactly one snapshot', () => {
    const w = world();
    w.send(0, { type: 'match.start' }); w.advance(3000);
    const id = w.sim.current(w.code)!.matchId;
    const countdownSnapshots = w.messages.filter((m) => m.type === 'match.state' && m.mode === 'match');
    expect(countdownSnapshots.every((m) => m.type === 'match.state' && m.mode === 'match' && m.events.length === 0)).toBe(true);
    for (let i = 0; i < 60; i += 1) w.advance(20);
    const events = w.messages.flatMap((m) => (m.type === 'match.state' && m.mode === 'match' && m.matchId === id ? m.events : []));
    // Both rockets start left of the top gate heading right, so each crosses it once.
    expect(events.filter((e) => e.kind === 'gate')).toEqual([
      expect.objectContaining({ team: 'comet', gate: 0 }),
      expect.objectContaining({ team: 'nova', gate: 0 }),
    ]);
  });
  it('resumes after usable controls and keeps completed results frozen when players leave', () => {
    const w = world();
    w.send(0, { type: 'match.start' }); w.advance(3000); w.advance(100);
    const id = w.sim.current(w.code)!.matchId;
    handleClose(w.deps, w.players[0]!);
    const token = w.rooms.get(w.code)!.tokens['comet-pilot'];
    w.send(0, { type: 'seat.reconnect', code: w.code, seat: 'comet-pilot', token });
    expect(w.sim.current(w.code)?.frozen).toBe(true);
    w.send(0, { type: 'setup.update', status: 'calibrated' });
    // M4: usable controls start the 3-second resume countdown first.
    expect(w.sim.current(w.code)).toMatchObject({ frozen: true, matchId: id });
    w.advance(3000);
    expect(w.sim.current(w.code)).toMatchObject({ frozen: false, matchId: id });
    for (let i = 0; i < 910; i += 1) w.advance(100);
    const result = w.sim.roomStatus(w.code).result;
    expect(result).not.toBeNull();
    expect(w.sim.roomStatus(w.code).phase).toBe('results');
    w.send(0, { type: 'room.leave' });
    expect(w.sim.roomStatus(w.code).result).toEqual(result);
    expect(w.input(3, { type: 'input.charge', matchId: id, seq: 99 })).toMatchObject([{ message: { reason: 'not-running' } }]);
    const publicText = JSON.stringify(w.messages);
    for (const secret of Object.values(w.rooms.get(w.code)!.tokens)) if (secret) expect(publicText).not.toContain(secret);
  });
});
