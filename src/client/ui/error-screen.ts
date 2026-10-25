import type { AppContext } from '../app';
import { roomErrorCopy } from './copy';
import { button, el } from './dom';

// Full-screen error card (PRD 7.7 Errors): what happened, what to do next,
// and Create room / Join room.

export type ErrorReason = 'room-expired' | 'server-closing' | 'lost' | 'connect-failed';

const TITLES: Record<ErrorReason, string> = {
  'room-expired': 'Room expired',
  'server-closing': 'Game restarted',
  lost: 'Connection lost',
  'connect-failed': "Can't connect",
};

export function mountErrorScreen(root: HTMLElement, ctx: AppContext): () => void {
  const open = (mode: 'create' | 'join') => () => {
    ctx.joinMode = mode;
    ctx.go('join');
  };
  root.append(
    el(
      'main',
      { className: 'screen menu-screen error-screen' },
      el(
        'section',
        { className: 'failure-card stack' },
        el('h1', { className: 'screen-title', text: TITLES[ctx.errorReason], attrs: { tabindex: '-1' } }),
        el('p', { className: 'body-text', text: roomErrorCopy(ctx.errorReason) }),
        el(
          'div',
          { className: 'stack' },
          button('Create room', 'btn btn-primary btn-block', open('create')),
          button('Join room', 'btn btn-secondary btn-block', open('join')),
        ),
      ),
    ),
  );
  return () => undefined;
}
