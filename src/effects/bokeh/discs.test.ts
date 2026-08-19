import { describe, expect, test } from 'bun:test';

import { createDiscs, discState } from './discs';
import type { DiscFieldOptions, DiscStateOptions } from './discs';
import type { Highlight } from './highlights';

const ANCHORS: Highlight[] = [
  { x: 0.2, y: 0.3, weight: 1, color: [255, 220, 180] },
  { x: 0.8, y: 0.65, weight: 0.4, color: [180, 210, 255] },
];

const FIELD: DiscFieldOptions = {
  count: 24,
  size: 0.16,
  variance: 0.55,
  tints: 4,
  seed: 3,
  anchors: [],
  follow: 0.9,
  tintFromSource: true,
};

const STATE: DiscStateOptions = {
  width: 1280,
  height: 720,
  intensity: 0.42,
  shimmer: 0.7,
  shimmerRate: 7,
  parallax: 0.6,
  drift: 0.05,
};

/** Object.values over a disc mixes numbers with the colour triple and null. */
function numbers(record: object): number[] {
  return Object.values(record).filter((value): value is number => typeof value === 'number');
}

describe('bokeh disc field', () => {
  test('the same seed produces an identical field', () => {
    expect(createDiscs(FIELD)).toEqual(createDiscs(FIELD));
  });

  test('a different seed produces a different field', () => {
    expect(createDiscs({ ...FIELD, seed: 4 })).not.toEqual(createDiscs(FIELD));
  });

  test('the count is honoured and capped', () => {
    expect(createDiscs({ ...FIELD, count: 0 })).toHaveLength(0);
    expect(createDiscs({ ...FIELD, count: 7 })).toHaveLength(7);
    expect(createDiscs({ ...FIELD, count: 400 })).toHaveLength(64);
  });

  test('without anchors every disc is free, untinted by the source and full gain', () => {
    for (const disc of createDiscs(FIELD)) {
      expect(disc.anchored).toBe(0);
      expect(disc.color).toBeNull();
      expect(disc.gain).toBe(1);
      expect(disc.tint).toBeGreaterThanOrEqual(0);
      expect(disc.tint).toBeLessThan(4);
    }
  });

  test('a fully followed disc lands on its own highlight', () => {
    const [first, second] = createDiscs({ ...FIELD, count: 2, anchors: ANCHORS, follow: 1 });

    expect(first.x).toBeCloseTo(0.2, 6);
    expect(first.y).toBeCloseTo(0.3, 6);
    expect(second.x).toBeCloseTo(0.8, 6);
    expect(second.y).toBeCloseTo(0.65, 6);

    const state = discState(first, 0.5, 0, { ...STATE, drift: 0 });
    expect(state.x).toBeCloseTo(0.2 * STATE.width, 6);
    expect(state.y).toBeCloseTo(0.3 * STATE.height, 6);
  });

  test('a dim highlight makes a dimmer disc than a bright one', () => {
    const [bright, dim] = createDiscs({ ...FIELD, count: 2, anchors: ANCHORS, follow: 1 });
    expect(bright.gain).toBe(1);
    expect(dim.gain).toBeLessThan(bright.gain);
  });

  test('follow zero ignores the anchors entirely', () => {
    expect(createDiscs({ ...FIELD, anchors: ANCHORS, follow: 0 })).toEqual(createDiscs(FIELD));
  });

  test('the highlight colour is inherited unless tintFromSource is off', () => {
    const [tinted] = createDiscs({ ...FIELD, anchors: ANCHORS, follow: 1 });
    expect(tinted.color).toEqual([255, 220, 180]);

    const [palette] = createDiscs({ ...FIELD, anchors: ANCHORS, follow: 1, tintFromSource: false });
    expect(palette.color).toBeNull();
  });

  test('reusing a highlight offsets the extra discs into a cluster', () => {
    const discs = createDiscs({ ...FIELD, count: 4, anchors: ANCHORS, follow: 1 });
    expect(discs[2].x).not.toBeCloseTo(discs[0].x, 6);
    expect(discs[2].anchored).toBeLessThan(discs[0].anchored);
  });

  test('an anchored disc holds still while a free one travels', () => {
    const [anchored] = createDiscs({ ...FIELD, count: 1, anchors: ANCHORS, follow: 1 });
    const [free] = createDiscs({ ...FIELD, count: 1 });
    const still = { ...STATE, drift: 0 };

    const anchoredTravel = Math.abs(
      discState(anchored, 1, 0, still).y - discState(anchored, 0, 0, still).y,
    );
    const freeTravel = Math.abs(discState(free, 1, 0, still).y - discState(free, 0, 0, still).y);

    expect(anchoredTravel).toBeLessThan(1);
    expect(freeTravel).toBeGreaterThan(40);
  });

  test('an anchored disc still shimmers with scroll', () => {
    const [anchored] = createDiscs({ ...FIELD, count: 1, anchors: ANCHORS, follow: 1 });
    const still = { ...STATE, drift: 0 };

    expect(discState(anchored, 0.24, 0, still).opacity).not.toBe(
      discState(anchored, 0.2, 0, still).opacity,
    );
  });

  test('revisiting a scroll position reconstructs the same frame', () => {
    const discs = createDiscs({ ...FIELD, anchors: ANCHORS });
    const frames = [0.6, 0.3, 0.6].map((progress) =>
      discs.map((disc) => discState(disc, progress, 4, STATE)),
    );

    expect(frames[2]).toEqual(frames[0]);
    expect(frames[1]).not.toEqual(frames[0]);
  });

  test('free discs stay inside the travel band across the whole scroll range', () => {
    for (const disc of createDiscs(FIELD)) {
      const reach = disc.size * Math.min(STATE.width, STATE.height);
      for (let step = 0; step <= 40; step += 1) {
        const state = discState(disc, step / 40, 3, STATE);
        expect(state.y).toBeGreaterThanOrEqual(-reach);
        expect(state.y).toBeLessThanOrEqual(STATE.height + reach);
        expect(state.opacity).toBeGreaterThanOrEqual(0);
        expect(state.opacity).toBeLessThanOrEqual(1);
      }
    }
  });

  test('a zero-size box produces no NaN', () => {
    const stateOptions = { ...STATE, width: 0, height: 0 };

    for (const disc of createDiscs({ ...FIELD, size: 0, anchors: ANCHORS })) {
      for (const value of numbers(disc)) expect(Number.isFinite(value)).toBe(true);
      for (const value of numbers(discState(disc, 0.5, 2, stateOptions))) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
