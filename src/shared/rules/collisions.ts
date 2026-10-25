import { BUMP_DISPLACEMENT, ROCKET_RADIUS, SHIELD_BUMP_MULTIPLIER } from '../config.js';
import type { TeamId } from '../protocol.js';
import type { RocketPose } from './physics.js';

export function resolveContact(bodies: Record<TeamId, RocketPose>, wasInContact: boolean, shielded: Record<TeamId, boolean>) {
  const { comet, nova } = bodies;
  const dx = nova.x - comet.x, dy = nova.y - comet.y;
  const distance = Math.hypot(dx, dy);
  const overlapping = distance < ROCKET_RADIUS * 2;
  const bumped = overlapping && !wasInContact;
  if (!overlapping) return { comet, nova, overlapping, bumped, impact: null };
  const nx = distance === 0 ? 1 : dx / distance, ny = distance === 0 ? 0 : dy / distance;
  const displacement = (team: TeamId) => (ROCKET_RADIUS * 2 - distance) / 2
    + (bumped ? BUMP_DISPLACEMENT * (shielded[team] ? SHIELD_BUMP_MULTIPLIER : 1) : 0);
  return {
    comet: { ...comet, x: comet.x - nx * displacement('comet'), y: comet.y - ny * displacement('comet') },
    nova: { ...nova, x: nova.x + nx * displacement('nova'), y: nova.y + ny * displacement('nova') },
    overlapping, bumped, impact: { x: (comet.x + nova.x) / 2, y: (comet.y + nova.y) / 2 },
  };
}
export function ramOutcome(boosting: boolean, used: boolean, shielded: boolean, carried: number): 'drop' | 'blocked' | 'none' {
  if (!boosting || used) return 'none';
  return shielded ? 'blocked' : carried > 0 ? 'drop' : 'none';
}
