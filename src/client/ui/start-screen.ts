import type { Role } from '../motion/controller';
import type { AppContext } from '../app';
import { el } from './dom';
import { lightningBoltIcon, steeringArrowIcon } from './icons';

// Menu screen: no .test-screen class, so pinch-zoom and scrolling stay allowed.

function roleCard(label: string, subline: string, icon: SVGSVGElement, onPick: () => void): HTMLButtonElement {
  const card = el(
    'button',
    { className: 'role-card', attrs: { type: 'button' } },
    icon,
    el(
      'span',
      { className: 'role-card-text' },
      el('span', { className: 'role-card-label', text: label }),
      el('span', { className: 'role-card-sub', text: subline }),
    ),
  );
  card.addEventListener('click', onPick);
  return card;
}

export function mountStartScreen(root: HTMLElement, ctx: AppContext): () => void {
  const pick = (role: Role) => () => {
    ctx.role = role;
    ctx.setupEntry = 'enable';
    ctx.go('setup');
  };

  root.append(
    el(
      'main',
      { className: 'screen menu-screen start-screen' },
      el('h1', { className: 'screen-title', text: 'Rival Rockets · Sensor test', attrs: { tabindex: '-1' } }),
      el(
        'div',
        { className: 'role-cards' },
        roleCard('Pilot test', 'Tilt to steer', steeringArrowIcon(), pick('pilot')),
        roleCard('Engineer test', 'Shake to charge. Tilt to choose.', lightningBoltIcon(), pick('engineer')),
      ),
    ),
  );
  return () => undefined;
}
