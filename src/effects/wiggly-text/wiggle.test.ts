import { describe, expect, test } from 'bun:test';

import {
  MAX_FRAMES,
  baseFrequency,
  composeFilter,
  displacementScale,
  edgeReconstruction,
  filterRegion,
  frameIndex,
  octaveCount,
  wiggleFrames,
} from './wiggle';

describe('wiggly text frames', () => {
  test('the same seed produces the same cycle', () => {
    expect(wiggleFrames(3, 5)).toEqual(wiggleFrames(3, 5));
  });

  test('a cycle holds distinct, non-adjacent seeds', () => {
    const seeds = wiggleFrames(4, 1).map((frame) => frame.seed);
    expect(new Set(seeds).size).toBe(4);
    for (let i = 1; i < seeds.length; i += 1) {
      expect(Math.abs(seeds[i] - seeds[i - 1])).toBeGreaterThan(8);
    }
  });

  test('a cycle is at least one frame and never runs away', () => {
    expect(wiggleFrames(0, 1)).toHaveLength(1);
    expect(wiggleFrames(-4, 1)).toHaveLength(1);
    expect(wiggleFrames(500, 1)).toHaveLength(MAX_FRAMES);
  });

  test('frames advance one per step and wrap at the end of the cycle', () => {
    expect(frameIndex(0, 100, 3)).toBe(0);
    expect(frameIndex(99, 100, 3)).toBe(0);
    expect(frameIndex(100, 100, 3)).toBe(1);
    expect(frameIndex(250, 100, 3)).toBe(2);
    expect(frameIndex(300, 100, 3)).toBe(0);
  });

  test('a still boil holds the first frame instead of dividing by zero', () => {
    expect(frameIndex(5000, 0, 3)).toBe(0);
    expect(frameIndex(5000, Number.POSITIVE_INFINITY, 3)).toBe(0);
  });
});

describe('wiggly text filter geometry', () => {
  test('amplitude is the peak excursion, so scale is twice it', () => {
    expect(displacementScale(3)).toBe(6);
    expect(displacementScale(-3)).toBe(0);
  });

  test('wavelength inverts to cycles per px, with a floor', () => {
    expect(baseFrequency(50)).toBeCloseTo(0.02, 6);
    expect(baseFrequency(0)).toBeCloseTo(0.25, 6);
  });

  test('roughness spans one to four octaves', () => {
    expect(octaveCount(0)).toBe(1);
    expect(octaveCount(1)).toBe(4);
    expect(octaveCount(5)).toBe(4);
  });

  test('the region grows by the excursion, so displaced pixels are not clipped', () => {
    const region = filterRegion(4, 800, 400);
    const padX = -Number.parseFloat(region.x);
    // 4px amplitude needs 8px of scale, so at least 6px of slack on an 800px box.
    expect((padX / 100) * 800).toBeGreaterThanOrEqual(6);
    expect(Number.parseFloat(region.width)).toBeCloseTo(100 + padX * 2, 4);
  });

  test('a short box gets proportionally more padding than a tall one', () => {
    const short = Number.parseFloat(filterRegion(3, 600, 24).y);
    const tall = Number.parseFloat(filterRegion(3, 600, 480).y);
    expect(Math.abs(short)).toBeGreaterThan(Math.abs(tall));
  });

  test('a degenerate box still gets a region with area', () => {
    const region = filterRegion(3, 0, 0);
    expect(Number.parseFloat(region.width)).toBeGreaterThan(100);
    expect(Number.parseFloat(region.height)).toBeGreaterThan(100);
    for (const value of Object.values(region)) expect(Number.isFinite(Number.parseFloat(value))).toBe(true);
  });

  test('padding is capped so a tiny box does not get an enormous region', () => {
    const region = filterRegion(40, 10, 10);
    expect(Number.parseFloat(region.width)).toBeLessThanOrEqual(200);
  });
});

describe('wiggly text edge reconstruction', () => {
  test('no crispness is an identity pass', () => {
    expect(edgeReconstruction(0)).toEqual({ blur: 0, slope: 1, intercept: 0 });
  });

  test('the ramp is centred on alpha 0.5, so the edge does not move', () => {
    for (const crisp of [0.2, 0.5, 0.7, 1]) {
      const { slope, intercept } = edgeReconstruction(crisp);
      expect(slope * 0.5 + intercept).toBeCloseTo(0.5, 10);
    }
  });

  test('more crispness means more blur and a steeper ramp', () => {
    const soft = edgeReconstruction(0.3);
    const hard = edgeReconstruction(0.9);
    expect(hard.blur).toBeGreaterThan(soft.blur);
    expect(hard.slope).toBeGreaterThan(soft.slope);
  });

  test('crispness is clamped', () => {
    expect(edgeReconstruction(4)).toEqual(edgeReconstruction(1));
    expect(edgeReconstruction(-4)).toEqual(edgeReconstruction(0));
  });
});

describe('wiggly text filter composition', () => {
  test("a host's existing filter survives, with the wiggle applied after it", () => {
    expect(composeFilter('blur(2px)', 'url(#w)')).toBe('blur(2px) url(#w)');
    expect(composeFilter('blur(2px) saturate(1.4)', 'url(#w)')).toBe(
      'blur(2px) saturate(1.4) url(#w)',
    );
  });

  test('an unfiltered host gets the wiggle alone', () => {
    expect(composeFilter('', 'url(#w)')).toBe('url(#w)');
    expect(composeFilter('   ', 'url(#w)')).toBe('url(#w)');
  });

  test('`none` is dropped rather than listed, which would invalidate the declaration', () => {
    expect(composeFilter('none', 'url(#w)')).toBe('url(#w)');
  });
});
