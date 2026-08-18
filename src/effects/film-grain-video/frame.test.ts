import { describe, expect, test } from 'bun:test';

import { DUST_SPECKS, createFrameState, updateFrameState } from './frame';
import { HALATION_AMBER, LOOKS, colorMatrix3, curveSamples } from './grade';
import type { FilmstockConfig } from './index';

const CONFIG: FilmstockConfig = {
  poster: undefined,
  renderer: 'auto',
  fps: 16,
  speed: 1,
  grain: 0.85,
  grainSize: 1.6,
  halation: 0.5,
  gateWeave: 0.4,
  vignette: 0.45,
  flicker: 0.2,
  flickerStyle: 'projector',
  flickerRate: 4,
  flash: 1,
  shutterBand: 0.3,
  colorBreathing: 0.25,
  dust: 0.3,
  look: 'kodak-gold-200',
  pauseOffscreen: true,
};

function stateAt(frame: number, config = CONFIG, reduced = false): Record<string, unknown> {
  const state = createFrameState();
  updateFrameState(state, frame, config, 1280, 800, reduced);
  return { ...state, specks: [...state.specks], scratch: [...state.scratch] };
}

describe('filmstock frame state', () => {
  test('one held frame always resolves to the same artefacts', () => {
    expect(stateAt(7)).toEqual(stateAt(7));
    expect(stateAt(8)).not.toEqual(stateAt(7));
  });

  test('reduced motion holds the gate still and suppresses every projector artefact', () => {
    // Over a span of frames, because a flash only lands on some of them.
    for (let frame = 0; frame < 40; frame += 1) {
      const state = createFrameState();
      updateFrameState(state, frame, CONFIG, 1280, 800, true);

      expect(state.exposure).toBe(1);
      expect(state.weaveX).toBe(0);
      expect(state.weaveY).toBe(0);
      expect(state.weaveRotation).toBe(0);
      expect(state.bandOpacity).toBe(0);
      expect(state.warmBreathing).toBe(0);
      expect(state.coolBreathing).toBe(0);
      expect(state.flashOpacity).toBe(0);
    }
  });

  test("the 'exposure' style leaves exposure alone as the only instability", () => {
    let flickered = false;
    for (let frame = 0; frame < 40; frame += 1) {
      const state = createFrameState();
      updateFrameState(state, frame, { ...CONFIG, flickerStyle: 'exposure' }, 1280, 800, false);

      if (state.exposure !== 1) flickered = true;
      expect(state.bandOpacity).toBe(0);
      expect(state.warmBreathing).toBe(0);
      expect(state.coolBreathing).toBe(0);
      expect(state.flashOpacity).toBe(0);
    }
    expect(flickered).toBe(true);
  });

  test('dust density scales the speck count and zero density clears the field', () => {
    const state = createFrameState();
    updateFrameState(state, 3, { ...CONFIG, dust: 1 }, 1280, 800, false);
    expect(state.speckCount).toBe(DUST_SPECKS);

    updateFrameState(state, 3, { ...CONFIG, dust: 0 }, 1280, 800, false);
    expect(state.speckCount).toBe(0);
    expect(state.scratchOpacity).toBe(0);
  });

  test('a zero-size box produces no NaN', () => {
    const state = createFrameState();
    updateFrameState(state, 5, CONFIG, 0, 0, false);

    for (const value of Object.values(state)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
    for (const value of state.specks) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('filmstock grade tables', () => {
  test('a feColorMatrix is transposed into the column order uniformMatrix3fv reads', () => {
    // SVG lists rows; GL takes columns, so element [column * 3 + row].
    const rows = HALATION_AMBER.trim()
      .split('\n')
      .map((row) => row.trim().split(/\s+/).map(Number));
    const columns = colorMatrix3(HALATION_AMBER);

    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        expect(columns[column * 3 + row]).toBeCloseTo(rows[row][column], 6);
      }
    }
  });

  test('the three channel curves interleave into one vec3 sample per step', () => {
    const look = LOOKS['kodak-gold-200'];
    const samples = curveSamples(look);
    const red = look.red.split(/\s+/).map(Number);
    const blue = look.blue.split(/\s+/).map(Number);

    expect(samples.length).toBe(red.length * 3);
    for (let i = 0; i < red.length; i += 1) {
      expect(samples[i * 3]).toBeCloseTo(red[i], 6);
      expect(samples[i * 3 + 2]).toBeCloseTo(blue[i], 6);
    }
    // The toe lifts blacks off zero and the shoulder stops short of white.
    expect(samples[0]).toBeGreaterThan(0);
    expect(samples[samples.length - 1]).toBeLessThan(1);
  });
});
