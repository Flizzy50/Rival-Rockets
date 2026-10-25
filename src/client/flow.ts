import type { PublicSeat, ReturnReason, RoomPhase, SeatId } from '../shared/protocol';
import type { ScreenName } from './app';

// Which screen the room phase calls for, or null to stay. Pure, so the whole
// table is unit-tested.
export function screenForPhase(phase: RoomPhase, seated: boolean, current: ScreenName, returnReason: ReturnReason | null = null): ScreenName | null {
  if (phase === 'results') return current === 'results' ? null : 'results';
  if (phase === 'countdown' || phase === 'running') {
    if (seated && current === 'setup') return null;
    const target = seated ? 'match' : 'room-watch';
    return current === target ? null : target;
  }
  // A seat that never came back ends the match with its own screen (PRD 7.7).
  if (current === 'match' && returnReason === 'interrupted') return 'interrupted';
  if (current === 'match' || current === 'results') return seated ? 'lobby' : 'room-watch';
  return null;
}

export interface PausedSeat { readonly seat: SeatId; readonly holdRemainingMs: number | null }

// The seat a pause is waiting on: the earliest hold deadline ends the match,
// so that one is shown (PRD 8). Elapsed is time since room.state arrived.
export function pausedSeat(seats: readonly PublicSeat[], elapsedMs: number): PausedSeat | null {
  let best: PausedSeat | null = null;
  for (const s of seats) {
    if (s.connected && s.setup === 'calibrated') continue;
    const holdRemainingMs = s.holdRemainingMs === null ? null : Math.max(0, s.holdRemainingMs - Math.max(0, elapsedMs));
    if (best === null || (holdRemainingMs !== null && (best.holdRemainingMs === null || holdRemainingMs < best.holdRemainingMs))) best = { seat: s.seat, holdRemainingMs };
  }
  return best;
}
