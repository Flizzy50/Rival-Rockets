import type { Ability, MatchSnapshotMessage, PublicMatchEvent, Role, TeamId } from '../shared/protocol';
import { FRAME_AVERAGE_WEIGHT, FRAME_BUDGET_MS, FRAME_RECOVER_MS, TEAM_COMET, TEAM_NOVA } from '../shared/tokens';

// Event feedback rules (PRD 7.8), kept pure so the scheduling, sound,
// haptic, and ticker choices are unit-tested without a browser. The DOM and
// canvas glue lives in ui/match-feedback.ts.

export type Sound = 'charge' | 'select' | 'ready' | 'error' | 'boost' | 'shield' | 'gate' | 'pickup' | 'clank' | 'horn';

// Who is looking: a seated player's team and role, or a watcher (both null).
export interface Viewer {
  readonly team: TeamId | null;
  readonly role: Role | null;
}

// Events arrive with the snapshot of the step that made them, but the arena
// shows rockets about one interpolation delay in the past. Holding each event
// until the rendered time reaches it keeps a burst on the rocket that caused it.
export interface EventQueue {
  readonly matchId: number | null;
  readonly pending: readonly PublicMatchEvent[];
}

// A stalled tab could otherwise collect events without bound.
export const EVENT_QUEUE_MAX = 64;

export function createEventQueue(): EventQueue {
  return { matchId: null, pending: [] };
}

export function enqueueEvents(queue: EventQueue, matchId: number, events: readonly PublicMatchEvent[]): EventQueue {
  const base = queue.matchId === matchId ? queue.pending : [];
  return { matchId, pending: [...base, ...events].slice(-EVENT_QUEUE_MAX) };
}

export function takeDueEvents(queue: EventQueue, renderMs: number): { queue: EventQueue; due: PublicMatchEvent[] } {
  const due: PublicMatchEvent[] = [];
  const pending: PublicMatchEvent[] = [];
  for (const event of queue.pending) (event.matchMs <= renderMs ? due : pending).push(event);
  return { queue: { matchId: queue.matchId, pending }, due };
}

export interface AbilityStart {
  readonly team: TeamId;
  readonly ability: Ability;
}

// Activations are seen on every screen from the crew state (PRD 5): a crew
// whose effect was off, or a different one, in the previous snapshot.
export function abilityStarts(previous: MatchSnapshotMessage | null, next: MatchSnapshotMessage): AbilityStart[] {
  if (!previous || previous.matchId !== next.matchId) return [];
  const starts: AbilityStart[] = [];
  for (const team of ['comet', 'nova'] as const) {
    const ability = next.crews[team].active;
    const before = previous.crews[team];
    // A longer remaining effect than before means a fresh activation, even
    // if the same ability was still showing.
    const fresh = ability !== null && (before.active !== ability || next.crews[team].effectRemainingMs > before.effectRemainingMs);
    if (fresh) starts.push({ team, ability });
  }
  return starts;
}

function involves(event: PublicMatchEvent, team: TeamId): boolean {
  switch (event.kind) {
    case 'gate':
    case 'pickup':
    case 'wall':
      return event.team === team;
    case 'drop':
    case 'blocked':
      return event.attacker === team || event.victim === team;
    case 'bump':
      return true;
  }
}

// Phones sound only their own crew's moments; a watcher hears everything.
export function soundForEvent(event: PublicMatchEvent, viewer: Viewer): Sound | null {
  const relevant = viewer.team === null || involves(event, viewer.team);
  if (!relevant) return null;
  if (event.kind === 'gate') return 'gate';
  if (event.kind === 'pickup') return 'pickup';
  if (event.kind === 'blocked') return 'clank';
  return null;
}

export function soundForAbility(start: AbilityStart, viewer: Viewer): Sound | null {
  if (viewer.team !== null && viewer.team !== start.team) return null;
  return start.ability;
}

export interface HapticDurations {
  readonly coreLostMs: number;
  readonly wallMs: number;
}

// Vibration length for this viewer, or 0 (PRD 7.8): the victim crew feels a
// lost core, and the pilot feels their own wall hit.
export function hapticForEvent(event: PublicMatchEvent, viewer: Viewer, durations: HapticDurations): number {
  if (viewer.team === null) return 0;
  if (event.kind === 'drop' && event.victim === viewer.team) return durations.coreLostMs;
  if (event.kind === 'wall' && event.team === viewer.team && viewer.role === 'pilot') return durations.wallMs;
  return 0;
}

function label(team: TeamId): string {
  return team === 'comet' ? TEAM_COMET.label : TEAM_NOVA.label;
}

// Spectator ticker copy (PRD 7.7, 7.9). Bumps and wall hits are too frequent
// to be news.
export function tickerLine(event: PublicMatchEvent): string | null {
  switch (event.kind) {
    case 'drop':
      return `${label(event.attacker)} rammed ${label(event.victim)} · core dropped`;
    case 'blocked':
      return `${label(event.victim)} shield blocked ${label(event.attacker)}`;
    case 'pickup':
      return `${label(event.team)} grabbed a core`;
    case 'gate':
      return `${label(event.team)} cleared gate ${event.gate + 1}`;
    case 'bump':
    case 'wall':
      return null;
  }
}

export function abilityTickerLine(start: AbilityStart): string {
  return `${label(start.team)} ${start.ability === 'boost' ? 'boosted' : 'shield up'}`;
}

// Frame budget (PRD 7.11): a running average of frame time. Shedding starts
// above the budget and stops only well below it, so effects do not flap.
export interface FrameBudget {
  readonly averageMs: number;
  readonly shedding: boolean;
}

export function createFrameBudget(): FrameBudget {
  return { averageMs: 1000 / 60, shedding: false };
}

export function updateFrameBudget(budget: FrameBudget, frameMs: number): FrameBudget {
  // Background tabs and stalls produce one huge gap; that is not render cost.
  if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return budget;
  const averageMs = budget.averageMs + (frameMs - budget.averageMs) * FRAME_AVERAGE_WEIGHT;
  const shedding = budget.shedding ? averageMs > FRAME_RECOVER_MS : averageMs > FRAME_BUDGET_MS;
  return { averageMs, shedding };
}
