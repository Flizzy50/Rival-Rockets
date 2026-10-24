import {
  applyCharge,
  createCrewAbilityState,
  getAbilityStatus,
  requestActivation,
  type Ability,
  type AbilityStatus,
  type ActivationResult,
} from '../../shared/rules/abilities';
import { createSelection, updateSelection, type SelectionState } from './selection';
import { createTiltCheck, isEngineerCheckPassed, updateTiltCheck } from './sensor-check';
import {
  createShakeDetector,
  DEFAULT_SHAKE_SETTINGS,
  hasUsableAcceleration,
  isShakeActive,
  updateShake,
  type ShakeSettings,
  type ShakeSource,
  type Vec3,
} from './shake';
import { createTiltState, DEFAULT_TILT_SETTINGS, updateTilt, type TiltSettings } from './tilt';

// Combines the pure motion modules for one phone. This is the only place raw
// samples are held, in memory only; nothing here is stored or sent (PRD 10).
// No browser APIs: sensors.ts converts events into these samples.

export type Role = 'pilot' | 'engineer';

export interface OrientationSample {
  readonly gamma: number | null;
  readonly beta: number | null;
  readonly timeMs: number;
}

export interface MotionSample {
  readonly acceleration: Vec3 | null;
  readonly accelerationIncludingGravity: Vec3 | null;
  readonly timeMs: number;
}

// One object so the debug panel can pass live slider values to both handlers.
export type MotionSettings = TiltSettings & ShakeSettings;

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  ...DEFAULT_TILT_SETTINGS,
  ...DEFAULT_SHAKE_SETTINGS,
};

export type ControllerEvent =
  | { readonly type: 'charge-accepted'; readonly timeMs: number; readonly energy: number }
  | { readonly type: 'charge-ignored'; readonly timeMs: number; readonly reason: 'rate-limited' | 'full' }
  | { readonly type: 'selection-changed'; readonly timeMs: number; readonly selected: Ability }
  | {
      readonly type: 'activation-failed';
      readonly timeMs: number;
      readonly ability: Ability;
      readonly reason: 'not-enough-energy' | 'cooldown';
      readonly cooldownRemainingMs: number;
      readonly energyShortfall: number;
    }
  | { readonly type: 'activated'; readonly timeMs: number; readonly ability: Ability };

export interface SensorChecks {
  // A finite gamma has arrived; null-only events do not count (AC3).
  readonly orientationReceived: boolean;
  readonly tiltPassed: boolean;
  readonly accelerationSeen: boolean;
  readonly shakeDetected: boolean;
  // Role-specific: Pilot needs tilt; Engineer also needs acceleration and a shake.
  readonly passed: boolean;
}

export interface MotionSnapshot {
  readonly role: Role;
  readonly neutralDeg: number | null;
  readonly rawBeta: number | null;
  readonly rawGamma: number | null;
  readonly smoothedRelDeg: number;
  readonly steering: number;
  readonly magnitude: number | null;
  readonly magnitudeSource: ShakeSource | null;
  readonly shakeActive: boolean;
  readonly shakeCount: number;
  readonly blocked: boolean;
  readonly selected: Ability;
  readonly pendingTarget: Ability | null;
  readonly pendingProgress: number;
  readonly selectionLocked: boolean;
  readonly energy: number;
  readonly ability: AbilityStatus;
  readonly checks: SensorChecks;
}

export interface MotionController {
  handleOrientation(sample: OrientationSample, settings?: MotionSettings): void;
  handleMotion(sample: MotionSample, settings?: MotionSettings): void;
  setNeutral(neutralDeg: number): void;
  setBlocked(blocked: boolean): void;
  activate(nowMs: number): ActivationResult;
  snapshot(nowMs: number): MotionSnapshot;
  drainEvents(): ControllerEvent[];
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

export function createMotionController(role: Role): MotionController {
  let neutralDeg: number | null = null;
  let tilt = createTiltState();
  let smoothedRelDeg = 0;
  let steering = 0;
  let rawBeta: number | null = null;
  let rawGamma: number | null = null;

  let tiltCheck = createTiltCheck();
  let tiltPassed = false;
  let orientationReceived = false;
  let accelerationSeen = false;
  let shakeDetected = false;

  let shake = createShakeDetector();
  let shakeSettings: ShakeSettings = DEFAULT_SHAKE_SETTINGS;
  let magnitude: number | null = null;
  let magnitudeSource: ShakeSource | null = null;
  let shakeCount = 0;

  let selection: SelectionState = createSelection();
  let pendingProgress = 0;
  let crew = createCrewAbilityState();
  let blocked = false;
  let events: ControllerEvent[] = [];

  function runSelection(nowMs: number): void {
    const out = updateSelection(selection, {
      smoothedRelDeg,
      shakeActive: isShakeActive(shake, nowMs, shakeSettings),
      blocked,
      nowMs,
    });
    selection = out.state;
    pendingProgress = out.progress;
    if (out.changed) events.push({ type: 'selection-changed', timeMs: nowMs, selected: out.state.selected });
  }

  function clearPendingSelection(): void {
    selection = { selected: selection.selected, pendingTarget: null, pendingSinceMs: null };
    pendingProgress = 0;
  }

  return {
    handleOrientation(sample, settings = DEFAULT_MOTION_SETTINGS) {
      shakeSettings = settings;
      rawBeta = finiteOrNull(sample.beta);
      rawGamma = finiteOrNull(sample.gamma);
      if (rawGamma !== null) orientationReceived = true;

      // Before calibration, neutral 0 lets the setup Check step show live tilt.
      const out = updateTilt(tilt, sample.gamma, neutralDeg ?? 0, sample.timeMs, settings);
      tilt = out.state;
      smoothedRelDeg = out.smoothedRelDeg;
      steering = out.steering;

      const check = updateTiltCheck(tiltCheck, sample.gamma);
      tiltCheck = check.state;
      tiltPassed = check.passed;

      if (role === 'engineer') runSelection(sample.timeMs);
    },

    handleMotion(sample, settings = DEFAULT_MOTION_SETTINGS) {
      shakeSettings = settings;
      if (hasUsableAcceleration(sample)) accelerationSeen = true;
      const out = updateShake(shake, sample, settings);
      shake = out.state;
      magnitude = out.magnitude;
      magnitudeSource = out.source;

      // Drop a pending hold on the same frame the shake starts, not on the
      // next orientation event, so the panel never shows a stale ring.
      if (role === 'engineer' && out.shakeActive) runSelection(sample.timeMs);

      if (!out.gesture) return;
      shakeCount += 1;
      shakeDetected = true;
      if (role !== 'engineer') return;
      const charge = applyCharge(crew, sample.timeMs);
      crew = charge.state;
      if (charge.result === 'accepted') {
        events.push({ type: 'charge-accepted', timeMs: sample.timeMs, energy: crew.energy });
      } else {
        events.push({ type: 'charge-ignored', timeMs: sample.timeMs, reason: charge.result });
      }
    },

    setNeutral(deg) {
      neutralDeg = deg;
      // Smoothing state is relative to the old neutral; snap on the next sample.
      tilt = createTiltState();
    },

    setBlocked(value) {
      blocked = value;
      if (blocked) clearPendingSelection();
    },

    activate(nowMs) {
      const ability = selection.selected;
      const out = requestActivation(crew, ability, nowMs);
      crew = out.state;
      if (out.result === 'activated') {
        events.push({ type: 'activated', timeMs: nowMs, ability });
      } else {
        const status = getAbilityStatus(crew, nowMs);
        events.push({
          type: 'activation-failed',
          timeMs: nowMs,
          ability,
          reason: out.result,
          cooldownRemainingMs: status.cooldownRemainingMs,
          energyShortfall: status.energyShortfall,
        });
      }
      return out.result;
    },

    snapshot(nowMs) {
      const shakeActive = isShakeActive(shake, nowMs, shakeSettings);
      const selectionLocked = shakeActive || blocked;
      return {
        role,
        neutralDeg,
        rawBeta,
        rawGamma,
        smoothedRelDeg,
        // While the rotate overlay is up, gamma no longer means left/right.
        steering: blocked ? 0 : steering,
        magnitude,
        magnitudeSource,
        shakeActive,
        shakeCount,
        blocked,
        selected: selection.selected,
        pendingTarget: selectionLocked ? null : selection.pendingTarget,
        pendingProgress: selectionLocked ? 0 : pendingProgress,
        selectionLocked,
        energy: crew.energy,
        ability: getAbilityStatus(crew, nowMs),
        checks: {
          orientationReceived,
          tiltPassed,
          accelerationSeen,
          shakeDetected,
          passed:
            role === 'pilot' ? tiltPassed : isEngineerCheckPassed({ tiltPassed, accelerationSeen, shakeDetected }),
        },
      };
    },

    drainEvents() {
      const drained = events;
      events = [];
      return drained;
    },
  };
}
