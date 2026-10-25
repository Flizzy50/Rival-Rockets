import { isMuted, onMuteChange, setMuted, unlockAudio } from '../audio';
import { el } from './dom';
import { soundIcon } from './icons';

// Mute toggle (PRD 7.8). The tap also unlocks audio, so a player who skipped
// sound on the Enable motion tap, or a watcher, can turn it on here.
export function createMuteToggle(className: string): { element: HTMLButtonElement; destroy(): void } {
  const element = el('button', { className, attrs: { type: 'button', 'aria-label': 'Mute sound' } });
  function render(muted: boolean): void {
    element.setAttribute('aria-pressed', String(muted));
    element.replaceChildren(soundIcon(!muted));
  }
  element.addEventListener('click', () => {
    unlockAudio();
    setMuted(!isMuted());
  });
  render(isMuted());
  const off = onMuteChange(render);
  return { element, destroy: off };
}
