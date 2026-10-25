import { MAX_CARRIED_CORES } from '../../shared/config';
import type { MatchSnapshotMessage, TeamId } from '../../shared/protocol';
import { FINAL_WARNING_MS } from '../../shared/tokens';
import { el, replayClass, setText } from './dom';

export function formatTimer(remainingMs: number): string {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function createHud(ownTeam: TeamId | null) {
  const timer = el('span', { className: 'match-timer tabular', text: formatTimer(0), attrs: { 'aria-label': 'Time remaining' } });
  function side(team: TeamId) {
    const score = el('strong', { className: 'hud-score tabular', text: '0' });
    const pips = el('span', { className: 'core-pips' });
    const dots = Array.from({ length: MAX_CARRIED_CORES }, () => el('span', { text: '○', attrs: { 'aria-hidden': 'true' } }));
    pips.append(...dots);
    const element = el('div', { className: `hud-team team-${team}${ownTeam === team ? ' own-team' : ''}` }, el('span', { className: 'hud-label', text: team === 'comet' ? '▲ COMET' : 'NOVA ●' }), score, pips);
    return { element, score, pips, dots };
  }
  const sides = { comet: side('comet'), nova: side('nova') };
  const element = el('header', { className: 'match-hud' }, sides.comet.element, timer, sides.nova.element);
  let lastSecond = '';
  return { element, update(snapshot: MatchSnapshotMessage) {
    const time = formatTimer(snapshot.remainingMs);
    setText(timer, time);
    timer.classList.toggle('final-warning', snapshot.remainingMs <= FINAL_WARNING_MS);
    if (lastSecond !== time && snapshot.remainingMs <= FINAL_WARNING_MS) replayClass(timer, 'timer-pulse');
    lastSecond = time;
    for (const team of ['comet', 'nova'] as const) {
      const c = snapshot.crews[team], s = sides[team];
      setText(s.score, String(c.score));
      s.pips.setAttribute('aria-label', `${team === 'comet' ? 'Comet' : 'Nova'} cores ${c.carried} of ${MAX_CARRIED_CORES}`);
      s.dots.forEach((dot, i) => setText(dot, i < c.carried ? '●' : '○'));
    }
  } };
}
