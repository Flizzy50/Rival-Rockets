import { PRACTICE_RINGS, PRACTICE_START_ENERGY } from '../../shared/config';
import { engineerTutorial, pilotTutorial } from '../../shared/copy';
import { createCrewAbilityState } from '../../shared/rules/abilities';
import type { AppContext } from '../app';
import { createMotionController } from '../motion/controller';
import { createPilotPractice, reduceEngineerPractice, stepPilotPractice, type EngineerPractice } from '../practice';
import { seatTeam } from '../room-context';
import { holdWakeLock } from '../wake-lock';
import { createArenaCanvas } from './arena-canvas';
import { button, el, setText } from './dom';
import { createEngineerPanel, failureText } from './engineer-panel';

export function mountPracticeScreen(root: HTMLElement, ctx: AppContext): () => void {
  const seat = ctx.room?.seat;
  if (!seat) { ctx.go('lobby'); return () => undefined; }
  // This controller has no network path; even Activate spends practice energy only.
  const local = createMotionController(ctx.role, { initialCrew: { ...createCrewAbilityState(), energy: PRACTICE_START_ENERGY } });
  local.setNeutral(ctx.neutralDeg ?? 0);
  const off = ctx.addSensorListener({ onOrientation: (s) => { local.setBlocked(ctx.blocked); local.handleOrientation(s, ctx.settings); }, onMotion: (s) => { local.setBlocked(ctx.blocked); local.handleMotion(s, ctx.settings); } });
  if (!ctx.sensorsActive) ctx.startSensors();
  let pilot = createPilotPractice(seatTeam(seat));
  let engineer: EngineerPractice = { charges: 0, step: 'charge', firstSuccess: false };
  let complete = false;
  function finish(): void { ctx.practiced.add(seat!); ctx.resetController(); ctx.go('lobby'); }
  const progress = el('p', { className: 'status-line', attrs: { 'aria-live': 'polite' } });
  const skip = button('Skip', 'btn btn-secondary', finish);
  skip.hidden = true;
  const done = button('Done', 'btn btn-primary', finish);
  done.hidden = true;
  const arena = el('div', { className: 'practice-arena' });
  const panel = ctx.role === 'engineer' ? createEngineerPanel(() => { local.setBlocked(ctx.blocked); local.activate(performance.now()); render(performance.now()); }, (text) => ctx.announce('assertive', text)) : null;
  root.append(el('main', { className: 'screen menu-screen practice-screen' },
    el('h1', { className: 'screen-title', text: 'PRACTICE', attrs: { tabindex: '-1' } }),
    el('p', { className: 'body-text', text: ctx.role === 'pilot' ? pilotTutorial() : engineerTutorial() }),
    progress, panel?.element ?? arena, el('div', { className: 'button-row' }, skip, done)));
  const canvas = panel ? null : createArenaCanvas(arena);
  const releaseWakeLock = holdWakeLock();
  let previous = performance.now(), raf = 0;
  function render(now: number): void {
    local.setBlocked(ctx.blocked);
    ctx.controller.drainEvents();
    for (const event of local.drainEvents()) {
      engineer = reduceEngineerPractice(engineer, event);
      if (event.type === 'charge-accepted') panel?.chargePop(event.energy);
      if (event.type === 'activation-failed') panel?.showFailure(failureText(event.reason, event.cooldownRemainingMs));
      if (event.type === 'activated') panel?.pressed();
    }
    const snap = local.snapshot(now);
    if (panel) {
      // Selecting Shield before the last charge still satisfies the checklist.
      if (engineer.step === 'select-shield' && snap.selected === 'shield') engineer = reduceEngineerPractice(engineer, { type: 'selection-changed', selected: 'shield', timeMs: now });
      panel.update({ ...snap, ...snap.ability });
      setText(progress, engineer.step === 'charge' ? 'Shake to fill two energy segments' : engineer.step === 'select-shield' ? 'Tilt right and hold for Shield' : engineer.step === 'activate' ? 'Tap Activate' : 'Ready to fly');
      complete = engineer.step === 'done';
    } else {
      if (!ctx.blocked && !complete) pilot = stepPilotPractice(pilot, snap.steering, now, now - previous);
      canvas?.drawPractice(pilot.rocket.pose, pilot.ringsDone);
      setText(progress, `Rings: ${pilot.ringsDone} / ${PRACTICE_RINGS.length}`);
      complete = pilot.ringsDone === PRACTICE_RINGS.length;
    }
    previous = now;
    const success = panel ? engineer.firstSuccess : pilot.firstSuccess;
    if (success) ctx.practiced.add(seat!);
    skip.hidden = !success || complete;
    done.hidden = !complete;
  }
  function frame(now: number): void { raf = requestAnimationFrame(frame); render(now); }
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); off(); panel?.destroy(); canvas?.destroy(); releaseWakeLock(); };
}
