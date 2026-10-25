import { describe, expect, it } from 'vitest';
import type { MatchSnapshotMessage, PublicMatchEvent } from '../shared/protocol';
import { FRAME_BUDGET_MS, FRAME_RECOVER_MS } from '../shared/tokens';
import {
  abilityStarts,
  abilityTickerLine,
  createEventQueue,
  createFrameBudget,
  enqueueEvents,
  EVENT_QUEUE_MAX,
  hapticForEvent,
  soundForAbility,
  soundForEvent,
  takeDueEvents,
  tickerLine,
  updateFrameBudget,
} from './feedback';

const gate = (matchMs: number, team: 'comet' | 'nova' = 'comet'): PublicMatchEvent => ({ kind: 'gate', matchMs, team, gate: 0 });
const drop: PublicMatchEvent = { kind: 'drop', matchMs: 0, attacker: 'nova', victim: 'comet', x: 0, y: 0 };
const blocked: PublicMatchEvent = { kind: 'blocked', matchMs: 0, attacker: 'comet', victim: 'nova', x: 0, y: 0 };
const wall: PublicMatchEvent = { kind: 'wall', matchMs: 0, team: 'nova', x: 0, y: 0 };
const durations = { coreLostMs: 80, wallMs: 50 };

function snapshot(matchId: number, comet: { active: 'boost' | 'shield' | null; effectRemainingMs: number }): MatchSnapshotMessage {
  const crew = { energy: 50, selected: 'boost' as const, active: null, effectRemainingMs: 0, cooldownRemainingMs: 0, crossings: 0, nextGate: 0, carried: 0, score: 0 };
  return {
    type: 'match.state', mode: 'match', matchId, phase: 'running', tick: 0, matchMs: 0, remainingMs: 90000, countdownRemainingMs: 0, frozen: false, resumeRemainingMs: 0,
    rockets: { comet: { x: 0, y: 0, heading: 0 }, nova: { x: 0, y: 0, heading: 0 } },
    crews: { comet: { ...crew, ...comet }, nova: crew }, courseCores: [], droppedCores: [], events: [],
  };
}

describe('event queue', () => {
  it('releases events once the rendered time reaches them, in order', () => {
    let queue = enqueueEvents(createEventQueue(), 1, [gate(100), gate(200), gate(300)]);
    const first = takeDueEvents(queue, 200);
    expect(first.due.map((e) => e.matchMs)).toEqual([100, 200]);
    queue = first.queue;
    expect(takeDueEvents(queue, 250).due).toEqual([]);
    expect(takeDueEvents(queue, 300).due.map((e) => e.matchMs)).toEqual([300]);
  });

  it('drops events from an earlier match', () => {
    const queue = enqueueEvents(enqueueEvents(createEventQueue(), 1, [gate(100)]), 2, [gate(50)]);
    expect(queue.pending.map((e) => e.matchMs)).toEqual([50]);
  });

  it('keeps only the newest events after a stall', () => {
    const many = Array.from({ length: EVENT_QUEUE_MAX + 10 }, (_, i) => gate(i));
    const queue = enqueueEvents(createEventQueue(), 1, many);
    expect(queue.pending).toHaveLength(EVENT_QUEUE_MAX);
    expect(queue.pending[0]?.matchMs).toBe(10);
  });
});

describe('ability starts', () => {
  it('sees a new effect, and a fresh one replacing the same ability', () => {
    expect(abilityStarts(snapshot(1, { active: null, effectRemainingMs: 0 }), snapshot(1, { active: 'boost', effectRemainingMs: 1990 }))).toEqual([{ team: 'comet', ability: 'boost' }]);
    expect(abilityStarts(snapshot(1, { active: 'boost', effectRemainingMs: 1500 }), snapshot(1, { active: 'boost', effectRemainingMs: 1440 }))).toEqual([]);
    expect(abilityStarts(snapshot(1, { active: 'boost', effectRemainingMs: 100 }), snapshot(1, { active: 'boost', effectRemainingMs: 1990 }))).toHaveLength(1);
  });

  it('ignores the first snapshot and a new match', () => {
    expect(abilityStarts(null, snapshot(1, { active: 'boost', effectRemainingMs: 1990 }))).toEqual([]);
    expect(abilityStarts(snapshot(1, { active: null, effectRemainingMs: 0 }), snapshot(2, { active: 'boost', effectRemainingMs: 1990 }))).toEqual([]);
  });
});

describe('sounds and haptics', () => {
  it('plays only own-crew sounds on a phone and everything for a watcher', () => {
    expect(soundForEvent(gate(0, 'nova'), { team: 'comet', role: 'pilot' })).toBeNull();
    expect(soundForEvent(gate(0, 'comet'), { team: 'comet', role: 'pilot' })).toBe('gate');
    expect(soundForEvent(gate(0, 'nova'), { team: null, role: null })).toBe('gate');
    expect(soundForEvent(blocked, { team: 'comet', role: 'engineer' })).toBe('clank');
    expect(soundForEvent(wall, { team: null, role: null })).toBeNull();
    expect(soundForAbility({ team: 'nova', ability: 'shield' }, { team: 'comet', role: 'pilot' })).toBeNull();
    expect(soundForAbility({ team: 'nova', ability: 'shield' }, { team: null, role: null })).toBe('shield');
  });

  it('vibrates the victim crew on a lost core and the pilot on its own wall hit', () => {
    expect(hapticForEvent(drop, { team: 'comet', role: 'engineer' }, durations)).toBe(80);
    expect(hapticForEvent(drop, { team: 'nova', role: 'pilot' }, durations)).toBe(0);
    expect(hapticForEvent(wall, { team: 'nova', role: 'pilot' }, durations)).toBe(50);
    expect(hapticForEvent(wall, { team: 'nova', role: 'engineer' }, durations)).toBe(0);
    expect(hapticForEvent(drop, { team: null, role: null }, durations)).toBe(0);
  });
});

describe('ticker', () => {
  it('names both crews with their labels', () => {
    expect(tickerLine(drop)).toBe('NOVA rammed COMET · core dropped');
    expect(tickerLine(blocked)).toBe('NOVA shield blocked COMET');
    expect(tickerLine({ kind: 'gate', matchMs: 0, team: 'nova', gate: 3 })).toBe('NOVA cleared gate 4');
    expect(tickerLine(wall)).toBeNull();
    expect(abilityTickerLine({ team: 'comet', ability: 'boost' })).toBe('COMET boosted');
  });
});

describe('frame budget', () => {
  it('sheds above the budget and recovers only below the lower mark', () => {
    let budget = createFrameBudget();
    for (let i = 0; i < 100; i += 1) budget = updateFrameBudget(budget, FRAME_BUDGET_MS + 10);
    expect(budget.shedding).toBe(true);
    for (let i = 0; i < 100; i += 1) budget = updateFrameBudget(budget, (FRAME_BUDGET_MS + FRAME_RECOVER_MS) / 2);
    expect(budget.shedding).toBe(true);
    for (let i = 0; i < 100; i += 1) budget = updateFrameBudget(budget, 1000 / 60);
    expect(budget.shedding).toBe(false);
  });

  it('ignores a single long gap from a background tab', () => {
    const budget = updateFrameBudget(createFrameBudget(), 5000);
    expect(budget).toEqual(createFrameBudget());
  });
});
