import { createCalibration, updateCalibration, type CalibrationState } from '../motion/calibration';
import { readingsTimedOut } from '../motion/sensor-check';
import { EVENT_BURST_MAX_MS, HAPTIC_SHAKE_MS } from '../../shared/tokens';
import type { AppContext } from '../app';
import { pulse } from '../haptics';
import { requestMotionPermission } from '../sensors';
import { holdWakeLock } from '../wake-lock';
import { button, el, replayClass, setText, setVar } from './dom';
import { seatName } from './copy';
import { checkIcon, progressRing } from './icons';

// Motion setup (PRD 6, 7.7; AC3): Enable -> Check -> Calibrate. Setup only
// completes through the sensor-check and calibration rules on real readings;
// a granted permission or simulated input never finishes it.

type Phase = 'enable' | 'requesting' | 'check' | 'calibrate' | 'denied' | 'no-readings';

const STEP_LABELS = ['Enable', 'Check', 'Calibrate'] as const;

const COPY = {
  denied: "Motion access was blocked. Reload the page and choose Allow. If it's still blocked, check your browser's motion settings.",
  noReadings: "We're not getting motion data from this phone.",
  calibrate: "Hold your phone how you'll play, then tap Set neutral",
  pilotHint: 'Tilt to steer',
  engineerHint: 'Shake to charge. Tilt to choose.',
  shakeOnce: 'Shake once',
  motionWorking: 'Motion working',
  holdSteady: 'Hold steady',
  neutralSet: 'Neutral set',
} as const;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function stepIndex(phase: Phase): number {
  if (phase === 'check' || phase === 'no-readings') return 1;
  if (phase === 'calibrate') return 2;
  return 0;
}

export function mountSetupScreen(root: HTMLElement, ctx: AppContext): () => void {
  const role = ctx.role;
  // Seated in a room: report progress to the server and fly next (Requirement 18).
  const room = ctx.room?.seat ? ctx.room : null;
  const seat = room?.seat ?? null;

  // Only progress is ever reported; denial and missing data leave the seat
  // unverified on the server (Requirement 18.4).
  function report(status: 'readings' | 'calibrated'): void {
    room?.request({ type: 'setup.update', status }).catch(() => undefined);
  }

  function watchInstead(): void {
    if (!room) {
      ctx.go('watch');
      return;
    }
    // Requirement 18.5: give up the seat and watch.
    room.request({ type: 'room.watch' }).then(
      () => ctx.go('room-watch'),
      () => ctx.go('lobby'),
    );
  }
  const recalibrating = ctx.setupEntry === 'calibrate' && ctx.sensorsActive;
  let phase: Phase = 'enable';
  let disposed = false;
  let rafId = 0;
  let navTimer: ReturnType<typeof setTimeout> | undefined;
  let releaseWakeLock: (() => void) | null = null;
  let readingsStartMs = 0;
  let shakeShown = false;
  let calibration: CalibrationState | null = null;
  let calibrated = false;

  // Step indicator: position is marked with aria-current and a check icon,
  // not by color alone.
  const steps = STEP_LABELS.map((label, index) =>
    el(
      'li',
      { className: 'step' },
      el('span', { className: 'step-marker' }, el('span', { className: 'step-number', text: String(index + 1) }), checkIcon()),
      el('span', { className: 'step-label', text: label }),
    ),
  );
  const stepList = el('ol', { className: 'steps' }, ...steps);

  // Enable
  const enableButton = button('Enable motion', 'btn btn-primary', onEnableTap);
  const enablePanel = el('section', { className: 'setup-panel' }, enableButton);

  // Check
  const tiltDot = el('span', { className: 'tilt-dot' });
  const tiltTrack = el('div', { className: 'tilt-track', attrs: { 'aria-hidden': 'true' } }, tiltDot);
  const shakeItem = el(
    'p',
    { className: 'shake-once' },
    el('span', { className: 'shake-once-marker' }, checkIcon()),
    el('span', { text: COPY.shakeOnce }),
  );
  const checkPanel = el(
    'section',
    { className: 'setup-panel' },
    tiltTrack,
    el('p', { className: 'body-text hint', text: role === 'pilot' ? COPY.pilotHint : COPY.engineerHint }),
  );
  if (role === 'engineer') checkPanel.append(shakeItem);

  // Calibrate
  const motionWorking = el(
    'p',
    { className: 'status-line is-success' },
    checkIcon(),
    el('span', { text: COPY.motionWorking }),
  );
  motionWorking.hidden = recalibrating;
  const ring = progressRing('calibration-ring');
  ring.classList.add('is-idle');
  const calibrationStatus = el('p', { className: 'calibration-status' });
  const setNeutralButton = button('Set neutral', 'btn btn-primary', onSetNeutral);
  const calibratePanel = el(
    'section',
    { className: 'setup-panel' },
    motionWorking,
    el('p', { className: 'body-text', text: COPY.calibrate }),
    el('div', { className: 'calibration-hold' }, ring, calibrationStatus),
    setNeutralButton,
  );

  // Failure card (Denied / No readings)
  const failureText = el('p', { className: 'body-text' });
  const tryAgainButton = button('Try again', 'btn btn-primary', onEnableTap);
  const failurePanel = el(
    'section',
    { className: 'setup-panel failure-card' },
    failureText,
    el(
      'div',
      { className: 'button-row' },
      tryAgainButton,
      button('Watch instead', 'btn btn-secondary', watchInstead),
    ),
  );

  const panels: Record<Phase, HTMLElement> = {
    enable: enablePanel,
    requesting: enablePanel,
    check: checkPanel,
    calibrate: calibratePanel,
    denied: failurePanel,
    'no-readings': failurePanel,
  };

  root.append(
    el(
      'main',
      { className: 'screen menu-screen setup-screen' },
      el('h1', { className: 'screen-title', text: 'Motion setup', attrs: { tabindex: '-1' } }),
      el('p', {
        className: 'caption',
        text: seat !== null ? seatName(seat) : role === 'pilot' ? 'Pilot test' : 'Engineer test',
      }),
      stepList,
      enablePanel,
      checkPanel,
      calibratePanel,
      failurePanel,
    ),
  );

  function setPhase(next: Phase): void {
    phase = next;
    const current = stepIndex(next);
    steps.forEach((step, index) => {
      step.classList.toggle('is-current', index === current);
      step.classList.toggle('is-complete', index < current);
      if (index === current) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    const visible = panels[next];
    for (const panel of [enablePanel, checkPanel, calibratePanel, failurePanel]) panel.hidden = panel !== visible;
    enableButton.disabled = next === 'requesting';
  }

  function fail(kind: 'denied' | 'no-readings'): void {
    ctx.stopSensors();
    const text = kind === 'denied' ? COPY.denied : COPY.noReadings;
    failureText.textContent = text;
    setPhase(kind);
    ctx.announce('assertive', text);
    tryAgainButton.focus();
  }

  // Shared by Enable motion and Try again so a retry also comes from a tap.
  function onEnableTap(): void {
    const permission = requestMotionPermission();
    releaseWakeLock ??= holdWakeLock();
    setPhase('requesting');
    void permission.then((result) => {
      if (disposed) return;
      if (result === 'denied') {
        fail('denied');
        return;
      }
      // A fresh controller so checks from an earlier attempt never carry over.
      ctx.resetController();
      ctx.startSensors();
      readingsStartMs = performance.now();
      shakeShown = false;
      shakeItem.classList.remove('is-done', 'pop');
      setPhase('check');
    });
  }

  function onSetNeutral(): void {
    if (calibrated) return;
    calibration = createCalibration();
    ring.classList.remove('is-idle');
    setVar(ring, '--progress', 0);
    setText(calibrationStatus, '');
  }

  function finishCalibration(neutralDeg: number): void {
    calibrated = true;
    ctx.setNeutral(neutralDeg);
    // The practice shake charged the setup controller; the test starts from
    // a fresh one at the initial energy. Recalibrate keeps the running test.
    if (!recalibrating) ctx.resetController();
    calibrationStatus.classList.add('is-success');
    setText(calibrationStatus, COPY.neutralSet);
    ctx.announce('polite', COPY.neutralSet);
    // Leaves the filled ring and "Neutral set" visible for one event burst.
    report('calibrated');
    navTimer = setTimeout(() => ctx.go(room ? 'control' : role), EVENT_BURST_MAX_MS);
  }

  const removeListener = ctx.addSensorListener({
    onOrientation(sample) {
      if (phase !== 'calibrate' || calibration === null || calibrated) return;
      if (ctx.blocked) {
        // Gamma is meaningless while rotated, so the hold starts over.
        calibration = createCalibration();
        setVar(ring, '--progress', 0);
        return;
      }
      const out = updateCalibration(calibration, sample.gamma, sample.timeMs);
      calibration = out.state;
      setVar(ring, '--progress', out.progress);
      if (out.status === 'restarted') setText(calibrationStatus, COPY.holdSteady);
      if (out.status === 'done' && out.neutralDeg !== null) finishCalibration(out.neutralDeg);
    },
  });

  function frame(nowMs: number): void {
    rafId = requestAnimationFrame(frame);
    // Practice charges do not matter here; draining keeps the queue empty.
    ctx.controller.drainEvents();
    if (phase !== 'check') return;
    if (ctx.blocked) {
      // Rotated readings don't count: hold the check and restart the
      // no-readings window so it can't expire under the overlay.
      readingsStartMs = nowMs;
      return;
    }
    const snap = ctx.controller.snapshot(nowMs);
    const received = snap.checks.orientationReceived && (role === 'pilot' || snap.checks.accelerationSeen);
    if (readingsTimedOut(readingsStartMs, nowMs, received)) {
      fail('no-readings');
      return;
    }
    setVar(tiltDot, '--tilt', clampUnit(snap.smoothedRelDeg / ctx.settings.fullScaleDeg));
    if (role === 'engineer' && snap.checks.shakeDetected && !shakeShown) {
      shakeShown = true;
      shakeItem.classList.add('is-done');
      replayClass(shakeItem, 'pop');
      pulse(HAPTIC_SHAKE_MS);
    }
    if (snap.checks.passed) {
      report('readings');
      ctx.announce('polite', COPY.motionWorking);
      setPhase('calibrate');
    }
  }

  if (recalibrating) {
    releaseWakeLock = holdWakeLock();
    setPhase('calibrate');
  } else {
    setPhase('enable');
  }
  rafId = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    clearTimeout(navTimer);
    removeListener();
    releaseWakeLock?.();
  };
}
