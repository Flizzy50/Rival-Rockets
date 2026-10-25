import { INTERPOLATION_DELAY_MS, SNAPSHOT_BUFFER_SIZE } from '../../shared/config';
import type { PublicPose, TeamId } from '../../shared/protocol';

// Interpolator (Requirement 20, PRD 9). Pure: the screen passes the local
// clock in. Renders slightly in the past so there is usually a snapshot on
// each side of the render time.

export interface Snapshot {
  readonly matchId: number;
  readonly sessionMs: number;
  readonly poses: Readonly<Partial<Record<TeamId, PublicPose>>>;
  readonly receivedAtMs: number;
}

export interface SnapshotBuffer {
  readonly snapshots: readonly Snapshot[];
}

const TWO_PI = 2 * Math.PI;

export function createBuffer(): SnapshotBuffer {
  return { snapshots: [] };
}

function shortestDelta(from: number, to: number): number {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

export function interpolatePose(a: PublicPose, b: PublicPose, t: number): PublicPose {
  const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  if (k === 0) return a;
  if (k === 1) return b;
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    heading: a.heading + shortestDelta(a.heading, b.heading) * k,
  };
}

// A new match drops the old match's snapshots: session time restarts at 0.
// Out-of-order or duplicate snapshots are ignored.
export function pushSnapshot(buf: SnapshotBuffer, s: Snapshot): SnapshotBuffer {
  const sameMatch = buf.snapshots.filter((x) => x.matchId === s.matchId);
  const newest = sameMatch[sameMatch.length - 1];
  if (newest && s.sessionMs <= newest.sessionMs) return sameMatch.length === buf.snapshots.length ? buf : { snapshots: sameMatch };
  const snapshots = [...sameMatch, s];
  if (snapshots.length > SNAPSHOT_BUFFER_SIZE) snapshots.splice(0, snapshots.length - SNAPSHOT_BUFFER_SIZE);
  return { snapshots };
}

export function newestSnapshot(buf: SnapshotBuffer): Snapshot | null {
  return buf.snapshots[buf.snapshots.length - 1] ?? null;
}

export function sampleAt(buf: SnapshotBuffer, renderSessionMs: number, team: TeamId = 'comet'): PublicPose | null {
  const list = buf.snapshots;
  const first = list[0];
  const last = list[list.length - 1];
  if (!first || !last) return null;
  if (renderSessionMs <= first.sessionMs) return first.poses[team] ?? null;
  // Past the newest data: hold rather than extrapolate (Requirement 20.4).
  if (renderSessionMs >= last.sessionMs) return last.poses[team] ?? null;
  for (let i = 1; i < list.length; i += 1) {
    const b = list[i] as Snapshot;
    if (b.sessionMs < renderSessionMs) continue;
    const a = list[i - 1] as Snapshot;
    const from = a.poses[team], to = b.poses[team];
    return from && to ? interpolatePose(from, to, (renderSessionMs - a.sessionMs) / (b.sessionMs - a.sessionMs)) : to ?? from ?? null;
  }
  return last.poses[team] ?? null;
}

// The smallest receipt-minus-session offset tracks the least-delayed snapshot,
// so jitter on later snapshots never pushes the render time ahead of data.
export function estimateRenderTime(buf: SnapshotBuffer, localNowMs: number): number {
  let minOffset = Number.POSITIVE_INFINITY;
  for (const s of buf.snapshots) minOffset = Math.min(minOffset, s.receivedAtMs - s.sessionMs);
  if (!Number.isFinite(minOffset)) return 0;
  return localNowMs - minOffset - INTERPOLATION_DELAY_MS;
}
