import { SEAT_IDS, type SeatId } from '../../shared/protocol';
import type { AppContext } from '../app';
import { estimateRenderTime, sampleAt } from '../net/interpolate';
import { seatRole, seatTeam } from '../room-context';
import { createArenaCanvas } from './arena-canvas';
import { M4_COPY, pausedLine, resumingLine, ROOM_COPY, seatName } from './copy';
import { pausedSeat } from '../flow';
import { button, el, setText } from './dom';
import { controlTestStatus } from './lobby-screen';
import { teamTag } from './top-bar';
import { createHud } from './hud';
import { startBlocker } from '../../shared/rules/seats';
import { startBlockerText } from '../../shared/copy';

// Watch view (Requirement 21): room code, the four seats, and the
// interpolated arena. It never asks for motion and sends no gameplay input.

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
  const hud = createHud(null);
  hud.element.hidden = true;

  root.append(
    el(
      'main',
      { className: 'screen test-screen room-watch-screen' },
      el(
        'header',
        { className: 'top-bar' },
        el('h1', { className: 'top-bar-title', text: 'Watching', attrs: { tabindex: '-1' } }),
        el('span', { className: 'room-code-small tabular', text: room.roomState.code }),
        el('div', { className: 'top-bar-actions' }, button(ROOM_COPY.leave, 'btn btn-small', () => ctx.leaveRoom())),
      ),
      list,
      hud.element,
      strip,
      el('div', { className: 'middle' }, arena, waiting),
    ),
  );

  const canvas = createArenaCanvas(arena);
  let rafId = 0;

  function renderSeats(): void {
    const state = room?.roomState;
    if (!state) return;
    for (const s of state.seats) {
      const occupant = s.occupantId === null ? null : state.participants.find((p) => p.id === s.occupantId);
      const row = seatRows[s.seat];
      setText(row.name, occupant?.name ?? '');
      let text = '';
      if (!occupant) text = ROOM_COPY.open;
      else if (!s.connected) text = ROOM_COPY.disconnected;
      else if (s.setup === 'calibrated') text = ROOM_COPY.calibrated;
      setText(row.state, text);
    }
  }

  function frame(nowMs: number): void {
    rafId = requestAnimationFrame(frame);
    if (!room) return;
    const pose = sampleAt(room.buffer, estimateRenderTime(room.buffer, nowMs));
    const running = room.roomState?.activeMatchId != null && pose !== null;
    const snapshot = room.matchState;
    hud.element.hidden = snapshot?.mode !== 'match';
    if (snapshot?.mode === 'match') {
      const time = estimateRenderTime(room.buffer, nowMs);
      canvas.drawMatch(snapshot, { comet: sampleAt(room.buffer, time, 'comet') ?? snapshot.rockets.comet, nova: sampleAt(room.buffer, time, 'nova') ?? snapshot.rockets.nova }, null);
      hud.update(snapshot);
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
    canvas.destroy();
  };
}
