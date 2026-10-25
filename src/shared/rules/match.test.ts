import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MATCH_DURATION_MS, SIMULATION_HZ } from '../config.js';
import { isDrivable } from '../course.js';
import { createMatch, matchMsAt, stepMatch, type MatchState } from './match.js';
import { resolveContact, ramOutcome } from './collisions.js';

function colliding(): MatchState {
  const s = createMatch(1);
  return { ...s, crews: {
    comet: { ...s.crews.comet, carried: 2, rocket: { ...s.crews.comet.rocket, pose: { x: 250, y: 100, heading: 0 } } },
    nova: { ...s.crews.nova, carried: 2, rocket: { ...s.crews.nova.rocket, pose: { x: 270, y: 100, heading: 0 } } },
  } };
}
describe('authoritative match step', () => {
  it('separates both crews and applies ability and charge limits', () => {
    const s = createMatch(7);
    const out = stepMatch(s, [{ kind: 'charge', team: 'nova', seq: 1 }, { kind: 'charge', team: 'nova', seq: 2 }, { kind: 'activate', team: 'comet', seq: 1 }, { kind: 'activate', team: 'comet', seq: 2 }]);
    expect(out.state.crews.nova.abilities.energy).toBe(75);
    expect(out.state.crews.comet.abilities.energy).toBe(0);
    expect(out.results.map((r) => r.status)).toEqual(['applied', 'rejected', 'applied', 'rejected']);
    expect(out.state.crews.comet.rocket.pose.x - s.crews.comet.rocket.pose.x).toBeCloseTo(120 * 1.5 * 0.033);
    expect(out.state.crews.nova.rocket.pose.x - s.crews.nova.rocket.pose.x).toBeCloseTo(120 * 0.033);
    expect(s.crews.comet.abilities.energy).toBe(50);
  });
  it('ordinary bumps preserve cores, reduce shield displacement, and apply no repeat bump', () => {
    const bodies = { comet: { x: 250, y: 100, heading: 0 }, nova: { x: 270, y: 100, heading: 0 } };
    const bump = resolveContact(bodies, false, { comet: true, nova: false });
    expect(bodies.comet.x - bump.comet.x).toBe(8 + 3);
    expect(bump.nova.x - bodies.nova.x).toBe(8 + 12);
    expect(resolveContact(bodies, true, { comet: false, nova: false }).comet.x).toBe(242);
    expect(stepMatch(colliding(), []).state.crews.comet.carried).toBe(2);
  });
  it('both boosts drop one core, never collect the new drops, and consume one allowance', () => {
    const out = stepMatch(colliding(), [{ kind: 'activate', team: 'comet', seq: 1 }, { kind: 'activate', team: 'nova', seq: 1 }]).state;
    expect(out.crews.comet.carried).toBe(1);
    expect(out.crews.nova.carried).toBe(1);
    expect(out.dropped).toHaveLength(2);
    expect(out.dropped.every(isDrivable)).toBe(true);
    expect(out.crews.comet.dropsUsed).toBe(1);
    const again = { ...out, inContact: false, crews: { comet: { ...out.crews.comet, rocket: colliding().crews.comet.rocket }, nova: { ...out.crews.nova, rocket: colliding().crews.nova.rocket } }, dropped: [] };
    expect(stepMatch(again, []).state.dropped).toHaveLength(0);
    expect(ramOutcome(true, false, true, 2)).toBe('blocked');
    expect(ramOutcome(true, false, false, 0)).toBe('none');
  });
  it('a shield prevents the drop without consuming the attacker allowance', () => {
    const out = stepMatch(colliding(), [{ kind: 'activate', team: 'comet', seq: 1 }, { kind: 'select', team: 'nova', seq: 1, ability: 'shield' }, { kind: 'activate', team: 'nova', seq: 2 }]).state;
    expect(out.dropped).toEqual([]);
    expect(out.crews.comet.dropsUsed).toBe(0);
  });
  it('counts a forward bump across the next gate', () => {
    const s = colliding();
    const state = { ...s, crews: { comet: { ...s.crews.comet, rocket: { ...s.crews.comet.rocket, pose: { x: 280, y: 100, heading: 0 } } }, nova: { ...s.crews.nova, rocket: { ...s.crews.nova.rocket, pose: { x: 290, y: 100, heading: 0 } } } } };
    const out = stepMatch(state, []).state;
    expect(out.crews.nova.crossings).toBe(1);
    expect(out.crews.comet.crossings).toBe(0);
  });
  it('reports a bump and both drops at the projected impact point', () => {
    const out = stepMatch(colliding(), [{ kind: 'activate', team: 'comet', seq: 1 }, { kind: 'activate', team: 'nova', seq: 1 }]);
    expect(out.events.filter((e) => e.kind === 'bump')).toHaveLength(1);
    const drops = out.events.flatMap((e) => (e.kind === 'drop' ? [e] : []));
    expect(drops.map((e) => e.victim).sort()).toEqual(['comet', 'nova']);
    for (const drop of drops) expect(out.state.dropped.some((c) => c.x === drop.x && c.y === drop.y && c.owner === drop.victim)).toBe(true);
    expect(out.events.some((e) => e.kind === 'blocked')).toBe(false);
  });
  it('reports a Shield block instead of a drop', () => {
    const out = stepMatch(colliding(), [{ kind: 'activate', team: 'comet', seq: 1 }, { kind: 'select', team: 'nova', seq: 1, ability: 'shield' }, { kind: 'activate', team: 'nova', seq: 2 }]);
    expect(out.events.filter((e) => e.kind === 'blocked')).toEqual([expect.objectContaining({ attacker: 'comet', victim: 'nova' })]);
    expect(out.events.some((e) => e.kind === 'drop')).toBe(false);
  });
  it('reports no bump event while an existing contact continues', () => {
    expect(stepMatch({ ...colliding(), inContact: true }, []).events.some((e) => e.kind === 'bump')).toBe(false);
  });
  it('reports the gate a forward bump scores', () => {
    const s = colliding();
    const state = { ...s, crews: { comet: { ...s.crews.comet, rocket: { ...s.crews.comet.rocket, pose: { x: 280, y: 100, heading: 0 } } }, nova: { ...s.crews.nova, rocket: { ...s.crews.nova.rocket, pose: { x: 290, y: 100, heading: 0 } } } } };
    expect(stepMatch(state, []).events.filter((e) => e.kind === 'gate')).toEqual([{ kind: 'gate', matchMs: 0, team: 'nova', gate: 0 }]);
  });
  it('reports a wall hit once per slide, not every step against the wall', () => {
    const s = createMatch(1);
    let state: MatchState = { ...s, crews: { ...s.crews, comet: { ...s.crews.comet, rocket: { ...s.crews.comet.rocket, pose: { x: 300, y: 44, heading: -Math.PI / 2 } } } } };
    const first = stepMatch(state, [{ kind: 'steer', team: 'comet', seq: 1, steering: -1 }]);
    expect(first.events.filter((e) => e.kind === 'wall')).toEqual([expect.objectContaining({ team: 'comet' })]);
    state = first.state;
    for (let i = 0; i < 5; i += 1) {
      const out = stepMatch(state, [{ kind: 'steer', team: 'comet', seq: i + 2, steering: -1 }]);
      expect(out.events.some((e) => e.kind === 'wall')).toBe(false);
      state = out.state;
    }
  });
  it('reports a pickup at the core position', () => {
    const s = createMatch(1);
    const state = { ...s, crews: { ...s.crews, comet: { ...s.crews.comet, rocket: { ...s.crews.comet.rocket, pose: { x: 410, y: 106, heading: 0 } } } } };
    expect(stepMatch(state, []).events.filter((e) => e.kind === 'pickup')).toEqual([{ kind: 'pickup', matchMs: 0, team: 'comet', x: 420, y: 106 }]);
  });
  it('ends at exactly 90 seconds with a frozen result and rejects every later input', () => {
    const tick = MATCH_DURATION_MS / 1000 * SIMULATION_HZ - 1;
    const initial = { ...createMatch(8), tick, matchMs: matchMsAt(tick) };
    const final = stepMatch(initial, []).state;
    expect(final.matchMs).toBe(90000);
    expect(final.complete).toBe(true);
    expect(final.result?.outcome).toBe('draw');
    const after = stepMatch(final, [{ kind: 'charge', team: 'comet', seq: 1 }]);
    expect(after.state).toBe(final);
    expect(after.results[0]).toMatchObject({ status: 'rejected', reason: 'not-running' });
  });
  it('reports one gate event per scored crossing and one pickup event per collected core', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true })), { minLength: 20, maxLength: 120 }), (steers) => {
      let state = createMatch(1);
      for (const [comet, nova] of steers) {
        const out = stepMatch(state, [{ team: 'comet', kind: 'steer', seq: 1, steering: comet }, { team: 'nova', kind: 'steer', seq: 1, steering: nova }]);
        for (const team of ['comet', 'nova'] as const) {
          const gates = out.events.filter((e) => e.kind === 'gate' && e.team === team).length;
          expect(gates).toBe(out.state.crews[team].crossings - state.crews[team].crossings);
          const lost = out.events.filter((e) => e.kind === 'drop' && e.victim === team).length;
          const picked = out.events.filter((e) => e.kind === 'pickup' && e.team === team).length;
          expect(out.state.crews[team].carried).toBe(state.crews[team].carried - lost + picked);
        }
        expect(out.events.every((e) => e.matchMs === state.matchMs)).toBe(true);
        state = out.state;
      }
    }), { numRuns: 100 });
  });
  it('keeps random trajectories finite, on-course, with monotonic gate points and bounded inventory', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true })), { minLength: 20, maxLength: 120 }), (steers) => {
      let state = createMatch(1);
      for (const [comet, nova] of steers) {
        const next = stepMatch(state, [{ team: 'comet', kind: 'steer', seq: 1, steering: comet }, { team: 'nova', kind: 'steer', seq: 1, steering: nova }]).state;
        for (const team of ['comet', 'nova'] as const) {
          expect(isDrivable(next.crews[team].rocket.pose)).toBe(true);
          expect(next.crews[team].crossings).toBeGreaterThanOrEqual(state.crews[team].crossings);
          expect(next.crews[team].carried).toBeGreaterThanOrEqual(0);
          expect(next.crews[team].carried).toBeLessThanOrEqual(5);
        }
        state = next;
      }
    }), { numRuns: 100 });
  });
});
