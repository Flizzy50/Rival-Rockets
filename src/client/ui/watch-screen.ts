import type { AppContext } from '../app';
import { button, el } from './dom';

// Placeholder until the M2 spectator view exists; Watch instead lands here.
export function mountWatchScreen(root: HTMLElement, ctx: AppContext): () => void {
  root.append(
    el(
      'main',
      { className: 'screen menu-screen watch-screen' },
      el('h1', { className: 'screen-title', text: 'Watch', attrs: { tabindex: '-1' } }),
      el('p', { className: 'body-text', text: 'Watching starts once rooms are ready. Reload to try motion again.' }),
      button('Back', 'btn btn-secondary', () => ctx.go('start')),
    ),
  );
  return () => undefined;
}
