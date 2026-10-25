import { coresLine, gatesLine, RESULTS_NOTE } from '../../shared/copy';
import type { AppContext } from '../app';
import { button, el } from './dom';
import { teamTag } from './top-bar';
import { rocketSilhouette } from './icons';

export function mountResultsScreen(root: HTMLElement, ctx: AppContext): () => void {
  const result = ctx.room?.roomState?.result;
  if (!result) { ctx.go('lobby'); return () => undefined; }
  const headline = result.winner === null ? 'DRAW' : `${result.winner.toUpperCase()} WINS`;
  const title = el('h1', { className: `screen-title${result.winner ? ` team-${result.winner}` : ''}`, text: headline, attrs: { tabindex: '-1', 'aria-live': 'polite' } });
  if (result.winner) title.prepend(rocketSilhouette(result.winner));
  const cards = (['comet', 'nova'] as const).map((team) => {
    const score = result.teams[team];
    return el('section', { className: `result-card team-${team}` }, rocketSilhouette(team), teamTag(team), el('p', { className: 'tabular', text: gatesLine(score) }), el('p', { className: 'tabular', text: coresLine(score) }), el('strong', { className: 'result-total tabular', text: `Total: ${score.total}` }));
  });
  root.append(el('main', { className: 'screen menu-screen results-screen' }, title, ...cards, el('p', { className: 'body-text', text: RESULTS_NOTE }), button('Leave room', 'btn btn-primary', () => ctx.leaveRoom())));
  ctx.announce('polite', headline);
  return () => undefined;
}
