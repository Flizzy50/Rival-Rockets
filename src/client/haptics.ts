// Haptics are a bonus (PRD 7.8): the Vibration API is missing on iPhone
// Safari, and every event they mark is also shown on screen.
export function pulse(ms: number): void {
  if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
}
