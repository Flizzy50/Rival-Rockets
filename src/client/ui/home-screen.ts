import type { AppContext } from '../app';
import { ROOM_COPY } from './copy';
import { button, el } from './dom';

// Home (PRD 6, 7.7): wordmark, pitch, Create room and Join room stacked full
// width. The M1 sensor test stays reachable for device checks.
export function mountHomeScreen(root: HTMLElement, ctx: AppContext): () => void {
  const open = (mode: 'create' | 'join') => () => {
    ctx.joinMode = mode;
    ctx.go('join');
  };
  root.append(
    el(
      'main',
      { className: 'screen menu-screen home-screen' },
      el('h1', { className: 'wordmark', text: 'Rival Rockets', attrs: { tabindex: '-1' } }),
      el('p', { className: 'body-text pitch', text: ROOM_COPY.homePitch }),
      el(
        'div',
        { className: 'stack' },
        button(ROOM_COPY.createTitle, 'btn btn-primary btn-block', open('create')),
        button(ROOM_COPY.joinTitle, 'btn btn-secondary btn-block', open('join')),
      ),
      el('p', { className: 'caption', text: ROOM_COPY.homeNote }),
      button(ROOM_COPY.sensorTest, 'btn btn-small btn-link', () => ctx.go('start')),
    ),
  );
  return () => undefined;
}
