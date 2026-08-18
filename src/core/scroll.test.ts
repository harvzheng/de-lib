import { describe, expect, test } from 'bun:test';

import { scrollProgress } from './scroll';

/** Element well below the fold: 500px tall, in a 1000px viewport. */
const DEFAULTS = {
  viewportHeight: 1000,
  elementTop: 2000,
  elementHeight: 500,
  start: 1,
  end: 0,
} as const;

describe('scrollProgress with the default window', () => {
  test('is 0 until the element reaches the viewport bottom', () => {
    expect(scrollProgress({ ...DEFAULTS, scrollY: 0 })).toBe(0);
    // startY = 2000 - 1000 = 1000: one pixel short of entry.
    expect(scrollProgress({ ...DEFAULTS, scrollY: 999 })).toBe(0);
    expect(scrollProgress({ ...DEFAULTS, scrollY: 1000 })).toBe(0);
  });

  test('is 1 once the element has fully left the viewport top', () => {
    // endY = 2000 + 500 = 2500.
    expect(scrollProgress({ ...DEFAULTS, scrollY: 2500 })).toBe(1);
    expect(scrollProgress({ ...DEFAULTS, scrollY: 9999 })).toBe(1);
  });

  test('is 0.5 at the geometric midpoint', () => {
    // scrollY 1750 puts the element's centre on the viewport's centre.
    const progress = scrollProgress({ ...DEFAULTS, scrollY: 1750 });
    expect(progress).toBeCloseTo(0.5, 12);

    const rectTop = DEFAULTS.elementTop - 1750;
    expect(rectTop + DEFAULTS.elementHeight / 2).toBe(DEFAULTS.viewportHeight / 2);
  });

  test('rises monotonically across the window', () => {
    let previous = -1;
    for (let scrollY = 0; scrollY <= 3000; scrollY += 10) {
      const progress = scrollProgress({ ...DEFAULTS, scrollY });
      expect(progress).toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
  });
});

describe('scrollProgress pinned (start: 0, end: 1)', () => {
  /** Taller than the viewport, so its own travel is the scrub range. */
  const pinned = {
    viewportHeight: 1000,
    elementTop: 2000,
    elementHeight: 3000,
    start: 0,
    end: 1,
  } as const;

  test('maps the element travel from its top edge to its bottom edge', () => {
    // startY = 2000 (element top at viewport top);
    // endY = 2000 + 3000 - 1000 = 4000 (element bottom at viewport bottom).
    expect(scrollProgress({ ...pinned, scrollY: 1500 })).toBe(0);
    expect(scrollProgress({ ...pinned, scrollY: 2000 })).toBe(0);
    expect(scrollProgress({ ...pinned, scrollY: 3000 })).toBeCloseTo(0.5, 12);
    expect(scrollProgress({ ...pinned, scrollY: 4000 })).toBe(1);
    expect(scrollProgress({ ...pinned, scrollY: 5000 })).toBe(1);
  });

  test('travel spans exactly elementHeight - viewportHeight', () => {
    const travel = pinned.elementHeight - pinned.viewportHeight;
    expect(scrollProgress({ ...pinned, scrollY: pinned.elementTop + travel })).toBe(1);
    expect(scrollProgress({ ...pinned, scrollY: pinned.elementTop + travel - 1 })).toBeLessThan(1);
  });
});

describe('scrollProgress with degenerate geometry', () => {
  test('clamps and never returns NaN for a zero-sized element and viewport', () => {
    const inputs = [
      { scrollY: 0, viewportHeight: 0, elementTop: 0, elementHeight: 0, start: 1, end: 0 },
      { scrollY: 500, viewportHeight: 0, elementTop: 0, elementHeight: 0, start: 1, end: 0 },
      { scrollY: -500, viewportHeight: 0, elementTop: 0, elementHeight: 0, start: 0, end: 1 },
      { scrollY: 0, viewportHeight: 1000, elementTop: 0, elementHeight: 0, start: 1, end: 0 },
      { scrollY: 0, viewportHeight: 0, elementTop: 1000, elementHeight: 0, start: 0, end: 0 },
    ];

    for (const input of inputs) {
      const progress = scrollProgress(input);
      expect(Number.isNaN(progress)).toBe(false);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  test('an inverted window collapses instead of dividing by a negative span', () => {
    // end above start: endY < startY, so the 1px floor keeps the result finite.
    const inverted = {
      viewportHeight: 1000,
      elementTop: 2000,
      elementHeight: 100,
      start: 0,
      end: 1,
    } as const;
    expect(scrollProgress({ ...inverted, scrollY: 1999 })).toBe(0);
    expect(scrollProgress({ ...inverted, scrollY: 2001 })).toBe(1);
  });
});
