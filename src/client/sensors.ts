import type { MotionSample, OrientationSample } from './motion/controller';
import type { Vec3 } from './motion/shake';

// Browser motion adapter. Events are converted into plain samples and handed
// straight to in-memory listeners; nothing is stored or sent (PRD 10).
// In portrait, left/right roll is deviceorientation gamma (PRD 5). Axis signs
// and grip comfort differ between devices and must be verified on real
// iPhone and Android phones, not in a simulator.

export interface Capabilities {
  readonly orientationEvent: boolean;
  readonly motionEvent: boolean;
  readonly orientationPermissionApi: boolean;
  readonly motionPermissionApi: boolean;
  readonly secureContext: boolean;
  readonly vibrate: boolean;
  readonly wakeLock: boolean;
  readonly screenOrientationApi: boolean;
}

export type MotionPermissionResult = 'granted' | 'denied' | 'not-required';

// iOS Safari adds a static requestPermission() to both event constructors;
// lib.dom does not declare it, so it is typed locally.
interface PermissionRequestingConstructor {
  requestPermission?: () => Promise<string>;
}

function orientationConstructor(): PermissionRequestingConstructor | null {
  return typeof DeviceOrientationEvent === 'undefined'
    ? null
    : (DeviceOrientationEvent as unknown as PermissionRequestingConstructor);
}

function motionConstructor(): PermissionRequestingConstructor | null {
  return typeof DeviceMotionEvent === 'undefined'
    ? null
    : (DeviceMotionEvent as unknown as PermissionRequestingConstructor);
}

function hasRequestPermission(ctor: PermissionRequestingConstructor | null): boolean {
  return ctor !== null && typeof ctor.requestPermission === 'function';
}

export function detectCapabilities(): Capabilities {
  const orientation = orientationConstructor();
  const motion = motionConstructor();
  return {
    orientationEvent: orientation !== null,
    motionEvent: motion !== null,
    orientationPermissionApi: hasRequestPermission(orientation),
    motionPermissionApi: hasRequestPermission(motion),
    secureContext: window.isSecureContext,
    vibrate: typeof navigator.vibrate === 'function',
    wakeLock: 'wakeLock' in navigator,
    screenOrientationApi: typeof screen !== 'undefined' && 'orientation' in screen,
  };
}

// Must be called directly from the tap handler. Both requestPermission calls
// run synchronously, before any await, because iOS rejects a request that is
// no longer inside the user gesture. Both roles ask for both permissions so
// iOS shows a single prompt.
export function requestMotionPermission(): Promise<MotionPermissionResult> {
  const requests: Promise<string>[] = [];
  try {
    const orientation = orientationConstructor();
    const motion = motionConstructor();
    if (orientation?.requestPermission) requests.push(orientation.requestPermission());
    if (motion?.requestPermission) requests.push(motion.requestPermission());
  } catch {
    return Promise.resolve('denied');
  }
  if (requests.length === 0) return Promise.resolve('not-required');
  return Promise.all(requests).then(
    (results) => (results.every((result) => result === 'granted') ? 'granted' : 'denied'),
    // A rejection (for example a request outside a gesture) is treated as
    // Denied so setup shows the recovery card instead of hanging.
    () => 'denied' as const,
  );
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface Vec3Like {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

function toVec3(value: Vec3Like | null | undefined): Vec3 | null {
  if (!value) return null;
  return { x: finiteOrNull(value.x), y: finiteOrNull(value.y), z: finiteOrNull(value.z) };
}

export function toOrientationSample(
  event: Pick<DeviceOrientationEvent, 'gamma' | 'beta' | 'timeStamp'>,
): OrientationSample {
  return { gamma: finiteOrNull(event.gamma), beta: finiteOrNull(event.beta), timeMs: event.timeStamp };
}

export function toMotionSample(
  event: Pick<DeviceMotionEvent, 'acceleration' | 'accelerationIncludingGravity' | 'timeStamp'>,
): MotionSample {
  return {
    acceleration: toVec3(event.acceleration),
    accelerationIncludingGravity: toVec3(event.accelerationIncludingGravity),
    timeMs: event.timeStamp,
  };
}

export interface SensorHandlers {
  onOrientation(sample: OrientationSample): void;
  onMotion(sample: MotionSample): void;
}

// event.timeStamp shares performance.now()'s time origin, so sample times and
// rAF frame times can be compared directly.
export function subscribeSensors(handlers: SensorHandlers): () => void {
  const onOrientation = (event: DeviceOrientationEvent): void => {
    handlers.onOrientation(toOrientationSample(event));
  };
  const onMotion = (event: DeviceMotionEvent): void => {
    handlers.onMotion(toMotionSample(event));
  };
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  return () => {
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('devicemotion', onMotion);
  };
}
