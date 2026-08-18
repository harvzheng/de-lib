/**
 * Deterministic geometry for the burn-through holes. Pure and DOM-free so the
 * placement can be exercised without a browser.
 */

import { clamp01, lerp, mulberry32 } from '../../core/math';

export interface BurnHole {
  /** Centre, 0..1 fraction of the frame's width and height respectively. */
  x: number;
  y: number;
  /** Radius as a fraction of the frame's shorter side. */
  radius: number;
  /** Progress at which the hole starts to open. */
  onset: number;
  /** Span of progress over which the hole reaches full size. */
  span: number;
  /** A per-hole 0..360 value used to desynchronise ember flicker and edge softness — not a shape rotation, since a rotated circle is unchanged. */
  variance: number;
}

/** Keeps holes off the frame edge; the roughened edge still overshoots this a little. */
const MARGIN_Y = 0.16;
const MIN_RADIUS = 0.09;
const MAX_RADIUS = 0.2;
const MIN_SPAN = 0.22;
const MAX_SPAN = 0.4;

/**
 * `aspect` is the frame's width / height. The horizontal margin is the
 * vertical one divided by aspect, so a hole keeps the same physical distance
 * from the left/right edge as from the top/bottom in a wide frame — without
 * it, holes would crowd the short edges of a landscape shot.
 */
export function buildBurnHoles(seed: number, count: number, aspect: number): BurnHole[] {
  const random = mulberry32(seed);
  const marginX = MARGIN_Y / Math.max(aspect, 0.1);
  const holes: BurnHole[] = [];

  for (let i = 0; i < count; i += 1) {
    // Onsets spread across the first ~60% of the travel so every hole has
    // finished blooming well before progress reaches 1; the random offset
    // keeps the spacing from reading as an evenly-spaced metronome.
    const base = count > 1 ? i / (count - 1) : 0;
    const onset = clamp01(base * 0.6 + random() * 0.15);

    holes.push({
      x: lerp(marginX, 1 - marginX, random()),
      y: lerp(MARGIN_Y, 1 - MARGIN_Y, random()),
      radius: lerp(MIN_RADIUS, MAX_RADIUS, random()),
      onset,
      span: lerp(MIN_SPAN, MAX_SPAN, random()),
      variance: random() * 360,
    });
  }

  return holes;
}
