import { describe, expect, test } from 'bun:test';

import { buildBurstGeometry } from './burst';
import type { BurstGeometryOptions, ImpactShape } from './burst';

const SHAPES: readonly ImpactShape[] = ['starburst', 'cloud', 'jagged', 'spike'];

function build(patch: Partial<BurstGeometryOptions> = {}) {
  return buildBurstGeometry({
    width: 240,
    height: 96,
    shape: 'starburst',
    points: 12,
    irregularity: 0.35,
    speedLines: 14,
    seed: 1,
    ...patch,
  });
}

function vertexCount(path: string): number {
  const curves = path.match(/Q/g);
  return curves === null ? (path.match(/[ML]/g) ?? []).length : curves.length;
}

describe('buildBurstGeometry', () => {
  test('the same seed produces byte-identical geometry', () => {
    for (const shape of SHAPES) {
      expect(build({ shape })).toEqual(build({ shape }));
    }
  });

  test('different seeds produce different geometry', () => {
    for (const shape of SHAPES) {
      expect(build({ shape, seed: 1 })).not.toEqual(build({ shape, seed: 17 }));
    }
  });

  test('points controls the polygon vertex count', () => {
    for (const points of [3, 8, 17]) {
      expect(vertexCount(build({ points }).path)).toBe(points * 2);
    }
  });

  test('cloud emits a curved silhouette', () => {
    expect(build({ shape: 'cloud' }).path).toContain('Q');
  });

  test('speedLines controls the number of radiating strokes', () => {
    for (const speedLines of [0, 7, 24]) {
      expect(build({ speedLines }).lines).toHaveLength(speedLines);
    }
  });

  test('every path is closed, well formed and finite', () => {
    for (const shape of SHAPES) {
      const geometry = build({ shape });
      expect(geometry.path.startsWith('M')).toBe(true);
      expect(geometry.path.endsWith('Z')).toBe(true);
      expect(geometry.path).not.toContain('NaN');
      expect(geometry.path).not.toContain('undefined');
      for (const line of geometry.lines) {
        expect(Object.values(line).every(Number.isFinite)).toBe(true);
      }
    }
  });

  test('a zero-size target produces no NaN coordinates', () => {
    for (const shape of SHAPES) {
      const geometry = build({ shape, width: 0, height: 0 });
      expect(geometry.path).not.toContain('NaN');
      const numbers = geometry.path.replace(/[MLQZ]/g, ' ').trim().split(/[,\s]+/).map(Number);
      expect(numbers.every(Number.isFinite)).toBe(true);
      for (const line of geometry.lines) {
        expect(Object.values(line).every(Number.isFinite)).toBe(true);
      }
    }
  });
});
