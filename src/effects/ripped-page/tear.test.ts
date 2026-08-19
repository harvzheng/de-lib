import { describe, expect, test } from 'bun:test';

import { buildTear } from './tear';
import type { TearOptions } from './tear';

const TEAR: TearOptions = {
  width: 1280,
  height: 720,
  axis: 'horizontal',
  angle: -8,
  offset: 0.52,
  roughness: 0.6,
  fiber: 0.5,
  pivotAt: 'start',
  seed: 5,
};

function pointsOf(polygon: string): [number, number][] {
  const body = polygon.slice('polygon('.length, -1);
  return body.split(',').map((pair) => {
    const [x, y] = pair.trim().split(/\s+/);
    return [Number.parseFloat(x), Number.parseFloat(y)];
  });
}

describe('ripped page tear geometry', () => {
  test('the same seed tears identically', () => {
    expect(buildTear(TEAR)).toEqual(buildTear(TEAR));
  });

  test('a different seed tears differently', () => {
    expect(buildTear({ ...TEAR, seed: 6 }).edgePath).not.toBe(buildTear(TEAR).edgePath);
  });

  test('a horizontal tear spans the full width, in order', () => {
    const { line } = buildTear(TEAR);
    expect(line[0].x).toBe(0);
    expect(line[line.length - 1].x).toBe(TEAR.width);
    for (let i = 1; i < line.length; i += 1) expect(line[i].x).toBeGreaterThan(line[i - 1].x);
  });

  test('a vertical tear spans the full height, in order', () => {
    const { line } = buildTear({ ...TEAR, axis: 'vertical' });
    expect(line[0].y).toBe(0);
    expect(line[line.length - 1].y).toBe(TEAR.height);
    for (let i = 1; i < line.length; i += 1) expect(line[i].y).toBeGreaterThan(line[i - 1].y);
  });

  test('the tear stays inside the frame at any tilt or offset', () => {
    for (const axis of ['horizontal', 'vertical'] as const) {
      for (const offset of [0, 0.5, 1]) {
        for (const angle of [-90, 0, 90]) {
          const { line } = buildTear({ ...TEAR, axis, offset, angle, roughness: 1, fiber: 1 });
          for (const point of line) {
            expect(point.x).toBeGreaterThanOrEqual(0);
            expect(point.x).toBeLessThanOrEqual(TEAR.width);
            expect(point.y).toBeGreaterThanOrEqual(0);
            expect(point.y).toBeLessThanOrEqual(TEAR.height);
          }
        }
      }
    }
  });

  test('the two pieces share the tear and take a frame edge each', () => {
    const { leadClip, trailClip } = buildTear(TEAR);
    const lead = pointsOf(leadClip);
    const trail = pointsOf(trailClip);

    expect(lead).toContainEqual([0, 0]);
    expect(lead).toContainEqual([TEAR.width, 0]);
    expect(trail).toContainEqual([0, TEAR.height]);
    expect(trail).toContainEqual([TEAR.width, TEAR.height]);

    // One piece's edge is the other's: every tear point is in both polygons.
    const leadPoints = new Set(lead.map((point) => point.join(':')));
    for (const point of trail) {
      if (point[1] === TEAR.height) continue;
      expect(leadPoints.has(point.join(':'))).toBe(true);
    }
  });

  test('roughness scales how far the tear wanders', () => {
    const spread = (roughness: number): number => {
      const values = buildTear({ ...TEAR, roughness, fiber: 0, angle: 0 }).line.map((p) => p.y);
      return Math.max(...values) - Math.min(...values);
    };

    expect(spread(0)).toBe(0);
    expect(spread(1)).toBeGreaterThan(spread(0.3));
  });

  test('fibre tufts stand out of the lead piece only', () => {
    const tufted = buildTear({ ...TEAR, roughness: 0, angle: 0, fiber: 1 }).line.map((p) => p.y);
    const flat = buildTear({ ...TEAR, roughness: 0, angle: 0, fiber: 0 }).line[0].y;

    expect(Math.min(...tufted)).toBeLessThan(flat);
    expect(Math.max(...tufted)).toBe(flat);
  });

  test('the pivot sits at the chosen end of the tear', () => {
    const { line } = buildTear(TEAR);
    expect(buildTear({ ...TEAR, pivotAt: 'start' }).pivot.x).toBe(line[0].x);
    expect(buildTear({ ...TEAR, pivotAt: 'end' }).pivot.x).toBe(line[line.length - 1].x);

    const centre = buildTear({ ...TEAR, pivotAt: 'center' }).pivot.x;
    expect(centre).toBeGreaterThan(0);
    expect(centre).toBeLessThan(TEAR.width);
  });

  test('a zero-size box produces finite geometry', () => {
    const geometry = buildTear({ ...TEAR, width: 0, height: 0 });
    for (const point of geometry.line) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    expect(geometry.leadClip.startsWith('polygon(')).toBe(true);
    expect(Number.isFinite(geometry.pivot.x)).toBe(true);
  });
});
