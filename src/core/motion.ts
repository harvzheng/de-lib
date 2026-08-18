/**
 * Reduced-motion preference. Effects must treat `true` as "render one static
 * representative frame", never as "render nothing".
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Fires when the preference flips. Returns the unsubscribe function. */
export function onReducedMotionChange(listener: (reduced: boolean) => void): () => void {
  const query = matchMedia(REDUCED_MOTION_QUERY);
  const handler = (event: MediaQueryListEvent): void => listener(event.matches);
  query.addEventListener('change', handler);
  return (): void => query.removeEventListener('change', handler);
}
