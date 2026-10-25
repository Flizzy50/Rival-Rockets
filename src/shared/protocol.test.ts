import { describe, expect, expectTypeOf, it } from 'vitest';
import { SEAT_COUNT } from './config.js';
import {
  ABILITIES,
  REJECT_REASONS,
  REPORTED_SETUP_STATUSES,
  SEAT_IDS,
  type ClientMessage,
  type ClientMessageType,
  type GameplayInput,
  type RoomRequest,
} from './protocol.js';

describe('protocol', () => {
  it('lists the four fixed seats once each, Comet first', () => {
    expect(SEAT_IDS).toEqual(['comet-pilot', 'comet-engineer', 'nova-pilot', 'nova-engineer']);
    expect(new Set(SEAT_IDS).size).toBe(SEAT_COUNT);
  });

  it('lists each reject reason once', () => {
    expect(new Set(REJECT_REASONS).size).toBe(REJECT_REASONS.length);
  });

  it('lets a phone report only setup progress', () => {
    expect(REPORTED_SETUP_STATUSES).toEqual(['readings', 'calibrated']);
    expect(ABILITIES).toEqual(['boost', 'shield']);
  });

  it('has start, rematch, and swap messages', () => {
    expectTypeOf<Extract<ClientMessageType, 'ready.set'>>().toEqualTypeOf<'ready.set'>();
    expectTypeOf<Extract<ClientMessageType, 'match.start'>>().toEqualTypeOf<'match.start'>();
    expectTypeOf<Extract<ClientMessageType, 'match.rematch'>>().toEqualTypeOf<'match.rematch'>();
    expectTypeOf<Extract<ClientMessageType, 'match.swap'>>().toEqualTypeOf<'match.swap'>();
  });

  it('carries no positions, energy, scores, or sensor data from clients (Requirement 8.7)', () => {
    // Type-level only: tsc fails if any client message gains one of these keys.
    type WithKey<K extends string> = Extract<ClientMessage, Record<K, unknown>>;
    expectTypeOf<WithKey<'x'>>().toBeNever();
    expectTypeOf<WithKey<'y'>>().toBeNever();
    expectTypeOf<WithKey<'heading'>>().toBeNever();
    expectTypeOf<WithKey<'pose'>>().toBeNever();
    expectTypeOf<WithKey<'energy'>>().toBeNever();
    expectTypeOf<WithKey<'score'>>().toBeNever();
    expectTypeOf<WithKey<'beta'>>().toBeNever();
    expectTypeOf<WithKey<'gamma'>>().toBeNever();
  });

  it('gives every gameplay input a matchId and seq, and every room request a requestId (Requirement 12.1)', () => {
    expectTypeOf<GameplayInput['type']>().toEqualTypeOf<'input.steer' | 'input.charge' | 'ability.request'>();
    expectTypeOf<GameplayInput>().toExtend<{ matchId: number; seq: number }>();
    expectTypeOf<Extract<ClientMessage, { type: 'heartbeat' }>>().not.toExtend<RoomRequest>();
  });
});
