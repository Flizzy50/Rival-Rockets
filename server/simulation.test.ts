import { describe, expect, it } from 'vitest';
import { BROADCAST_HZ, SIMULATION_HZ } from '../src/shared/config.js';
import type { ServerMessage } from '../src/shared/protocol.js';
import {
  addParticipant,
  claimSeat,
  createSeatsState,
  setConnected,
  setSeatSetup,
  type SeatResult,
  type SeatsState,
} from '../src/shared/rules/seats.js';
import { MAX_CATCH_UP_STEPS, SIMULATION_LOOP_INTERVAL_MS } from './config.js';
import { controlTestFlag, createSimulation, type Simulation } from './simulation.js';

const MS_PER_S = 1000;
const TEST_SECONDS = 10;

function ok(r: SeatResult): SeatsState {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function readyCrew(): SeatsState {
  let s = createSeatsState({ id: 'p', intent: 'play', connected: true, joinOrder: 0, connectedSince: 0 });
  s = ok(addParticipant(s, { id: 'e', intent: 'play', connected: true, joinOrder: 1, connectedSince: 0 }));
  s = ok(claimSeat(s, 'p', 'comet-pilot'));
  s = ok(claimSeat(s, 'e', 'comet-engineer'));
  s = ok(setSeatSetup(s, 'p', 'calibrated'));
  return ok(setSeatSetup(s, 'e', 'calibrated'));
}

interface Harness {
  sim: Simulation;
  now: { ms: number };
  broadcasts: ServerMessage[];
  direct: Array<{ to: string; message: ServerMessage }>;
}

function harness(enabled = true): Harness {
  const now = { ms: 0 };
  const broadcasts: ServerMessage[] = [];
  const direct: Array<{ to: string; message: ServerMessage }> = [];
  const sim = createSimulation({
    nowMs: () => now.ms,
    sendTo: (to, message) => direct.push({ to, message }),
    broadcast: (_code, message) => broadcasts.push(message),
    controlTestEnabled: enabled,
  });
  return { sim, now, broadcasts, direct };
}

function run(h: Harness, ms: number): void {
  const end = h.now.ms + ms;
  while (h.now.ms < end) {
    h.now.ms += SIMULATION_LOOP_INTERVAL_MS;
    h.sim.tick();
  }
}

function matchStates(h: Harness) {
  return h.broadcasts.flatMap((m) => (m.type === 'match.state' ? [m] : []));
}

describe('simulation', () => {
  it('parses the control test flag (Requirement 17.3)', () => {
    expect(controlTestFlag(['node', 'main.js', '--dev'], {})).toBe(true);
    expect(controlTestFlag([], { RR_CONTROL_TEST: '1' })).toBe(true);
    expect(controlTestFlag([], { RR_CONTROL_TEST: 'true' })).toBe(false);
    expect(controlTestFlag([], {})).toBe(false);
  });

  it('starts nothing while the flag is off (Requirement 17.2)', () => {
    const h = harness(false);
    expect(h.sim.sync('ROOM', readyCrew())).toBeNull();
    expect(h.sim.current('ROOM')).toBeNull();
  });

  it('starts when the Comet crew is ready and steps at 30 Hz with ~18 Hz broadcasts (Requirements 16.1, 16.2)', () => {
    const h = harness();
    expect(h.sim.sync('ROOM', readyCrew())).toBe('started');
    h.broadcasts.length = 0;
    run(h, TEST_SECONDS * MS_PER_S);
    const states = matchStates(h);
    expect(Math.abs(states.length - TEST_SECONDS * BROADCAST_HZ)).toBeLessThanOrEqual(1);
    const lastTick = states[states.length - 1]?.tick ?? 0;
    expect(Math.abs(lastTick - TEST_SECONDS * SIMULATION_HZ)).toBeLessThanOrEqual(1);
  });

  it('caps catch-up after a stall (Requirement 16.5)', () => {
    const h = harness();
    h.sim.sync('ROOM', readyCrew());
    h.now.ms += MS_PER_S;
    h.sim.tick();
    expect(matchStates(h).at(-1)?.tick).toBe(MAX_CATCH_UP_STEPS);
  });

  it('acks each input after the step that applied it', () => {
    const h = harness();
    h.sim.sync('ROOM', readyCrew());
    const matchId = h.sim.current('ROOM')?.matchId ?? -1;
    expect(h.sim.enqueue('ROOM', 'c1', { kind: 'steer', seq: 1, steering: 1 })).toBeNull();
    expect(h.sim.enqueue('ROOM', 'c2', { kind: 'charge', seq: 1 })).toBeNull();
    run(h, 40);
    expect(h.direct).toEqual([
      { to: 'c1', message: expect.objectContaining({ type: 'input.ack', matchId, seq: 1, status: 'applied', tick: 1, steering: 1 }) as unknown },
      { to: 'c2', message: expect.objectContaining({ type: 'input.ack', matchId, seq: 1, status: 'applied', tick: 1 }) as unknown },
    ]);
  });

  it('freezes with neutral steering on a crew disconnect and resumes the same test (Requirements 11.4, 17.5, 17.6)', () => {
    const h = harness();
    const ready = readyCrew();
    h.sim.sync('ROOM', ready);
    const matchId = h.sim.current('ROOM')?.matchId;
    h.sim.enqueue('ROOM', 'c1', { kind: 'steer', seq: 1, steering: 1 });
    run(h, 100);
    const away = setConnected(ready, 'p', false, h.now.ms);
    expect(h.sim.sync('ROOM', away)).toBe('frozen');
    const frozenState = matchStates(h).at(-1);
    expect(frozenState).toMatchObject({ frozen: true, steering: 0 });
    run(h, 500);
    expect(matchStates(h).at(-1)?.tick).toBe(frozenState?.tick);
    expect(h.sim.enqueue('ROOM', 'c2', { kind: 'charge', seq: 1 })).toBe('no-control-test');

    expect(h.sim.sync('ROOM', setConnected(away, 'p', true, h.now.ms))).toBe('resumed');
    expect(h.sim.current('ROOM')).toEqual({ matchId, frozen: false });
    run(h, 100);
    expect(matchStates(h).at(-1)?.tick).toBeGreaterThan(frozenState?.tick ?? 0);
  });

  it('ends on an occupant change and the next test is fresh (Requirement 17.7)', () => {
    const h = harness();
    const ready = readyCrew();
    h.sim.sync('ROOM', ready);
    const first = h.sim.current('ROOM')?.matchId ?? 0;
    h.sim.enqueue('ROOM', 'c1', { kind: 'steer', seq: 5, steering: 1 });
    const swapped: SeatsState = {
      ...ready,
      seats: { ...ready.seats, 'comet-pilot': { ...ready.seats['comet-pilot'], occupantId: 'e2' } },
    };
    expect(h.sim.sync('ROOM', swapped)).toBe('ended');
    expect(h.direct.at(-1)?.message).toMatchObject({ status: 'rejected', reason: 'stale-match', seq: 5 });
    expect(h.sim.sync('ROOM', ready)).toBe('started');
    expect(h.sim.current('ROOM')?.matchId).toBe(first + 1);
    expect(matchStates(h).at(-1)).toMatchObject({ tick: 0, crew: { energy: 50 } });
  });

  it('sends no score, timer, or result fields (Requirements 16.6, 17.4)', () => {
    const h = harness();
    h.sim.sync('ROOM', readyCrew());
    const state = matchStates(h)[0];
    expect(Object.keys(state ?? {}).sort()).toEqual(
      ['crew', 'frozen', 'matchId', 'mode', 'pose', 'sessionMs', 'steering', 'tick', 'type'].sort(),
    );
  });
});
