/**
 * Scroll scrubbing. Scroll and resize events only mark the subscription dirty;
 * the `getBoundingClientRect` read happens inside the shared rAF tick, so N
 * scroll-driven effects cause at most one layout flush per frame.
 */

import { clamp01 } from './math';
import { onTick } from './raf';

export interface ScrollProgressOptions {
  /** Viewport fraction the element's TOP edge sits at when progress = 0. Default 1 (viewport bottom). */
  start?: number;
  /** Viewport fraction the element's BOTTOM edge sits at when progress = 1. Default 0 (viewport top). */
  end?: number;
}

export interface ScrollProgressInput {
  scrollY: number;
  viewportHeight: number;
  /** Document-space top of the element (`rect.top + scrollY`). */
  elementTop: number;
  elementHeight: number;
  start: number;
  end: number;
}

/**
 * Pure mapping, exported for tests. The `max(..., 1)` floor keeps degenerate
 * geometry (zero-height element in a zero-height viewport) finite.
 */
export function scrollProgress(input: ScrollProgressInput): number {
  const startY = input.elementTop - input.viewportHeight * input.start;
  const endY = input.elementTop + input.elementHeight - input.viewportHeight * input.end;
  return clamp01((input.scrollY - startY) / Math.max(endY - startY, 1));
}

/**
 * Reports clamped 0..1 progress once immediately, then on scroll/resize
 * (coalesced through the shared rAF tick). Returns the unsubscribe function.
 */
export function onScrollProgress(
  element: Element,
  listener: (progress: number) => void,
  options: ScrollProgressOptions = {},
): () => void {
  const start = options.start ?? 1;
  const end = options.end ?? 0;

  let dirty = false;
  let reported = -1;

  const measure = (): void => {
    dirty = false;
    const rect = element.getBoundingClientRect();
    const scrollY = window.scrollY;
    const progress = scrollProgress({
      scrollY,
      viewportHeight: window.innerHeight,
      elementTop: rect.top + scrollY,
      elementHeight: rect.height,
      start,
      end,
    });
    if (progress === reported) return;
    reported = progress;
    listener(progress);
  };

  const invalidate = (): void => {
    dirty = true;
  };

  const stopTick = onTick(() => {
    if (dirty) measure();
  });

  window.addEventListener('scroll', invalidate, { passive: true });
  window.addEventListener('resize', invalidate);
  measure();

  return (): void => {
    stopTick();
    window.removeEventListener('scroll', invalidate);
    window.removeEventListener('resize', invalidate);
  };
}
