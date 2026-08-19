import { describe, expect, test } from 'bun:test';

import { buildCreases } from './creases';
import type { Crease, CreaseFieldOptions } from './creases';

const FIELD: CreaseFieldOptions = {
  width: 1280,
  height: 800,
  scale: 260,
  sharpness: 0.55,
  seed: 4,
};

function kinds(shapes: Crease[]): { creases: number; swells: number } {
  let creases = 0;
  let swells = 0;
  for (const shape of shapes) {
    if (shape.kind === 'crease') creases += 1;
    else swells += 1;
  }
  return { creases, swells };
}

describe('crumpled paper creases', () => {
  test('the same seed creases identically', () => {
    expect(buildCreases(FIELD)).toEqual(buildCreases(FIELD));
  });

  test('a different seed creases differently', () => {
    expect(buildCreases({ ...FIELD, seed: 5 })).not.toEqual(buildCreases(FIELD));
  });

  test('both populations are present, with more creases than swells', () => {
    const { creases, swells } = kinds(buildCreases(FIELD));
    expect(swells).toBeGreaterThan(0);
    expect(creases).toBeGreaterThan(swells);
  });

  test('creases are needles and swells are not', () => {
    for (const shape of buildCreases(FIELD)) {
      const ratio = shape.length / shape.reach;
      if (shape.kind === 'crease') expect(ratio).toBeGreaterThan(8);
      else expect(ratio).toBeLessThan(3);
      expect(shape.amplitude).toBeGreaterThan(0);
      expect(shape.amplitude).toBeLessThanOrEqual(1);
    }
  });

  test('every shape is centred inside the sheet', () => {
    for (const shape of buildCreases(FIELD)) {
      expect(shape.cx).toBeGreaterThanOrEqual(0);
      expect(shape.cx).toBeLessThanOrEqual(FIELD.width);
      expect(shape.cy).toBeGreaterThanOrEqual(0);
      expect(shape.cy).toBeLessThanOrEqual(FIELD.height);
      expect(shape.angle).toBeGreaterThanOrEqual(0);
      expect(shape.angle).toBeLessThan(Math.PI);
    }
  });

  test('a tighter crumple means more creases', () => {
    expect(buildCreases({ ...FIELD, scale: 90 }).length).toBeGreaterThan(
      buildCreases({ ...FIELD, scale: 500 }).length,
    );
  });

  test('sharpness trades swell height for crease count', () => {
    const soft = buildCreases({ ...FIELD, sharpness: 0 });
    const hard = buildCreases({ ...FIELD, sharpness: 1 });

    expect(kinds(hard).creases).toBeGreaterThan(kinds(soft).creases);
    const swellHeight = (shapes: Crease[]): number =>
      shapes.filter((s) => s.kind === 'swell').reduce((total, s) => total + s.amplitude, 0);
    expect(swellHeight(soft)).toBeGreaterThan(swellHeight(hard));
  });

  test('the summed swell height stays inside the map range', () => {
    for (const sharpness of [0, 0.5, 1]) {
      for (const scale of [90, 260, 600]) {
        const shapes = buildCreases({ ...FIELD, sharpness, scale });
        const total = shapes
          .filter((shape) => shape.kind === 'swell')
          .reduce((sum, shape) => sum + shape.amplitude, 0);
        expect(total).toBeLessThan(6);
      }
    }
  });

  test('a zero-size sheet produces finite shapes', () => {
    for (const shape of buildCreases({ ...FIELD, width: 0, height: 0 })) {
      for (const value of [shape.cx, shape.cy, shape.length, shape.reach, shape.amplitude]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
