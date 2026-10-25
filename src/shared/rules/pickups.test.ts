import { describe, expect, it } from 'vitest';
import { contactTime, createCourseCores, expireAndRespawn, resolvePickups, type DroppedCoreState, type PickupInput } from './pickups.js';

const core: DroppedCoreState = { id: 0, x: 300, y: 100, owner: 'comet', createdTick: 0, ownerUnlockAtMs: 1000, expiresAtMs: 6000 };
const atCore = { from: { x: 300, y: 100 }, to: { x: 300, y: 100 } };
const far = { from: { x: 100, y: 500 }, to: { x: 100, y: 500 } };
function input(patch: Partial<PickupInput> = {}): PickupInput { return { paths: { comet: atCore, nova: far }, carried: { comet: 0, nova: 0 }, course: [], dropped: [core], tick: 1, nowMs: 1000, ...patch }; }

describe('pickup boundaries and contested sweeps', () => {
  it('solves swept contact including stationary, tangent, and missed paths', () => {
    expect(contactTime({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 1)).toBeCloseTo(0.4);
    expect(contactTime({ x: 0, y: 1 }, { x: 10, y: 1 }, { x: 5, y: 0 }, 1)).toBe(0.5);
    expect(contactTime({ x: 0, y: 2 }, { x: 10, y: 2 }, { x: 5, y: 0 }, 1)).toBeNull();
    expect(contactTime(core, core, core, 1)).toBe(0);
  });
  it('enforces owner lockout, new-drop exclusion, and expiry at their boundaries', () => {
    expect(resolvePickups(input({ nowMs: 999 })).carried.comet).toBe(0);
    expect(resolvePickups(input()).carried.comet).toBe(1);
    expect(resolvePickups(input({ tick: 0 })).carried.comet).toBe(0);
    expect(resolvePickups(input({ nowMs: 6000 })).carried.comet).toBe(0);
    expect(expireAndRespawn([], [core], 6000).dropped).toEqual([]);
  });
  it('leaves exact ties untouched and lets the opponent collect when the first crew is full', () => {
    const paths = { comet: atCore, nova: atCore };
    expect(resolvePickups(input({ paths })).carried).toEqual({ comet: 0, nova: 0 });
    expect(resolvePickups(input({ paths, carried: { comet: 5, nova: 0 } })).carried).toEqual({ comet: 5, nova: 1 });
  });
  it('awards the earliest contact and processes capacity in chronological order', () => {
    const paths = { comet: { from: { x: 250, y: 100 }, to: { x: 350, y: 100 } }, nova: { from: { x: 360, y: 100 }, to: { x: 300, y: 100 } } };
    expect(resolvePickups(input({ paths })).carried).toEqual({ comet: 1, nova: 0 });
    const result = resolvePickups(input({ paths: { comet: paths.comet, nova: far }, carried: { comet: 4, nova: 0 }, dropped: [{ ...core, id: 1, x: 340 }, core] }));
    expect(result.carried.comet).toBe(5);
    expect(result.dropped.map((c) => c.id)).toEqual([1]);
  });
  it('respawns a course core at exactly eight seconds', () => {
    const course = createCourseCores().map((c) => ({ ...c, respawnAtMs: 8000 }));
    expect(expireAndRespawn(course, [], 7999).course.every((c) => c.respawnAtMs !== null)).toBe(true);
    const due = expireAndRespawn(course, [], 8000);
    const p = { from: { x: 420, y: 106 }, to: { x: 420, y: 106 } };
    const out = resolvePickups(input({ paths: { comet: p, nova: far }, course: due.course, dropped: [], nowMs: 8000 }));
    expect(out.carried.comet).toBe(1);
    expect(out.course[0]?.respawnAtMs).toBe(16000);
  });
});
