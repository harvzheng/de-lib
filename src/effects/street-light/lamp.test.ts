import { describe, expect, test } from 'bun:test';

import { scrollProgress } from '../../core/scroll';
import { bandOffset, buzzGain, lampRig, swayShift } from './lamp';
import type { BandInput, RigInput } from './lamp';

const WIDTH = 1280;
const HEIGHT = 2600;
const VIEWPORT = 800;

function rigInput(patch: Partial<RigInput> = {}): RigInput {
  return {
    width: WIDTH,
    viewportHeight: VIEWPORT,
    anchor: 0.26,
    column: 0.4,
    drop: 0.3,
    spread: 0.21,
    stretch: 1.55,
    ...patch,
  };
}

function bandInput(patch: Partial<BandInput> = {}): BandInput {
  return {
    height: HEIGHT,
    viewportHeight: VIEWPORT,
    progress: 0,
    scrollStart: 1,
    scrollEnd: 0,
    ...patch,
  };
}

/** Band-space y of the viewport's top edge — the slack the band carries above it. */
const MARGIN = (lampRig(rigInput()).height - VIEWPORT) / 2;

const SAMPLES = [0, 0.07, 0.25, 0.5, 0.63, 0.9, 1];

describe('street light rig', () => {
  test('the band is taller than the viewport, with the slack split either side', () => {
    const rig = lampRig(rigInput());
    expect(rig.height).toBeGreaterThan(VIEWPORT);
    expect(MARGIN).toBeGreaterThan(0);
  });

  test('every ellipse is finite and sized', () => {
    const rig = lampRig(rigInput());
    for (const ellipse of [rig.hotspot, rig.pool, rig.tail]) {
      for (const value of Object.values(ellipse)) expect(Number.isFinite(value)).toBe(true);
      expect(ellipse.across).toBeGreaterThan(0);
      expect(ellipse.along).toBeGreaterThan(0);
    }
  });

  test('the lamp stands where `column` puts it, and the throw hangs plumb below it', () => {
    for (const column of [0, 0.25, 0.5, 0.75, 1]) {
      const rig = lampRig(rigInput({ column }));
      expect(rig.lensX).toBeCloseTo(column * WIDTH, 6);
      expect(rig.pool.x).toBeCloseTo(rig.lensX, 6);
      expect(rig.hotspot.x).toBeCloseTo(rig.lensX, 6);
      expect(rig.tail.x).toBeCloseTo(rig.lensX, 6);
    }
  });

  test('`anchor` is a viewport fraction, measured off the viewport top edge', () => {
    for (const anchor of [0, 0.1, 0.26, 0.5, 1]) {
      const rig = lampRig(rigInput({ anchor }));
      expect(rig.lensY - MARGIN).toBeCloseTo(anchor * VIEWPORT, 6);
    }
  });

  test('nothing about the rig can depend on host height or scroll position', () => {
    // This is the load-bearing property of the whole design: if either leaked
    // into the rig, the gradients would have to be repainted at every scroll
    // step instead of painted once and translated.
    const keys = Object.keys(rigInput());
    expect(keys).not.toContain('height');
    expect(keys).not.toContain('progress');
    // The lens holds its viewport line regardless of how wide the host is, too:
    // only the pool's size is allowed to notice a narrow one.
    expect(lampRig(rigInput({ width: 400 })).lensY).toBe(lampRig(rigInput()).lensY);
  });

  test('the throw lands below the lens, and `drop` says how far', () => {
    for (const drop of [0.05, 0.2, 0.3, 0.6]) {
      const rig = lampRig(rigInput({ drop }));
      expect(rig.pool.y - rig.lensY).toBeCloseTo(drop * VIEWPORT, 6);
      expect(rig.pool.y).toBeGreaterThan(rig.lensY);
    }
  });

  test('the throw is elongated down the page, never squat', () => {
    for (const stretch of [1, 1.55, 3]) {
      const rig = lampRig(rigInput({ stretch }));
      expect(rig.pool.along).toBeCloseTo(rig.pool.across * stretch, 6);
      expect(rig.pool.along).toBeGreaterThanOrEqual(rig.pool.across);
    }
  });

  test('a stretch below 1 is floored rather than inverting the axes', () => {
    const rig = lampRig(rigInput({ stretch: 0.2 }));
    expect(rig.pool.along).toBeCloseTo(rig.pool.across, 6);
  });

  test('the pool is sized off the lesser of host width and viewport height', () => {
    expect(lampRig(rigInput({ width: 4000 })).pool.across).toBeCloseTo(0.21 * VIEWPORT, 6);
    expect(lampRig(rigInput({ width: 400 })).pool.across).toBeCloseTo(0.21 * 400, 6);
  });

  test('the hotspot sits inside the pool, at the lamp end of it', () => {
    const rig = lampRig(rigInput());
    expect(rig.hotspot.y).toBeLessThan(rig.pool.y);
    expect(rig.hotspot.y).toBeGreaterThan(rig.pool.y - rig.pool.along);
    expect(rig.hotspot.across).toBeLessThan(rig.pool.across);
    expect(rig.hotspot.along).toBeLessThan(rig.pool.along);
  });

  test('the tail runs out past the pool, away from the lamp', () => {
    const rig = lampRig(rigInput());
    expect(rig.tail.y).toBeGreaterThan(rig.pool.y);
    expect(rig.tail.along).toBeGreaterThan(rig.pool.along);
    expect(rig.tail.across).toBeGreaterThan(rig.pool.across);
    // The opening just reaches above the lamp line, but not by more than the
    // pool's short radius: the air above stays night while the ground gets a
    // long ramp into the throw instead of a rim around it.
    expect(rig.tail.y - rig.tail.along).toBeLessThan(rig.lensY);
    expect(rig.tail.y - rig.tail.along).toBeGreaterThan(rig.lensY - rig.pool.across);
  });

  test('the mist reaches the ground it lights, and no further than the tail', () => {
    const rig = lampRig(rigInput());
    expect(rig.coneHalfAngle).toBeGreaterThan(0);
    expect(rig.coneHalfAngle).toBeLessThan(90);
    expect(rig.coneLength).toBeGreaterThan(rig.pool.y - rig.lensY);
    expect(rig.coneLength).toBeLessThan(rig.tail.y + rig.tail.along - rig.lensY);
  });

  test('the throw and mist boxes contain every pixel their gradients can paint', () => {
    const rig = lampRig(rigInput());
    expect(rig.throwBox.x).toBeLessThanOrEqual(rig.tail.x - rig.tail.across);
    expect(rig.throwBox.x + rig.throwBox.width).toBeGreaterThanOrEqual(
      rig.tail.x + rig.tail.across,
    );
    expect(rig.throwBox.y).toBeLessThan(rig.lensY);
    expect(rig.throwBox.y + rig.throwBox.height).toBeGreaterThanOrEqual(
      rig.tail.y + rig.tail.along,
    );
    expect(rig.coneBox.x + rig.coneBox.width / 2).toBeCloseTo(rig.lensX, 6);
    expect(rig.coneBox.y).toBeCloseTo(rig.lensY, 6);
    expect(rig.coneBox.height).toBeCloseTo(rig.coneLength, 6);
  });

  test('a shorter throw makes a wider cone, having less distance to spread over', () => {
    expect(lampRig(rigInput({ drop: 0.12 })).coneHalfAngle).toBeGreaterThan(
      lampRig(rigInput({ drop: 0.6 })).coneHalfAngle,
    );
  });

  test('the mast stands on the side the lamp is already nearer', () => {
    expect(lampRig(rigInput({ column: 0.1 })).fixture.side).toBe(-1);
    expect(lampRig(rigInput({ column: 0.5 })).fixture.side).toBe(-1);
    expect(lampRig(rigInput({ column: 0.9 })).fixture.side).toBe(1);
  });

  test('the fixture is sized off the viewport and clamped to lamp-sized', () => {
    const tiny = lampRig(rigInput({ viewportHeight: 200 })).fixture;
    const huge = lampRig(rigInput({ viewportHeight: 4000 })).fixture;
    // A twentyfold viewport must not give a twentyfold lamp.
    expect(huge.headWidth / tiny.headWidth).toBeLessThan(3);
    for (const fixture of [tiny, huge]) {
      expect(fixture.headWidth).toBeGreaterThan(fixture.headHeight);
      expect(fixture.armLength).toBeGreaterThan(fixture.headWidth);
      expect(fixture.armThickness).toBeGreaterThan(0);
      expect(fixture.mastThickness).toBeGreaterThanOrEqual(fixture.armThickness);
    }
  });

  test('the fixture box contains the hardware without carrying a viewport-wide transparent band', () => {
    const rig = lampRig(rigInput());
    expect(rig.fixtureBox.x).toBeLessThan(rig.lensX);
    expect(rig.fixtureBox.x + rig.fixtureBox.width).toBeGreaterThan(rig.lensX);
    expect(rig.fixtureBox.height).toBe(rig.lensY);
    expect(rig.fixtureBox.width).toBeLessThan(WIDTH * 0.25);
    expect(rig.fixtureBox.height).toBeLessThan(rig.height * 0.5);
  });

  test('a zero-sized host and a zero-height viewport produce numbers, not NaN', () => {
    for (const input of [
      rigInput({ width: 0 }),
      rigInput({ viewportHeight: 0 }),
      rigInput({ width: 0, viewportHeight: 0 }),
      rigInput({ width: -50, viewportHeight: -50, spread: -1, drop: -1, anchor: -1 }),
    ]) {
      const rig = lampRig(input);
      const numbers = [
        rig.height,
        rig.lensX,
        rig.lensY,
        rig.coneHalfAngle,
        rig.coneLength,
        ...Object.values(rig.pool),
        ...Object.values(rig.hotspot),
        ...Object.values(rig.tail),
        rig.fixture.armLength,
        rig.fixture.headWidth,
        rig.fixture.mastThickness,
      ];
      for (const value of numbers) expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('street light band placement', () => {
  test('progress walks the band down the host, one way, without turning back', () => {
    let previous = -Infinity;
    for (const progress of SAMPLES) {
      const y = bandOffset(bandInput({ progress }));
      expect(y).toBeGreaterThan(previous);
      previous = y;
    }
  });

  test('the lamp holds one viewport line while the host walks under it', () => {
    const rig = lampRig(rigInput());
    // The lens sits at `bandY + lensY` in host space and the viewport's top edge
    // at `bandY + MARGIN`; what the reader sees is the gap between them, and the
    // whole effect rests on that gap not moving.
    for (const progress of SAMPLES) {
      const bandY = bandOffset(bandInput({ progress }));
      expect(bandY + rig.lensY - (bandY + MARGIN)).toBeCloseTo(0.26 * VIEWPORT, 6);
    }
  });

  test('the host walks the full distance under the lamp, and overshoots at both ends', () => {
    const rig = lampRig(rigInput());
    const lensInHost = (progress: number) => bandOffset(bandInput({ progress })) + rig.lensY;
    expect(lensInHost(0)).toBeLessThan(0);
    expect(lensInHost(1)).toBeGreaterThan(HEIGHT);
  });

  test('the band inverts `scrollProgress` exactly, so hand-driven progress lands where scroll would', () => {
    const elementTop = 4321;
    for (const [start, end] of [
      [1, 0],
      [0.85, 0.15],
      [1.2, -0.2],
    ]) {
      const span = HEIGHT + VIEWPORT * (start - end);
      for (const step of SAMPLES) {
        const scrollY = elementTop - VIEWPORT * start + span * step;
        const progress = scrollProgress({
          scrollY,
          viewportHeight: VIEWPORT,
          elementTop,
          elementHeight: HEIGHT,
          start,
          end,
        });
        const band = bandOffset(bandInput({ progress, scrollStart: start, scrollEnd: end }));
        expect(band + MARGIN).toBeCloseTo(scrollY - elementTop, 6);
      }
    }
  });

  test('the band always covers whatever of the host the reader can see', () => {
    const rig = lampRig(rigInput());
    for (const progress of SAMPLES) {
      const bandTop = bandOffset(bandInput({ progress }));
      const viewportTop = bandTop + MARGIN;
      const visibleTop = Math.max(0, viewportTop);
      const visibleBottom = Math.min(HEIGHT, viewportTop + VIEWPORT);
      if (visibleBottom <= visibleTop) continue;
      expect(bandTop).toBeLessThanOrEqual(visibleTop);
      expect(bandTop + rig.height).toBeGreaterThanOrEqual(visibleBottom);
    }
  });

  test('progress outside 0..1 clamps instead of running the band off forever', () => {
    expect(bandOffset(bandInput({ progress: -4 }))).toBe(bandOffset(bandInput({ progress: 0 })));
    expect(bandOffset(bandInput({ progress: 9 }))).toBe(bandOffset(bandInput({ progress: 1 })));
  });

  test('a degenerate host and viewport produce a number, not NaN', () => {
    for (const input of [
      bandInput({ height: 0, viewportHeight: 0 }),
      bandInput({ height: -100, viewportHeight: -100 }),
      bandInput({ height: 0, viewportHeight: 0, scrollStart: 0, scrollEnd: 0 }),
    ]) {
      expect(Number.isFinite(bandOffset(input))).toBe(true);
    }
  });
});

describe('street light sway', () => {
  test('time zero is the rest position, so a stopped lamp holds a deliberate frame', () => {
    const shift = swayShift(0, 12, 5200);
    expect(shift.head.x).toBeCloseTo(0, 6);
    expect(shift.head.y).toBeCloseTo(0, 6);
    expect(shift.pool.x).toBeCloseTo(0, 6);
    expect(shift.pool.y).toBeCloseTo(0, 6);
  });

  test('zero amplitude is exactly still', () => {
    for (const elapsed of [0, 700, 4300, 91_000]) {
      const shift = swayShift(elapsed, 0, 5200);
      expect(shift.head).toEqual({ x: 0, y: 0 });
      expect(shift.pool).toEqual({ x: 0, y: 0 });
    }
  });

  test('the head never swings past the stated amplitude', () => {
    for (let elapsed = 0; elapsed < 26_000; elapsed += 37) {
      const shift = swayShift(elapsed, 10, 5200);
      expect(Math.abs(shift.head.x)).toBeLessThanOrEqual(10 + 1e-6);
      expect(Math.abs(shift.head.y)).toBeLessThanOrEqual(10 + 1e-6);
    }
  });

  test('the pool at the far end of the throw swings further than the head, and the same way', () => {
    let poolWon = 0;
    for (let elapsed = 60; elapsed < 12_000; elapsed += 60) {
      const shift = swayShift(elapsed, 9, 5200);
      if (Math.abs(shift.pool.x) > Math.abs(shift.head.x) + 1e-9) poolWon += 1;
      expect(Math.sign(shift.pool.x)).toBe(Math.sign(shift.head.x));
    }
    expect(poolWon).toBeGreaterThan(150);
  });

  test('the lift never rises above the hang point, at either end of the arc', () => {
    for (let elapsed = 0; elapsed < 26_000; elapsed += 41) {
      expect(swayShift(elapsed, 10, 5200).head.y).toBeLessThanOrEqual(1e-9);
    }
  });

  test('the pool takes a smaller share of the lift than of the swing', () => {
    const shift = swayShift(1300, 10, 5200);
    expect(Math.abs(shift.pool.y / shift.head.y)).toBeLessThan(
      Math.abs(shift.pool.x / shift.head.x),
    );
  });
});

describe('street light buzz', () => {
  test('zero depth is a steady lamp, exactly', () => {
    for (const elapsed of [0, 250, 5000, 240_000]) expect(buzzGain(elapsed, 0)).toBe(1);
  });

  test('gain stays inside 1 - depth .. 1 for every depth', () => {
    for (const depth of [0.05, 0.15, 0.5, 1]) {
      for (let elapsed = 0; elapsed < 40_000; elapsed += 13) {
        const gain = buzzGain(elapsed, depth);
        expect(gain).toBeLessThanOrEqual(1 + 1e-6);
        expect(gain).toBeGreaterThanOrEqual(1 - depth - 1e-6);
      }
    }
  });

  test('the dropout is rare and brief, not a throb', () => {
    let deep = 0;
    let samples = 0;
    for (let elapsed = 0; elapsed < 60_000; elapsed += 20) {
      samples += 1;
      if (buzzGain(elapsed, 1) < 0.5) deep += 1;
    }
    expect(deep).toBeGreaterThan(0);
    expect(deep / samples).toBeLessThan(0.08);
  });

  test('full depth reaches the floor on a dropout crest', () => {
    let lowest = 1;
    for (let elapsed = 0; elapsed < 60_000; elapsed += 5) {
      lowest = Math.min(lowest, buzzGain(elapsed, 1));
    }
    expect(lowest).toBeLessThan(0.05);
  });
});
