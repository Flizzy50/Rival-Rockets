import type { Ability, PublicCrewState } from '../shared/protocol';

// Crew view reducer (Requirement 19.5, design M2-11). The phone predicts on
// the same frame for feel; every authoritative update replaces those
// predictions, so what the screen shows converges on the server's state.
// Remaining times are stored as deadlines on the local clock so countdowns
// keep running between snapshots.

export interface CrewView {
  readonly energy: number;
  readonly selected: Ability;
  readonly active: Ability | null;
  readonly effectEndsAtMs: number;
  readonly cooldownEndsAtMs: number;
  // A charge was predicted but not yet confirmed.
  readonly chargePending: boolean;
  // A select request is in flight; the local selection wins until it lands.
  readonly selectPending: Ability | null;
  // Activate was tapped and the server has not answered yet.
  readonly activatePending: boolean;
  // True once any authoritative crew state has arrived.
  readonly synced: boolean;
}

export type CrewEvent =
  | { readonly type: 'charge-predicted' }
  | { readonly type: 'selection-local'; readonly ability: Ability }
  | { readonly type: 'activate-pressed' }
  // From an applied or rejected ack; `kind` says which request it answers.
  | { readonly type: 'ack'; readonly kind: 'charge' | 'select' | 'activate'; readonly crew: PublicCrewState | null; readonly nowMs: number }
  | { readonly type: 'snapshot'; readonly crew: PublicCrewState; readonly nowMs: number };

export function createCrewView(initial: PublicCrewState | null = null, nowMs = 0): CrewView {
  const base: CrewView = {
    energy: 0,
    selected: 'boost',
    active: null,
    effectEndsAtMs: 0,
    cooldownEndsAtMs: 0,
    chargePending: false,
    selectPending: null,
    activatePending: false,
    synced: false,
  };
  return initial ? adopt(base, initial, nowMs) : base;
}

function adopt(view: CrewView, crew: PublicCrewState, nowMs: number): CrewView {
  return {
    ...view,
    energy: crew.energy,
    // A pending local select stays on screen until the server confirms it.
    selected: view.selectPending ?? crew.selected,
    active: crew.active,
    effectEndsAtMs: nowMs + crew.effectRemainingMs,
    cooldownEndsAtMs: nowMs + crew.cooldownRemainingMs,
    synced: true,
  };
}

export function reduceCrewView(view: CrewView, event: CrewEvent): CrewView {
  switch (event.type) {
    case 'charge-predicted':
      return { ...view, chargePending: true };
    case 'selection-local':
      return { ...view, selected: event.ability, selectPending: event.ability };
    case 'activate-pressed':
      return { ...view, activatePending: true };
    case 'ack': {
      const cleared: CrewView = {
        ...view,
        chargePending: event.kind === 'charge' ? false : view.chargePending,
        selectPending: event.kind === 'select' ? null : view.selectPending,
        activatePending: event.kind === 'activate' ? false : view.activatePending,
      };
      return event.crew ? adopt(cleared, event.crew, event.nowMs) : cleared;
    }
    case 'snapshot':
      return adopt(view, event.crew, event.nowMs);
  }
}

export function effectRemainingMs(view: CrewView, nowMs: number): number {
  return view.active === null ? 0 : Math.max(0, view.effectEndsAtMs - nowMs);
}

export function cooldownRemainingMs(view: CrewView, nowMs: number): number {
  return Math.max(0, view.cooldownEndsAtMs - nowMs);
}
