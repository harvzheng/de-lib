/**
 * The pack's only animation loop. Every effect subscribes here instead of
 * calling `requestAnimationFrame`, so N effects on a page cost one frame
 * callback and share a single timestamp.
 */

export type TickListener = (now: number, deltaMs: number) => void;

/** A backgrounded tab resumes with a huge gap; clamping keeps simulations sane. */
const MAX_DELTA_MS = 100;
const FIRST_DELTA_MS = 16.7;

const listeners = new Set<TickListener>();

let handle = 0;
let ticking = false;
let previous = 0;

function tick(now: number): void {
  handle = 0;
  ticking = true;

  const deltaMs = previous === 0 ? FIRST_DELTA_MS : Math.min(now - previous, MAX_DELTA_MS);
  previous = now;

  // Snapshot: a listener may unsubscribe itself or a sibling mid-tick.
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    if (listeners.has(listener)) listener(now, deltaMs);
  }

  ticking = false;
  if (listeners.size > 0) handle = requestAnimationFrame(tick);
  else previous = 0;
}

/**
 * Subscribes to the single shared rAF loop; loop starts on the first subscriber
 * and stops when the last unsubscribes. Returns the unsubscribe function.
 */
export function onTick(listener: TickListener): () => void {
  listeners.add(listener);
  // While `ticking`, the frame's tail schedules the next one for us.
  if (handle === 0 && !ticking) handle = requestAnimationFrame(tick);

  return (): void => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    if (handle !== 0) {
      cancelAnimationFrame(handle);
      handle = 0;
    }
    previous = 0;
  };
}
