import { SWAP_HINT } from '../../shared/copy';
import type { RejectReason, RoomErrorReason, SeatId } from '../../shared/protocol';

// M2 player copy (PRD 7.9 "Rooms and control test (Milestone 2)"). Errors say
// what to do next and never blame the player. Protocol-level reasons only
// happen with a broken or modified client, so they get a developer marker
// for the debug log instead of player copy.

export const DEVELOPER_ONLY = Symbol('developer-only');

export const ROOM_COPY = {
  homePitch: 'Two rockets. Four phones. One winner.',
  homeNote: 'Needs 4 phones with motion sensors.',
  sensorTest: 'Sensor test',
  createTitle: 'Create room',
  joinTitle: 'Join room',
  codeLabel: 'Room code',
  nameLabel: 'Your name',
  nameHint: 'Use 1–16 characters, no line breaks.',
  watchToggle: 'Just watch',
  openSlot: 'Tap to join',
  open: 'Open',
  taken: 'Taken',
  calibrated: 'Calibrated',
  disconnected: 'Disconnected',
  you: 'You',
  share: 'Share link',
  linkCopied: 'Link copied',
  watch: 'Watch',
  leave: 'Leave',
  release: 'Leave seat',
  controlTestLabel: 'CONTROL TEST · not a match',
  controlTestOff: 'Control test is off on this server.',
  controlTestRunning: 'Control test running',
  novaNote: 'This test flies the Comet rocket only.',
  waitingNoTest: 'Waiting for the Comet crew to calibrate',
  reconnecting: 'Reconnecting…',
  frozenNote: 'Paused · waiting for the crew',
  connectFailed: "Can't reach the game. Reload and try again.",
  lost: 'Connection lost. Create or join a new room.',
  roomExpired: 'This room expired. Create or join a new room.',
  serverClosing: 'The game restarted. Create or join a new room.',
} as const;

const SEAT_NAMES: Record<SeatId, string> = {
  'comet-pilot': 'Comet Pilot',
  'comet-engineer': 'Comet Engineer',
  'nova-pilot': 'Nova Pilot',
  'nova-engineer': 'Nova Engineer',
};

export function seatName(seat: SeatId): string {
  return SEAT_NAMES[seat];
}

// PRD 7.7 start-blocked pattern.
export function waitingFor(seat: SeatId, what: 'join' | 'calibrate' | 'reconnect'): string {
  if (what === 'join') return `Waiting for a ${seatName(seat)}`;
  if (what === 'reconnect') return `Waiting for ${seatName(seat)} to reconnect`;
  return `Waiting for ${seatName(seat)} to calibrate`;
}

const REJECT_COPY: Record<RejectReason, string | typeof DEVELOPER_ONLY> = {
  'invalid-message': DEVELOPER_ONLY,
  'too-large': DEVELOPER_ONLY,
  'unknown-type': DEVELOPER_ONLY,
  'invalid-field': DEVELOPER_ONLY,
  'invalid-value': 'Check the room code and try again.',
  'invalid-name': 'Use 1–16 characters, no line breaks.',
  'rate-limited': 'Too many tries. Wait a minute, then try again.',
  'room-not-found': 'No room with that code.',
  'room-full': 'This room is full. Watch instead?',
  'not-in-room': 'Join a room first.',
  'already-in-room': 'You are already in a room.',
  'seat-taken': 'That seat was just taken. Pick another.',
  'already-seated': 'Leave your seat first, then pick another.',
  'watching': 'You joined to watch. Rejoin to play.',
  'not-seated': 'Pick a seat first.',
  'reconnect-denied': 'Your seat was released. Join the room again.',
  // Gameplay rejections are shown by the controls, not as messages.
  'not-authorized': DEVELOPER_ONLY,
  'stale-match': DEVELOPER_ONLY,
  'stale-sequence': DEVELOPER_ONLY,
  'no-control-test': DEVELOPER_ONLY,
  'wrong-phase': 'Wait for the lobby to change seats or get ready.',
  'not-host': 'Only the host can do that.',
  'start-blocked': 'All four players need to calibrate and get ready.',
  'not-calibrated': 'Check motion and set neutral before Ready.',
  'not-running': DEVELOPER_ONLY,
  full: DEVELOPER_ONLY,
  cooldown: DEVELOPER_ONLY,
  'not-enough-energy': DEVELOPER_ONLY,
};

export function rejectCopy(reason: RejectReason): string | typeof DEVELOPER_ONLY {
  return REJECT_COPY[reason];
}

// M4 interruption, rematch, and swap copy (PRD 7.7, 7.9; proposed lines are
// listed in the PRD "Interruptions and rematch (Milestone 4)" block).
export const M4_COPY = {
  interruptedTitle: 'Match interrupted',
  interrupted: "Match interrupted. A player couldn't reconnect.",
  backToLobby: 'Back to lobby',
  countdownCancelled: 'Countdown cancelled. Check motion and get ready again.',
  matchError: 'The match hit a problem and ended with no winner. Start a new one.',
  rematch: 'Rematch',
  swapRoles: 'Swap roles',
  cancelSwap: 'Cancel swap',
  waitingTeammate: 'Waiting for teammate',
  wantsSwap: 'Wants to swap',
  swapHint: SWAP_HINT,
  waitingHost: 'Waiting for the host to start a rematch',
  holdLabel: 'Seat held',
} as const;

export function pausedLine(seat: SeatId | null): string {
  return `Paused · ${seat ? seatName(seat) : 'Crew'} reconnecting`;
}

// Whole seconds rounded up, so the label never reads 0 while still waiting.
export function resumingLine(remainingMs: number): string {
  return `Resuming in ${Math.max(1, Math.ceil(remainingMs / 1000))}…`;
}

// Shown when a developer-only reason reaches a room request anyway.
export const FALLBACK_REJECT = 'Something went wrong. Try again.';

export function roomErrorCopy(reason: RoomErrorReason | 'lost' | 'connect-failed'): string {
  switch (reason) {
    case 'room-expired':
      return ROOM_COPY.roomExpired;
    case 'server-closing':
      return ROOM_COPY.serverClosing;
    case 'lost':
      return ROOM_COPY.lost;
    case 'connect-failed':
      return ROOM_COPY.connectFailed;
  }
}
