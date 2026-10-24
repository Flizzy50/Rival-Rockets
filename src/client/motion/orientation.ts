// Portrait detection for the "Turn your phone upright" overlay (PRD 7.4).

export interface ViewportInfo {
  // screen.orientation.type when the browser provides it.
  readonly type?: string | null;
  readonly width: number;
  readonly height: number;
}

export function isPortrait({ type, width, height }: ViewportInfo): boolean {
  // The reported type wins because the viewport can be briefly stale or
  // squeezed by the keyboard during a rotation.
  if (typeof type === 'string') {
    if (type.startsWith('portrait')) return true;
    if (type.startsWith('landscape')) return false;
  }
  return width <= height;
}

// Only touch phones get the overlay, so desktop dev browsers stay usable.
export function shouldShowRotateOverlay(portrait: boolean, coarsePointer: boolean): boolean {
  return coarsePointer && !portrait;
}
