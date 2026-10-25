import { CORE_PICKUP_RADIUS, CORE_SPAWNS, COURSE_CORE_RESPAWN_MS, MAX_CARRIED_CORES } from '../config.js';
import type { Vec } from '../course.js';
import type { TeamId } from '../protocol.js';

export interface CourseCoreState { readonly spawn: number; readonly respawnAtMs: number | null }
export interface DroppedCoreState extends Vec {
  readonly id: number; readonly owner: TeamId; readonly createdTick: number;
  readonly ownerUnlockAtMs: number; readonly expiresAtMs: number;
}
export function createCourseCores(): CourseCoreState[] { return CORE_SPAWNS.map((_, spawn) => ({ spawn, respawnAtMs: null })); }
export function expireAndRespawn(course: readonly CourseCoreState[], dropped: readonly DroppedCoreState[], nowMs: number) {
  return {
    course: course.map((c) => c.respawnAtMs !== null && c.respawnAtMs <= nowMs ? { ...c, respawnAtMs: null } : c),
    dropped: dropped.filter((c) => nowMs < c.expiresAtMs),
  };
}
export function contactTime(from: Vec, to: Vec, core: Vec, radius: number): number | null {
  const x = from.x - core.x, y = from.y - core.y, dx = to.x - from.x, dy = to.y - from.y;
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = x * dx + y * dy;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}
export interface PickupInput {
  readonly paths: Record<TeamId, { from: Vec; to: Vec }>;
  readonly carried: Record<TeamId, number>;
  readonly course: readonly CourseCoreState[]; readonly dropped: readonly DroppedCoreState[];
  readonly tick: number; readonly nowMs: number;
}
export function resolvePickups(input: PickupInput) {
  const carried = { ...input.carried };
  const course = [...input.course];
  const removed = new Set<number>();
  const settled = new Set<string>();
  const events: { key: string; kind: 'course' | 'dropped'; index: number; team: TeamId; t: number }[] = [];
  function candidate(kind: 'course' | 'dropped', index: number, position: Vec, owner: TeamId | null = null) {
    for (const team of ['comet', 'nova'] as const) {
      if (team === owner) continue;
      const path = input.paths[team];
      const t = contactTime(path.from, path.to, position, CORE_PICKUP_RADIUS);
      if (t !== null) events.push({ key: `${kind}/${index}`, kind, index, team, t });
    }
  }
  course.forEach((c, i) => { const p = CORE_SPAWNS[c.spawn]; if (c.respawnAtMs === null && p) candidate('course', i, p); });
  input.dropped.forEach((c, i) => {
    if (c.createdTick < input.tick && input.nowMs < c.expiresAtMs) candidate('dropped', i, c, input.nowMs < c.ownerUnlockAtMs ? c.owner : null);
  });
  events.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
  // Where each pickup happened, in contact order, for presentation events only.
  const collected: { team: TeamId; x: number; y: number }[] = [];
  for (const event of events) {
    if (settled.has(event.key) || carried[event.team] >= MAX_CARRIED_CORES) continue;
    const tied = events.some((e) => e.key === event.key && e.t === event.t && e.team !== event.team && carried[e.team] < MAX_CARRIED_CORES);
    settled.add(event.key);
    if (tied) continue;
    carried[event.team] += 1;
    if (event.kind === 'course') {
      const core = course[event.index];
      if (core) course[event.index] = { ...core, respawnAtMs: input.nowMs + COURSE_CORE_RESPAWN_MS };
      const p = core ? CORE_SPAWNS[core.spawn] : undefined;
      if (p) collected.push({ team: event.team, x: p.x, y: p.y });
    } else {
      removed.add(event.index);
      const c = input.dropped[event.index];
      if (c) collected.push({ team: event.team, x: c.x, y: c.y });
    }
  }
  return { carried, course, dropped: input.dropped.filter((_, i) => !removed.has(i)), collected };
}
