import { describe, expect, it } from 'vitest';
import { pausedSeat, screenForPhase } from './flow';
import { SEAT_IDS, type PublicSeat } from '../shared/protocol';
import { M4_COPY, pausedLine, resumingLine } from './ui/copy';
import { formatTimer } from './ui/hud';
import { createPilotPractice, reduceEngineerPractice, stepPilotPractice } from './practice';
import { createMotionController } from './motion/controller';
import { createCrewAbilityState } from '../shared/rules/abilities';
import { PRACTICE_START_ENERGY } from '../shared/config';
import { edgeMarkers } from './ui/arena-geometry';
import { createBuffer, pushSnapshot, sampleAt } from './net/interpolate';

describe('M3 phone models', () => {
  it('routes players and watchers while keeping reconnect setup open', () => {
    expect(screenForPhase('countdown', true, 'lobby')).toBe('match');
    expect(screenForPhase('running', true, 'setup')).toBeNull();
    expect(screenForPhase('running', false, 'lobby')).toBe('room-watch');
    expect(screenForPhase('results', false, 'room-watch')).toBe('results');
    expect(screenForPhase('lobby', true, 'match')).toBe('lobby');
    expect(screenForPhase('lobby', true, 'practice')).toBeNull();
  });
  it('rounds time up without showing zero before the match ends', () => {
    expect([90000, 61000, 10000, 1, 0].map(formatTimer)).toEqual(['01:30', '01:01', '00:10', '00:01', '00:00']);
  });
  it('uses independent practice energy and ordered engineer successes', () => {
    const initial = { charges: 0, step: 'charge' as const, firstSuccess: false };
    expect(reduceEngineerPractice(initial, { type: 'activated', ability: 'shield', timeMs: 0 })).toBe(initial);
    let practice = reduceEngineerPractice(initial, { type: 'charge-accepted', energy: 25, timeMs: 0 });
    expect(practice.firstSuccess).toBe(true);
    practice = reduceEngineerPractice(practice, { type: 'charge-accepted', energy: 50, timeMs: 1000 });
    practice = reduceEngineerPractice(practice, { type: 'selection-changed', selected: 'shield', timeMs: 1400 });
    practice = reduceEngineerPractice(practice, { type: 'activated', ability: 'shield', timeMs: 1500 });
    expect(practice.step).toBe('done');
    const local = createMotionController('engineer', { initialCrew: { ...createCrewAbilityState(), energy: PRACTICE_START_ENERGY } });
    expect(local.snapshot(0).energy).toBe(0);
    expect(createCrewAbilityState().energy).toBe(50);
  });
  it('does not count a later pilot practice ring out of order', () => {
    const p = createPilotPractice('comet');
    const wrong = { ...p, rocket: { ...p.rocket, pose: { x: 498, y: 360, heading: 0 } } };
    expect(stepPilotPractice(wrong, 0, 0, 0).ringsDone).toBe(0);
    const right = { ...p, rocket: { ...p.rocket, pose: { x: 460, y: 106, heading: 0 } } };
    expect(stepPilotPractice(right, 0, 0, 0)).toMatchObject({ ringsDone: 1, firstSuccess: true });
  });
  it('marks only fully off-screen objects at the correct edge and clamps x', () => {
    expect(edgeMarkers({ scale: 1, offsetX: 0, offsetY: -200 }, 300, 400, [
      { kind: 'core', x: -100, minY: 100, maxY: 150 },
      { kind: 'gate', x: 200, minY: 199, maxY: 201 },
      { kind: 'opponent', x: 500, minY: 601, maxY: 630 },
    ])).toEqual([{ kind: 'core', edge: 'top', x: 14 }, { kind: 'opponent', edge: 'bottom', x: 286 }]);
  });
  it('interpolates Nova independently without altering Comet', () => {
    const pose = (x: number) => ({ x, y: 100, heading: 0 });
    let buffer = pushSnapshot(createBuffer(), { matchId: 1, sessionMs: 0, receivedAtMs: 0, poses: { comet: pose(100), nova: pose(300) } });
    buffer = pushSnapshot(buffer, { matchId: 1, sessionMs: 100, receivedAtMs: 100, poses: { comet: pose(200), nova: pose(320) } });
    expect(sampleAt(buffer, 50, 'comet')?.x).toBe(150);
    expect(sampleAt(buffer, 50, 'nova')?.x).toBe(310);
  });
});

describe('M4 interruption flow', () => {
  it('opens Interrupted only for a seated match screen and lobby otherwise', () => {
    expect(screenForPhase('lobby', true, 'match', 'interrupted')).toBe('interrupted');
    expect(screenForPhase('lobby', true, 'match', 'countdown-cancelled')).toBe('lobby');
    expect(screenForPhase('lobby', true, 'match', 'match-error')).toBe('lobby');
    expect(screenForPhase('lobby', true, 'interrupted', 'interrupted')).toBeNull();
    expect(screenForPhase('lobby', true, 'results', null)).toBe('lobby');
    expect(screenForPhase('countdown', true, 'interrupted', null)).toBe('match');
  });
  it('shows the seat with the earliest hold, counted down locally', () => {
    const seat = (id: (typeof SEAT_IDS)[number], patch: Partial<PublicSeat>): PublicSeat => ({ seat: id, occupantId: 'p', setup: 'calibrated', connected: true, held: false, ready: false, holdRemainingMs: null, swapRequested: false, ...patch });
    const seats = [
      seat('comet-pilot', {}),
      seat('comet-engineer', { connected: false, held: true, holdRemainingMs: 9000 }),
      seat('nova-pilot', { connected: false, held: true, holdRemainingMs: 4000 }),
      seat('nova-engineer', { setup: 'unverified', holdRemainingMs: 12000 }),
    ];
    expect(pausedSeat(seats, 1000)).toEqual({ seat: 'nova-pilot', holdRemainingMs: 3000 });
    expect(pausedSeat(seats, 99999)?.holdRemainingMs).toBe(0);
    expect(pausedSeat(seats.map((s) => ({ ...s, connected: true, setup: 'calibrated' as const })), 0)).toBeNull();
  });
});

describe('M4 copy', () => {
  it('formats the pause and resume lines and keeps the PRD interrupted line', () => {
    expect(pausedLine('nova-engineer')).toBe('Paused · Nova Engineer reconnecting');
    expect([3000, 2001, 2000, 1, 0].map(resumingLine)).toEqual(['Resuming in 3…', 'Resuming in 3…', 'Resuming in 2…', 'Resuming in 1…', 'Resuming in 1…']);
    expect(M4_COPY.interrupted).toBe("Match interrupted. A player couldn't reconnect.");
  });
});
