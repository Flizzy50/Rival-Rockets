import { describe, expect, it } from 'vitest';
import { screenForPhase } from './flow';
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
