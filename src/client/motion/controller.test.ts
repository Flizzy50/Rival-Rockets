import { describe, expect, it } from 'vitest';
import { CHARGE_INTERVAL_MS, SELECTION_HOLD_MS, SHAKE_QUIET_MS } from '../../shared/config';
import { createMotionController, type ControllerEvent, type MotionController } from './controller';

const STEP_MS = 10;

function motion(controller: MotionController, t: number, magnitude: number): void {
  controller.handleMotion({
    timeMs: t,
    acceleration: { x: magnitude, y: 0, z: 0 },
    accelerationIncludingGravity: { x: magnitude, y: 0, z: 9.81 },
  });
}

function orientation(controller: MotionController, t: number, gamma: number | null): void {
  controller.handleOrientation({ timeMs: t, gamma, beta: gamma === null ? null : 45 });
}

function ofType<T extends ControllerEvent['type']>(
  events: readonly ControllerEvent[],
  type: T,
): Extract<ControllerEvent, { type: T }>[] {
  return events.filter((e): e is Extract<ControllerEvent, { type: T }> => e.type === type);
}

describe('motion controller (AC4)', () => {
  it('keeps Boost during a steady right tilt while shaking, then needs 300 ms quiet + 300 ms hold', () => {
    const c = createMotionController('engineer');
    c.setNeutral(0);
    const shaking = (t: number): number => (t < 1000 && t % 200 < 100 ? 20 : 0);
    let lastAboveMs = -1;
    let switchedAtMs: number | null = null;
    for (let t = 0; t <= 2000; t += STEP_MS) {
      const m = shaking(t);
      if (m > 0) lastAboveMs = t;
      motion(c, t, m);
      orientation(c, t, 20);
      const snap = c.snapshot(t);
      if (snap.selected === 'shield' && switchedAtMs === null) switchedAtMs = t;
      if (t < 1000) {
        expect(snap.selected).toBe('boost');
        expect(snap.selectionLocked).toBe(true);
        expect(snap.pendingTarget).toBeNull();
      }
    }
    expect(switchedAtMs).toBe(lastAboveMs + SHAKE_QUIET_MS + SELECTION_HOLD_MS);
    const changes = ofType(c.drainEvents(), 'selection-changed');
    expect(changes).toEqual([{ type: 'selection-changed', timeMs: switchedAtMs, selected: 'shield' }]);
  });

  it('turns 5 s of continuous shaking into one accepted charge', () => {
    const c = createMotionController('engineer');
    for (let t = 0; t <= 5000; t += STEP_MS) motion(c, t, t % 200 < 100 ? 25 : 0);
    const events = c.drainEvents();
    expect(ofType(events, 'charge-accepted')).toHaveLength(1);
    expect(ofType(events, 'charge-ignored')).toHaveLength(0);
    expect(c.snapshot(5000).energy).toBe(75);
  });

  it('never accepts more than one charge per second from repeated bursts', () => {
    const c = createMotionController('engineer');
    const burstAt = (t: number): number => {
      const phase = t % 600;
      return phase < 30 || (phase >= 150 && phase < 180) ? 20 : 0;
    };
    for (let t = 0; t <= 5000; t += STEP_MS) {
      motion(c, t, burstAt(t));
      // Spend energy so charges keep being accepted rather than hitting full.
      if (c.snapshot(t).ability.phase === 'ready') c.activate(t);
    }
    const accepted = ofType(c.drainEvents(), 'charge-accepted');
    expect(accepted.length).toBeGreaterThan(1);
    for (let i = 1; i < accepted.length; i += 1) {
      const gap = (accepted[i]?.timeMs ?? 0) - (accepted[i - 1]?.timeMs ?? 0);
      expect(gap).toBeGreaterThanOrEqual(CHARGE_INTERVAL_MS);
    }
    expect(accepted.length).toBeLessThanOrEqual(Math.ceil(5000 / CHARGE_INTERVAL_MS));
  });

  it('forces steering to 0 and freezes selection while blocked', () => {
    const c = createMotionController('engineer');
    c.setNeutral(0);
    c.setBlocked(true);
    for (let t = 0; t <= 1000; t += STEP_MS) {
      orientation(c, t, 30);
      const snap = c.snapshot(t);
      expect(snap.steering).toBe(0);
      expect(snap.selected).toBe('boost');
      expect(snap.selectionLocked).toBe(true);
    }
    expect(c.drainEvents()).toEqual([]);

    c.setBlocked(false);
    orientation(c, 1010, 30);
    expect(c.snapshot(1010).steering).toBe(1);
    orientation(c, 1010 + SELECTION_HOLD_MS - STEP_MS, 30);
    expect(c.snapshot(1300).selected).toBe('boost');
    orientation(c, 1010 + SELECTION_HOLD_MS, 30);
    expect(c.snapshot(1310).selected).toBe('shield');
  });

  it('steers the pilot relative to the neutral and never changes its selection', () => {
    const c = createMotionController('pilot');
    c.setNeutral(10);
    orientation(c, 0, 22);
    const snap = c.snapshot(0);
    expect(snap.smoothedRelDeg).toBe(12);
    expect(snap.steering).toBeCloseTo(1 / 3);
    expect(snap.rawGamma).toBe(22);
    for (let t = 10; t <= 1000; t += STEP_MS) orientation(c, t, 40);
    expect(c.snapshot(1000).selected).toBe('boost');
  });
});

describe('motion controller activation', () => {
  it('activates the selected ability and reports a failed tap without spending', () => {
    const c = createMotionController('engineer');
    expect(c.activate(100)).toBe('activated');
    expect(c.activate(1500)).toBe('cooldown');
    const events = c.drainEvents();
    expect(events[0]).toEqual({ type: 'activated', timeMs: 100, ability: 'boost' });
    expect(events[1]).toMatchObject({
      type: 'activation-failed',
      reason: 'cooldown',
      cooldownRemainingMs: 1600,
      energyShortfall: 50,
    });
    expect(c.snapshot(1500).energy).toBe(0);
    expect(c.activate(3100)).toBe('not-enough-energy');
    expect(c.snapshot(3100).ability.phase).toBe('not-enough-energy');
  });
});

describe('motion controller sensor checks (AC3)', () => {
  it('never passes without real finite readings', () => {
    const pilot = createMotionController('pilot');
    expect(pilot.snapshot(0).checks.passed).toBe(false);
    for (let t = 0; t < 100; t += STEP_MS) orientation(pilot, t, null);
    expect(pilot.snapshot(100).checks).toMatchObject({ orientationReceived: false, passed: false });
  });

  it('passes the pilot on tilt alone and the engineer only after acceleration and a shake', () => {
    const pilot = createMotionController('pilot');
    const engineer = createMotionController('engineer');
    for (const c of [pilot, engineer]) {
      orientation(c, 0, 0);
      orientation(c, 10, 1);
      orientation(c, 20, 2);
    }
    expect(pilot.snapshot(20).checks.passed).toBe(true);
    expect(engineer.snapshot(20).checks).toMatchObject({ tiltPassed: true, passed: false });

    engineer.handleMotion({ timeMs: 30, acceleration: null, accelerationIncludingGravity: null });
    expect(engineer.snapshot(30).checks.accelerationSeen).toBe(false);

    for (let t = 40; t <= 400; t += STEP_MS) {
      const phase = t - 40;
      motion(engineer, t, phase < 30 || (phase >= 150 && phase < 180) ? 20 : 0);
    }
    expect(engineer.snapshot(400).checks).toMatchObject({
      accelerationSeen: true,
      shakeDetected: true,
      passed: true,
    });
    expect(engineer.snapshot(400).shakeCount).toBe(1);
  });
});

describe('motion controller, server authority (Requirements 19.2-19.4, 19.7)', () => {
  it('turns a shake into charge-requested and leaves local crew state alone', () => {
    const c = createMotionController('engineer', { authority: 'server' });
    const energyBefore = c.snapshot(0).energy;
    for (let t = 0; t <= 600; t += STEP_MS) motion(c, t, t % 200 < 100 ? 25 : 0);
    const events = c.drainEvents();
    expect(ofType(events, 'charge-requested')).toHaveLength(1);
    expect(ofType(events, 'charge-accepted')).toHaveLength(0);
    expect(c.snapshot(600).energy).toBe(energyBefore);
  });

  it('emits activate-requested with the local selection and spends nothing', () => {
    const c = createMotionController('engineer', { authority: 'server' });
    c.requestActivate(5);
    expect(c.drainEvents()).toEqual([{ type: 'activate-requested', timeMs: 5, ability: 'boost' }]);
    expect(c.snapshot(5).ability.phase).toBe('ready');
  });

  it('adopts the server selection without an event', () => {
    const c = createMotionController('engineer', { authority: 'server' });
    c.syncSelection('shield');
    expect(c.snapshot(0).selected).toBe('shield');
    expect(c.drainEvents()).toEqual([]);
  });

  it('sends no selection changes and neutral steering while blocked', () => {
    const c = createMotionController('engineer', { authority: 'server' });
    c.setNeutral(0);
    c.setBlocked(true);
    for (let t = 0; t <= 1000; t += STEP_MS) orientation(c, t, 25);
    expect(ofType(c.drainEvents(), 'selection-changed')).toHaveLength(0);
    expect(c.snapshot(1000).steering).toBe(0);
  });
});
