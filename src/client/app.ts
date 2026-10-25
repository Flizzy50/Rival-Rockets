import type { Intent, SeatId } from '../shared/protocol';
import {
  createMotionController,
  DEFAULT_MOTION_SETTINGS,
  type MotionController,
  type MotionSample,
  type MotionSettings,
  type OrientationSample,
  type Role,
} from './motion/controller';
import { isPortrait, shouldShowRotateOverlay } from './motion/orientation';
import { clearSession, loadSession, parseRoomParam } from './net/session';
import type { RequestReply } from './net/socket';
import { createRoomContext, seatRole, type RoomContext } from './room-context';
import { detectCapabilities, subscribeSensors, type Capabilities } from './sensors';
import { ROOM_COPY } from './ui/copy';
import { mountControlScreen } from './ui/control-screen';
import { mountEngineerScreen } from './ui/engineer-screen';
import { mountErrorScreen, type ErrorReason } from './ui/error-screen';
import { mountHomeScreen } from './ui/home-screen';
import { mountJoinScreen } from './ui/join-screen';
import { mountLobbyScreen } from './ui/lobby-screen';
import { mountPilotScreen } from './ui/pilot-screen';
import { mountRoomWatchScreen } from './ui/room-watch-screen';
import { createRotateOverlay } from './ui/rotate-overlay';
import { mountSetupScreen } from './ui/setup-screen';
import { mountStartScreen } from './ui/start-screen';
import { mountWatchScreen } from './ui/watch-screen';
import { mountPracticeScreen } from './ui/practice-screen';
import { mountResultsScreen } from './ui/results-screen';
import { screenForPhase } from './flow';

export type ScreenName =
  | 'practice'
  | 'match'
  | 'results'
  // M2 rooms
  | 'home'
  | 'join'
  | 'lobby'
  | 'control'
  | 'room-watch'
  | 'error'
  // M1 sensor test (setup is shared)
  | 'start'
  | 'setup'
  | 'pilot'
  | 'engineer'
  | 'watch';
// Recalibrate re-enters setup at the Calibrate step with sensors still running.
export type SetupEntry = 'enable' | 'calibrate';
export type AnnounceLevel = 'polite' | 'assertive';
export type JoinMode = 'create' | 'join';

export interface SensorListener {
  onOrientation?(sample: OrientationSample): void;
  onMotion?(sample: MotionSample): void;
}

export interface EnterRoomRequest {
  readonly mode: JoinMode;
  readonly name: string;
  readonly code?: string;
  readonly intent: Intent;
}

export interface AppContext {
  readonly practiced: Set<SeatId>;
  role: Role;
  setupEntry: SetupEntry;
  readonly capabilities: Capabilities;
  readonly controller: MotionController;
  // Live tuning values; the debug panel replaces this object, kept in memory only.
  settings: MotionSettings;
  readonly neutralDeg: number | null;
  // True while the rotate overlay is visible.
  readonly blocked: boolean;
  readonly sensorsActive: boolean;
  // M2 room, or null for the M1 sensor test and menus.
  readonly room: RoomContext | null;
  joinMode: JoinMode;
  prefillCode: string | null;
  errorReason: ErrorReason;
  // Connects if needed, then sends create or join. Null when the server is unreachable.
  enterRoom(request: EnterRoomRequest): Promise<RequestReply | null>;
  // Leaves the room on the server and returns to Home.
  leaveRoom(): void;
  // Seat claim succeeded: set the role and open motion setup (Requirement 18.1).
  startSeat(seat: SeatId): void;
  // Fresh controller for the current role; keeps neutral and the blocked state.
  resetController(): void;
  setNeutral(neutralDeg: number): void;
  startSensors(): void;
  stopSensors(): void;
  addSensorListener(listener: SensorListener): () => void;
  orientationType(): string;
  announce(level: AnnounceLevel, text: string): void;
  go(screen: ScreenName): void;
}

export type ScreenMount = (root: HTMLElement, ctx: AppContext) => () => void;

const SCREENS: Record<ScreenName, ScreenMount> = {
  practice: mountPracticeScreen,
  match: mountControlScreen,
  results: mountResultsScreen,
  home: mountHomeScreen,
  join: mountJoinScreen,
  lobby: mountLobbyScreen,
  control: mountControlScreen,
  'room-watch': mountRoomWatchScreen,
  error: mountErrorScreen,
  start: mountStartScreen,
  setup: mountSetupScreen,
  pilot: mountPilotScreen,
  engineer: mountEngineerScreen,
  watch: mountWatchScreen,
};

// Fixed full-height layouts with the gesture lock (PRD 7.11).
const LOCKED_SCREENS: ReadonlySet<ScreenName> = new Set(['pilot', 'engineer', 'control', 'room-watch', 'match']);
// Motion is only read on setup and control screens.
const MOTION_SCREENS: ReadonlySet<ScreenName> = new Set(['setup', 'pilot', 'engineer', 'control', 'practice', 'match', 'lobby']);
// Screens that need a seat; losing it sends the player back to the lobby.
const SEATED_SCREENS: ReadonlySet<ScreenName> = new Set(['setup', 'control', 'practice', 'match']);

export interface LiveRegions {
  readonly polite: HTMLElement;
  readonly assertive: HTMLElement;
}

export function startApp(appRoot: HTMLElement, live: LiveRegions): void {
  const screenRoot = document.createElement('div');
  screenRoot.className = 'screen-root';
  const overlay = createRotateOverlay();
  appRoot.replaceChildren(screenRoot, overlay.element);

  const portraitQuery = window.matchMedia('(orientation: portrait)');
  const coarseQuery = window.matchMedia('(pointer: coarse)');
  const listeners = new Set<SensorListener>();
  let controller = createMotionController('pilot');
  let neutralDeg: number | null = null;
  let blocked = false;
  let unsubscribe: (() => void) | null = null;
  let cleanup: (() => void) | null = null;
  let current: ScreenName = 'home';
  let room: RoomContext | null = null;
  let offRoom: (() => void) | null = null;

  function closeRoom(): void {
    offRoom?.();
    offRoom = null;
    room?.dispose();
    room = null;
  }

  function fail(reason: ErrorReason): void {
    closeRoom();
    clearSession();
    ctx.errorReason = reason;
    ctx.go('error');
  }

  function openRoom(): RoomContext {
    if (room) return room;
    const next = createRoomContext(window.location);
    let hadSeat = false;
    offRoom = next.subscribe((event) => {
      if (event.type === 'room-error') fail(event.reason);
      else if (event.type === 'status') {
        if (event.status === 'reconnecting') ctx.announce('assertive', ROOM_COPY.reconnecting);
        else if (event.status === 'closed') fail('lost');
      } else if (event.type === 'room') {
        // Seat reopened under us (hold expired, released elsewhere): back to the lobby.
        const seated = next.seat !== null;
        if (hadSeat && !seated && SEATED_SCREENS.has(current)) ctx.go('lobby');
        hadSeat = seated;
        if (next.roomState) {
          const own = next.roomState.seats.find((s) => s.seat === next.seat);
          if (seated && own?.setup === 'unverified' && current === 'match' && next.seat) { ctx.startSeat(next.seat); return; }
          const target = screenForPhase(next.roomState.phase, seated, current);
          if (target) ctx.go(target);
        }
      }
    });
    room = next;
    return next;
  }

  const ctx: AppContext = {
    practiced: new Set(),
    role: 'pilot',
    setupEntry: 'enable',
    capabilities: detectCapabilities(),
    get controller() {
      return controller;
    },
    settings: { ...DEFAULT_MOTION_SETTINGS },
    get neutralDeg() {
      return neutralDeg;
    },
    get blocked() {
      return blocked;
    },
    get sensorsActive() {
      return unsubscribe !== null;
    },
    get room() {
      return room;
    },
    joinMode: 'create',
    prefillCode: parseRoomParam(window.location.search),
    errorReason: 'lost',
    async enterRoom(request) {
      const r = openRoom();
      try {
        await r.whenOpen();
      } catch {
        closeRoom();
        return null;
      }
      try {
        return request.mode === 'create'
          ? await r.request({ type: 'room.create', name: request.name })
          : await r.request({ type: 'room.join', code: request.code ?? '', name: request.name, intent: request.intent });
      } catch {
        return null;
      }
    },
    leaveRoom() {
      ctx.practiced.clear();
      const r = room;
      clearSession();
      // Detach first, so a new room made right away gets a fresh connection.
      offRoom?.();
      offRoom = null;
      room = null;
      if (r) {
        // Best effort: closing the socket removes the participant anyway.
        const done = () => r.dispose();
        r.request({ type: 'room.leave' }).then(done, done);
      }
      ctx.go('home');
    },
    startSeat(seat) {
      ctx.practiced.delete(seat);
      ctx.role = seatRole(seat);
      ctx.setupEntry = 'enable';
      ctx.go('setup');
    },
    resetController() {
      // Seated players run in server-authority mode (design M2-11).
      controller = createMotionController(ctx.role, { authority: room?.seat ? 'server' : 'local' });
      if (neutralDeg !== null) controller.setNeutral(neutralDeg);
      controller.setBlocked(blocked);
    },
    setNeutral(deg) {
      neutralDeg = deg;
      controller.setNeutral(deg);
    },
    startSensors() {
      ctx.stopSensors();
      unsubscribe = subscribeSensors({
        onOrientation(sample) {
          controller.handleOrientation(sample, ctx.settings);
          for (const listener of listeners) listener.onOrientation?.(sample);
          if (current === 'lobby') controller.drainEvents();
        },
        onMotion(sample) {
          controller.handleMotion(sample, ctx.settings);
          for (const listener of listeners) listener.onMotion?.(sample);
          if (current === 'lobby') controller.drainEvents();
        },
      });
    },
    stopSensors() {
      unsubscribe?.();
      unsubscribe = null;
    },
    addSensorListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    orientationType() {
      if (ctx.capabilities.screenOrientationApi) return screen.orientation.type;
      return portraitQuery.matches ? 'portrait' : 'landscape';
    },
    announce(level, text) {
      const region = level === 'polite' ? live.polite : live.assertive;
      // Clearing first makes screen readers repeat an identical message.
      region.textContent = '';
      requestAnimationFrame(() => {
        region.textContent = text;
      });
    },
    go(name) {
      cleanup?.();
      cleanup = null;
      screenRoot.replaceChildren();
      current = name;
      if (name === 'match' || name === 'control') ctx.resetController();
      if (!MOTION_SCREENS.has(name)) ctx.stopSensors();
      // Page-level overscroll is locked only on fixed match-style screens, so
      // menu screens keep normal scrolling and pinch-zoom.
      document.documentElement.classList.toggle('in-test', LOCKED_SCREENS.has(name));
      cleanup = SCREENS[name](screenRoot, ctx);
      screenRoot.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    },
  };

  function updateOrientation(): void {
    const portrait = isPortrait({
      type: ctx.capabilities.screenOrientationApi ? screen.orientation.type : null,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    const show = shouldShowRotateOverlay(portrait, coarseQuery.matches);
    if (show === blocked) return;
    blocked = show;
    // Neutral steering and frozen selection while rotated (PRD 7.6).
    controller.setBlocked(blocked);
    screenRoot.inert = blocked;
    overlay.setVisible(blocked);
    if (blocked) ctx.announce('assertive', overlay.text);
    else screenRoot.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }

  // A reload of the same tab reclaims its seat from session storage
  // (Requirement 5.7); motion setup runs again because sensors restart.
  async function resume(): Promise<void> {
    const stored = loadSession();
    if (stored === null) {
      ctx.go('home');
      return;
    }
    const r = openRoom();
    try {
      await r.whenOpen();
      const reply = await r.request({ type: 'seat.reconnect', code: stored.code, seat: stored.seat, token: stored.token });
      if (reply.type === 'session.accepted' && reply.seat !== null) {
        if (r.roomState?.phase === 'results') ctx.go('results');
        else ctx.startSeat(reply.seat);
        return;
      }
    } catch {
      // Fall through to Home.
    }
    closeRoom();
    clearSession();
    ctx.prefillCode = stored.code;
    ctx.go('home');
  }

  if (ctx.capabilities.screenOrientationApi) {
    screen.orientation.addEventListener('change', updateOrientation);
  } else {
    portraitQuery.addEventListener('change', updateOrientation);
  }
  coarseQuery.addEventListener('change', updateOrientation);

  updateOrientation();
  if (ctx.prefillCode !== null && loadSession() === null) {
    // A share link opens straight into the join form (Requirement 3.3).
    ctx.joinMode = 'join';
    ctx.go('join');
  } else {
    void resume();
  }
}
