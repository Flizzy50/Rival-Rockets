import { el } from './dom';

// Full-screen prompt shown when a phone turns landscape (PRD 7.6). The app
// blocks steering and selection while it is visible; this module only renders.

const TEXT = 'Turn your phone upright';

export interface RotateOverlay {
  readonly element: HTMLElement;
  readonly text: string;
  setVisible(visible: boolean): void;
}

export function createRotateOverlay(): RotateOverlay {
  const message = el('p', { className: 'rotate-text', text: TEXT, attrs: { id: 'rotate-text' } });
  const element = el(
    'div',
    {
      className: 'rotate-overlay',
      attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'rotate-text', tabindex: '-1' },
    },
    message,
  );
  element.hidden = true;
  return {
    element,
    text: TEXT,
    setVisible(visible) {
      element.hidden = !visible;
      if (visible) element.focus({ preventScroll: true });
    },
  };
}
