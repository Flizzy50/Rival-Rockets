import { BROADCAST_INTERVAL_MS, START_COUNTDOWN_MS, STEP_MS } from '../src/shared/config.js';
import { SEAT_IDS, type PublicMatchResult, type RejectReason, type ReturnReason, type RoomPhase, type SeatId, type ServerMessage } from '../src/shared/protocol.js';
import {
  createControlTest,
  stepControlTest,
  withNeutralSteering,
  type ControlTestState,
  type QueuedInput,
} from '../src/shared/rules/control-test.js';
import { cometCrewReady, type SeatsState } from '../src/shared/rules/seats.js';
import { MAX_CATCH_UP_STEPS } from './config.js';
import { rejectedAck, toAck, toMatchState, toMatchAck, toMatchSnapshot, toPublicResult } from './public-view.js';
import { createMatch, neutralMatchSteering, stepMatch, type MatchInput, type MatchState } from '../src/shared/rules/match.js';

// Simulation (Requirements 16, 17): owns each room's control test, its input
// queue, and the fixed-step accumulator. The clock and outbound channels are
// injected, so tests drive it with fake time and no sockets.

export interface SimulationDeps {
  nowMs(): number;
  sendTo(connectionId: string, message: ServerMessage): void;
  broadcast(code: string, message: ServerMessage): void;
  readonly controlTestEnabled: boolean;
  roomChanged(code: string): void;
}

export interface ControlTestInfo {
  readonly mode: 'control-test' | 'match';
  readonly accepting: boolean;
  readonly matchId: number;
  readonly frozen: boolean;
}

export type LifecycleChange = 'started' | 'frozen' | 'resumed' | 'ended' | null;

export interface Simulation {
  startMatch(code: string, seats: SeatsState): void;
  roomStatus(code: string): { phase: RoomPhase; result: PublicMatchResult | null; returnReason: ReturnReason | null };
  // Re-evaluates start, freeze, resume, and end after any seat change.
  sync(code: string, seats: SeatsState): LifecycleChange;
  // Null when queued; otherwise why the input was refused.
  enqueue(code: string, connectionId: string, input: QueuedInput | MatchInput): RejectReason | null;
  current(code: string): ControlTestInfo | null;
  // One loop pass: run due steps, send acks, and broadcast when due.
  tick(): void;
  remove(code: string): void;
}

interface Runtime {
  state: ControlTestState;
  queue: Array<{ input: QueuedInput; connectionId: string }>;
  frozen: boolean;
  accumulatorMs: number;
  lastLoopMs: number;
  nextBroadcastMs: number;
  // The crew the test started with; a different occupant ends the test.
  readonly pilotId: string;
  readonly engineerId: string;
}

interface MatchRuntime {
  state: MatchState; phase: 'countdown' | 'running' | 'results'; frozen: boolean;
  queue: Array<{ input: MatchInput; connectionId: string }>;
  countdownEndsAtMs: number; accumulatorMs: number; lastLoopMs: number; nextBroadcastMs: number;
  occupants: Record<SeatId, string | null>;
}

// The flag is read from argv and env here, not inside the loop, so tests can
// pass any combination (Requirement 17.3).
export function controlTestFlag(argv: readonly string[], env: { RR_CONTROL_TEST?: string | undefined }): boolean {
  return argv.includes('--dev') || env.RR_CONTROL_TEST === '1';
}

export function createSimulation(deps: SimulationDeps): Simulation {
  const runtimes = new Map<string, Runtime>();
  const matches = new Map<string, MatchRuntime>();
  const returnReasons = new Map<string, ReturnReason>();
  let nextMatchId = 1;

  function rejectQueue(runtime: Runtime, reason: RejectReason): void {
    for (const { input, connectionId } of runtime.queue) {
      deps.sendTo(connectionId, rejectedAck(runtime.state.matchId, input.seq, reason));
    }
    runtime.queue = [];
  }

  function end(code: string, runtime: Runtime): void {
    rejectQueue(runtime, 'stale-match');
    runtimes.delete(code);
  }

  function step(runtime: Runtime): void {
    const batch = runtime.queue;
    runtime.queue = [];
    const out = stepControlTest(
      runtime.state,
      batch.map((b) => b.input),
    );
    runtime.state = out.state;
    out.results.forEach((result, i) => {
      const owner = batch[i];
      if (owner) deps.sendTo(owner.connectionId, toAck(runtime.state, result));
    });
  }

  function rejectMatchQueue(runtime: MatchRuntime): void {
    for (const item of runtime.queue) deps.sendTo(item.connectionId, rejectedAck(runtime.state.matchId, item.input.seq, 'not-running'));
    runtime.queue = [];
  }
  function broadcastMatch(code: string, runtime: MatchRuntime): void {
    deps.broadcast(code, toMatchSnapshot(runtime.state, runtime.phase === 'results' ? 'complete' : runtime.phase, runtime.frozen, runtime.phase === 'countdown' ? Math.max(0, runtime.countdownEndsAtMs - deps.nowMs()) : 0));
  }

  return {
    startMatch(code, seats) {
      const control = runtimes.get(code);
      if (control) end(code, control);
      const now = deps.nowMs();
      const occupants = Object.fromEntries(SEAT_IDS.map((seat) => [seat, seats.seats[seat].occupantId])) as Record<SeatId, string | null>;
      const runtime: MatchRuntime = { state: createMatch(nextMatchId++), phase: 'countdown', frozen: false, queue: [], countdownEndsAtMs: now + START_COUNTDOWN_MS, accumulatorMs: 0, lastLoopMs: now, nextBroadcastMs: now, occupants };
      matches.set(code, runtime);
      returnReasons.delete(code);
      broadcastMatch(code, runtime);
    },

    roomStatus(code) {
      const match = matches.get(code);
      return { phase: match?.phase ?? 'lobby', result: match?.state.result ? toPublicResult(match.state.result, match.state.matchId) : null, returnReason: returnReasons.get(code) ?? null };
    },

    sync(code, seats) {
      const match = matches.get(code);
      if (match) {
        if (match.phase === 'results') return null;
        const changed = SEAT_IDS.some((s) => seats.seats[s].occupantId !== match.occupants[s]);
        const usable = SEAT_IDS.every((s) => {
          const slot = seats.seats[s];
          return slot.occupantId !== null && seats.participants.get(slot.occupantId)?.connected && slot.setup === 'calibrated';
        });
        if (changed || (match.phase === 'countdown' && !usable)) {
          rejectMatchQueue(match);
          matches.delete(code);
          returnReasons.set(code, changed ? 'abandoned' : 'countdown-cancelled');
          return 'ended';
        }
        if (!usable) {
          for (const team of ['comet', 'nova'] as const) match.state = neutralMatchSteering(match.state, team);
          if (!match.frozen) {
            match.frozen = true;
            match.accumulatorMs = 0;
            rejectMatchQueue(match);
            broadcastMatch(code, match);
            return 'frozen';
          }
        } else if (match.frozen) {
          match.frozen = false;
          match.lastLoopMs = deps.nowMs();
          match.accumulatorMs = 0;
          broadcastMatch(code, match);
          return 'resumed';
        }
        return null;
      }
      const runtime = runtimes.get(code);
      const pilotId = seats.seats['comet-pilot'].occupantId;
      const engineerId = seats.seats['comet-engineer'].occupantId;
      const now = deps.nowMs();

      if (!runtime) {
        if (!deps.controlTestEnabled || !cometCrewReady(seats) || pilotId === null || engineerId === null) return null;
        const state = createControlTest(nextMatchId);
        nextMatchId += 1;
        runtimes.set(code, {
          state,
          queue: [],
          frozen: false,
          accumulatorMs: 0,
          lastLoopMs: now,
          nextBroadcastMs: now,
          pilotId,
          engineerId,
        });
        deps.broadcast(code, toMatchState(state, false));
        return 'started';
      }

      // A reopened seat or a new occupant means a different crew, which must
      // start from fresh state (Requirement 17.7).
      if (pilotId !== runtime.pilotId || engineerId !== runtime.engineerId) {
        end(code, runtime);
        return 'ended';
      }

      const ready = cometCrewReady(seats);
      if (!ready && !runtime.frozen) {
        runtime.frozen = true;
        runtime.state = withNeutralSteering(runtime.state);
        runtime.accumulatorMs = 0;
        rejectQueue(runtime, 'no-control-test');
        deps.broadcast(code, toMatchState(runtime.state, true));
        return 'frozen';
      }
      if (ready && runtime.frozen) {
        runtime.frozen = false;
        runtime.accumulatorMs = 0;
        runtime.lastLoopMs = now;
        runtime.nextBroadcastMs = now;
        deps.broadcast(code, toMatchState(runtime.state, false));
        return 'resumed';
      }
      return null;
    },

    enqueue(code, connectionId, input) {
      const match = matches.get(code);
      if (match) {
        if (match.phase !== 'running' || match.frozen) return 'not-running';
        if (!('team' in input)) return 'not-authorized';
        match.queue.push({ input, connectionId });
        return null;
      }
      const runtime = runtimes.get(code);
      // Frozen time cannot apply anything, and queuing would replay stale
      // input on resume.
      if (!runtime || runtime.frozen) return 'no-control-test';
      runtime.queue.push({ input, connectionId });
      return null;
    },

    current(code) {
      const match = matches.get(code);
      if (match) return { mode: 'match', matchId: match.state.matchId, frozen: match.frozen, accepting: match.phase === 'running' && !match.frozen };
      const runtime = runtimes.get(code);
      return runtime ? { mode: 'control-test', matchId: runtime.state.matchId, frozen: runtime.frozen, accepting: !runtime.frozen } : null;
    },

    tick() {
      const now = deps.nowMs();
      for (const [code, runtime] of matches) {
        if (runtime.phase === 'results') continue;
        if (runtime.phase === 'countdown') {
          if (now >= runtime.countdownEndsAtMs) {
            runtime.phase = 'running';
            runtime.lastLoopMs = now;
            runtime.accumulatorMs = 0;
            broadcastMatch(code, runtime);
            deps.roomChanged(code);
          } else if (now >= runtime.nextBroadcastMs) {
            broadcastMatch(code, runtime);
            runtime.nextBroadcastMs = now + BROADCAST_INTERVAL_MS;
          }
          continue;
        }
        if (runtime.frozen) { runtime.lastLoopMs = now; continue; }
        runtime.accumulatorMs += Math.max(0, now - runtime.lastLoopMs);
        runtime.lastLoopMs = now;
        let steps = 0;
        while (runtime.accumulatorMs >= STEP_MS && steps < MAX_CATCH_UP_STEPS && !runtime.state.complete) {
          const batch = runtime.queue;
          runtime.queue = [];
          const out = stepMatch(runtime.state, batch.map((b) => b.input));
          runtime.state = out.state;
          out.results.forEach((result, i) => { const item = batch[i]; if (item) deps.sendTo(item.connectionId, toMatchAck(runtime.state, item.input.team, result)); });
          runtime.accumulatorMs -= STEP_MS;
          steps += 1;
        }
        if (runtime.accumulatorMs >= STEP_MS) runtime.accumulatorMs = 0;
        if (runtime.state.complete) {
          runtime.phase = 'results';
          broadcastMatch(code, runtime);
          deps.roomChanged(code);
        } else if (steps > 0 && now >= runtime.nextBroadcastMs) {
          broadcastMatch(code, runtime);
          runtime.nextBroadcastMs = now + BROADCAST_INTERVAL_MS;
        }
      }
      for (const [code, runtime] of runtimes) {
        if (runtime.frozen) {
          runtime.lastLoopMs = now;
          continue;
        }
        runtime.accumulatorMs += Math.max(0, now - runtime.lastLoopMs);
        runtime.lastLoopMs = now;
        let steps = 0;
        while (runtime.accumulatorMs >= STEP_MS && steps < MAX_CATCH_UP_STEPS) {
          step(runtime);
          runtime.accumulatorMs -= STEP_MS;
          steps += 1;
        }
        // After a stall, drop the backlog instead of fast-forwarding the
        // rocket (Requirement 16.5).
        if (runtime.accumulatorMs >= STEP_MS) runtime.accumulatorMs = 0;
        // Broadcasts land on step boundaries; spacing is real time, so the
        // average stays at BROADCAST_HZ.
        if (steps > 0 && now >= runtime.nextBroadcastMs) {
          deps.broadcast(code, toMatchState(runtime.state, false));
          runtime.nextBroadcastMs += BROADCAST_INTERVAL_MS;
          if (runtime.nextBroadcastMs <= now) runtime.nextBroadcastMs = now + BROADCAST_INTERVAL_MS;
        }
      }
    },

    remove(code) {
      const runtime = runtimes.get(code);
      if (runtime) end(code, runtime);
      const match = matches.get(code);
      if (match) rejectMatchQueue(match);
      matches.delete(code);
      returnReasons.delete(code);
    },
  };
}
