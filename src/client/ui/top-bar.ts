import type { TeamId } from '../../shared/protocol';
import { TEAM_COMET, TEAM_NOVA } from '../../shared/tokens';
import type { AppContext } from '../app';
import { button, el } from './dom';
import { cometGlyphIcon, novaGlyphIcon } from './icons';

// Team identity is glyph + label + color together, never color alone (PRD 7.4).
export function teamTag(team: TeamId): HTMLElement {
  const info = team === 'comet' ? TEAM_COMET : TEAM_NOVA;
  return el(
    'span',
    { className: `team-tag team-${team}` },
    team === 'comet' ? cometGlyphIcon() : novaGlyphIcon(),
    el('span', { text: info.label }),
  );
}

// Shared header for the sensor test and control screens.
export function createTestTopBar(
  ctx: AppContext,
  title: string,
  debugToggle: HTMLButtonElement,
  team: TeamId = 'comet',
  ...extra: HTMLElement[]
): HTMLElement {
  const recalibrate = button('Recalibrate', 'btn btn-small', () => {
    ctx.setupEntry = 'calibrate';
    ctx.go('setup');
  });
  return el(
    'header',
    { className: 'top-bar' },
    teamTag(team),
    el('h1', { className: 'top-bar-title', text: title, attrs: { tabindex: '-1' } }),
    el('div', { className: 'top-bar-actions' }, ...extra, recalibrate, debugToggle),
  );
}
