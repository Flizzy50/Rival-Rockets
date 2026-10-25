import { ABILITY_COST, ABILITY_DURATION_MS, CHARGE_ENERGY, CHECKPOINT_POINTS, CORE_POINTS, SHARED_COOLDOWN_MS } from './config.js';
import type { PublicScoreBreakdown, StartBlocker } from './protocol.js';

export function pilotTutorial(): string { return `Tilt to steer. Cross the glowing gate, then the next one. Each gate earns ${CHECKPOINT_POINTS}. Grab cores for ${CORE_POINTS} each. Your gate points stay, even if you lose a core.`; }
export function engineerTutorial(): string { return `Shake to charge ${CHARGE_ENERGY}. Boost starts selected. Tilt left and hold for Boost; tilt right and hold for Shield. Tap Activate to spend ${ABILITY_COST}. Boost and Shield last ${ABILITY_DURATION_MS / 1000} seconds and share a ${SHARED_COOLDOWN_MS / 1000}-second cooldown. A boosted hit can drop one core; Shield blocks the drop.`; }
export function gatesLine(b: PublicScoreBreakdown): string { return `Gates: ${b.crossings} × ${CHECKPOINT_POINTS} = ${b.checkpointPoints}`; }
export function coresLine(b: PublicScoreBreakdown): string { return `Cores held: ${b.carried} × ${CORE_POINTS} = ${b.corePoints}`; }
export const RESULTS_NOTE = 'Gate points stay. Core points reflect what you hold at the finish.';
export function seatLabel(seat: string): string { return seat.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
export function startBlockerText(b: StartBlocker): string { return `Waiting for ${seatLabel(b.seat)} to ${b.step === 'ready' ? 'get ready' : b.step}`; }
