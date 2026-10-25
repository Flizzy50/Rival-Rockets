import { CHECKPOINT_POINTS, CORE_POINTS, MAX_CARRIED_CORES } from '../../shared/config';
import type { MatchSnapshotMessage, PublicMatchEvent, TeamId } from '../../shared/protocol';
import { FINAL_WARNING_MS } from '../../shared/tokens';
import { el, replayClass, setText } from './dom';
import { createMuteToggle } from './mute-toggle';

export function formatTimer(remainingMs: number): string {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export interface HudOptions {
  // The phone HUD carries the mute toggle (PRD 7.8); the spectator view has its own.
  readonly mute?: boolean;
}

export interface Hud {
  readonly element: HTMLElement;
  update(snapshot: MatchSnapshotMessage): void;
  // Score pops and pip feedback for one server event (PRD 7.8).
  event(event: PublicMatchEvent): void;
  destroy(): void;
}

// The score floats are decorative copies of a change the score itself shows,
// so they stay out of the accessibility tree.
function float(text: string, tone: 'gain' | 'loss'): HTMLElement {
  return el('span', { className: `score-float score-float-${tone}`, text, attrs: { 'aria-hidden': 'true' } });
}

export function createHud(ownTeam: TeamId | null, options: HudOptions = {}): Hud {
  const timer = el('span', { className: 'match-timer tabular', text: formatTimer(0), attrs: { 'aria-label': 'Time remaining' } });
  function side(team: TeamId) {
    const score = el('strong', { className: 'hud-score tabular', text: '0' });
    const pips = el('span', { className: 'core-pips' });
    const dots = Array.from({ length: MAX_CARRIED_CORES }, () => el('span', { className: 'core-pip', text: '○', attrs: { 'aria-hidden': 'true' } }));
    pips.append(...dots);
    const gain = float('', 'gain');
    const loss = float('', 'loss');
    const element = el('div', { className: `hud-team team-${team}${ownTeam === team ? ' own-team' : ''}` }, el('span', { className: 'hud-label', text: team === 'comet' ? '▲ COMET' : 'NOVA ●' }), score, pips, gain, loss);
    return { element, score, pips, dots, gain, loss, carried: 0 };
  }
  const sides = { comet: side('comet'), nova: side('nova') };
  const mute = options.mute ? createMuteToggle('btn btn-small hud-mute') : null;
  const center = el('div', { className: 'hud-center' }, timer, ...(mute ? [mute.element] : []));
  const element = el('header', { className: 'match-hud' }, sides.comet.element, center, sides.nova.element);
  let lastSecond = '';

  function pop(team: TeamId, text: string, tone: 'gain' | 'loss'): void {
    const s = sides[team];
    const node = tone === 'gain' ? s.gain : s.loss;
    node.textContent = text;
    replayClass(node, 'float');
    replayClass(s.score, tone === 'gain' ? 'pop' : 'loss-flash');
  }

  return {
    element,
    update(snapshot) {
      const time = formatTimer(snapshot.remainingMs);
      setText(timer, time);
      const warning = snapshot.remainingMs <= FINAL_WARNING_MS;
      timer.classList.toggle('final-warning', warning);
      if (lastSecond !== time && warning) replayClass(timer, 'timer-pulse');
      lastSecond = time;
      for (const team of ['comet', 'nova'] as const) {
        const c = snapshot.crews[team], s = sides[team];
        setText(s.score, String(c.score));
        s.pips.setAttribute('aria-label', `${team === 'comet' ? 'Comet' : 'Nova'} cores ${c.carried} of ${MAX_CARRIED_CORES}`);
        s.dots.forEach((dot, i) => {
          setText(dot, i < c.carried ? '●' : '○');
          dot.classList.toggle('is-filled', i < c.carried);
        });
        s.carried = c.carried;
      }
    },
    event(event) {
      if (event.kind === 'gate') pop(event.team, `+${CHECKPOINT_POINTS}`, 'gain');
      else if (event.kind === 'pickup') {
        pop(event.team, `+${CORE_POINTS}`, 'gain');
        // The pips already follow the newest snapshot, which is ahead of the
        // rendered event, so the last filled pip is the one just collected.
        const dot = sides[event.team].dots[Math.max(0, sides[event.team].carried - 1)];
        if (dot) replayClass(dot, 'pop');
      } else if (event.kind === 'drop') {
        pop(event.victim, `−${CORE_POINTS}`, 'loss');
        // The first empty pip is the one just lost.
        const dot = sides[event.victim].dots[Math.min(MAX_CARRIED_CORES - 1, sides[event.victim].carried)];
        if (dot) replayClass(dot, 'loss-flash');
      }
    },
    destroy() {
      mute?.destroy();
    },
  };
}
