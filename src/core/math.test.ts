import { describe, expect, test } from 'bun:test';

import {
  clamp,
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  mulberry32,
  seededWave,
  smoothstep,
} from './math';

describe('clamp', () => {
  test('holds inside the range and pins outside it', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test('handles negative ranges', () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(0, -10, -1)).toBe(-1);
  });
});

describe('clamp01', () => {
  test('pins to the unit range', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-0.25)).toBe(0);
    expect(clamp01(1.25)).toBe(1);
  });
});

describe('lerp', () => {
  test('hits both endpoints exactly and the midpoint', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  test('extrapolates outside 0..1', () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });
});

describe('smoothstep', () => {
  test('is flat outside the edges and exact at them', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });

  test('is monotone non-decreasing across the ramp', () => {
    let previous = -1;
    for (let i = 0; i <= 200; i += 1) {
      const value = smoothstep(2, 6, 1 + (i / 200) * 6);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('easings', () => {
  test('easeInOutCubic pins both ends and stays monotone', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);

    let previous = -1;
    for (let i = 0; i <= 1000; i += 1) {
      const value = easeInOutCubic(i / 1000);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  test('easeOutCubic pins both ends, stays monotone, and front-loads', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);

    let previous = -1;
    for (let i = 0; i <= 1000; i += 1) {
      const value = easeOutCubic(i / 1000);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }

    // "Out" easing: most of the distance is covered in the first half.
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('mulberry32', () => {
  test('is deterministic for a given seed', () => {
    const first = mulberry32(12345);
    const second = mulberry32(12345);
    for (let i = 0; i < 64; i += 1) expect(first()).toBe(second());
  });

  test('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differences = 0;
    for (let i = 0; i < 64; i += 1) {
      if (a() !== b()) differences += 1;
    }
    expect(differences).toBeGreaterThan(60);
  });

  test('stays in [0, 1)', () => {
    for (const seed of [0, 1, 7, 999, 2 ** 31, -1]) {
      const random = mulberry32(seed);
      for (let i = 0; i < 2000; i += 1) {
        const value = random();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});

describe('seededWave', () => {
  test('is deterministic for a given seed', () => {
    const first = seededWave(42);
    const second = seededWave(42);
    for (let i = 0; i < 200; i += 1) {
      const x = i * 0.37;
      expect(first(x)).toBe(second(x));
    }
  });

  test('differs between seeds', () => {
    const a = seededWave(1);
    const b = seededWave(2);
    let differences = 0;
    for (let i = 0; i < 200; i += 1) {
      if (a(i * 0.37) !== b(i * 0.37)) differences += 1;
    }
    expect(differences).toBeGreaterThan(190);
  });

  test('keeps roughly unit amplitude', () => {
    const wave = seededWave(7);
    for (let i = 0; i < 5000; i += 1) {
      const value = wave(i * 0.013);
      expect(Number.isNaN(value)).toBe(false);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
  });

  test('is continuous: a small step in x gives a small step in y', () => {
    const wave = seededWave(2024);
    const dx = 0.01;
    let previous = wave(-20);
    for (let x = -20 + dx; x <= 20; x += dx) {
      const value = wave(x);
      expect(Math.abs(value - previous)).toBeLessThan(0.1);
      previous = value;
    }
  });

  test('actually varies rather than sitting flat', () => {
    const wave = seededWave(9);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 1000; i += 1) {
      const value = wave(i * 0.25);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(max - min).toBeGreaterThan(0.5);
  });
});
