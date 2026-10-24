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
import { detectCapabilities, subscribeSensors, type Capabilities } from './sensors';
import { mountEngineerScreen } from './ui/engineer-screen';
import { mountPilotScreen } from './ui/pilot-screen';
import { createRotateOverlay } from './ui/rotate-overlay';
import { mountSetupScreen } from './ui/setup-screen';
import { mountStartScreen } from './ui/start-screen';
import { mountWatchScreen } from './ui/watch-screen';

export type ScreenName = 'start' | 'setup' | 'pilot' | 'engineer' | 'watch';
// Recalibrate re-enters setup at the Calibrate step with sensors still running.
export type SetupEntry = 'enable' | 'calibrate';
export type AnnounceLevel = 'polite' | 'assertive';

export interface SensorListener {
  onOrientation?(sample: OrientationSample): void;
  onMotion?(sample: MotionSample): void;
}

export interface AppContext {
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
  start: mountStartScreen,
  setup: mountSetupScreen,
  pilot: mountPilotScreen,
  engineer: mountEngineerScreen,
  watch: mountWatchScreen,
};

const TEST_SCREENS: ReadonlySet<ScreenName> = new Set(['pilot', 'engineer']);

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

  const ctx: AppContext = {
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
    resetController() {
      controller = createMotionController(ctx.role);
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
        },
        onMotion(sample) {
          controller.handleMotion(sample, ctx.settings);
          for (const listener of listeners) listener.onMotion?.(sample);
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
      // Motion is only read on setup and test screens.
      if (name === 'start' || name === 'watch') ctx.stopSensors();
      // Page-level overscroll is locked only while a test screen is mounted, so
      // menu screens keep normal scrolling and pinch-zoom.
      document.documentElement.classList.toggle('in-test', TEST_SCREENS.has(name));
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

  if (ctx.capabilities.screenOrientationApi) {
    screen.orientation.addEventListener('change', updateOrientation);
  } else {
    portraitQuery.addEventListener('change', updateOrientation);
  }
  coarseQuery.addEventListener('change', updateOrientation);

  ctx.go('start');
  updateOrientation();
}
