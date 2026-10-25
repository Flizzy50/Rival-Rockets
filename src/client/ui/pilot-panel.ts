import { HINT_DURATION_MS } from '../../shared/tokens';
import { el, setVar } from './dom';

// Pilot tilt gauge (PRD 7.6), shared by the M1 sensor test and the M2 control
// screen. The caller feeds it the controller snapshot each frame, so the
// needle moves on the same frame as the tilt (Requirement 19.1).

export interface PilotGaugeView {
  readonly steering: number;
  readonly smoothedRelDeg: number;
  readonly blocked: boolean;
  readonly deadZoneDeg: number;
  readonly fullScaleDeg: number;
}

export interface PilotPanel {
  readonly element: HTMLElement;
  update(view: PilotGaugeView): void;
  destroy(): void;
}

// The gauge axis is tilt over full scale, so the band is exactly the dead
// zone and the ends are maximum turn. Outside the band the needle is placed
// from steering; inside it shows the wobble that steering ignores.
export function needlePosition(view: PilotGaugeView): { band: number; position: number } {
  const { deadZoneDeg, fullScaleDeg } = view;
  const band = fullScaleDeg > 0 ? Math.min(1, Math.max(0, deadZoneDeg / fullScaleDeg)) : 0;
  let position: number;
  if (view.steering !== 0) {
    position = Math.sign(view.steering) * (band + Math.abs(view.steering) * (1 - band));
  } else if (view.blocked || fullScaleDeg <= 0) {
    position = 0;
  } else {
    position = Math.min(band, Math.max(-band, view.smoothedRelDeg / fullScaleDeg));
  }
  return { band, position };
}

// `extra` lets the control screen add the crew status row under the gauge.
export function createPilotPanel(...extra: Node[]): PilotPanel {
  const deadZone = el('div', { className: 'gauge-dead-zone' });
  const needle = el('div', { className: 'gauge-needle' });
  const gauge = el(
    'div',
    { className: 'gauge', attrs: { 'aria-hidden': 'true' } },
    el('span', { className: 'gauge-side', text: 'L' }),
    el(
      'div',
      { className: 'gauge-track' },
      deadZone,
      el('div', { className: 'gauge-end gauge-end-left' }),
      el('div', { className: 'gauge-end gauge-end-right' }),
      needle,
    ),
    el('span', { className: 'gauge-side', text: 'R' }),
  );
  const hint = el('p', { className: 'panel-hint', text: 'Tilt to steer' });
  const element = el('section', { className: 'role-panel pilot-panel' }, gauge, ...extra, hint);
  // The hint shows for the first five seconds only (PRD 7.6).
  const hintTimer = setTimeout(() => {
    hint.hidden = true;
  }, HINT_DURATION_MS);

  return {
    element,
    update(view) {
      const { band, position } = needlePosition(view);
      setVar(deadZone, '--band', band);
      setVar(needle, '--needle', position);
    },
    destroy() {
      clearTimeout(hintTimer);
    },
  };
}
