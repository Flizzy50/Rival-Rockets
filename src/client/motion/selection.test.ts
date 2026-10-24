import { describe, expect, it } from 'vitest';
import { SELECTION_HOLD_MS } from '../../shared/config';
import { createSelection, updateSelection, type SelectionState, type SelectionUpdate } from './selection';

interface Step {
  readonly t: number;
  readonly rel: number;
  readonly shake?: boolean;
  readonly blocked?: boolean;
}

function play(steps: readonly Step[], start: SelectionState = createSelection()): SelectionUpdate[] {
  let state = start;
  return steps.map(({ t, rel, shake = false, blocked = false }) => {
    const out = updateSelection(state, { smoothedRelDeg: rel, shakeActive: shake, blocked, nowMs: t });
    state = out.state;
    return out;
  });
}

function last(outs: readonly SelectionUpdate[]): SelectionUpdate {
  const out = outs[outs.length - 1];
  if (!out) throw new Error('no updates');
  return out;
}

function holdSteps(fromMs: number, toMs: number, rel: number, extra: Partial<Step> = {}): Step[] {
  const steps: Step[] = [];
  for (let t = fromMs; t <= toMs; t += 10) steps.push({ t, rel, ...extra });
  return steps;
}

describe('engineer selection', () => {
  it('starts with Boost selected', () => {
    expect(createSelection().selected).toBe('boost');
  });

  it('switches to Shield after 12 degrees right for 300 ms', () => {
    const outs = play(holdSteps(0, SELECTION_HOLD_MS, 12));
    const final = last(outs);
    expect(final.changed).toBe(true);
    expect(final.state.selected).toBe('shield');
    expect(outs.filter((o) => o.changed)).toHaveLength(1);
  });

  it('does not switch at 299 ms and shows pending progress', () => {
    const outs = play([...holdSteps(0, 290, 12), { t: SELECTION_HOLD_MS - 1, rel: 12 }]);
    const final = last(outs);
    expect(final.changed).toBe(false);
    expect(final.state.selected).toBe('boost');
    expect(final.pendingTarget).toBe('shield');
    expect(final.progress).toBeCloseTo((SELECTION_HOLD_MS - 1) / SELECTION_HOLD_MS);
  });

  it('switches back to Boost after 12 degrees left for 300 ms', () => {
    const outs = play(holdSteps(0, SELECTION_HOLD_MS, -12), createSelection('shield'));
    expect(last(outs).state.selected).toBe('boost');
  });

  it('resets the hold when tilt dips below 12 degrees', () => {
    const outs = play([
      ...holdSteps(0, 140, 12),
      { t: 150, rel: 11.9 },
      ...holdSteps(160, 450, 12),
    ]);
    expect(outs.some((o) => o.changed)).toBe(false);
    const done = play([{ t: 160 + SELECTION_HOLD_MS, rel: 12 }], last(outs).state);
    expect(last(done).state.selected).toBe('shield');
  });

  it('keeps the selection at neutral', () => {
    const switched = last(play(holdSteps(0, SELECTION_HOLD_MS, 20))).state;
    const outs = play(holdSteps(400, 2000, 0), switched);
    expect(last(outs).state.selected).toBe('shield');
    expect(outs.every((o) => o.pendingTarget === null && !o.changed)).toBe(true);
  });

  it('shows no pending hold toward the already selected ability', () => {
    const outs = play(holdSteps(0, 1000, -20));
    expect(outs.every((o) => o.pendingTarget === null && o.progress === 0 && !o.changed)).toBe(true);
    expect(last(outs).state.selected).toBe('boost');
  });

  it('cancels a hold when a shake starts and needs a fresh 300 ms hold after unlock (AC4)', () => {
    const steps = [
      ...holdSteps(0, 200, 20),
      ...holdSteps(210, 400, 20, { shake: true }),
      ...holdSteps(410, 1000, 20),
    ];
    const outs = play(steps);
    const before = outs.find((_, i) => steps[i]?.t === 200);
    expect(before?.pendingTarget).toBe('shield');
    const during = outs.filter((_, i) => steps[i]?.shake === true);
    expect(during.every((o) => o.locked && o.pendingTarget === null && !o.changed)).toBe(true);
    const firstChange = outs.findIndex((o) => o.changed);
    // The 200 ms held before the shake is discarded: the hold restarts at 410 ms.
    expect(steps[firstChange]?.t).toBe(410 + SELECTION_HOLD_MS);
    expect(outs[firstChange]?.state.selected).toBe('shield');
    expect(outs.slice(0, firstChange).every((o) => o.state.selected === 'boost')).toBe(true);
  });

  it('treats blocked (rotate overlay) like a lock', () => {
    const outs = play(holdSteps(0, 1000, 20, { blocked: true }));
    expect(outs.every((o) => o.locked && !o.changed && o.state.selected === 'boost')).toBe(true);
  });
});
