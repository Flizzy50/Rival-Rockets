import { ABILITY_COST, CHARGE_ENERGY, MAX_CARRIED_CORES, MAX_ENERGY } from '../../shared/config';
import { SEAT_IDS, type MatchSnapshotMessage, type PublicMatchCrew, type SeatId, type TeamId } from '../../shared/protocol';
import { FINAL_WARNING_MS, PHONE_SOUND_GAIN, SPECTATOR_SOUND_GAIN, TICKER_LINES } from '../../shared/tokens';
import type { AppContext } from '../app';
import { setSoundGain } from '../audio';
import { estimateRenderTime, sampleAt } from '../net/interpolate';
import { seatRole, seatTeam } from '../room-context';
import { createArenaCanvas } from './arena-canvas';
import { M4_COPY, pausedLine, resumingLine, ROOM_COPY, seatName } from './copy';
import { pausedSeat } from '../flow';
import { button, el, setText } from './dom';
import { ABILITY_LABEL, seconds } from './engineer-panel';
import { controlTestStatus } from './lobby-screen';
import { teamTag } from './top-bar';
import { createHud, formatTimer } from './hud';
import { createMatchFeedback } from './match-feedback';
import { createMuteToggle } from './mute-toggle';
import { lightningBoltIcon, rocketSilhouette, steeringArrowIcon } from './icons';
import { startBlocker } from '../../shared/rules/seats';
import { startBlockerText } from '../../shared/copy';

// Watch view (Requirement 21, PRD 7.7): room code, the four seats, and the
// interpolated full course. On a wide landscape screen it becomes the 16:9
// spectator display: side panels per crew, a large timer, and an event
// ticker. It never asks for motion and sends no gameplay input.

// One crew's spectator panel state, matching the phone's crew status row.
export function crewStateText(crew: PublicMatchCrew): string {
  if (crew.active !== null && crew.effectRemainingMs > 0) return `${ABILITY_LABEL[crew.active]} · ${seconds(crew.effectRemainingMs)}`;
  if (crew.cooldownRemainingMs > 0) return `Cooldown ${seconds(crew.cooldownRemainingMs)}`;
  if (crew.energy < ABILITY_COST) return `Need ${ABILITY_COST - crew.energy} more`;
  return `${ABILITY_LABEL[crew.selected]} READY`;
}

interface TeamPanel {
  readonly element: HTMLElement;
  readonly names: Record<'pilot' | 'engineer', HTMLElement>;
  readonly score: HTMLElement;
  readonly pips: HTMLElement[];
  readonly pipsLabel: HTMLElement;
  readonly segments: HTMLElement[];
  readonly energy: HTMLElement;
  readonly state: HTMLElement;
}

function teamPanel(team: TeamId): TeamPanel {
  const names = { pilot: el('span', { className: 'spectator-name' }), engineer: el('span', { className: 'spectator-name' }) };
  const score = el('strong', { className: 'spectator-score tabular', text: '0' });
  const pips = Array.from({ length: MAX_CARRIED_CORES }, () => el('span', { className: 'core-pip', text: '○', attrs: { 'aria-hidden': 'true' } }));
  const pipsLabel = el('span', { className: 'core-pips spectator-pips' }, ...pips);
  const segments = Array.from({ length: MAX_ENERGY / CHARGE_ENERGY }, () => el('span', { className: 'energy-segment' }));
  const energy = el('span', { className: 'energy-value tabular', text: '0' });
  const state = el('p', { className: 'spectator-state tabular' });
  const element = el(
    'aside',
    { className: `spectator-panel team-${team}`, attrs: { 'aria-label': team === 'comet' ? 'Comet crew' : 'Nova crew' } },
    el('div', { className: 'spectator-team' }, rocketSilhouette(team), teamTag(team)),
    el('p', { className: 'spectator-role' }, steeringArrowIcon(), el('span', { text: 'Pilot' }), names.pilot),
    el('p', { className: 'spectator-role' }, lightningBoltIcon(), el('span', { text: 'Engineer' }), names.engineer),
    score,
    pipsLabel,
    el('div', { className: 'energy-row' }, el('span', { className: 'energy-label', text: 'ENERGY' }), el('div', { className: 'energy-meter' }, ...segments), energy),
    state,
  );
  return { element, names, score, pips, pipsLabel, segments, energy, state };
}

export function mountRoomWatchScreen(root: HTMLElement, ctx: AppContext): () => void {
  const room = ctx.room;
  if (!room || !room.roomState) {
    ctx.go('home');
    return () => undefined;
  }

  const seatRows = {} as Record<SeatId, { name: HTMLElement; state: HTMLElement }>;
  const list = el('ul', { className: 'watch-seats' });
  for (const seat of SEAT_IDS) {
    const name = el('span', { className: 'watch-seat-name' });
    const state = el('span', { className: 'watch-seat-state' });
    seatRows[seat] = { name, state };
    list.append(
      el(
        'li',
        { attrs: { 'aria-label': seatName(seat) } },
        teamTag(seatTeam(seat)),
        el('span', { className: 'watch-seat-role', text: seatRole(seat) === 'pilot' ? 'Pilot' : 'Engineer' }),
        name,
        state,
      ),
    );
  }

  const arena = el('div', { className: 'arena' });
  const strip = el('p', { className: 'control-strip', text: ROOM_COPY.controlTestLabel });
  const waiting = el('p', { className: 'arena-message', attrs: { 'aria-live': 'polite' } });
  const timeBanner = el('div', { className: 'time-banner', text: 'TIME!', attrs: { role: 'status' } });
  timeBanner.hidden = true;
  const hud = createHud(null);
  hud.element.hidden = true;
  const panels = { comet: teamPanel('comet'), nova: teamPanel('nova') };
  const bigTimer = el('p', { className: 'spectator-timer tabular', text: formatTimer(0), attrs: { 'aria-label': 'Time remaining' } });
  // The ticker is a visual log; screen readers already get scores and pauses
  // from the HUD and live regions, so it is not announced line by line.
  const ticker = el('ol', { className: 'ticker', attrs: { 'aria-label': 'Match events' } });
  const mute = createMuteToggle('btn btn-small');

  const screen = el(
    'main',
    { className: 'screen test-screen room-watch-screen' },
    el(
      'header',
      { className: 'top-bar' },
      el('h1', { className: 'top-bar-title', text: 'Watching', attrs: { tabindex: '-1' } }),
      el('span', { className: 'room-code-small tabular', text: room.roomState.code }),
      el('div', { className: 'top-bar-actions' }, mute.element, button(ROOM_COPY.leave, 'btn btn-small', () => ctx.leaveRoom())),
    ),
    list,
    hud.element,
    bigTimer,
    strip,
    el('div', { className: 'spectator-stage' }, panels.comet.element, el('div', { className: 'middle' }, arena, waiting, timeBanner), panels.nova.element),
    ticker,
  );
  root.append(screen);

  // The spectator display carries the room's sound (PRD 7.8).
  setSoundGain(SPECTATOR_SOUND_GAIN);
  const canvas = createArenaCanvas(arena);
  const feedback = createMatchFeedback(room, { team: null, role: null }, { canvas, hud, ticker: addTickerLine, onTime: () => { timeBanner.hidden = false; } });
  let rafId = 0;

  function addTickerLine(line: string): void {
    ticker.prepend(el('li', { text: line }));
    while (ticker.children.length > TICKER_LINES) ticker.lastElementChild?.remove();
  }

  function renderSeats(): void {
    const state = room?.roomState;
    if (!state) return;
    for (const s of state.seats) {
      const occupant = s.occupantId === null ? null : state.participants.find((p) => p.id === s.occupantId);
      const row = seatRows[s.seat];
      // Names stay text nodes (PRD 10).
      setText(row.name, occupant?.name ?? '');
      setText(panels[seatTeam(s.seat)].names[seatRole(s.seat)], occupant?.name ?? ROOM_COPY.open);
      let text = '';
      if (!occupant) text = ROOM_COPY.open;
      else if (!s.connected) text = ROOM_COPY.disconnected;
      else if (s.setup === 'calibrated') text = ROOM_COPY.calibrated;
      setText(row.state, text);
    }
  }

  function renderPanels(snapshot: MatchSnapshotMessage): void {
    setText(bigTimer, formatTimer(snapshot.remainingMs));
    bigTimer.classList.toggle('final-warning', snapshot.remainingMs <= FINAL_WARNING_MS);
    for (const team of ['comet', 'nova'] as const) {
      const crew = snapshot.crews[team], p = panels[team];
      setText(p.score, String(crew.score));
      p.pipsLabel.setAttribute('aria-label', `${team === 'comet' ? 'Comet' : 'Nova'} cores ${crew.carried} of ${MAX_CARRIED_CORES}`);
      p.pips.forEach((dot, i) => {
        setText(dot, i < crew.carried ? '●' : '○');
        dot.classList.toggle('is-filled', i < crew.carried);
      });
      p.segments.forEach((s, i) => s.classList.toggle('is-filled', crew.energy >= (i + 1) * CHARGE_ENERGY));
      setText(p.energy, String(crew.energy));
      setText(p.state, crewStateText(crew));
      p.element.classList.toggle('is-active', crew.active !== null);
    }
  }

  function frame(nowMs: number): void {
    rafId = requestAnimationFrame(frame);
    if (!room) return;
    const time = estimateRenderTime(room.buffer, nowMs);
    const pose = sampleAt(room.buffer, time);
    const running = room.roomState?.activeMatchId != null && pose !== null;
    const snapshot = room.matchState;
    const inMatch = snapshot?.mode === 'match';
    hud.element.hidden = !inMatch;
    screen.classList.toggle('in-match', inMatch);
    if (snapshot?.mode === 'match') {
      hud.update(snapshot);
      renderPanels(snapshot);
      feedback.frame(time, nowMs);
      canvas.drawMatch(snapshot, { comet: sampleAt(room.buffer, time, 'comet') ?? snapshot.rockets.comet, nova: sampleAt(room.buffer, time, 'nova') ?? snapshot.rockets.nova }, null, nowMs);
    } else if (running) {
      const crew = snapshot?.mode === 'control-test' ? snapshot.crew : null;
      canvas.drawPose(pose, { active: crew?.active ?? null, effectRemainingMs: crew?.effectRemainingMs });
    } else {
      canvas.drawEmpty();
    }
    let message = '';
    if (!running) {
      const blocker = room.roomState ? startBlocker(room.roomState.seats) : null;
      message = blocker ? startBlockerText(blocker) : room.roomState ? controlTestStatus(room.roomState) : ROOM_COPY.waitingNoTest;
    }
    else if (snapshot?.mode === 'match' && snapshot.frozen) {
      message = snapshot.resumeRemainingMs > 0 ? resumingLine(snapshot.resumeRemainingMs) : pausedLine(room.roomState ? pausedSeat(room.roomState.seats, nowMs - room.roomReceivedAtMs)?.seat ?? null : null);
    } else if (room.matchState?.frozen) message = ROOM_COPY.frozenNote;
    // A watcher has no Interrupted screen; the reason shows here instead.
    if (!running && room.roomState?.phase === 'lobby') {
      const reason = room.roomState.returnReason;
      if (reason === 'interrupted') message = M4_COPY.interrupted;
      else if (reason === 'match-error') message = M4_COPY.matchError;
    }
    setText(waiting, message);
    waiting.hidden = message === '';
    arena.classList.toggle('is-paused', snapshot?.mode === 'match' && snapshot.frozen);
    strip.hidden = !running || snapshot?.mode === 'match';
  }

  renderSeats();
  const off = room.subscribe((event) => {
    if (event.type === 'room') renderSeats();
  });
  rafId = requestAnimationFrame(frame);

  return () => {
    off();
    cancelAnimationFrame(rafId);
    feedback.destroy();
    hud.destroy();
    mute.destroy();
    canvas.destroy();
    setSoundGain(PHONE_SOUND_GAIN);
  };
}
