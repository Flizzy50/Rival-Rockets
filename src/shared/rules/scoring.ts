import { CHECKPOINT_COUNT, CHECKPOINT_POINTS, CORE_POINTS } from '../config.js';
import { crossesForward, GATES, type Vec } from '../course.js';
import type { TeamId } from '../protocol.js';

export function nextGateIndex(crossings: number): number { return crossings % CHECKPOINT_COUNT; }
export function advanceCrossings(crossings: number, from: Vec, to: Vec): number {
  for (let n = 0; n < CHECKPOINT_COUNT; n += 1) {
    const gate = GATES[nextGateIndex(crossings)];
    if (!gate || !crossesForward(gate, from, to)) break;
    crossings += 1;
  }
  return crossings;
}
export function teamScore(crossings: number, carried: number): number { return CHECKPOINT_POINTS * crossings + CORE_POINTS * carried; }
export function breakdown(crossings: number, carried: number) {
  return { crossings, checkpointPoints: crossings * CHECKPOINT_POINTS, carried, corePoints: carried * CORE_POINTS, total: teamScore(crossings, carried) };
}
export type ScoreBreakdown = ReturnType<typeof breakdown>;
export interface MatchResult { readonly outcome: 'win' | 'draw'; readonly winner: TeamId | null; readonly teams: Readonly<Record<TeamId, ScoreBreakdown>> }
export function matchResult(crews: Record<TeamId, { crossings: number; carried: number }>): MatchResult {
  const teams = { comet: breakdown(crews.comet.crossings, crews.comet.carried), nova: breakdown(crews.nova.crossings, crews.nova.carried) };
  const winner = teams.comet.total === teams.nova.total ? null : teams.comet.total > teams.nova.total ? 'comet' : 'nova';
  return { outcome: winner === null ? 'draw' : 'win', winner, teams };
}
