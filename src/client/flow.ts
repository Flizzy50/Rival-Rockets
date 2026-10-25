import type { RoomPhase } from '../shared/protocol';
import type { ScreenName } from './app';

export function screenForPhase(phase: RoomPhase, seated: boolean, current: ScreenName): ScreenName | null {
  if (phase === 'results') return current === 'results' ? null : 'results';
  if (phase === 'countdown' || phase === 'running') {
    if (seated && current === 'setup') return null;
    const target = seated ? 'match' : 'room-watch';
    return current === target ? null : target;
  }
  if (current === 'match' || current === 'results') return seated ? 'lobby' : 'room-watch';
  return null;
}
