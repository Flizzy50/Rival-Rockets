import { DROPPED_CORE_LIFETIME_MS, MATCH_DURATION_MS, MAX_DROPS_PER_BOOST, OWNER_RECLAIM_DELAY_MS, SIMULATION_HZ, WALL_SLOW_MS } from '../config.js';
import { containPoint, containPose } from '../course.js';
import type { TeamId } from '../protocol.js';
import { activateSelected, applyCharge, clearExpiredEffect, createCrewAbilityState, getAbilityStatus, selectAbility, type CrewAbilityState } from './abilities.js';
import { ramOutcome, resolveContact } from './collisions.js';
import type { InputResult, QueuedInput } from './control-test.js';
import { createStartPose, moveRocket, type LaneOrder, type RocketState } from './physics.js';
import { createCourseCores, expireAndRespawn, resolvePickups, type CourseCoreState, type DroppedCoreState } from './pickups.js';
import { advanceCrossings, matchResult, type MatchResult } from './scoring.js';

export const TEAMS = ['comet', 'nova'] as const;
export interface CrewMatchState {
  readonly rocket: RocketState; readonly abilities: CrewAbilityState;
  readonly crossings: number; readonly carried: number; readonly dropsUsed: number;
}
export interface MatchState {
  readonly matchId: number; readonly tick: number; readonly matchMs: number;
  readonly lanes: LaneOrder;
  readonly crews: Readonly<Record<TeamId, CrewMatchState>>;
  readonly course: readonly CourseCoreState[]; readonly dropped: readonly DroppedCoreState[];
  readonly inContact: boolean; readonly nextDroppedId: number;
  readonly complete: boolean; readonly result: MatchResult | null;
}
export type MatchInput = QueuedInput & { readonly team: TeamId };
export function matchMsAt(tick: number): number { return Math.floor(tick * 1000 / SIMULATION_HZ); }
export function createMatch(matchId: number, lanes: LaneOrder = 'comet-upper'): MatchState {
  const crew = (team: TeamId): CrewMatchState => ({ rocket: { pose: createStartPose(team, lanes), steering: 0, wallSlowUntilMs: null }, abilities: createCrewAbilityState(), crossings: 0, carried: 0, dropsUsed: 0 });
  return { matchId, tick: 0, matchMs: 0, lanes, crews: { comet: crew('comet'), nova: crew('nova') }, course: createCourseCores(), dropped: [], inContact: false, nextDroppedId: 0, complete: false, result: null };
}
export function neutralMatchSteering(state: MatchState, team: TeamId): MatchState {
  const crew = state.crews[team];
  return { ...state, crews: { ...state.crews, [team]: { ...crew, rocket: { ...crew.rocket, steering: 0 } } } };
}
export function stepMatch(state: MatchState, inputs: readonly MatchInput[]): { state: MatchState; results: InputResult[] } {
  if (state.complete || state.matchMs >= MATCH_DURATION_MS) return { state, results: inputs.map((i) => ({ seq: i.seq, kind: i.kind, status: 'rejected', reason: 'not-running' })) };
  const now = state.matchMs;
  const crews = { ...state.crews };
  const timers = expireAndRespawn(state.course, state.dropped, now);
  const dropped = [...timers.dropped];
  let nextDroppedId = state.nextDroppedId;
  for (const team of TEAMS) crews[team] = { ...crews[team], abilities: clearExpiredEffect(crews[team].abilities, now) };
  const results: InputResult[] = [];
  for (const input of inputs) {
    let crew = crews[input.team];
    let reason: 'full' | 'rate-limited' | 'cooldown' | 'not-enough-energy' | null = null;
    switch (input.kind) {
      case 'steer': crew = { ...crew, rocket: { ...crew.rocket, steering: Math.max(-1, Math.min(1, Number.isFinite(input.steering) ? input.steering : 0)) } }; break;
      case 'select': crew = { ...crew, abilities: selectAbility(crew.abilities, input.ability) }; break;
      case 'charge': {
        const out = applyCharge(crew.abilities, now);
        crew = { ...crew, abilities: out.state };
        if (out.result !== 'accepted') reason = out.result;
        break;
      }
      case 'activate': {
        const out = activateSelected(crew.abilities, now);
        crew = { ...crew, abilities: out.state };
        if (out.result !== 'activated') reason = out.result;
        else if (out.state.activeAbility === 'boost') crew = { ...crew, dropsUsed: 0 };
        break;
      }
    }
    crews[input.team] = crew;
    results.push(reason ? { seq: input.seq, kind: input.kind, status: 'rejected', reason } : { seq: input.seq, kind: input.kind, status: 'applied' });
  }
  const active = { comet: getAbilityStatus(crews.comet.abilities, now).activeAbility, nova: getAbilityStatus(crews.nova.abilities, now).activeAbility };
  const dt = matchMsAt(state.tick + 1) - now;
  for (const team of TEAMS) {
    const crew = crews[team];
    const rocket = moveRocket(crew.rocket, active[team] === 'boost', now, dt, createStartPose(team, state.lanes));
    crews[team] = { ...crew, rocket, crossings: advanceCrossings(crew.crossings, crew.rocket.pose, rocket.pose) };
  }
  const contact = resolveContact({ comet: crews.comet.rocket.pose, nova: crews.nova.rocket.pose }, state.inContact, { comet: active.comet === 'shield', nova: active.nova === 'shield' });
  if (contact.bumped && contact.impact) {
    const impact = containPoint(contact.impact).point;
    for (const attacker of TEAMS) {
      const victim = attacker === 'comet' ? 'nova' : 'comet';
      if (ramOutcome(active[attacker] === 'boost', crews[attacker].dropsUsed >= MAX_DROPS_PER_BOOST, active[victim] === 'shield', crews[victim].carried) !== 'drop') continue;
      crews[attacker] = { ...crews[attacker], dropsUsed: crews[attacker].dropsUsed + 1 };
      crews[victim] = { ...crews[victim], carried: crews[victim].carried - 1 };
      dropped.push({ ...impact, id: nextDroppedId++, owner: victim, createdTick: state.tick, ownerUnlockAtMs: now + OWNER_RECLAIM_DELAY_MS, expiresAtMs: now + DROPPED_CORE_LIFETIME_MS });
    }
  }
  for (const team of TEAMS) {
    const crew = crews[team];
    const contained = containPose(contact[team], createStartPose(team, state.lanes));
    crews[team] = { ...crew, rocket: { ...crew.rocket, pose: contained.pose, wallSlowUntilMs: contained.contact ? now + WALL_SLOW_MS : crew.rocket.wallSlowUntilMs }, crossings: advanceCrossings(crew.crossings, crew.rocket.pose, contained.pose) };
  }
  const pickups = resolvePickups({ paths: { comet: { from: state.crews.comet.rocket.pose, to: crews.comet.rocket.pose }, nova: { from: state.crews.nova.rocket.pose, to: crews.nova.rocket.pose } }, carried: { comet: crews.comet.carried, nova: crews.nova.carried }, course: timers.course, dropped, tick: state.tick, nowMs: now });
  for (const team of TEAMS) crews[team] = { ...crews[team], carried: pickups.carried[team] };
  const tick = state.tick + 1, matchMs = matchMsAt(tick), complete = matchMs >= MATCH_DURATION_MS;
  return { state: { ...state, tick, matchMs, crews, course: pickups.course, dropped: pickups.dropped, nextDroppedId, inContact: contact.overlapping, complete, result: complete ? matchResult(crews) : null }, results };
}
