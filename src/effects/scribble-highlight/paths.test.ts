import { describe, expect, test } from 'bun:test';

import { buildScribbleDrawings } from './paths';
import type { ScribbleGeometryOptions, ScribbleStroke, ScribbleVariant } from './paths';

const VARIANTS: readonly ScribbleVariant[] = [
  'circle',
  'underline',
  'box',
  'strike',
  'arrow',
  'star',
  'trace',
];

const TRACE_PATH: readonly (readonly [number, number])[] = [
  [0.18, 0.08],
  [0.82, 0.14],
  [0.94, 0.66],
  [0.5, 0.97],
  [0.06, 0.58],
];

function build(patch: Partial<ScribbleGeometryOptions> = {}): ScribbleStroke[][] {
  return buildScribbleDrawings({
    width: 240,
    height: 42,
    variant: 'circle',
    padding: 10,
    jitter: 4,
    passes: 2,
    frames: 6,
    seed: 1,
    path: TRACE_PATH,
    ...patch,
  });
}

function dataOf(drawings: readonly ScribbleStroke[][]): string {
  return drawings.map((strokes) => strokes.map((stroke) => stroke.d).join('\n')).join('\n--\n');
}

describe('buildScribbleDrawings', () => {
  test('the same seed produces byte-identical path data', () => {
    for (const variant of VARIANTS) {
      expect(dataOf(build({ variant }))).toBe(dataOf(build({ variant })));
    }
  });

  test('different seeds produce different drawings', () => {
    for (const variant of VARIANTS) {
      expect(dataOf(build({ variant, seed: 1 }))).not.toBe(dataOf(build({ variant, seed: 7 })));
    }
  });

  test('every drawing in a set is drawn independently of the others', () => {
    for (const variant of VARIANTS) {
      const drawings = build({ variant });
      const distinct = new Set(drawings.map((strokes) => strokes.map((s) => s.d).join('\n')));
      expect(distinct.size).toBe(drawings.length);
    }
  });

  test('every drawing in a set carries the same strokes in the same pass order', () => {
    for (const variant of VARIANTS) {
      const drawings = build({ variant });
      const shapes = new Set(
        drawings.map((strokes) => `${strokes.length}:${strokes.map((s) => s.pass).join(',')}`),
      );
      expect(shapes.size).toBe(1);
    }
  });

  test('each pass contributes the same number of strokes', () => {
    for (const variant of VARIANTS) {
      const single = build({ variant, passes: 1 })[0];
      const triple = build({ variant, passes: 3 })[0];
      expect(triple.length).toBe(single.length * 3);
      expect(triple.filter((stroke) => stroke.pass === 2)).toHaveLength(single.length);
    }
  });

  test('path data is well formed', () => {
    for (const variant of VARIANTS) {
      for (const strokes of build({ variant })) {
        for (const stroke of strokes) {
          expect(stroke.d.startsWith('M')).toBe(true);
          expect(stroke.d).not.toContain('NaN');
          expect(stroke.d).not.toContain('undefined');
          expect(stroke.widthScale).toBeGreaterThan(0);
        }
      }
    }
  });

  test('a zero-size box produces no NaN coordinates', () => {
    for (const variant of VARIANTS) {
      for (const padding of [0, 10]) {
        for (const strokes of build({ variant, width: 0, height: 0, padding })) {
          for (const stroke of strokes) {
            expect(stroke.d).not.toContain('NaN');
            const numbers = stroke.d.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
            expect(numbers.every(Number.isFinite)).toBe(true);
          }
        }
      }
    }
  });

  test('a trace with no usable outline still draws something', () => {
    for (const path of [undefined, [[0.5, 0.5]] as const]) {
      const drawings = build({ variant: 'trace', path });
      expect(drawings).toHaveLength(6);
      for (const strokes of drawings) {
        expect(strokes.length).toBeGreaterThan(0);
        for (const stroke of strokes) expect(stroke.d.startsWith('M')).toBe(true);
      }
    }
  });

  test('the traced outline passes through the supplied points', () => {
    const [stroke] = build({ variant: 'trace', jitter: 0, passes: 1, frames: 1 })[0];
    const tokens = stroke.d.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
    // On-curve points sit at every sixth token: `M x y` then `C c1x c1y c2x c2y x y`.
    const curve = tokens.filter((_, index) => index % 6 < 2);
    for (const [x, y] of TRACE_PATH) {
      const px = 10 + x * 240;
      const py = 10 + y * 42;
      let nearest = Infinity;
      for (let i = 0; i < curve.length; i += 2) {
        nearest = Math.min(nearest, Math.hypot(curve[i] - px, curve[i + 1] - py));
      }
      // Samples land about 9px apart along the curve, so an unjittered outline
      // running through a vertex always has one within half that.
      expect(nearest).toBeLessThan(6);
    }
  });

  test('a different outline traces differently', () => {
    const triangle = [
      [0.1, 0.1],
      [0.9, 0.2],
      [0.5, 0.9],
    ] as const;
    expect(dataOf(build({ variant: 'trace', path: triangle }))).not.toBe(
      dataOf(build({ variant: 'trace' })),
    );
  });
});
