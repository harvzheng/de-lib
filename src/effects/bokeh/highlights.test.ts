import { describe, expect, test } from 'bun:test';

import { findHighlights } from './highlights';
import type { HighlightScanOptions } from './highlights';

const WIDTH = 48;
const HEIGHT = 32;

const SCAN: HighlightScanOptions = {
  width: WIDTH,
  height: HEIGHT,
  count: 8,
  threshold: 0.2,
  separation: 0.08,
};

function grid(fill: [number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    pixels[i * 4] = fill[0];
    pixels[i * 4 + 1] = fill[1];
    pixels[i * 4 + 2] = fill[2];
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function dot(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  colour: [number, number, number],
): void {
  const index = (y * WIDTH + x) * 4;
  pixels[index] = colour[0];
  pixels[index + 1] = colour[1];
  pixels[index + 2] = colour[2];
}

describe('bokeh highlight detection', () => {
  test('a flat frame has no highlights', () => {
    expect(findHighlights(grid([90, 90, 90]), SCAN)).toEqual([]);
  });

  test('bright isolated points are found at their own positions', () => {
    const pixels = grid([28, 30, 36]);
    dot(pixels, 6, 5, [255, 240, 210]);
    dot(pixels, 30, 20, [250, 200, 160]);

    const found = findHighlights(pixels, SCAN);
    expect(found).toHaveLength(2);

    const positions = found
      .map((h) => [Math.round(h.x * (WIDTH - 1)), Math.round(h.y * (HEIGHT - 1))])
      .sort((a, b) => a[0] - b[0]);
    expect(positions).toEqual([
      [6, 5],
      [30, 20],
    ]);
  });

  test('the highlight carries its own colour and a normalised weight', () => {
    const pixels = grid([20, 20, 20]);
    dot(pixels, 12, 12, [255, 180, 90]);

    const [highlight] = findHighlights(pixels, SCAN);
    expect(highlight.color).toEqual([255, 180, 90]);
    expect(highlight.weight).toBe(1);
  });

  test('the strongest peak comes first', () => {
    const pixels = grid([20, 20, 20]);
    dot(pixels, 8, 8, [140, 140, 140]);
    dot(pixels, 34, 22, [255, 255, 255]);

    const found = findHighlights(pixels, SCAN);
    expect(found[0].weight).toBeGreaterThan(found[1].weight);
    expect(Math.round(found[0].x * (WIDTH - 1))).toBe(34);
  });

  test('separation suppresses neighbouring cells of one highlight', () => {
    const pixels = grid([20, 20, 20]);
    for (let x = 10; x <= 13; x += 1) {
      for (let y = 10; y <= 13; y += 1) dot(pixels, x, y, [255, 255, 255]);
    }

    expect(findHighlights(pixels, { ...SCAN, separation: 0.2 })).toHaveLength(1);
    expect(findHighlights(pixels, { ...SCAN, separation: 0 }).length).toBeGreaterThan(1);
  });

  test('the count is a hard cap', () => {
    const pixels = grid([16, 16, 16]);
    for (let i = 0; i < 20; i += 1) dot(pixels, 2 + i * 2, 4 + (i % 6) * 4, [255, 250, 240]);

    expect(findHighlights(pixels, { ...SCAN, count: 3, separation: 0.02 })).toHaveLength(3);
  });

  test('a degenerate grid returns nothing rather than throwing', () => {
    expect(findHighlights(new Uint8ClampedArray(0), { ...SCAN, width: 0, height: 0 })).toEqual([]);
    expect(findHighlights(new Uint8ClampedArray(4), SCAN)).toEqual([]);
  });
});
