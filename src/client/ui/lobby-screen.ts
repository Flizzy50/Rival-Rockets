import { SEAT_IDS, type PublicSeat, type RoomStateMessage, type SeatId, type TeamId } from '../../shared/protocol';
import { TEAM_COMET, TEAM_NOVA } from '../../shared/tokens';
import type { AppContext } from '../app';
import { buildShareLink } from '../net/session';
import { seatRole, seatTeam } from '../room-context';
import { DEVELOPER_ONLY, FALLBACK_REJECT, M4_COPY, rejectCopy, ROOM_COPY, waitingFor } from './copy';
import { button, el, setText } from './dom';
import { checkIcon, cometGlyphIcon, lightningBoltIcon, novaGlyphIcon, steeringArrowIcon } from './icons';
import { createQrSvg } from './qr';
import { startBlocker } from '../../shared/rules/seats';
import { startBlockerText } from '../../shared/copy';
import type { RoomRequestWithoutId } from '../../shared/protocol';

// Lobby (PRD 6, 7.7): room code, QR, share link, two team columns with Pilot
// and Engineer seat cards, Watch, and Leave. Names render as textContent only
// (Requirement 2.8). Ready and Start arrive with M3/M4.

const TEAM = { comet: TEAM_COMET, nova: TEAM_NOVA } as const;
const ROLE_LABEL = { pilot: 'Pilot', engineer: 'Engineer' } as const;
const LINK_COPIED_MS = 2000;

interface SeatCard {
  readonly element: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly name: HTMLElement;
}

function seatCard(seat: SeatId, onTap: () => void): SeatCard {
  const role = seatRole(seat);
  const name = el('span', { className: 'seat-name' });
  const status = el('span', { className: 'seat-status' });
  const element = el(
    'button',
    { className: `seat-card team-${seatTeam(seat)}`, attrs: { type: 'button' } },
    role === 'pilot' ? steeringArrowIcon() : lightningBoltIcon(),
    el('span', { className: 'seat-text' }, el('span', { className: 'seat-role', text: ROLE_LABEL[role] }), name, status),
  );
  element.addEventListener('click', onTap);
  return { element, status, name };
}

function teamColumn(team: TeamId, cards: Record<SeatId, SeatCard>): HTMLElement {
  const info = TEAM[team];
  return el(
    'section',
    { className: `team-column team-${team}`, attrs: { 'aria-label': info.label } },
    el('h2', { className: 'team-heading' }, team === 'comet' ? cometGlyphIcon() : novaGlyphIcon(), el('span', { text: info.label })),
    ...SEAT_IDS.filter((s) => seatTeam(s) === team).map((s) => cards[s].element),
  );
}

// The control test status line, using the PRD start-blocked pattern.
export function controlTestStatus(state: RoomStateMessage): string {
  if (!state.controlTestEnabled) return ROOM_COPY.controlTestOff;
  if (state.activeMatchId !== null) return ROOM_COPY.controlTestRunning;
  for (const seat of ['comet-pilot', 'comet-engineer'] as const) {
    const s = state.seats.find((x) => x.seat === seat);
    if (!s || s.occupantId === null) return waitingFor(seat, 'join');
    if (!s.connected) return waitingFor(seat, 'reconnect');
    if (s.setup !== 'calibrated') return waitingFor(seat, 'calibrate');
  }
  return ROOM_COPY.controlTestRunning;
}

export function mountLobbyScreen(root: HTMLElement, ctx: AppContext): () => void {
  const room = ctx.room;
  if (!room || !room.roomState) {
    ctx.go('home');
    return () => undefined;
  }
  const code = room.roomState.code;
  const link = buildShareLink(window.location.origin, code);
  let linkTimer: ReturnType<typeof setTimeout> | undefined;

  const cards = {} as Record<SeatId, SeatCard>;
  for (const seat of SEAT_IDS) cards[seat] = seatCard(seat, () => void onSeat(seat));

  const shareStatus = el('p', { className: 'caption', attrs: { role: 'status' } });
  const shareButton = button(ROOM_COPY.share, 'btn btn-secondary', () => void share());
  const status = el('p', { className: 'status-line lobby-status', attrs: { 'aria-live': 'polite' } });
  const errorLine = el('p', { className: 'field-error', attrs: { role: 'alert' } });
  const continueButton = button('Continue setup', 'btn btn-primary btn-block', () => {
    const seat = room.seat;
    if (seat === null) return;
    const s = room.roomState?.seats.find((x) => x.seat === seat);
    if (s?.setup === 'calibrated' && ctx.neutralDeg !== null) ctx.go('practice');
    else ctx.startSeat(seat);
  });
  const releaseButton = button(ROOM_COPY.release, 'btn btn-secondary', () => {
    void request({ type: 'seat.release' });
  });
  const readyButton = button('Ready', 'btn btn-primary', () => {
    const slot = room.roomState?.seats.find((s) => s.seat === room.seat);
    void request({ type: 'ready.set', ready: !slot?.ready });
  });
  const startButton = button('Start', 'btn btn-primary', () => void request({ type: 'match.start' }));
  const recalibrateButton = button('Recalibrate', 'btn btn-secondary', () => { ctx.setupEntry = 'calibrate'; ctx.go('setup'); });
  const controlButton = button(ROOM_COPY.controlTestLabel, 'btn btn-secondary', () => ctx.go('control'));
  const notice = el('p', { className: 'caption', attrs: { 'aria-live': 'polite' } });

  root.append(
    el(
      'main',
      { className: 'screen menu-screen lobby-screen' },
      el('h1', { className: 'sr-only', text: 'Lobby', attrs: { tabindex: '-1' } }),
      el(
        'section',
        { className: 'room-share' },
        el('p', { className: 'caption', text: ROOM_COPY.codeLabel }),
        el('p', { className: 'room-code tabular', text: code }),
        createQrSvg(link, `QR code for room ${code}`),
        shareButton,
        shareStatus,
      ),
      status,
      notice,
      el('div', { className: 'team-columns' }, teamColumn('comet', cards), teamColumn('nova', cards)),
      errorLine,
      continueButton,
      el('div', { className: 'button-row' }, readyButton, startButton, recalibrateButton),
      controlButton,
      el(
        'div',
        { className: 'button-row' },
        releaseButton,
        button(ROOM_COPY.watch, 'btn btn-secondary', () => void watch()),
        button(ROOM_COPY.leave, 'btn btn-secondary', () => ctx.leaveRoom()),
      ),
    ),
  );

  async function request(message: RoomRequestWithoutId): Promise<void> {
    errorLine.textContent = '';
    try {
      const reply = await room?.request(message);
      if (reply?.type === 'request.rejected') {
        const blocker = room?.roomState ? startBlocker(room.roomState.seats) : null;
        const copy = reply.reason === 'start-blocked' && blocker ? startBlockerText(blocker) : rejectCopy(reply.reason);
        errorLine.textContent = copy === DEVELOPER_ONLY ? FALLBACK_REJECT : copy;
      }
    } catch { errorLine.textContent = FALLBACK_REJECT; }
  }

  async function onSeat(seat: SeatId): Promise<void> {
    errorLine.textContent = '';
    if (room?.seat !== null) return;
    try {
      const reply = await room.request({ type: 'seat.claim', seat });
      if (reply.type === 'session.accepted' && reply.seat !== null) {
        ctx.startSeat(reply.seat);
      } else if (reply.type === 'request.rejected') {
        const copy = rejectCopy(reply.reason);
        errorLine.textContent = copy === DEVELOPER_ONLY ? FALLBACK_REJECT : copy;
      }
    } catch {
      errorLine.textContent = FALLBACK_REJECT;
    }
  }

  async function watch(): Promise<void> {
    if (!room) return;
    if (room.seat === null) { ctx.go('room-watch'); return; }
    try {
      const reply = await room.request({ type: 'room.watch' });
      if (reply.type !== 'request.rejected') ctx.go('room-watch');
    } catch {
      errorLine.textContent = FALLBACK_REJECT;
    }
  }

  async function share(): Promise<void> {
    // Web Share where available, clipboard otherwise (Requirement 3.4).
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Rival Rockets', url: link });
        return;
      } catch {
        // Cancelled or blocked: fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      shareStatus.textContent = ROOM_COPY.linkCopied;
    } catch {
      // Show the link so it can be copied by hand.
      shareStatus.textContent = link;
      return;
    }
    clearTimeout(linkTimer);
    linkTimer = setTimeout(() => {
      shareStatus.textContent = '';
    }, LINK_COPIED_MS);
  }

  function renderSeat(s: PublicSeat, state: RoomStateMessage, mySeat: SeatId | null): void {
    const card = cards[s.seat];
    const occupant = s.occupantId === null ? null : state.participants.find((p) => p.id === s.occupantId);
    const mine = s.occupantId !== null && s.occupantId === room?.participantId;
    let statusText: string;
    let tone: 'open' | 'taken' | 'ok' | 'warn';
    if (s.occupantId === null) {
      statusText = ROOM_COPY.openSlot;
      tone = 'open';
    } else if (!s.connected) {
      statusText = ROOM_COPY.disconnected;
      tone = 'warn';
    } else if (s.ready) {
      statusText = 'Ready';
      tone = 'ok';
    } else if (s.setup === 'calibrated') {
      statusText = ROOM_COPY.calibrated;
      tone = 'ok';
    } else {
      statusText = ROOM_COPY.taken;
      tone = 'taken';
    }
    const host = s.occupantId !== null && s.occupantId === state.hostId ? ' · Host' : '';
    setText(card.name, occupant ? `${occupant.name}${mine ? ` (${ROOM_COPY.you})` : ''}${host}` : '');
    card.status.replaceChildren(...(tone === 'ok' ? [checkIcon()] : []), document.createTextNode(statusText));
    card.element.dataset.tone = tone;
    card.element.classList.toggle('is-mine', mine);
    // Only an open seat is tappable, and only for an unseated player.
    card.element.disabled = state.phase !== 'lobby' || s.occupantId !== null || mySeat !== null;
    card.element.setAttribute(
      'aria-label',
      `${seatRole(s.seat) === 'pilot' ? 'Pilot' : 'Engineer'}, ${TEAM[seatTeam(s.seat)].label}: ${occupant ? occupant.name : ''} ${statusText}`.trim(),
    );
  }

  function render(): void {
    const state = room?.roomState;
    if (!state) return;
    const mySeat = room?.seat ?? null;
    for (const s of state.seats) renderSeat(s, state, mySeat);
    const blocker = startBlocker(state.seats);
    setText(status, state.phase !== 'lobby' ? 'A match is running. Watch it?' : blocker ? startBlockerText(blocker) : 'Waiting for the host to start');
    setText(notice, state.returnReason === 'interrupted' ? M4_COPY.interrupted : state.returnReason === 'countdown-cancelled' ? M4_COPY.countdownCancelled : state.returnReason === 'match-error' ? M4_COPY.matchError : '');
    const practiced = mySeat !== null && ctx.practiced.has(mySeat);
    const calibrated = state.seats.find((s) => s.seat === mySeat)?.setup === 'calibrated';
    const ready = state.seats.find((s) => s.seat === mySeat)?.ready === true;
    continueButton.hidden = mySeat === null || practiced || state.phase !== 'lobby';
    setText(continueButton, calibrated ? 'Practice' : 'Continue setup');
    readyButton.hidden = mySeat === null || !practiced || !calibrated || state.phase !== 'lobby';
    readyButton.setAttribute('aria-pressed', String(ready));
    setText(readyButton, ready ? '✓ Ready' : 'Ready');
    startButton.hidden = state.hostId !== room?.participantId || state.phase !== 'lobby';
    startButton.disabled = blocker !== null;
    recalibrateButton.hidden = mySeat === null || !calibrated || state.phase !== 'lobby';
    releaseButton.hidden = mySeat === null || state.phase !== 'lobby';
    controlButton.hidden = state.phase !== 'lobby' || !state.controlTestEnabled || state.activeMatchId === null || mySeat === null || seatTeam(mySeat) !== 'comet';
  }

  render();
  const off = room.subscribe((event) => {
    if (event.type === 'room') render();
  });

  return () => {
    off();
    clearTimeout(linkTimer);
  };
}
