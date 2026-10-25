import { coresLine, gatesLine, RESULTS_NOTE } from '../../shared/copy';
import type { RoomRequestWithoutId, SeatId } from '../../shared/protocol';
import { crewmateSeat } from '../../shared/rules/seats';
import type { AppContext } from '../app';
import { DEVELOPER_ONLY, FALLBACK_REJECT, M4_COPY, rejectCopy, ROOM_COPY, seatName } from './copy';
import { button, el, setText } from './dom';
import { rocketSilhouette } from './icons';
import { teamTag } from './top-bar';

// Results (PRD 6, 7.7): the frozen result from room.state, then Rematch for
// the host and Swap roles for each crew. The result itself never changes;
// only the seat list below it does.

export function mountResultsScreen(root: HTMLElement, ctx: AppContext): () => void {
  const room = ctx.room;
  const result = room?.roomState?.result;
  if (!room || !result) { ctx.go('lobby'); return () => undefined; }
  const headline = result.winner === null ? 'DRAW' : `${result.winner.toUpperCase()} WINS`;
  const title = el('h1', { className: `screen-title${result.winner ? ` team-${result.winner}` : ''}`, text: headline, attrs: { tabindex: '-1', 'aria-live': 'polite' } });
  if (result.winner) title.prepend(rocketSilhouette(result.winner));
  const cards = (['comet', 'nova'] as const).map((team) => {
    const score = result.teams[team];
    return el('section', { className: `result-card team-${team}` }, rocketSilhouette(team), teamTag(team), el('p', { className: 'tabular', text: gatesLine(score) }), el('p', { className: 'tabular', text: coresLine(score) }), el('strong', { className: 'result-total tabular', text: `Total: ${score.total}` }));
  });

  const seatRows = new Map<SeatId, HTMLElement>();
  const seatList = el('ul', { className: 'result-seats', attrs: { 'aria-live': 'polite' } });
  for (const s of room.roomState?.seats ?? []) {
    const row = el('li', { className: `team-${s.seat.split('-')[0] ?? ''}` });
    seatRows.set(s.seat, row);
    seatList.append(row);
  }
  const status = el('p', { className: 'status-line', attrs: { 'aria-live': 'polite' } });
  const errorLine = el('p', { className: 'field-error', attrs: { role: 'alert' } });
  const rematchButton = button(M4_COPY.rematch, 'btn btn-primary btn-block', () => void request({ type: 'match.rematch' }));
  const swapButton = button(M4_COPY.swapRoles, 'btn btn-secondary btn-block', () => void request({ type: 'match.swap' }));

  root.append(el('main', { className: 'screen menu-screen results-screen' },
    title, ...cards,
    el('p', { className: 'body-text', text: RESULTS_NOTE }),
    seatList, status, errorLine, rematchButton, swapButton,
    el('p', { className: 'caption', text: M4_COPY.swapHint }),
    button('Leave room', 'btn btn-secondary', () => ctx.leaveRoom())));
  ctx.announce('polite', headline);

  async function request(message: RoomRequestWithoutId): Promise<void> {
    errorLine.textContent = '';
    try {
      const reply = await room?.request(message);
      if (reply?.type === 'request.rejected') {
        const copy = rejectCopy(reply.reason);
        errorLine.textContent = copy === DEVELOPER_ONLY ? FALLBACK_REJECT : copy;
      }
    } catch { errorLine.textContent = FALLBACK_REJECT; }
  }

  function render(): void {
    const state = room?.roomState;
    if (!state || state.phase !== 'results') return;
    const mySeat = room?.seat ?? null;
    for (const s of state.seats) {
      const row = seatRows.get(s.seat);
      if (!row) continue;
      const name = state.participants.find((p) => p.id === s.occupantId)?.name ?? ROOM_COPY.open;
      const note = s.occupantId === null ? '' : !s.connected ? ROOM_COPY.disconnected : s.swapRequested ? M4_COPY.wantsSwap : '';
      // Names stay text nodes (PRD 10).
      setText(row, `${seatName(s.seat)}: ${name}${note ? ` · ${note}` : ''}`);
    }
    const isHost = state.hostId !== null && state.hostId === room?.participantId;
    rematchButton.hidden = !isHost;
    const mine = mySeat === null ? null : state.seats.find((s) => s.seat === mySeat);
    const mate = mySeat === null ? null : state.seats.find((s) => s.seat === crewmateSeat(mySeat));
    swapButton.hidden = mine == null;
    setText(swapButton, mine?.swapRequested ? M4_COPY.cancelSwap : M4_COPY.swapRoles);
    swapButton.setAttribute('aria-pressed', String(mine?.swapRequested === true));
    const waiting = mine?.swapRequested === true && mate?.swapRequested !== true;
    setText(status, waiting ? M4_COPY.waitingTeammate : isHost ? '' : M4_COPY.waitingHost);
  }

  render();
  const off = room.subscribe((event) => { if (event.type === 'room') render(); });
  return () => off();
}

// Interrupted (PRD 7.7): neutral, no winner, one way back.
export function mountInterruptedScreen(root: HTMLElement, ctx: AppContext): () => void {
  root.append(el('main', { className: 'screen menu-screen interrupted-screen' },
    el('section', { className: 'failure-card stack' },
      el('h1', { className: 'screen-title', text: M4_COPY.interruptedTitle, attrs: { tabindex: '-1' } }),
      el('p', { className: 'body-text', text: M4_COPY.interrupted }),
      button(M4_COPY.backToLobby, 'btn btn-primary btn-block', () => ctx.go(ctx.room?.seat ? 'lobby' : 'room-watch')))));
  ctx.announce('assertive', M4_COPY.interrupted);
  return () => undefined;
}
