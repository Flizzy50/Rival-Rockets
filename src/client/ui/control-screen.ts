import { ABILITY_COST, CHARGE_INTERVAL_MS, CHARGE_ENERGY, MAX_ENERGY, SHARED_COOLDOWN_MS } from '../../shared/config';
import type { RejectReason } from '../../shared/protocol';
import type { AbilityPhase } from '../../shared/rules/abilities';
import type { AppContext } from '../app';
import { cooldownRemainingMs, effectRemainingMs, type CrewView } from '../crew-view';
import type { ControllerEvent } from '../motion/controller';
import { estimateRenderTime, sampleAt } from '../net/interpolate';
import { seatRole, seatTeam, type RoomContext, type RoomEvent } from '../room-context';
import { holdWakeLock } from '../wake-lock';
import { createArenaCanvas } from './arena-canvas';
import { ROOM_COPY } from './copy';
import { createCrewStatus } from './crew-status';
import { createDebugPanel } from './debug-panel';
import { button, el, setText } from './dom';
import { createEngineerPanel, failureText, type EngineerView } from './engineer-panel';
import { controlTestStatus } from './lobby-screen';
import { createPilotPanel } from './pilot-panel';
import { createTestTopBar } from './top-bar';

// Control screen (Requirements 17.9, 19, 20): the Comet Pilot and Engineer
// fly one server-owned rocket. Local feedback lands on the same frame; the
// numbers shown come from the server. Nova seats watch read-only (19.10).

const FAILURE_REASONS: ReadonlySet<RejectReason> = new Set(['cooldown', 'not-enough-energy']);

function phaseOf(view: CrewView, nowMs: number): AbilityPhase {
  if (effectRemainingMs(view, nowMs) > 0) return 'active';
  if (cooldownRemainingMs(view, nowMs) > 0) return 'cooldown';
  if (view.energy < ABILITY_COST) return 'not-enough-energy';
  return 'ready';
}

export function engineerView(view: CrewView, nowMs: number, local: { pendingTarget: EngineerView['pendingTarget']; pendingProgress: number; shakeActive: boolean }): EngineerView {
  const cooldown = cooldownRemainingMs(view, nowMs);
  return {
    energy: view.energy,
    selected: view.selected,
    pendingTarget: local.pendingTarget,
    pendingProgress: local.pendingProgress,
    shakeActive: local.shakeActive,
    phase: phaseOf(view, nowMs),
    activeAbility: view.active,
    effectRemainingMs: effectRemainingMs(view, nowMs),
    cooldownRemainingMs: cooldown,
    cooldownProgress: Math.min(1, Math.max(0, 1 - cooldown / SHARED_COOLDOWN_MS)),
    energyShortfall: Math.max(0, ABILITY_COST - view.energy),
  };
}

function waitingText(room: RoomContext): string {
  if (room.net.status === 'reconnecting') return ROOM_COPY.reconnecting;
  if (room.matchState?.frozen) return ROOM_COPY.frozenNote;
  return room.roomState ? controlTestStatus(room.roomState) : ROOM_COPY.waitingNoTest;
}

export function mountControlScreen(root: HTMLElement, ctx: AppContext): () => void {
  const room = ctx.room;
  const seat = room?.seat ?? null;
  if (!room || seat === null) {
    ctx.go(room ? 'lobby' : 'home');
    return () => undefined;
  }
  const role = seatRole(seat);
  const team = seatTeam(seat);
  const flies = team === 'comet';

  const debug = createDebugPanel(ctx);
  const arena = el('div', { className: 'arena' });
  const strip = el('p', { className: 'control-strip', text: ROOM_COPY.controlTestLabel });
  const waiting = el('p', { className: 'arena-message', attrs: { 'aria-live': 'polite' } });
  const lobbyButton = button('Lobby', 'btn btn-small', () => ctx.go('lobby'));

  const crewStatus = createCrewStatus();
  const pilot = flies && role === 'pilot' ? createPilotPanel(crewStatus.element) : null;
  const engineer = flies && role === 'engineer' ? createEngineerPanel(onActivate, (text) => ctx.announce('assertive', text)) : null;
  const novaPanel = el('section', { className: 'role-panel nova-panel' }, el('p', { className: 'body-text', text: ROOM_COPY.novaNote }));
  const panel = pilot?.element ?? engineer?.element ?? novaPanel;

  root.append(
    el(
      'main',
      { className: `screen test-screen control-screen role-${role}` },
      createTestTopBar(ctx, role === 'pilot' ? 'Pilot' : 'Engineer', debug.toggle, team, lobbyButton),
      strip,
      el('div', { className: 'middle' }, arena, waiting, debug.panel),
      panel,
    ),
  );

  const canvas = createArenaCanvas(arena);
  const releaseWakeLock = holdWakeLock();
  let rafId = 0;
  let lastRenderMs = 0;
  // Local prediction of the server's one-charge-per-second rule, used only to
  // decide whether to show the pop (PRD 7.8: ignored shakes get no pop).
  let lastPopMs = Number.NEGATIVE_INFINITY;

  function onActivate(): void {
    if (!room) return;
    const matchId = room.liveMatchId;
    ctx.controller.requestActivate(performance.now());
    for (const event of ctx.controller.drainEvents()) handleEvent(event, matchId);
    render(performance.now());
  }

  function handleEvent(event: ControllerEvent, matchId: number | null): void {
    if (!room || !engineer) return;
    switch (event.type) {
      case 'charge-requested': {
        if (matchId === null) return;
        room.sendCrewInput('charge', { type: 'input.charge', matchId });
        const crew = room.crew;
        if (crew.energy < MAX_ENERGY && event.timeMs - lastPopMs >= CHARGE_INTERVAL_MS) {
          lastPopMs = event.timeMs;
          engineer.chargePop(Math.min(MAX_ENERGY, crew.energy + CHARGE_ENERGY));
        }
        room.crewEvent({ type: 'charge-predicted' });
        break;
      }
      case 'selection-changed':
        engineer.selectionBump(event.selected);
        if (matchId === null) return;
        if (room.sendCrewInput('select', { type: 'ability.request', matchId, intent: 'select', ability: event.selected }) !== null) {
          room.crewEvent({ type: 'selection-local', ability: event.selected });
        }
        break;
      case 'activate-requested':
        if (matchId === null) return;
        if (room.sendCrewInput('activate', { type: 'ability.request', matchId, intent: 'activate' }) !== null) {
          room.crewEvent({ type: 'activate-pressed' });
        }
        break;
      default:
        break;
    }
  }

  function onRoomEvent(event: RoomEvent): void {
    if (event.type !== 'ack' || !engineer || !room) return;
    const { ack, kind } = event;
    if (kind !== 'activate') return;
    if (ack.status === 'applied') {
      engineer.pressed();
    } else if (FAILURE_REASONS.has(ack.reason)) {
      // The M1 copy for 1.5 s, timed from the server's numbers (Requirement 19.6).
      const reason = ack.reason as 'cooldown' | 'not-enough-energy';
      engineer.showFailure(failureText(reason, ack.crew?.cooldownRemainingMs ?? 0));
    }
  }
  const offRoom = room.subscribe(onRoomEvent);

  function render(timeMs: number): void {
    if (!room) return;
    const nowMs = Math.max(timeMs, lastRenderMs);
    lastRenderMs = nowMs;
    const matchId = room.liveMatchId;
    for (const event of ctx.controller.drainEvents()) handleEvent(event, matchId);
    const snap = ctx.controller.snapshot(nowMs);

    // Pilot steering at the throttled rate; blocked already reads 0 (19.7).
    if (pilot && matchId !== null) room.net.steer(matchId, snap.steering);

    // Keep the local selection on the server's choice unless a change is in flight.
    if (engineer && room.crew.synced && room.crew.selectPending === null) ctx.controller.syncSelection(room.crew.selected);

    const renderSessionMs = estimateRenderTime(room.buffer, nowMs);
    const pose = sampleAt(room.buffer, renderSessionMs);
    const running = room.roomState?.activeMatchId != null && pose !== null;
    if (running) {
      const crew = room.crew;
      canvas.drawPose(pose, { active: crew.active, effectRemainingMs: effectRemainingMs(crew, nowMs) });
      room.recordRender(renderSessionMs, nowMs);
    } else {
      canvas.drawEmpty();
    }
    const message = running && !room.matchState?.frozen && room.net.status === 'open' ? '' : waitingText(room);
    setText(waiting, message);
    waiting.hidden = message === '';
    strip.hidden = !running;

    pilot?.update({ ...snap, deadZoneDeg: ctx.settings.deadZoneDeg, fullScaleDeg: ctx.settings.fullScaleDeg });
    crewStatus.update(room.crew, nowMs);
    engineer?.update(engineerView(room.crew, nowMs, snap));
    debug.update(snap, nowMs);
  }

  function frame(nowMs: number): void {
    rafId = requestAnimationFrame(frame);
    render(nowMs);
  }
  rafId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafId);
    offRoom();
    pilot?.destroy();
    engineer?.destroy();
    canvas.destroy();
    debug.destroy();
    releaseWakeLock();
  };
}
