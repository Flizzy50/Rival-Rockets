import { PRACTICE_CHARGE_GOAL, PRACTICE_RINGS, PRACTICE_RING_RADIUS, PREVIEW_MAX_STEP_MS } from '../shared/config';
import type { TeamId } from '../shared/protocol';
import { createStartPose, moveRocket, type RocketState } from '../shared/rules/physics';
import { contactTime } from '../shared/rules/pickups';
import type { ControllerEvent } from './motion/controller';

export interface PilotPractice { readonly rocket: RocketState; readonly ringsDone: number; readonly firstSuccess: boolean; readonly team: TeamId }
export function createPilotPractice(team: TeamId): PilotPractice { return { rocket: { pose: createStartPose(team), steering: 0, wallSlowUntilMs: null }, ringsDone: 0, firstSuccess: false, team }; }
export function stepPilotPractice(p: PilotPractice, steering: number, nowMs: number, dtMs: number): PilotPractice {
  const rocket = moveRocket({ ...p.rocket, steering }, false, nowMs, Math.min(PREVIEW_MAX_STEP_MS, Math.max(0, dtMs)), createStartPose(p.team));
  const ring = PRACTICE_RINGS[p.ringsDone];
  const ringsDone = p.ringsDone + (ring && contactTime(p.rocket.pose, rocket.pose, ring, PRACTICE_RING_RADIUS) !== null ? 1 : 0);
  return { ...p, rocket, ringsDone, firstSuccess: ringsDone > 0 };
}
export interface EngineerPractice { readonly charges: number; readonly step: 'charge' | 'select-shield' | 'activate' | 'done'; readonly firstSuccess: boolean }
export function reduceEngineerPractice(p: EngineerPractice, event: ControllerEvent): EngineerPractice {
  if (p.step === 'charge' && event.type === 'charge-accepted') {
    const charges = Math.min(PRACTICE_CHARGE_GOAL, p.charges + 1);
    return { charges, step: charges >= PRACTICE_CHARGE_GOAL ? 'select-shield' : 'charge', firstSuccess: true };
  }
  if (p.step === 'select-shield' && event.type === 'selection-changed' && event.selected === 'shield') return { ...p, step: 'activate' };
  if (p.step === 'activate' && event.type === 'activated' && event.ability === 'shield') return { ...p, step: 'done' };
  return p;
}
