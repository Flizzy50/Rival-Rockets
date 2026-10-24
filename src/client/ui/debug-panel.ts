import { DEBUG_RANGES, EVENT_RATE_WINDOW_MS } from '../../shared/config';
import type { AppContext } from '../app';
import type { MotionSettings, MotionSnapshot } from '../motion/controller';
import { button, el, setText } from './dom';

// Developer-only panel for tuning on real phones (labels are exempt from the
// PRD copy table). Tuning values live in memory only. Only event timestamps
// are kept, for the Hz readout; raw samples are neither stored nor sent, and
// Copy readings summarises settings and rates, never sample streams (PRD 10).

type TuningKey = keyof typeof DEBUG_RANGES;

const TUNING: readonly { key: TuningKey; label: string; unit: string }[] = [
  { key: 'deadZoneDeg', label: 'Dead zone', unit: '°' },
  { key: 'smoothingTauMs', label: 'Smoothing tau', unit: ' ms' },
  { key: 'fullScaleDeg', label: 'Full-scale tilt', unit: '°' },
  { key: 'shakeThresholdMps2', label: 'Shake threshold', unit: ' m/s²' },
];

const MS_PER_S = 1000;
const PANEL_ID_PREFIX = 'debug-panel-';
let panelCount = 0;

export interface DebugPanel {
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  update(snap: MotionSnapshot, nowMs: number): void;
  destroy(): void;
}

function fixed(value: number | null, digits: number): string {
  return value === null ? '–' : value.toFixed(digits);
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function rateHz(times: number[], nowMs: number): number {
  while (times.length > 0 && (times[0] ?? nowMs) < nowMs - EVENT_RATE_WINDOW_MS) times.shift();
  return (times.length * MS_PER_S) / EVENT_RATE_WINDOW_MS;
}

function formatSetting(settings: MotionSettings, key: TuningKey, unit: string): string {
  return `${settings[key]}${unit}`;
}

export function createDebugPanel(ctx: AppContext): DebugPanel {
  panelCount += 1;
  const panelId = `${PANEL_ID_PREFIX}${panelCount}`;
  const orientationTimes: number[] = [];
  const motionTimes: number[] = [];
  let orientationHz = 0;
  let motionHz = 0;

  const removeListener = ctx.addSensorListener({
    onOrientation(sample) {
      orientationTimes.push(sample.timeMs);
    },
    onMotion(sample) {
      motionTimes.push(sample.timeMs);
    },
  });

  const list = el('dl', { className: 'debug-values' });
  function row(label: string): HTMLElement {
    const value = el('dd', { className: 'tabular' });
    list.append(el('dt', { text: label }), value);
    return value;
  }
  const rawBeta = row('Raw beta');
  const rawGamma = row('Raw gamma');
  const accel = row('Accel magnitude');
  const accelSource = row('Accel source');
  const relGamma = row('Smoothed rel. gamma');
  const steering = row('Steering');
  const shakes = row('Shake gestures');
  const orientationRate = row('Orientation rate');
  const motionRate = row('Motion rate');
  const orientationType = row('Screen orientation');
  const caps = ctx.capabilities;
  row('Orientation permission API').textContent = yesNo(caps.orientationPermissionApi);
  row('Motion permission API').textContent = yesNo(caps.motionPermissionApi);
  row('Secure context').textContent = yesNo(caps.secureContext);
  row('User agent').textContent = navigator.userAgent;

  const sliders = TUNING.map(({ key, label, unit }) => {
    const range = DEBUG_RANGES[key];
    const id = `${panelId}-${key}`;
    const output = el('output', { className: 'tabular', attrs: { for: id } });
    const input = el('input', {
      attrs: {
        id,
        type: 'range',
        min: String(range.min),
        max: String(range.max),
        step: String(range.step),
      },
    });
    input.value = String(ctx.settings[key]);
    output.textContent = formatSetting(ctx.settings, key, unit);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      ctx.settings = { ...ctx.settings, [key]: value };
      output.textContent = formatSetting(ctx.settings, key, unit);
    });
    return el(
      'div',
      { className: 'debug-slider' },
      el('label', { text: label, attrs: { for: id } }),
      input,
      output,
    );
  });

  const copyStatus = el('p', { className: 'debug-copy-status', attrs: { role: 'status' } });
  const fallback = el('textarea', { className: 'debug-copy-fallback', attrs: { readonly: '', rows: '8' } });
  fallback.hidden = true;

  function summary(): string {
    const s = ctx.settings;
    return [
      'Rival Rockets sensor test readings',
      `Time: ${new Date().toISOString()}`,
      `Role: ${ctx.role}`,
      `Settings: ${TUNING.map(({ key, label, unit }) => `${label} ${formatSetting(s, key, unit)}`).join(', ')}`,
      `Neutral: ${fixed(ctx.neutralDeg, 1)}°`,
      `Rates: orientation ${orientationHz.toFixed(0)} Hz, motion ${motionHz.toFixed(0)} Hz`,
      `Screen orientation: ${ctx.orientationType()}`,
      `APIs: orientation permission ${yesNo(caps.orientationPermissionApi)}, motion permission ${yesNo(
        caps.motionPermissionApi,
      )}, secure context ${yesNo(caps.secureContext)}, vibrate ${yesNo(caps.vibrate)}, wake lock ${yesNo(
        caps.wakeLock,
      )}`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n');
  }

  function showFallback(text: string): void {
    fallback.value = text;
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    copyStatus.textContent = 'Copy the text below.';
  }

  const copyButton = button('Copy readings', 'btn btn-secondary', () => {
    const text = summary();
    if (!navigator.clipboard?.writeText) {
      showFallback(text);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        fallback.hidden = true;
        copyStatus.textContent = 'Copied.';
      },
      () => showFallback(text),
    );
  });

  const panel = el(
    'aside',
    { className: 'debug-panel', attrs: { id: panelId, 'aria-label': 'Debug' } },
    list,
    ...sliders,
    copyButton,
    copyStatus,
    fallback,
  );
  panel.hidden = true;

  const toggle = button('Debug', 'btn btn-small', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panelId);

  return {
    toggle,
    panel,
    update(snap, nowMs) {
      // Rates are tracked even while hidden so they are ready when opened.
      orientationHz = rateHz(orientationTimes, nowMs);
      motionHz = rateHz(motionTimes, nowMs);
      if (panel.hidden) return;
      setText(rawBeta, `${fixed(snap.rawBeta, 1)}°`);
      setText(rawGamma, `${fixed(snap.rawGamma, 1)}°`);
      setText(accel, `${fixed(snap.magnitude, 2)} m/s²`);
      setText(accelSource, snap.magnitudeSource ?? '–');
      setText(relGamma, `${snap.smoothedRelDeg.toFixed(1)}°`);
      setText(steering, snap.steering.toFixed(2));
      setText(shakes, String(snap.shakeCount));
      setText(orientationRate, `${orientationHz.toFixed(0)} Hz`);
      setText(motionRate, `${motionHz.toFixed(0)} Hz`);
      setText(orientationType, ctx.orientationType());
    },
    destroy() {
      removeListener();
    },
  };
}
