// Keeps the screen on during setup and the sensor tests (PRD 7.11). Several
// screens hold it in turn, so holders are counted and the lock is released
// only when the last one lets go.

let holders = 0;
let sentinel: WakeLockSentinel | null = null;
let pending = false;
let listening = false;

function acquire(): void {
  if (!('wakeLock' in navigator) || sentinel !== null || pending) return;
  if (document.visibilityState !== 'visible') return;
  pending = true;
  navigator.wakeLock.request('screen').then(
    (lock) => {
      pending = false;
      if (holders === 0) {
        void lock.release().catch(() => undefined);
        return;
      }
      sentinel = lock;
      // The browser drops the lock when the page is hidden; forget it so the
      // visibility handler requests a new one.
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
      });
    },
    () => {
      // Best effort: battery saver, unsupported contexts, or a missing user
      // gesture can refuse the lock, and the test still works without it.
      pending = false;
    },
  );
}

function onVisibilityChange(): void {
  if (holders > 0 && document.visibilityState === 'visible') acquire();
}

export function holdWakeLock(): () => void {
  if (!listening) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    listening = true;
  }
  holders += 1;
  acquire();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    // Deferred so a screen change (old screen releases, new one holds in the
    // same task) keeps the current lock instead of dropping and re-requesting.
    setTimeout(() => {
      if (holders > 0 || sentinel === null) return;
      const lock = sentinel;
      sentinel = null;
      void lock.release().catch(() => undefined);
    }, 0);
  };
}
