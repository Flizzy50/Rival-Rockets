import type { MatchSnapshotMessage } from '../../shared/protocol';
import { HAPTIC_CORE_LOST_MS, HAPTIC_WALL_MS } from '../../shared/tokens';
import { playSound } from '../audio';
import {
  abilityStarts,
  abilityTickerLine,
  createEventQueue,
  createFrameBudget,
  enqueueEvents,
  hapticForEvent,
  soundForAbility,
  soundForEvent,
  takeDueEvents,
  tickerLine,
  updateFrameBudget,
  type Viewer,
} from '../feedback';
import { pulse } from '../haptics';
import type { RoomContext } from '../room-context';
import type { ArenaCanvas } from './arena-canvas';
import type { Hud } from './hud';

// Match feedback glue (PRD 7.8): server events reach the arena, HUD, sound,
// haptics, and ticker when the rendered time catches up with them. Nothing
// here touches authoritative state or delays input; it only decorates.

export interface MatchFeedbackTargets {
  readonly canvas: ArenaCanvas;
  readonly hud: Hud | null;
  readonly ticker?: (line: string) => void;
  // The first complete snapshot of a match: the TIME! banner.
  readonly onTime?: () => void;
}

export interface MatchFeedback {
  frame(renderMs: number, nowMs: number): void;
  destroy(): void;
}

export function createMatchFeedback(room: RoomContext, viewer: Viewer, targets: MatchFeedbackTargets): MatchFeedback {
  let queue = createEventQueue();
  let budget = createFrameBudget();
  let previous: MatchSnapshotMessage | null = null;
  let lastFrameMs: number | null = null;
  let timeShownFor: number | null = null;

  function onSnapshot(snapshot: MatchSnapshotMessage): void {
    queue = enqueueEvents(queue, snapshot.matchId, snapshot.events);
    for (const start of abilityStarts(previous, snapshot)) {
      const sound = soundForAbility(start, viewer);
      if (sound) playSound(sound);
      targets.ticker?.(abilityTickerLine(start));
    }
    if (snapshot.phase === 'complete' && timeShownFor !== snapshot.matchId) {
      timeShownFor = snapshot.matchId;
      playSound('horn');
      targets.onTime?.();
    }
    previous = snapshot;
  }

  const off = room.subscribe((event) => {
    if (event.type !== 'match') return;
    const snapshot = room.matchState;
    if (snapshot?.mode === 'match') onSnapshot(snapshot);
  });
  // The snapshot that was current when the screen opened has no events to
  // replay, but it is the baseline for ability starts.
  if (room.matchState?.mode === 'match') {
    previous = room.matchState;
    if (previous.phase === 'complete') timeShownFor = previous.matchId;
  }

  return {
    frame(renderMs, nowMs) {
      if (lastFrameMs !== null) {
        budget = updateFrameBudget(budget, nowMs - lastFrameMs);
        targets.canvas.setShedding(budget.shedding);
      }
      lastFrameMs = nowMs;
      // A complete match shows everything it sent, even past the render clock.
      const limit = previous?.phase === 'complete' ? Number.POSITIVE_INFINITY : renderMs;
      const out = takeDueEvents(queue, limit);
      queue = out.queue;
      for (const event of out.due) {
        targets.canvas.addEffect(event, nowMs);
        targets.hud?.event(event);
        const sound = soundForEvent(event, viewer);
        if (sound) playSound(sound);
        const ms = hapticForEvent(event, viewer, { coreLostMs: HAPTIC_CORE_LOST_MS, wallMs: HAPTIC_WALL_MS });
        if (ms > 0) pulse(ms);
        const line = tickerLine(event);
        if (line) targets.ticker?.(line);
      }
    },
    destroy() {
      off();
    },
  };
}
