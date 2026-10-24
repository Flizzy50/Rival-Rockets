import { TEAM_COMET } from '../../shared/tokens';
import type { AppContext } from '../app';
import { button, el } from './dom';
import { cometGlyphIcon } from './icons';

// Shared header for both test screens. Team identity is glyph + label +
// color together, never color alone (PRD 7.4).
export function createTestTopBar(ctx: AppContext, title: string, debugToggle: HTMLButtonElement): HTMLElement {
  const recalibrate = button('Recalibrate', 'btn btn-small', () => {
    ctx.setupEntry = 'calibrate';
    ctx.go('setup');
  });
  return el(
    'header',
    { className: 'top-bar' },
    el('span', { className: 'team-tag' }, cometGlyphIcon(), el('span', { text: TEAM_COMET.label })),
    el('h1', { className: 'top-bar-title', text: title, attrs: { tabindex: '-1' } }),
    el('div', { className: 'top-bar-actions' }, recalibrate, debugToggle),
  );
}
