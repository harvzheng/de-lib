import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_GAS,
  DROPOUT_FLOOR,
  SLOT_MS,
  bounceLevel,
  coreAt,
  glowStack,
  hazeLevel,
  mixRgb,
  parseColor,
  rgbChannels,
  rgbCss,
  tubeBrightness,
  tubePalette,
} from './tube';
import type { Rgb } from './tube';

/** Samples a whole minute of tube output at a rate well above the write rate. */
function sample(flicker: number, seed: number, ms = 60000, stepMs = 8): number[] {
  const out: number[] = [];
  for (let elapsed = 0; elapsed <= ms; elapsed += stepMs) {
    out.push(tubeBrightness(elapsed, { flicker, seed }));
  }
  return out;
}

/** Runs of consecutive samples below full-ish output, i.e. dropout events. */
function dropoutCount(levels: number[]): number {
  let count = 0;
  let inside = false;
  for (const level of levels) {
    const dark = level < 0.5;
    if (dark && !inside) count += 1;
    inside = dark;
  }
  return count;
}

const distance = (a: Rgb, b: Rgb): number =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

const spread = (c: Rgb): number => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

describe('neon flicker schedule', () => {
  test('one seed replays exactly the same sequence', () => {
    expect(sample(0.6, 7, 4000)).toEqual(sample(0.6, 7, 4000));
  });

  test('two seeds do not share a sequence', () => {
    expect(sample(0.6, 7, 8000)).not.toEqual(sample(0.6, 8, 8000));
  });

  test('output stays inside 0..1 at every flicker setting', () => {
    for (const flicker of [0, 0.15, 0.3, 0.75, 1]) {
      for (const level of sample(flicker, 3)) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
  });

  test('no flicker means a hard constant, not a slow one', () => {
    const levels = sample(0, 4, 20000);
    expect(levels.every((level) => level === 1)).toBe(true);
  });

  test('a settled tube sits near full output, never above it', () => {
    const levels = sample(0.3, 5);
    expect(Math.max(...levels)).toBeLessThanOrEqual(1);
    // Mean, not max: the buzz is meant to be a ripple you feel, not a pulse.
    expect(levels.reduce((sum, level) => sum + level, 0) / levels.length).toBeGreaterThan(0.85);
  });

  test('a hard flicker drops the tube out; no flicker never does', () => {
    const busy = sample(1, 11);
    expect(dropoutCount(busy)).toBeGreaterThan(4);
    expect(Math.min(...busy)).toBeLessThan(0.2);

    expect(dropoutCount(sample(0, 11))).toBe(0);
    expect(Math.min(...sample(0, 11))).toBe(1);
  });

  test('dropouts get rarer as the setting falls, over the same minute', () => {
    const busy = dropoutCount(sample(1, 21));
    const occasional = dropoutCount(sample(0.3, 21));
    expect(occasional).toBeGreaterThan(0);
    expect(occasional).toBeLessThan(busy / 2);
  });

  test('a dropout keeps an afterglow instead of going black', () => {
    expect(Math.min(...sample(1, 31))).toBeGreaterThan(0);
    expect(Math.min(...sample(1, 31))).toBeGreaterThanOrEqual(DROPOUT_FLOOR * 0.8);
  });

  test('output is a function of elapsed time only, so it can be sampled out of order', () => {
    const forwards = sample(0.8, 13, 6000, 40);
    const backwards: number[] = [];
    for (let elapsed = 6000; elapsed >= 0; elapsed -= 40) {
      backwards.push(tubeBrightness(elapsed, { flicker: 0.8, seed: 13 }));
    }
    expect(backwards.reverse()).toEqual(forwards);
  });

  test('a dropout that starts late in a slot is still seen from the next one', () => {
    // Sampling only on slot boundaries would miss every event; the contract is
    // that an event straddling a boundary is continuous across it.
    const before = tubeBrightness(SLOT_MS * 4 - 1, { flicker: 1, seed: 17 });
    const after = tubeBrightness(SLOT_MS * 4 + 1, { flicker: 1, seed: 17 });
    expect(Math.abs(before - after)).toBeLessThan(0.5);
  });

  test('a glitched clock leaves the sign lit rather than dark', () => {
    const atZero = tubeBrightness(0, { flicker: 1, seed: 2 });
    expect(tubeBrightness(-500, { flicker: 1, seed: 2 })).toBe(atZero);
    expect(tubeBrightness(Number.NaN, { flicker: 1, seed: 2 })).toBe(atZero);
    expect(tubeBrightness(Number.POSITIVE_INFINITY, { flicker: 1, seed: 2 })).toBe(atZero);
    expect(tubeBrightness(1e12, { flicker: 1, seed: 2 })).toBeGreaterThan(0);
    expect(tubeBrightness(500, { flicker: 1, seed: 1.7 })).toBeGreaterThan(0);
  });
});

describe('neon colour parsing', () => {
  test('hex is read at three, six and eight digits, alpha discarded', () => {
    expect(parseColor('#0f8')).toEqual({ r: 0, g: 255, b: 136 });
    expect(parseColor('#00ff88')).toEqual({ r: 0, g: 255, b: 136 });
    expect(parseColor('#00ff8840')).toEqual({ r: 0, g: 255, b: 136 });
  });

  test('rgb() is read with commas, spaces, a slashed alpha and percentages', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('rgb(100% 0% 50%)')).toEqual({ r: 255, g: 0, b: 127.5 });
  });

  test('a colour needing a document falls back rather than throwing', () => {
    expect(parseColor('tomato')).toEqual(DEFAULT_GAS);
    expect(parseColor('oklch(70% 0.2 20)')).toEqual(DEFAULT_GAS);
    expect(parseColor('rgb(a b c)')).toEqual(DEFAULT_GAS);
    expect(parseColor('#12345')).toEqual(DEFAULT_GAS);
    expect(parseColor('')).toEqual(DEFAULT_GAS);
  });

  test('channels are serialised as integers, and alpha is only spent when partial', () => {
    expect(rgbChannels({ r: 10.4, g: 20.6, b: 30 })).toBe('10 21 30');
    expect(rgbCss({ r: 1, g: 2, b: 3 })).toBe('rgb(1 2 3)');
    expect(rgbCss({ r: 1, g: 2, b: 3 }, 2)).toBe('rgb(1 2 3)');
    expect(rgbCss({ r: 1, g: 2, b: 3 }, 0.5)).toBe('rgb(1 2 3 / 0.500)');
    expect(rgbCss({ r: 1, g: 2, b: 3 }, -1)).toBe('rgb(1 2 3 / 0.000)');
  });

  test('a mix is clamped to its endpoints', () => {
    const a = { r: 0, g: 0, b: 0 };
    const b = { r: 100, g: 200, b: 50 };
    expect(mixRgb(a, b, -1)).toEqual(a);
    expect(mixRgb(a, b, 5)).toEqual(b);
    expect(mixRgb(a, b, 0.5)).toEqual({ r: 50, g: 100, b: 25 });
  });
});

describe('neon tube palette', () => {
  const gas = '#ff2e63';
  const palette = tubePalette(gas, 0.78);

  test('the halo is the gas, and the core is not', () => {
    expect(palette.glow).toEqual(parseColor(gas));
    // The single-colour tube is the classic mistake: it reads as a drop shadow.
    expect(distance(palette.core, palette.glow)).toBeGreaterThan(60);
  });

  test('the core is hotter than the gas and heat controls how much', () => {
    const white = { r: 255, g: 255, b: 255 };
    const cool = tubePalette(gas, 0.2);
    const hot = tubePalette(gas, 0.95);
    expect(distance(hot.core, white)).toBeLessThan(distance(cool.core, white));
    expect(distance(tubePalette(gas, 0).core, palette.glow)).toBe(0);
    expect(tubePalette(gas, 1).core).toEqual(white);
  });

  test('spill is gas light that has travelled: same hue, less of it', () => {
    const gasRgb = parseColor(gas);
    expect(palette.spill.r).toBeLessThan(gasRgb.r);
    expect(palette.spill.r / palette.spill.g).toBeCloseTo(gasRgb.r / gasRgb.g, 5);
  });

  test('the bounce colour can only tint, because it multiplies', () => {
    // Anything but near-white multiplies a page into ink instead of lighting it.
    expect(Math.min(palette.bounce.r, palette.bounce.g, palette.bounce.b)).toBeGreaterThan(180);
    expect(spread(palette.bounce)).toBeLessThan(spread(palette.glow));
  });

  test('unlit glass is grey, faintly tinted, and never the gas', () => {
    expect(spread(palette.glass)).toBeLessThan(spread(palette.glow) * 0.3);
    expect(spread(palette.glass)).toBeGreaterThan(0);
    expect(palette.glass.g).toBeGreaterThan(80);
    expect(palette.glass.g).toBeLessThan(200);
  });

  test('an unparseable colour still yields a finite, in-gamut palette', () => {
    const fallback = tubePalette('rebeccapurple-ish', 0.5);
    for (const colour of [fallback.core, fallback.glow, fallback.spill, fallback.bounce, fallback.glass]) {
      for (const value of [colour.r, colour.g, colour.b]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }
  });

  test('the core cools to glass as the tube loses output', () => {
    expect(coreAt(palette, 1)).toEqual(palette.core);
    expect(coreAt(palette, 0)).toEqual(palette.glass);
    expect(coreAt(palette, -3)).toEqual(palette.glass);
    const dim = coreAt(palette, 0.2);
    expect(distance(dim, palette.glass)).toBeLessThan(distance(dim, palette.core));
  });
});

describe('neon glow stack', () => {
  const palette = tubePalette('#ff2e63', 0.78);
  const shadows = (value: string): string[] => value.split(/,\s*(?=0 0)/);

  test('nothing to paint yields none rather than a transparent stack', () => {
    expect(glowStack(palette, 0, 1, 1)).toBe('none');
    expect(glowStack(palette, 18, 0, 1)).toBe('none');
    expect(glowStack(palette, 18, 1, 0)).toBe('none');
    expect(glowStack(palette, -4, 1, 1)).toBe('none');
  });

  test('the stack is layered tight to wide, and only the tightest is core-coloured', () => {
    const layers = shadows(glowStack(palette, 20, 1, 1));
    expect(layers.length).toBeGreaterThan(2);

    const radii = layers.map((layer) => Number(/0 0 ([\d.]+)/.exec(layer)?.[1]));
    for (let i = 1; i < radii.length; i += 1) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    expect(radii[radii.length - 1]).toBeGreaterThan(20);

    expect(layers[0]).toContain(rgbChannels(palette.core));
    for (const layer of layers.slice(1)) expect(layer).toContain(rgbChannels(palette.glow));
  });

  test('alpha falls off outward, so the halo has an edge', () => {
    const alphas = shadows(glowStack(palette, 20, 1, 1)).map((layer) =>
      Number(/\/ ([\d.]+)\)/.exec(layer)?.[1]),
    );
    for (let i = 1; i < alphas.length; i += 1) expect(alphas[i]).toBeLessThan(alphas[i - 1]);
  });

  test('intensity and brightness both scale the whole stack down', () => {
    const alphaOf = (value: string): number => Number(/\/ ([\d.]+)\)/.exec(value)?.[1]);
    const full = alphaOf(glowStack(palette, 20, 1, 1));
    expect(alphaOf(glowStack(palette, 20, 0.5, 1))).toBeLessThan(full);
    expect(alphaOf(glowStack(palette, 20, 1, 0.5))).toBeLessThan(full);
    // Out-of-range settings are clamped, not amplified.
    expect(glowStack(palette, 20, 4, 4)).toBe(glowStack(palette, 20, 1, 1));
  });

  test('radii scale with the requested glow radius', () => {
    const widest = (value: string): number => {
      const radii = [...value.matchAll(/0 0 ([\d.]+)px/g)].map((match) => Number(match[1]));
      return Math.max(...radii);
    };
    expect(widest(glowStack(palette, 40, 1, 1))).toBeCloseTo(widest(glowStack(palette, 20, 1, 1)) * 2, 5);
  });
});

describe('neon spill', () => {
  test('both spill layers scale with the setting and go out with the tube', () => {
    expect(hazeLevel(0.5, 1)).toBeGreaterThan(hazeLevel(0.2, 1));
    expect(hazeLevel(0.5, 0.4)).toBeLessThan(hazeLevel(0.5, 1));
    expect(hazeLevel(0.5, 0)).toBe(0);
    expect(bounceLevel(0.5, 0)).toBe(0);
    // A bounce has been absorbed once, so it can never out-light the air.
    expect(bounceLevel(1, 1)).toBeLessThan(hazeLevel(1, 1));
  });

  test('spill levels stay inside 0..1 whatever they are handed', () => {
    for (const level of [hazeLevel(4, 4), bounceLevel(4, 4), hazeLevel(-2, 1), bounceLevel(1, -2)]) {
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

});
